import { findColumn, requireNumber, resolveColumns, sheetHeaders, type ColumnSpec } from './columns';
import { makeNameResolver } from './nameResolve';
import { cellText, isBlank, isBlankRow, normalizeName, parseNumber } from './normalize';
import type {
  HeroUpgradeConfig,
  HeroUpgradePreviewRow,
  HeroUpgradeTransformResult,
  Issue,
  RarityCost,
  RawSheet,
} from './types';

/**
 * Turns the Hero Upgrade Settings workbook into `heroUpgradeSettings`.
 *
 * Two tabs: a `Growth` key/value tab holding the six scalars the client rolls
 * the cost curve out of, and a `Costs` tab with one row per rarity. The scalar
 * names are checked against a constant list with the same correction and
 * suggestion behaviour power parameters have, so a mistyped setting is
 * reported instead of silently dropped.
 */

/* ---------------------------------------------------------------- growth -- */

/** The scalar settings, in output order. */
const GROWTH_KEYS = [
  'CoinsGrowth',
  'CardsGrowth',
  'CoinsRounding',
  'CardsRounding',
  'ReferenceRarity',
  'CardsPayoutModifier',
] as const;

export type GrowthKey = (typeof GROWTH_KEYS)[number];

const GROWTH_RESOLVER = makeNameResolver(GROWTH_KEYS);

/** Display names for messages: the sheet convention spaces the words out. */
const GROWTH_TITLES: Record<GrowthKey, string> = {
  CoinsGrowth: 'Coins Growth',
  CardsGrowth: 'Cards Growth',
  CoinsRounding: 'Coins Rounding',
  CardsRounding: 'Cards Rounding',
  ReferenceRarity: 'Reference Rarity',
  CardsPayoutModifier: 'Cards Payout Modifier',
};

const SETTING_LABELS = ['setting', 'settings', 'key', 'name', 'parameter', 'field'];
const VALUE_LABELS = ['value', 'values', 'input'];

interface GrowthRead {
  values: Partial<Record<GrowthKey, { raw: unknown; sheetRow: number }>>;
}

/**
 * Reads the key/value tab. The header row is optional: a tab that starts
 * straight into `Coins Growth | 1.42` is read from row 1.
 */
function readGrowth(sheet: RawSheet, issues: Issue[]): GrowthRead {
  const tab = `"${sheet.name}" tab`;
  const headers = sheetHeaders(sheet);
  let keyIndex = findColumn(headers, SETTING_LABELS);
  let valueIndex = findColumn(headers, VALUE_LABELS);
  const hasHeader = keyIndex !== -1 || valueIndex !== -1;
  if (keyIndex === -1) keyIndex = valueIndex === 0 ? 1 : 0;
  if (valueIndex === -1) valueIndex = keyIndex === 0 ? 1 : 0;

  const values: GrowthRead['values'] = {};
  for (let r = hasHeader ? 1 : 0; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    if (isBlankRow(row)) continue;
    const name = cellText(row[keyIndex] ?? null);
    if (name === null) {
      issues.push({
        severity: 'error',
        code: 'heroupgrade-setting-unnamed',
        message: `Row ${sheetRow} of the ${tab} has a value but no setting name.`,
        sheetRow,
      });
      continue;
    }
    const resolved = GROWTH_RESOLVER.resolve(name);
    if (resolved.status === 'unknown') {
      const hint =
        resolved.suggestion === null
          ? `The settings are ${GROWTH_KEYS.map((key) => GROWTH_TITLES[key]).join(', ')}.`
          : `Did you mean "${GROWTH_TITLES[resolved.suggestion]}"?`;
      issues.push({
        severity: 'error',
        code: 'heroupgrade-setting-unknown',
        message: `"${name}" on the ${tab} is not a hero upgrade setting the game reads. ${hint}`,
        sheetRow,
      });
      continue;
    }
    const key = resolved.name;
    if (values[key] !== undefined) {
      issues.push({
        severity: 'error',
        code: 'heroupgrade-setting-duplicate',
        message: `"${GROWTH_TITLES[key]}" appears twice on the ${tab} (rows ${values[key]?.sheetRow} and ${sheetRow}).`,
        sheetRow,
      });
      continue;
    }
    values[key] = { raw: row[valueIndex] ?? null, sheetRow };
  }

  for (const key of GROWTH_KEYS) {
    if (values[key] === undefined) {
      issues.push({
        severity: 'error',
        code: 'heroupgrade-setting-missing',
        message: `The ${tab} has no "${GROWTH_TITLES[key]}" row.`,
      });
    }
  }
  return { values };
}

/* ----------------------------------------------------------------- costs -- */

