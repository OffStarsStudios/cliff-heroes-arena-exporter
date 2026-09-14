import { ARENA_BOT_DIFFICULTIES, botLevelName } from './arenaDifficulties';
import { requireNumber, resolveColumns, type ColumnSpec } from './columns';
import { isBlankRow } from './normalize';
import type { BotTuning, BotsConfig, BotsTransformResult, BotPreviewRow, Issue, RawSheet } from './types';

/**
 * Turns the Bots tab into `botsSettings`.
 *
 * One row per bot level: the level number and the eight tuning values the
 * client reads.
 *
 * The level is not a free number. The client reads it into the same `BotLevel`
 * enum the arenas config names its bots by, so the only levels that mean
 * anything are 0 (`VeryEasy`) through 4 (`VeryHard`) - see
 * `ARENA_BOT_DIFFICULTIES`, which is that enum in its declared order. The
 * client then looks each difficulty up in this table by value rather than
 * indexing into it, so a level outside the enum matches nothing and a
 * difficulty left out of the table is one the client logs and leaves authored.
 * Both are refused here: every difficulty is tuned exactly once, or nothing is
 * exported.
 */

const COLUMN_LABELS = {
  level: ['level', 'bot level', 'lvl'],
  minJumpInterval: ['min jump interval', 'minimum jump interval', 'min jump'],
  maxJumpInterval: ['max jump interval', 'maximum jump interval', 'max jump'],
  minDodgeChance: ['min dodge chance', 'minimum dodge chance', 'min dodge'],
  maxDodgeChance: ['max dodge chance', 'maximum dodge chance', 'max dodge'],
  raycastDistance: ['raycast distance', 'ray cast distance', 'raycast'],
  raycastInterval: ['raycast interval', 'ray cast interval'],
  minFireInterval: ['min fire interval', 'minimum fire interval', 'min fire'],
  maxFireInterval: ['max fire interval', 'maximum fire interval', 'max fire'],
} as const;

type FieldName = keyof typeof COLUMN_LABELS;

const FIELDS: FieldName[] = [
  'level',
  'minJumpInterval',
  'maxJumpInterval',
  'minDodgeChance',
  'maxDodgeChance',
  'raycastDistance',
  'raycastInterval',
  'minFireInterval',
  'maxFireInterval',
];

const TITLES: Record<FieldName, string> = {
  level: 'Level',
  minJumpInterval: 'Min Jump Interval',
  maxJumpInterval: 'Max Jump Interval',
  minDodgeChance: 'Min Dodge Chance',
  maxDodgeChance: 'Max Dodge Chance',
  raycastDistance: 'Raycast Distance',
  raycastInterval: 'Raycast Interval',
  minFireInterval: 'Min Fire Interval',
  maxFireInterval: 'Max Fire Interval',
};

const COLUMN_SPEC: ColumnSpec<FieldName> = {
  labels: COLUMN_LABELS,
  titles: TITLES,
  missingCode: 'bots-missing-column',
};

const NUMBER_CODES = { missing: 'bots-missing-value', nonNumeric: 'bots-non-numeric' };

/** Output key order, exactly as the client reads it. */
const TUNING_KEYS = [
  ['MinJumpInterval', 'minJumpInterval'],
  ['MaxJumpInterval', 'maxJumpInterval'],
  ['MinDodgeChance', 'minDodgeChance'],
  ['MaxDodgeChance', 'maxDodgeChance'],
  ['RaycastDistance', 'raycastDistance'],
  ['RaycastInterval', 'raycastInterval'],
  ['MinFireInterval', 'minFireInterval'],
  ['MaxFireInterval', 'maxFireInterval'],
] as const;

export interface BotsTransformInput {
  /** The Bots tab. */
  bots: RawSheet;
}

