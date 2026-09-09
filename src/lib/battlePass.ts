import { findColumn, resolveColumns, sheetHeaders, type ColumnSpec } from './columns';
import { resolveLookup } from './lookups';
import { makeNameResolver } from './nameResolve';
import { cellText, isBlank, isBlankRow, parseNumber } from './normalize';
import type {
  BattlePassConfig,
  BattlePassPreviewRow,
  BattlePassReward,
  BattlePassTier,
  BattlePassTransformResult,
  Issue,
  LookupTable,
  RawCell,
  RawSheet,
} from './types';

/**
 * Turns the Battle Pass Settings workbook into `battlePassSettings`.
 *
 * Two tabs plus a lookup: a `Season` key/value tab holding the season scalars,
 * and a `Tiers` tab with one row per tier carrying the free and the premium
 * reward. Reward names are resolved through the Rewards lookup tab, exactly as
 * the shop does - reward IDs are never constructed from names.
 *
 * Three of the ten season fields do not come from the sheet at all. When the
 * season starts, how long it runs and what art the final reward wears are
 * decisions about a live season rather than descriptions of a ladder, and they
 * are the ones somebody wants to change without opening Drive and re-exporting
 * - to push a start back an hour, or to drop in the art once it exists. So the
 * console sets them, on the battle pass page, and hands them here as
 * `schedule`. The sheet keeps what it is good at: the ladder and the IDs.
 *
 * The tier list is positional in the client: tier 1 is `Tiers[0]`. A gap in
 * the tier numbers would silently shift every tier above it, so the numbers
 * must run 1..N, the same rule the match trophy places follow.
 */

/* --------------------------------------------------------------- season -- */

/** The season scalars, in output order. `Tiers` is appended after them. */
export const SEASON_KEYS = [
  'SeasonID',
  'SeasonName',
  'StartUtc',
  'DurationDays',
  'TokensPerTier',
  'PremiumProductID',
  'SkipTierCost',
  'SkipCurrencyID',
  'FinalRewardArt',
] as const;

export type SeasonKey = (typeof SEASON_KEYS)[number];

/**
 * The three the console owns. They are still resolved by name, so a sheet that
 * has not been tidied up yet is told its rows are ignored rather than told they
 * are settings the game does not read.
 */
export const CONSOLE_SEASON_KEYS = ['StartUtc', 'DurationDays', 'FinalRewardArt'] as const;

export type ConsoleSeasonKey = (typeof CONSOLE_SEASON_KEYS)[number];

/** The scalars the Season tab is still the source of. */
export const SHEET_SEASON_KEYS = SEASON_KEYS.filter(
  (key): key is Exclude<SeasonKey, ConsoleSeasonKey> =>
    !(CONSOLE_SEASON_KEYS as readonly string[]).includes(key),
);

function isConsoleKey(key: SeasonKey): key is ConsoleSeasonKey {
  return (CONSOLE_SEASON_KEYS as readonly string[]).includes(key);
}

const SEASON_RESOLVER = makeNameResolver(SEASON_KEYS);

/** How the sheet spells each setting, and how messages name it. */
const SEASON_TITLES: Record<SeasonKey, string> = {
  SeasonID: 'Season ID',
  SeasonName: 'Season Name',
  StartUtc: 'Start (UTC)',
  DurationDays: 'Duration Days',
  TokensPerTier: 'Tokens Per Tier',
  PremiumProductID: 'Premium Product ID',
  SkipTierCost: 'Skip Tier Cost',
  SkipCurrencyID: 'Skip Currency ID',
  FinalRewardArt: 'Final Reward Art',
};


const SETTING_LABELS = ['setting', 'settings', 'key', 'name', 'parameter', 'field'];
const VALUE_LABELS = ['value', 'values', 'input'];

/** `pass.<name>`, the convention the client and the shop product share. */
const SEASON_ID_PATTERN = /^pass\.[a-z0-9]+$/;
/** The shop's own ID convention, checked here only as a spelling hint. */
const PRODUCT_ID_PATTERN = /^shop\.[a-z0-9]+(\.[a-z0-9]+)+$/;