const COST_LABELS = {
  rarity: ['rarity', 'hero rarity'],
  coinsBase: ['coins base', 'base coins', 'coins'],
  cardsBase: ['cards base', 'base cards', 'cards'],
  costModifier: ['cost modifier', 'cost multiplier'],
  growthModifier: ['growth modifier', 'growth multiplier'],
} as const;

type CostField = keyof typeof COST_LABELS;

const COST_TITLES: Record<CostField, string> = {
  rarity: 'Rarity',
  coinsBase: 'Coins Base',
  cardsBase: 'Cards Base',
  costModifier: 'Cost Modifier',
  growthModifier: 'Growth Modifier',
};

const COST_SPEC: ColumnSpec<CostField> = {
  labels: COST_LABELS,
  titles: COST_TITLES,
  missingCode: 'heroupgrade-missing-column',
};

const NUMBER_CODES = { missing: 'heroupgrade-missing-value', nonNumeric: 'heroupgrade-non-numeric' };

function readCosts(sheet: RawSheet, issues: Issue[]): { costs: RarityCost[]; preview: HeroUpgradePreviewRow[] } {
  const tab = `"${sheet.name}" tab`;
  const { index } = resolveColumns(sheet, ['rarity', 'coinsBase', 'cardsBase', 'costModifier', 'growthModifier'], COST_SPEC, issues);
  const costs: RarityCost[] = [];
  const preview: HeroUpgradePreviewRow[] = [];
  const rowsByRarity = new Map<string, number>();
  let dataRows = 0;

  for (let r = 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    if (isBlankRow(row)) continue;
    dataRows += 1;

    const rarity = index.rarity === undefined ? null : cellText(row[index.rarity]);
    if (rarity === null) {
      if (index.rarity !== undefined) {
        issues.push({
          severity: 'error',
          code: 'heroupgrade-rarity-missing',
          message: `Row ${sheetRow} of the ${tab} has values but no rarity.`,
          sheetRow,
        });
      }
      continue;
    }
    const key = normalizeName(rarity);
    const earlier = rowsByRarity.get(key);
    if (earlier !== undefined) {
      issues.push({
        severity: 'error',
        code: 'heroupgrade-rarity-duplicate',
        message: `"${rarity}" is priced twice on the ${tab} (rows ${earlier} and ${sheetRow}). Each rarity is priced once.`,
        sheetRow,
      });
      continue;
    }
    rowsByRarity.set(key, sheetRow);
    const where = `"${rarity}" on the ${tab}`;

    const coinsBase = requireNumber(row, index.coinsBase, `${where}: Coins Base`, sheetRow, issues, NUMBER_CODES);
    const cardsBase = requireNumber(row, index.cardsBase, `${where}: Cards Base`, sheetRow, issues, NUMBER_CODES);
    const costModifier = requireNumber(row, index.costModifier, `${where}: Cost Modifier`, sheetRow, issues, NUMBER_CODES);
    const growthModifier = requireNumber(row, index.growthModifier, `${where}: Growth Modifier`, sheetRow, issues, NUMBER_CODES);
    if (coinsBase === null || cardsBase === null || costModifier === null || growthModifier === null) continue;

    let valid = true;
    const fail = (code: string, message: string) => {
      issues.push({ severity: 'error', code, message: `${where}: ${message}`, sheetRow });
      valid = false;
    };
    if (!Number.isInteger(coinsBase) || coinsBase < 0) fail('heroupgrade-base-invalid', `Coins Base must be a whole number of 0 or more, not ${coinsBase}.`);
    if (!Number.isInteger(cardsBase) || cardsBase < 0) fail('heroupgrade-base-invalid', `Cards Base must be a whole number of 0 or more, not ${cardsBase}.`);
    if (costModifier <= 0) fail('heroupgrade-modifier-not-positive', `Cost Modifier must be greater than 0, not ${costModifier}.`);
    if (growthModifier <= 0) fail('heroupgrade-modifier-not-positive', `Growth Modifier must be greater than 0, not ${growthModifier}.`);
    if (!valid) continue;

    costs.push({ Rarity: rarity, CoinsBase: coinsBase, CardsBase: cardsBase, CostModifier: costModifier, GrowthModifier: growthModifier });
    preview.push({ rarity, coinsBase, cardsBase, costModifier, growthModifier, sheetRow });
  }

  if (dataRows === 0) {
    issues.push({ severity: 'error', code: 'heroupgrade-empty', message: `The ${tab} contains no rarity rows.` });
  }
  return { costs, preview };
}

/* ------------------------------------------------------------- transform -- */

export interface HeroUpgradeTransformInput {
  /** The Growth key/value tab. */
  growth: RawSheet;
  /** The Costs tab: one row per rarity. */
  costs: RawSheet;
}

