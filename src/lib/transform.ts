import { cellText, cleanNumber, isBlank, isBlankRow, parseNumber } from './normalize';
import { resolveLookup } from './lookups';
import type {
  ArenaMilestone,
  ArenaProgressConfig,
  ColumnMapping,
  Issue,
  LookupTable,
  Milestone,
  ParsedReward,
  ParsedRow,
  PreviewRow,
  RawSheet,
  RewardMilestone,
  TransformResult,
} from './types';

export interface TransformInput {
  progression: RawSheet;
  headerRowIndex: number;
  mapping: ColumnMapping;
  arenas: LookupTable;
  rewards: LookupTable;
}

/**
 * Reads the progression sheet into an intermediate row model.
 *
 * Blank arena cells are forward-filled from the row above, because sheets
 * commonly name the arena only on the first row of its block. A row is treated
 * as an arena milestone when it is the first row that introduces its arena.
 */
export function parseProgressionRows(
  sheet: RawSheet,
  headerRowIndex: number,
  mapping: ColumnMapping,
): { rows: ParsedRow[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const rows: ParsedRow[] = [];
  const seenArenas = new Set<string>();
  let carriedArena: string | null = null;

  for (let r = headerRowIndex + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    if (isBlankRow(row)) continue;

    const trophiesRaw = mapping.trophiesIndex === null ? null : row[mapping.trophiesIndex] ?? null;
    const arenaRaw = mapping.arenaIndex === null ? null : row[mapping.arenaIndex] ?? null;

    const rewards: ParsedReward[] = [];
    for (const slot of mapping.rewardSlots) {
      const name = cellText(row[slot.nameIndex] ?? null);
      if (name === null) continue;
      rewards.push({
        slotLabel: slot.label,
        name,
        amountRaw: slot.amountIndex === null ? null : row[slot.amountIndex] ?? null,
      });
    }

    // A row with no trophy value, no arena and no reward is sheet padding.
    if (isBlank(trophiesRaw) && rewards.length === 0 && isBlank(arenaRaw)) continue;

    const arenaCell = cellText(arenaRaw);
    if (arenaCell !== null) carriedArena = arenaCell;
    const arenaName = carriedArena;

    let isArenaMilestone = false;
    if (arenaName !== null) {
      const key = arenaName.toLowerCase();
      if (!seenArenas.has(key)) {
        seenArenas.add(key);
        isArenaMilestone = true;
      }
    }

    rows.push({ sheetRow: r + 1, trophiesRaw, arenaRaw, arenaName, rewards, isArenaMilestone });
  }

  if (rows.length === 0) {
    issues.push({
      severity: 'error',
      code: 'empty-progression',
      message: 'The progression sheet "' + sheet.name + '" contains no data rows below its header.',
    });
  }

  return { rows, issues };
}

interface TrophyParse {
  ok: boolean;
  value: number;
}

function readTrophies(row: ParsedRow, issues: Issue[], hasTrophyColumn: boolean): TrophyParse {
  if (!hasTrophyColumn) {
    issues.push({
      severity: 'error',
      code: 'no-trophy-column',
      message: 'No trophy column is mapped. Assign one in the column mapping panel.',
      sheetRow: row.sheetRow,
    });
    return { ok: false, value: NaN };
  }
  if (isBlank(row.trophiesRaw)) {
    issues.push({
      severity: 'error',
      code: 'missing-trophies',
      message: `Row ${row.sheetRow} has no trophy value.`,
      sheetRow: row.sheetRow,
    });
    return { ok: false, value: NaN };
  }
  const parsed = parseNumber(row.trophiesRaw);
  if (!parsed.ok) {
    issues.push({
      severity: 'error',
      code: 'invalid-trophies',
      message: `Row ${row.sheetRow} has a non-numeric trophy value ("${String(row.trophiesRaw)}").`,
      sheetRow: row.sheetRow,
    });
    return { ok: false, value: NaN };
  }
  return { ok: true, value: cleanNumber(parsed.value) };
}

type LookupKindLabel = 'Rewards' | 'Arenas';

function lookupFailureMessage(
  kind: LookupKindLabel,
  name: string,
  reason: 'missing' | 'ambiguous',
  candidates?: string[],
): string {
  const noun = kind === 'Arenas' ? 'Arena' : 'Reward';
  if (reason === 'ambiguous') {
    const list = (candidates ?? []).join(', ');
    return `${noun} "${name}" matches more than one row in the ${kind} lookup table (${list}).`;
  }
  return `${noun} "${name}" could not be found in the ${kind} lookup table.`;
}

/**
 * Turns parsed rows into the final milestone list.
 *
 * - The first row of each arena becomes an arena milestone. Its reward slots
 *   that carry no amount become `Unlocks` entries - any number of them.
 * - Every other populated reward slot becomes a `Trophies` / `RewardID` /
 *   `Amount` milestone, in sheet order.
 */
export function transform(input: TransformInput): TransformResult {
  const { progression, headerRowIndex, mapping, arenas, rewards } = input;
  const issues: Issue[] = [];
  const milestones: Milestone[] = [];
  const preview: PreviewRow[] = [];

  const parsed = parseProgressionRows(progression, headerRowIndex, mapping);
  issues.push(...parsed.issues);

  if (mapping.arenaIndex === null) {
    issues.push({
      severity: 'warning',
      code: 'no-arena-column',
      message: 'No arena column is mapped, so no arena milestones will be produced.',
    });
  }
  if (mapping.rewardSlots.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'no-reward-columns',
      message: 'No reward columns were detected on the progression sheet.',
    });
  }

  const hasTrophyColumn = mapping.trophiesIndex !== null;
  const arenaIds = new Set<string>();
  let arenaUnlockMilestones = 0;
  let rewardMilestones = 0;
  let previousTrophies: number | null = null;

  for (const row of parsed.rows) {
    const trophies = readTrophies(row, issues, hasTrophyColumn);

    if (trophies.ok) {
      if (previousTrophies !== null && trophies.value < previousTrophies) {
        issues.push({
          severity: 'warning',
          code: 'trophies-out-of-order',
          message: `Row ${row.sheetRow} requires ${trophies.value} trophies, below the previous row (${previousTrophies}). Milestones are emitted in sheet order.`,
          sheetRow: row.sheetRow,
        });
      }
      previousTrophies = trophies.value;
    }

    // On an arena row, reward slots with no amount are unlocks; anything that
    // carries an amount stays a regular reward milestone.
    const unlockRewards: ParsedReward[] = [];
    const amountRewards: ParsedReward[] = [];
    for (const reward of row.rewards) {
      if (row.isArenaMilestone && isBlank(reward.amountRaw)) unlockRewards.push(reward);
      else amountRewards.push(reward);
    }

    if (row.isArenaMilestone && row.arenaName !== null) {
      const arenaLookup = resolveLookup(arenas, row.arenaName);
      const unlocks: { RewardID: string }[] = [];

      for (const reward of unlockRewards) {
        const rewardLookup = resolveLookup(rewards, reward.name);
        if (!rewardLookup.ok) {
          issues.push({
            severity: 'error',
            code: 'unlock-reward-not-found',
            message:
              lookupFailureMessage('Rewards', reward.name, rewardLookup.reason, rewardLookup.candidates) +
              ` It is an arena unlock on row ${row.sheetRow}.`,
            sheetRow: row.sheetRow,
          });
          continue;
        }
        unlocks.push({ RewardID: rewardLookup.id });
      }

      if (!arenaLookup.ok) {
        issues.push({
          severity: 'error',
          code: 'arena-not-found',
          message:
            lookupFailureMessage('Arenas', row.arenaName, arenaLookup.reason, arenaLookup.candidates) +
            ` It is used on row ${row.sheetRow}.`,
          sheetRow: row.sheetRow,
        });
      } else if (trophies.ok) {
        arenaIds.add(arenaLookup.id);
        // Key insertion order below is the emitted JSON order.
        const milestone: ArenaMilestone = { Trophies: trophies.value, ArenaID: arenaLookup.id };
        if (unlocks.length > 0) {
          milestone.Unlocks = unlocks;
          arenaUnlockMilestones += 1;
        }
        milestones.push(milestone);
      }

      preview.push({
        trophies: trophies.ok ? trophies.value : null,
        type: unlockRewards.length > 0 ? 'Arena Unlock' : 'Arena',
        label: [row.arenaName, ...unlockRewards.map((r) => r.name)].join(' + '),
        amount: null,
        sheetRow: row.sheetRow,
      });
    }

    for (const reward of amountRewards) {
      if (row.isArenaMilestone) {
        issues.push({
          severity: 'warning',
          code: 'unlock-with-amount',
          message: `Row ${row.sheetRow} pairs arena unlock "${reward.name}" with an amount. Unlock entries carry no amount, so it was emitted as a separate reward milestone.`,
          sheetRow: row.sheetRow,
        });
      }

      const rewardLookup = resolveLookup(rewards, reward.name);
      if (!rewardLookup.ok) {
        issues.push({
          severity: 'error',
          code: 'reward-not-found',
          message:
            lookupFailureMessage('Rewards', reward.name, rewardLookup.reason, rewardLookup.candidates) +
            ` It is used on row ${row.sheetRow}.`,
          sheetRow: row.sheetRow,
        });
        continue;
      }

      if (isBlank(reward.amountRaw)) {
        issues.push({
          severity: 'error',
          code: 'missing-amount',
          message: `Reward "${reward.name}" on row ${row.sheetRow} has no amount.`,
          sheetRow: row.sheetRow,
        });
        continue;
      }

      const amount = parseNumber(reward.amountRaw);
      if (!amount.ok) {
        issues.push({
          severity: 'error',
          code: 'invalid-amount',
          message: `Reward "${reward.name}" on row ${row.sheetRow} has a non-numeric amount ("${String(reward.amountRaw)}").`,
          sheetRow: row.sheetRow,
        });
        continue;
      }

      if (trophies.ok) {
        // Key insertion order below is the emitted JSON order.
        const milestone: RewardMilestone = {
          Trophies: trophies.value,
          RewardID: rewardLookup.id,
          Amount: cleanNumber(amount.value),
        };
        milestones.push(milestone);
        rewardMilestones += 1;
      }

      preview.push({
        trophies: trophies.ok ? trophies.value : null,
        type: 'Reward',
        label: reward.name,
        amount: cleanNumber(amount.value),
        sheetRow: row.sheetRow,
      });
    }
  }

  if (parsed.rows.length > 0 && milestones.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-milestones',
      message: 'No valid milestones could be produced from the progression sheet.',
    });
  }

  const config: ArenaProgressConfig = { Milestones: milestones };
  const errors = issues.filter((issue) => issue.severity === 'error').length;

  return {
    config,
    preview,
    issues,
    stats: {
      milestones: milestones.length,
      arenas: arenaIds.size,
      arenaUnlockMilestones,
      rewardMilestones,
      errors,
      warnings: issues.length - errors,
    },
  };
}