/**
 * `YYYY-MM-DD HH:mm`. A cell formatted as a real date arrives as an ISO
 * string (SheetJS reads dates as `Date`, and the workbook reader stringifies
 * them), so seconds and a trailing `Z` are accepted and dropped on the way out.
 */
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?Z?)?$/;

/** Canonicalizes a start time, or returns null when it is not a timestamp. */
export function parseStartUtc(raw: string): string | null {
  const match = TIMESTAMP.exec(raw.trim());
  if (match === null) return null;
  const [, year, month, day, hour = '00', minute = '00'] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)),
  );
  // The round-trip catches 2026-02-30 and 25:00, which the pattern allows.
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute)
  ) {
    return null;
  }
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/* ------------------------------------------------------------- schedule -- */

/**
 * The three fields the console owns rather than the sheet.
 *
 * `startUtc` is canonical `YYYY-MM-DD HH:mm`, the same shape the sheet used to
 * carry and the client still expects; `finalRewardArt` is empty when there is
 * no art, which is the one value the game accepts blank.
 */
export interface BattlePassSchedule {
  startUtc: string;
  durationDays: number;
  finalRewardArt: string;
}

/** What the panel opens on before the live season or a stored value replaces it. */
export const EMPTY_SCHEDULE: BattlePassSchedule = {
  startUtc: '',
  durationDays: 30,
  finalRewardArt: '',
};

/**
 * Checks the console-set fields, in the same voice the sheet checks get.
 *
 * The schema gate refuses these values too, but it reports in schema language
 * after the fact. Reporting them here puts them in the page's own issue list,
 * beside the sheet's, which is where somebody looking for what is blocking the
 * publish will actually look.
 */
export function validateSchedule(schedule: BattlePassSchedule): Issue[] {
  const issues: Issue[] = [];

  if (schedule.startUtc.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'battlepass-schedule-start-missing',
      message: 'The season has no start time. Set it on the battle pass page.',
    });
  } else if (parseStartUtc(schedule.startUtc) === null) {
    issues.push({
      severity: 'error',
      code: 'battlepass-schedule-start-invalid',
      message: `The season start must be a UTC timestamp written as YYYY-MM-DD HH:mm, not ${JSON.stringify(schedule.startUtc)}.`,
    });
  }

  if (!Number.isInteger(schedule.durationDays) || schedule.durationDays < 1) {
    // An empty box arrives as 0, and "not 0" would be describing the empty box
    // back at somebody rather than telling them anything.
    const seen =
      Number.isFinite(schedule.durationDays) && schedule.durationDays !== 0
        ? `, not ${schedule.durationDays}`
        : '';
    issues.push({
      severity: 'error',
      code: 'battlepass-schedule-duration-invalid',
      message: `The season duration must be a whole number of days, 1 or more${seen}. Set it on the battle pass page.`,
    });
  }

  return issues;
}