function requireScalar(
  read: GrowthRead,
  key: GrowthKey,
  tab: string,
  issues: Issue[],
  check: (value: number) => string | null,
): number | null {
  const entry = read.values[key];
  if (entry === undefined) return null;
  const title = GROWTH_TITLES[key];
  if (isBlank(entry.raw as never)) {
    issues.push({ severity: 'error', code: 'heroupgrade-missing-value', message: `"${title}" on the ${tab} has no value.`, sheetRow: entry.sheetRow });
    return null;
  }
  const parsed = parseNumber(entry.raw as never);
  if (!parsed.ok) {
    issues.push({
      severity: 'error',
      code: 'heroupgrade-non-numeric',
      message: `"${title}" on the ${tab} must be a number, not ${JSON.stringify(entry.raw)}.`,
      sheetRow: entry.sheetRow,
    });
    return null;
  }
  const problem = check(parsed.value);
  if (problem !== null) {
    issues.push({ severity: 'error', code: 'heroupgrade-scalar-invalid', message: `"${title}" on the ${tab} ${problem}`, sheetRow: entry.sheetRow });
    return null;
  }
  return parsed.value;
}

/** Builds the hero upgrade config. Cost rows keep the sheet's order. */
export function transformHeroUpgrade(input: HeroUpgradeTransformInput): HeroUpgradeTransformResult {
  const issues: Issue[] = [];
  const growthTab = `"${input.growth.name}" tab`;

  const growth = readGrowth(input.growth, issues);
  const { costs, preview } = readCosts(input.costs, issues);

  const positive = (value: number) => (value > 0 ? null : `must be greater than 0, not ${value}.`);
  const positiveInteger = (value: number) =>
    Number.isInteger(value) && value >= 1 ? null : `must be a whole number of 1 or more, not ${value}.`;
  const nonNegative = (value: number) => (value >= 0 ? null : `must be 0 or more, not ${value}.`);

  const coinsGrowth = requireScalar(growth, 'CoinsGrowth', growthTab, issues, positive);
  const cardsGrowth = requireScalar(growth, 'CardsGrowth', growthTab, issues, positive);
  const coinsRounding = requireScalar(growth, 'CoinsRounding', growthTab, issues, positiveInteger);
  const cardsRounding = requireScalar(growth, 'CardsRounding', growthTab, issues, positiveInteger);
  const cardsPayoutModifier = requireScalar(growth, 'CardsPayoutModifier', growthTab, issues, nonNegative);

  for (const [key, value] of [['CoinsGrowth', coinsGrowth], ['CardsGrowth', cardsGrowth]] as const) {
    if (value !== null && value < 1) {
      issues.push({
        severity: 'warning',
        code: 'heroupgrade-growth-below-one',
        message: `"${GROWTH_TITLES[key]}" is ${value}, so each level costs less than the one before. Growth is usually above 1.`,
        sheetRow: growth.values[key]?.sheetRow,
      });
    }
  }

  let referenceRarity: string | null = null;
  const reference = growth.values.ReferenceRarity;
  if (reference !== undefined) {
    const text = cellText(reference.raw as never);
    if (text === null) {
      issues.push({ severity: 'error', code: 'heroupgrade-missing-value', message: `"Reference Rarity" on the ${growthTab} has no value.`, sheetRow: reference.sheetRow });
    } else {
      const priced = costs.find((cost) => normalizeName(cost.Rarity) === normalizeName(text));
      if (priced === undefined) {
        issues.push({
          severity: 'error',
          code: 'heroupgrade-reference-rarity-unpriced',
          message: `"Reference Rarity" is "${text}", but the Costs tab has no row for that rarity.${costs.length > 0 ? ` Priced rarities: ${costs.map((cost) => cost.Rarity).join(', ')}.` : ''}`,
          sheetRow: reference.sheetRow,
        });
      } else {
        // The exact spelling from the Costs tab is what the client compares against.
        referenceRarity = priced.Rarity;
      }
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const complete =
    errors === 0 &&
    coinsGrowth !== null &&
    cardsGrowth !== null &&
    coinsRounding !== null &&
    cardsRounding !== null &&
    referenceRarity !== null &&
    cardsPayoutModifier !== null;

  // Every field is non-null when `complete`; the fallbacks only fill a config
  // that the error count already keeps from being exported.
  const config: HeroUpgradeConfig = {
    CoinsGrowth: coinsGrowth ?? 0,
    CardsGrowth: cardsGrowth ?? 0,
    CoinsRounding: coinsRounding ?? 0,
    CardsRounding: cardsRounding ?? 0,
    ReferenceRarity: referenceRarity ?? '',
    CardsPayoutModifier: cardsPayoutModifier ?? 0,
    Costs: costs,
  };

  return {
    config,
    preview,
    issues,
    stats: { rarities: complete ? costs.length : 0, errors, warnings: issues.length - errors },
  };
}