/** Builds the bots config. Rows may be in any order; the level decides the output order. */
export function transformBots(input: BotsTransformInput): BotsTransformResult {
  const issues: Issue[] = [];
  const sheet = input.bots;
  const tab = `"${sheet.name}" tab`;

  const { index } = resolveColumns(sheet, FIELDS, COLUMN_SPEC, issues);

  const bots: BotTuning[] = [];
  const preview: BotPreviewRow[] = [];
  const rowsByLevel = new Map<number, number>();
  let dataRows = 0;

  for (let r = 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    if (isBlankRow(row)) continue;
    dataRows += 1;

    const level = requireNumber(row, index.level, `Row ${sheetRow} of the ${tab}: Level`, sheetRow, issues, NUMBER_CODES);
    if (level === null) continue;
    const highest = ARENA_BOT_DIFFICULTIES.length - 1;
    if (!Number.isInteger(level) || level < 0 || level > highest) {
      issues.push({
        severity: 'error',
        code: 'bots-level-invalid',
        message:
          `Row ${sheetRow} of the ${tab}: Level must be a whole number from 0 to ${highest}, not ${level}. ` +
          `The game has ${ARENA_BOT_DIFFICULTIES.length} difficulties - ` +
          `${ARENA_BOT_DIFFICULTIES.map((name, i) => `${i} ${name}`).join(', ')} - ` +
          'and a level outside them tunes no bot at all.',
        sheetRow,
      });
      continue;
    }

    const earlier = rowsByLevel.get(level);
    if (earlier !== undefined) {
      issues.push({
        severity: 'error',
        code: 'bots-level-duplicate',
        message: `${botLevelName(level)} (level ${level}) is tuned twice on the ${tab} (rows ${earlier} and ${sheetRow}). Each difficulty is tuned once.`,
        sheetRow,
      });
      continue;
    }
    rowsByLevel.set(level, sheetRow);
    const where = `${botLevelName(level)} (level ${level}) on the ${tab}`;

    const values: Partial<Record<FieldName, number>> = {};
    let complete = true;
    for (const [, field] of TUNING_KEYS) {
      const value = requireNumber(row, index[field], `${where}: ${TITLES[field]}`, sheetRow, issues, NUMBER_CODES);
      if (value === null) {
        complete = false;
        continue;
      }
      values[field] = value;
    }
    if (!complete) continue;

    let valid = true;
    const fail = (code: string, message: string) => {
      issues.push({ severity: 'error', code, message: `${where}: ${message}`, sheetRow });
      valid = false;
    };

    for (const field of ['minJumpInterval', 'maxJumpInterval', 'raycastInterval', 'minFireInterval', 'maxFireInterval'] as const) {
      if ((values[field] as number) <= 0) fail('bots-interval-not-positive', `${TITLES[field]} must be greater than 0, not ${values[field]}.`);
    }
    if ((values.raycastDistance as number) <= 0) {
      fail('bots-distance-not-positive', `Raycast Distance must be greater than 0, not ${values.raycastDistance}.`);
    }
    for (const field of ['minDodgeChance', 'maxDodgeChance'] as const) {
      const chance = values[field] as number;
      if (chance < 0 || chance > 1) fail('bots-chance-out-of-range', `${TITLES[field]} is a probability and must be between 0 and 1, not ${chance}.`);
    }
    for (const [min, max, what] of [
      ['minJumpInterval', 'maxJumpInterval', 'jump interval'],
      ['minDodgeChance', 'maxDodgeChance', 'dodge chance'],
      ['minFireInterval', 'maxFireInterval', 'fire interval'],
    ] as const) {
      if ((values[min] as number) > (values[max] as number)) {
        fail('bots-min-above-max', `the minimum ${what} (${values[min]}) is above the maximum (${values[max]}).`);
      }
    }
    if (!valid) continue;

    const tuning = { Level: level } as BotTuning;
    for (const [key, field] of TUNING_KEYS) tuning[key] = values[field] as number;
    bots.push(tuning);
    preview.push({
      level,
      name: botLevelName(level) as string,
      jump: [tuning.MinJumpInterval, tuning.MaxJumpInterval],
      dodge: [tuning.MinDodgeChance, tuning.MaxDodgeChance],
      raycast: [tuning.RaycastDistance, tuning.RaycastInterval],
      fire: [tuning.MinFireInterval, tuning.MaxFireInterval],
      sheetRow,
    });
  }

  bots.sort((a, b) => a.Level - b.Level);
  preview.sort((a, b) => a.level - b.level);

  // Every difficulty the game declares must be tuned: it looks each one up in
  // this table by value, and logs an error and keeps the authored tuning for
  // any it cannot find.
  const missing = ARENA_BOT_DIFFICULTIES.filter((_, level) => !rowsByLevel.has(level));
  const sequenceOk = missing.length === 0 && dataRows > 0;
  if (missing.length > 0 && dataRows > 0) {
    issues.push({
      severity: 'error',
      code: 'bots-level-gap',
      message:
        `The ${tab} tunes no ${missing.map((name) => `${name} (level ${ARENA_BOT_DIFFICULTIES.indexOf(name)})`).join(' or ')}. ` +
        `All ${ARENA_BOT_DIFFICULTIES.length} difficulties are tuned in one table, since the game keeps the values ` +
        'built into the build for any it does not find here.',
    });
  }

  if (sequenceOk) {
    for (let i = 1; i < bots.length; i += 1) {
      const harder = bots[i];
      const easier = bots[i - 1];
      if (harder.MaxDodgeChance < easier.MaxDodgeChance || harder.MinFireInterval > easier.MinFireInterval) {
        issues.push({
          severity: 'warning',
          code: 'bots-not-harder',
          message: `${botLevelName(harder.Level)} dodges less or fires slower than ${botLevelName(easier.Level)}. Higher difficulties are usually harder.`,
          sheetRow: preview[i].sheetRow,
        });
      }
    }
  }

  if (dataRows === 0) {
    issues.push({ severity: 'error', code: 'bots-empty', message: `The ${tab} contains no bot rows.` });
  }

  const exported = sequenceOk ? bots : [];
  // `Bots` and nothing beside it: the client's own config class holds only this
  // list, so a summary field such as the highest level would be read by nothing.
  const config: BotsConfig = { Bots: exported };
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return {
    config,
    preview: sequenceOk ? preview : [],
    issues,
    stats: { levels: exported.length, errors, warnings: issues.length - errors },
  };
}