/** The UTC instant a season ends, or null while the schedule is unusable. */
export function seasonEndUtc(schedule: BattlePassSchedule): string | null {
  const start = parseStartUtc(schedule.startUtc);
  if (start === null || !Number.isInteger(schedule.durationDays) || schedule.durationDays < 1) {
    return null;
  }
  const [date, time] = start.split(' ');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + schedule.durationDays, hour, minute));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())} ${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`;
}

interface SeasonCell {
  raw: RawCell;
  sheetRow: number;
}

/**
 * Reads the key/value tab into one raw cell per setting. The header row is
 * optional: a tab that starts straight into `Season ID | pass.season1` is read
 * from row 1, the same way the hero upgrade Growth tab is.
 */
function readSeason(sheet: RawSheet, issues: Issue[]): Partial<Record<SeasonKey, SeasonCell>> {
  const tab = `"${sheet.name}" tab`;
  const headers = sheetHeaders(sheet);
  let keyIndex = findColumn(headers, SETTING_LABELS);
  let valueIndex = findColumn(headers, VALUE_LABELS);
  const hasHeader = keyIndex !== -1 || valueIndex !== -1;
  if (keyIndex === -1) keyIndex = valueIndex === 0 ? 1 : 0;
  if (valueIndex === -1) valueIndex = keyIndex === 0 ? 1 : 0;

  const values: Partial<Record<SeasonKey, SeasonCell>> = {};
  for (let r = hasHeader ? 1 : 0; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    if (isBlankRow(row)) continue;
    const name = cellText(row[keyIndex] ?? null);
    if (name === null) {
      issues.push({
        severity: 'error',
        code: 'battlepass-setting-unnamed',
        message: `Row ${sheetRow} of the ${tab} has a value but no setting name.`,
        sheetRow,
      });
      continue;
    }
    const resolved = SEASON_RESOLVER.resolve(name);
    if (resolved.status === 'unknown') {
      const hint =
        resolved.suggestion === null
          ? `The settings are ${SEASON_KEYS.map((key) => SEASON_TITLES[key]).join(', ')}.`
          : `Did you mean "${SEASON_TITLES[resolved.suggestion]}"?`;
      issues.push({
        severity: 'error',
        code: 'battlepass-setting-unknown',
        message: `"${name}" on the ${tab} is not a battle pass setting the game reads. ${hint}`,
        sheetRow,
      });
      continue;
    }
    const key = resolved.name;
    if (isConsoleKey(key)) {
      issues.push({
        severity: 'warning',
        code: 'battlepass-setting-ignored',
        message: `"${SEASON_TITLES[key]}" on the ${tab} is ignored - the console sets it on the battle pass page now, so the sheet value has no effect. Delete the row to stop this warning.`,
        sheetRow,
      });
      continue;
    }
    if (values[key] !== undefined) {
      issues.push({
        severity: 'error',
        code: 'battlepass-setting-duplicate',
        message: `"${SEASON_TITLES[key]}" appears twice on the ${tab} (rows ${values[key]?.sheetRow} and ${sheetRow}).`,
        sheetRow,
      });
      continue;
    }
    values[key] = { raw: row[valueIndex] ?? null, sheetRow };
  }

  for (const key of SHEET_SEASON_KEYS) {
    if (values[key] === undefined) {
      issues.push({
        severity: 'error',
        code: 'battlepass-setting-missing',
        message: `The ${tab} has no "${SEASON_TITLES[key]}" row.`,
      });
    }
  }
  return values;
}

/** The typed season scalars the sheet owns. A field is absent when its cell failed. */
type SeasonValues = Partial<Record<Exclude<SeasonKey, ConsoleSeasonKey>, string | number>>;

/** Types each season scalar, reporting rather than substituting on failure. */
function typeSeason(
  cells: Partial<Record<Exclude<SeasonKey, ConsoleSeasonKey>, SeasonCell>>,
  sheetName: string,
  issues: Issue[],
): SeasonValues {
  const tab = `"${sheetName}" tab`;
  const values: SeasonValues = {};

  const fail = (code: string, key: Exclude<SeasonKey, ConsoleSeasonKey>, message: string) => {
    issues.push({
      severity: 'error',
      code,
      message: `"${SEASON_TITLES[key]}" on the ${tab} ${message}`,
      sheetRow: cells[key]?.sheetRow,
    });
  };

  const text = (key: Exclude<SeasonKey, ConsoleSeasonKey>): string | null => {
    const cell = cells[key];
    if (cell === undefined) return null;
    const value = cellText(cell.raw);
    if (value === null) {
      // A missing row was already reported; only a present but empty one is new.
      fail('battlepass-value-missing', key, 'is empty.');
      return null;
    }
    return value;
  };

  const whole = (key: Exclude<SeasonKey, ConsoleSeasonKey>, minimum: number) => {
    const cell = cells[key];
    if (cell === undefined) return;
    if (isBlank(cell.raw)) {
      fail('battlepass-value-missing', key, 'is empty.');
      return;
    }
    const parsed = parseNumber(cell.raw);
    if (!parsed.ok) {
      fail('battlepass-value-invalid', key, `is not a number (found ${JSON.stringify(cell.raw)}).`);
      return;
    }
    if (!Number.isInteger(parsed.value) || parsed.value < minimum) {
      fail(
        'battlepass-value-invalid',
        key,
        `must be a whole number of ${minimum} or more, not ${parsed.value}.`,
      );
      return;
    }
    values[key] = parsed.value;
  };

  const seasonId = text('SeasonID');
  if (seasonId !== null) {
    values.SeasonID = seasonId;
    if (!SEASON_ID_PATTERN.test(seasonId)) {
      issues.push({
        severity: 'warning',
        code: 'battlepass-season-id-format',
        message: `"${seasonId}" does not follow the pass.<name> pattern (lowercase letters and digits). Player progress is stored against this ID, so it is also what ends one season and starts the next.`,
        sheetRow: cells.SeasonID?.sheetRow,
      });
    }
  }

  const seasonName = text('SeasonName');
  if (seasonName !== null) values.SeasonName = seasonName;

  whole('TokensPerTier', 1);

  const productId = text('PremiumProductID');
  if (productId !== null) {
    values.PremiumProductID = productId;
    if (!PRODUCT_ID_PATTERN.test(productId)) {
      issues.push({
        severity: 'warning',
        code: 'battlepass-product-id-format',
        message: `"${productId}" does not follow the shop.<kind>.<name> pattern. The premium track is bought by exact product ID, so a mistyped one cannot be purchased.`,
        sheetRow: cells.PremiumProductID?.sheetRow,
      });
    }
  }

  whole('SkipTierCost', 0);

  const currency = text('SkipCurrencyID');
  if (currency !== null) values.SkipCurrencyID = currency;

  return values;
}

/* ---------------------------------------------------------------- tiers -- */

const COLUMN_LABELS = {
  tier: ['tier', 'tier number', 'tier no', 'number', 'level'],
  freeName: ['free reward', 'free', 'free track', 'free reward name'],
  freeAmount: ['free amount', 'free reward amount', 'amount free'],
  premiumName: ['premium reward', 'premium', 'premium track', 'premium reward name'],
  premiumAmount: ['premium amount', 'premium reward amount', 'amount premium'],
} as const;

type FieldName = keyof typeof COLUMN_LABELS;

const COLUMN_SPEC: ColumnSpec<FieldName> = {
  labels: COLUMN_LABELS,
  titles: {
    tier: 'Tier',
    freeName: 'Free Reward',
    freeAmount: 'Free Amount',
    premiumName: 'Premium Reward',
    premiumAmount: 'Premium Amount',
  },
  missingCode: 'battlepass-missing-column',
};

/** How each track's two columns are named in messages. */
const TRACK_TITLES: Record<'Free' | 'Premium', { name: string; amount: string }> = {
  Free: { name: 'Free Reward', amount: 'Free Amount' },
  Premium: { name: 'Premium Reward', amount: 'Premium Amount' },
};

interface TierRow {
  tier: number;
  sheetRow: number;
  free: BattlePassReward | null;
  premium: BattlePassReward | null;
  freeName: string | null;
  premiumName: string | null;
}

/* ------------------------------------------------------------- transform -- */

export interface BattlePassTransformInput {
  /** The Season key/value tab. */
  season: RawSheet;
  /** The Tiers tab: one row per tier. */
  tiers: RawSheet;
  /** Reward name -> reward ID, built from the Rewards lookup tab. */
  rewards: LookupTable;
  /** The start, duration and final reward art, set in the console. */
  schedule: BattlePassSchedule;
}

/** Builds the battle pass config. Tier numbers decide the output order. */
export function transformBattlePass(input: BattlePassTransformInput): BattlePassTransformResult {
  const issues: Issue[] = [];

  const seasonCells = readSeason(input.season, issues);
  const season = typeSeason(seasonCells, input.season.name, issues);
  issues.push(...validateSchedule(input.schedule));

  const sheet = input.tiers;
  const tab = `"${sheet.name}" tab`;
  const { index } = resolveColumns(
    sheet,
    ['tier', 'freeName', 'freeAmount', 'premiumName', 'premiumAmount'],
    COLUMN_SPEC,
    issues,
  );

  const rows: TierRow[] = [];
  const rowsByTier = new Map<number, number>();
  let dataRows = 0;

  for (let r = 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    if (isBlankRow(row)) continue;
    dataRows += 1;

    const tierCell = index.tier === undefined ? null : (row[index.tier] ?? null);
    if (isBlank(tierCell)) {
      if (index.tier !== undefined) {
        issues.push({
          severity: 'error',
          code: 'battlepass-tier-missing',
          message: `Row ${sheetRow} of the ${tab} has values but no tier number.`,
          sheetRow,
        });
      }
      continue;
    }
    const parsedTier = parseNumber(tierCell);
    if (!parsedTier.ok || !Number.isInteger(parsedTier.value) || parsedTier.value < 1) {
      issues.push({
        severity: 'error',
        code: 'battlepass-tier-invalid',
        message: `Row ${sheetRow} of the ${tab}: Tier must be a whole number of 1 or more, not ${JSON.stringify(tierCell)}.`,
        sheetRow,
      });
      continue;
    }
    const tier = parsedTier.value;

    const earlier = rowsByTier.get(tier);
    if (earlier !== undefined) {
      issues.push({
        severity: 'error',
        code: 'battlepass-tier-duplicate',
        message: `Tier ${tier} appears twice on the ${tab} (rows ${earlier} and ${sheetRow}). Each tier is listed once.`,
        sheetRow,
      });
      continue;
    }
    rowsByTier.set(tier, sheetRow);

    const where = `Tier ${tier} on the ${tab}`;
    let valid = true;
    const fail = (code: string, message: string) => {
      issues.push({ severity: 'error', code, message: `${where}: ${message}`, sheetRow });
      valid = false;
    };

    /** Reads one track's reward name and amount, or null when the track is empty. */
    const readTrack = (
      track: 'Free' | 'Premium',
      nameField: FieldName,
      amountField: FieldName,
    ): { reward: BattlePassReward | null; name: string | null } => {
      const titles = TRACK_TITLES[track];
      const nameColumn = index[nameField];
      const amountColumn = index[amountField];
      const nameCell = nameColumn === undefined ? null : (row[nameColumn] ?? null);
      const amountCell = amountColumn === undefined ? null : (row[amountColumn] ?? null);
      const name = cellText(nameCell);
      if (name === null) {
        if (!isBlank(amountCell)) {
          fail(
            'battlepass-reward-orphan-amount',
            `"${titles.name}" is empty but "${titles.amount}" is ${JSON.stringify(amountCell)}. Name the reward or clear the amount.`,
          );
        }
        return { reward: null, name: null };
      }
      const resolved = resolveLookup(input.rewards, name);
      if (!resolved.ok) {
        fail(
          resolved.reason === 'ambiguous' ? 'battlepass-reward-ambiguous' : 'battlepass-reward-unknown',
          resolved.reason === 'ambiguous'
            ? `"${name}" appears more than once on the Rewards tab with different IDs (${(resolved.candidates ?? []).join(', ')}).`
            : `"${name}" in "${titles.name}" has no entry on the Rewards tab, so there is no Reward ID to export.`,
        );
        return { reward: null, name };
      }
      if (isBlank(amountCell)) {
        fail(
          'battlepass-reward-amount-missing',
          `"${titles.name}" names ${name} but "${titles.amount}" is empty.`,
        );
        return { reward: null, name };
      }
      const parsed = parseNumber(amountCell);
      if (!parsed.ok) {
        fail(
          'battlepass-reward-amount-invalid',
          `"${titles.amount}" is not a number (found ${JSON.stringify(amountCell)}).`,
        );
        return { reward: null, name };
      }
      if (!Number.isInteger(parsed.value) || parsed.value < 1) {
        fail(
          'battlepass-reward-amount-invalid',
          `"${titles.amount}" must be a whole number of 1 or more, not ${parsed.value}.`,
        );
        return { reward: null, name };
      }
      return { reward: { RewardID: resolved.id, Amount: parsed.value }, name };
    };

    const free = readTrack('Free', 'freeName', 'freeAmount');
    const premium = readTrack('Premium', 'premiumName', 'premiumAmount');
    if (!valid) continue;

    if (free.reward === null && premium.reward === null) {
      issues.push({
        severity: 'warning',
        code: 'battlepass-tier-empty',
        message: `${where} grants nothing on either track. Reaching it would give the player no reward.`,
        sheetRow,
      });
    }

    rows.push({
      tier,
      sheetRow,
      free: free.reward,
      premium: premium.reward,
      freeName: free.name,
      premiumName: premium.name,
    });
  }

  rows.sort((a, b) => a.tier - b.tier);

  // Tiers are positional in the client: tier 1 is Tiers[0]. A gap would shift
  // every tier above it, so the numbers have to be a complete 1..N run.
  let sequenceOk = true;
  rows.forEach((row, i) => {
    if (row.tier !== i + 1) {
      if (sequenceOk) {
        issues.push({
          severity: 'error',
          code: 'battlepass-tier-gap',
          message: `The ${tab} skips tier ${i + 1}: expected tier ${i + 1} but found tier ${row.tier}. Tiers must run 1 to ${rows.length} with no gaps.`,
          sheetRow: row.sheetRow,
        });
      }
      sequenceOk = false;
    }
  });

  if (dataRows === 0) {
    issues.push({
      severity: 'error',
      code: 'battlepass-empty',
      message: `The ${tab} contains no tier rows.`,
    });
  }

  const tiers: BattlePassTier[] = (sequenceOk ? rows : []).map((row) => {
    const tier: BattlePassTier = {};
    if (row.free !== null) tier.Free = row.free;
    if (row.premium !== null) tier.Premium = row.premium;
    return tier;
  });

  // Anything that failed to parse is left as an empty string or a zero. The
  // error count already blocks the export, and the schema gate refuses these
  // values too, so a partial config can never be published.
  const config: BattlePassConfig = {
    SeasonID: String(season.SeasonID ?? ''),
    SeasonName: String(season.SeasonName ?? ''),
    StartUtc: parseStartUtc(input.schedule.startUtc) ?? input.schedule.startUtc,
    DurationDays: input.schedule.durationDays,
    TokensPerTier: Number(season.TokensPerTier ?? 0),
    PremiumProductID: String(season.PremiumProductID ?? ''),
    SkipTierCost: Number(season.SkipTierCost ?? 0),
    SkipCurrencyID: String(season.SkipCurrencyID ?? ''),
    FinalRewardArt: input.schedule.finalRewardArt,
    Tiers: tiers,
  };

  const preview: BattlePassPreviewRow[] = rows.map((row) => ({
    tier: row.tier,
    freeName: row.freeName,
    freeAmount: row.free?.Amount ?? null,
    premiumName: row.premiumName,
    premiumAmount: row.premium?.Amount ?? null,
    sheetRow: row.sheetRow,
  }));

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return {
    config,
    preview,
    issues,
    stats: {
      tiers: tiers.length,
      free: tiers.filter((tier) => tier.Free !== undefined).length,
      premium: tiers.filter((tier) => tier.Premium !== undefined).length,
      errors,
      warnings: issues.length - errors,
    },
  };
}

/** The season key order plus `Tiers`, exported for the schema gate. */
export const BATTLE_PASS_KEYS: readonly string[] = [...SEASON_KEYS, 'Tiers'];
