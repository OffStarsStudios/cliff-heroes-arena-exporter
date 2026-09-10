import { resolveColumns, type ColumnSpec } from './columns';
import { resolveLookup } from './lookups';
import { cellText, isBlank, isBlankRow, parseNumber } from './normalize';
import { SHOP_SOLD_IN } from './shop';
import type {
  BattlePassConfig,
  BattlePassPreviewRow,
  BattlePassReward,
  BattlePassTier,
  BattlePassTransformResult,
  Issue,
  LookupTable,
  RawSheet,
} from './types';

/**
 * Turns the Battle Pass Settings workbook into `battlePassSettings`.
 *
 * One tab plus a lookup: a `Tiers` tab with one row per tier carrying the free
 * and the premium reward, joined against the Rewards lookup tab exactly as the
 * shop does - reward IDs are never constructed from names.
 *
 * The season header does not come from the sheet at all. It used to: a
 * key/value `Season` tab held the ID, the name, the product, the currency and
 * the numbers, and every one of them was a decision about one live season
 * rather than a description of the ladder. Worse, half of them are IDs that
 * have to match another config exactly, and a spreadsheet cannot offer the
 * shop's actual product list or the game's actual currencies. So the console
 * owns the header - see `BattlePassSeason` - and hands it in as `season`.
 *
 * The tier list is positional in the client: tier 1 is `Tiers[0]`. A gap in
 * the tier numbers would silently shift every tier above it, so the numbers
 * must run 1..N, the same rule the match trophy places follow.
 */

/* ----------------------------------------------------------- output keys -- */

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

/* --------------------------------------------------------- the season -- */

/**
 * The season header, set in the console rather than read from the sheet.
 *
 * Every field here used to be a row on the Season tab, and every one of them
 * is the same kind of thing: a decision about one live season rather than a
 * description of the ladder. Which product buys the premium track, what the
 * season is called, when it starts, how long it runs - these are settled in
 * the hour before a season goes up, and half of them are IDs that have to
 * match something in another config exactly. A spreadsheet cell can hold
 * `shop.pass.season2.premuim` for a week without anybody noticing; a dropdown
 * built from the live shop cannot.
 *
 * So the sheet keeps what a spreadsheet is good at - the ladder, thirty rows
 * of rewards and amounts - and the console owns the header. `startUtc` is
 * canonical `YYYY-MM-DD HH:mm` because that is what the client reads, and
 * `finalRewardArt` is the one value the game accepts empty.
 */
export interface BattlePassSeason {
  seasonId: string;
  seasonName: string;
  startUtc: string;
  durationDays: number;
  tokensPerTier: number;
  premiumProductId: string;
  skipTierCost: number;
  skipCurrencyId: string;
  finalRewardArt: string;
}

/**
 * What a tier skip is paid in.
 *
 * `hardCurrency` is the value the live pass uses and the only one confirmed to
 * work in the client. The rest are the shop's own `SoldIn` values, offered
 * because they are the currencies the game demonstrably has - and warned about
 * when chosen, because nothing has yet confirmed the client reads them here.
 * When that is settled with the client, this list and its warning are the two
 * things to change.
 */
export const CONFIRMED_SKIP_CURRENCY = 'hardCurrency';

export const SKIP_CURRENCIES: readonly string[] = [CONFIRMED_SKIP_CURRENCY, ...SHOP_SOLD_IN];

/** What the panel opens on before the live season or a stored value replaces it. */
export const EMPTY_SEASON: BattlePassSeason = {
  seasonId: '',
  seasonName: '',
  startUtc: '',
  durationDays: 30,
  tokensPerTier: 100,
  premiumProductId: '',
  skipTierCost: 0,
  skipCurrencyId: CONFIRMED_SKIP_CURRENCY,
  finalRewardArt: '',
};

/**
 * The season after this one: `pass.season1` -> `pass.season2`.
 *
 * Player progress is stored against the season ID, so a new season needs a new
 * one, and the trailing number is how everybody here reads which season it is.
 * An ID with no number - `pass.winter` - has no successor worth guessing, and
 * gets null rather than an invented one.
 */
export function nextSeasonId(current: string): string | null {
  const match = /^(.*?)(\d+)$/.exec(current.trim());
  if (match === null) return null;
  return `${match[1]}${Number(match[2]) + 1}`;
}

/**
 * Checks the season header, in the same voice the sheet's own checks use.
 *
 * The schema gate refuses these values too, but it reports in schema language
 * after the fact. Reporting them here puts them in the same issue list as the
 * ladder's problems, which is where somebody looking for what is blocking the
 * publish will actually look.
 */
export function validateSeason(season: BattlePassSeason): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string) => {
    issues.push({ severity: 'error', code, message });
  };
  const warn = (code: string, message: string) => {
    issues.push({ severity: 'warning', code, message });
  };

  const whole = (value: number, minimum: number, code: string, title: string, unit: string) => {
    if (Number.isInteger(value) && value >= minimum) return;
    // An empty box arrives as 0, and "not 0" would be describing the empty box
    // back at somebody rather than telling them anything.
    const seen = Number.isFinite(value) && value !== 0 ? `, not ${value}` : '';
    error(code, `${title} must be ${unit} of ${minimum} or more${seen}.`);
  };

  const seasonId = season.seasonId.trim();
  if (seasonId === '') {
    error(
      'battlepass-season-id-missing',
      'The season has no ID. Player progress is stored against it, so it is also what ends one season and starts the next.',
    );
  } else if (!SEASON_ID_PATTERN.test(seasonId)) {
    warn(
      'battlepass-season-id-format',
      `"${seasonId}" does not follow the pass.<name> pattern (lowercase letters and digits). It is what player progress is stored against, so it is worth spelling the way the client expects.`,
    );
  }

  if (season.seasonName.trim() === '') {
    error('battlepass-season-name-missing', 'The season has no name. It is the title the player sees on the pass.');
  }

  if (season.startUtc.trim() === '') {
    error('battlepass-season-start-missing', 'The season has no start time.');
  } else if (parseStartUtc(season.startUtc) === null) {
    error(
      'battlepass-season-start-invalid',
      `The season start must be a UTC timestamp written as YYYY-MM-DD HH:mm, not ${JSON.stringify(season.startUtc)}.`,
    );
  }

  whole(season.durationDays, 1, 'battlepass-season-duration-invalid', 'The season duration', 'a whole number of days');
  whole(season.tokensPerTier, 1, 'battlepass-season-tokens-invalid', 'Tokens per tier', 'a whole number');

  const productId = season.premiumProductId.trim();
  if (productId === '') {
    error(
      'battlepass-product-id-missing',
      'No premium product is set, so the premium track would be visible with no way to buy it. Pick the shop product that sells this pass.',
    );
  } else if (!PRODUCT_ID_PATTERN.test(productId)) {
    warn(
      'battlepass-product-id-format',
      `"${productId}" does not follow the shop.<kind>.<name> pattern. The premium track is bought by exact product ID, so a mistyped one cannot be purchased.`,
    );
  }

  // A free skip is a legitimate setting; a negative one is not.
  whole(season.skipTierCost, 0, 'battlepass-skip-cost-invalid', 'The skip tier cost', 'a whole number');

  const currency = season.skipCurrencyId.trim();
  if (currency === '') {
    error('battlepass-skip-currency-missing', 'No skip currency is set, so a tier skip has nothing to charge.');
  } else if (currency !== CONFIRMED_SKIP_CURRENCY) {
    warn(
      'battlepass-skip-currency-unconfirmed',
      `"${currency}" as the skip currency has not been confirmed with the client. Only "${CONFIRMED_SKIP_CURRENCY}" is known to work, so this may not be chargeable in game until somebody checks it.`,
    );
  }

  return issues;
}

/** The UTC instant a season ends, or null while the window is unusable. */
export function seasonEndUtc(season: Pick<BattlePassSeason, 'startUtc' | 'durationDays'>): string | null {
  const start = parseStartUtc(season.startUtc);
  if (start === null || !Number.isInteger(season.durationDays) || season.durationDays < 1) {
    return null;
  }
  const [date, time] = start.split(' ');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + season.durationDays, hour, minute));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())} ${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`;
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
  /** The Tiers tab: one row per tier. */
  tiers: RawSheet;
  /** Reward name -> reward ID, built from the Rewards lookup tab. */
  rewards: LookupTable;
  /** The whole season header, set in the console. */
  season: BattlePassSeason;
}

/** Builds the battle pass config. Tier numbers decide the output order. */
export function transformBattlePass(input: BattlePassTransformInput): BattlePassTransformResult {
  const issues: Issue[] = [];

  const season = input.season;
  issues.push(...validateSeason(season));

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

  // An unset field is written as the empty string or the zero it already is.
  // The issue list above already blocks the export, and the schema gate
  // refuses these values too, so a half-filled season can never be published.
  const config: BattlePassConfig = {
    SeasonID: season.seasonId.trim(),
    SeasonName: season.seasonName.trim(),
    StartUtc: parseStartUtc(season.startUtc) ?? season.startUtc,
    DurationDays: season.durationDays,
    TokensPerTier: season.tokensPerTier,
    PremiumProductID: season.premiumProductId.trim(),
    SkipTierCost: season.skipTierCost,
    SkipCurrencyID: season.skipCurrencyId.trim(),
    FinalRewardArt: season.finalRewardArt,
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
