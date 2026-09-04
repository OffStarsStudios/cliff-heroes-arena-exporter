import type { HeroUpgradeConfig, Issue } from './types';

const ROOT_KEYS = [
  'CoinsGrowth',
  'CardsGrowth',
  'CoinsRounding',
  'CardsRounding',
  'ReferenceRarity',
  'CardsPayoutModifier',
  'Costs',
];
const COST_KEYS = ['Rarity', 'CoinsBase', 'CardsBase', 'CostModifier', 'GrowthModifier'];

function sameKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Final gate before export: re-checks the generated object against the exact
 * output schema, including property order. Deliberately independent of the
 * transformer so a regression there cannot ship a malformed config.
 */
export function validateHeroUpgradeConfig(config: HeroUpgradeConfig): Issue[] {
  const issues: Issue[] = [];
  const record = config as unknown as Record<string, unknown>;

  const rootKeys = Object.keys(record);
  if (!sameKeys(rootKeys, ROOT_KEYS)) {
    issues.push({
      severity: 'error',
      code: 'schema-root',
      message: `The root object must contain exactly [${ROOT_KEYS.join(', ')}] in that order (found: ${rootKeys.join(', ') || 'none'}).`,
    });
    return issues;
  }

  for (const key of ['CoinsGrowth', 'CardsGrowth', 'CoinsRounding', 'CardsRounding', 'CardsPayoutModifier']) {
    if (!isFiniteNumber(record[key])) {
      issues.push({ severity: 'error', code: 'schema-scalar', message: `"${key}" must be a number, not ${JSON.stringify(record[key])}.` });
    }
  }
  for (const key of ['CoinsRounding', 'CardsRounding']) {
    const value = record[key];
    if (isFiniteNumber(value) && (!Number.isInteger(value) || value < 1)) {
      issues.push({ severity: 'error', code: 'schema-rounding', message: `"${key}" must be a whole number of 1 or more, not ${value}.` });
    }
  }
  if (!isNonEmptyString(record.ReferenceRarity)) {
    issues.push({ severity: 'error', code: 'schema-reference-rarity', message: '"ReferenceRarity" must be a non-empty string.' });
  }

  const costs = record.Costs;
  if (!Array.isArray(costs)) {
    issues.push({ severity: 'error', code: 'schema-costs', message: '"Costs" must be an array.' });
    return issues;
  }
  if (costs.length === 0) {
    issues.push({ severity: 'error', code: 'no-costs', message: 'The generated config prices no rarities.' });
  }

  const seen = new Set<string>();
  costs.forEach((cost, index) => {
    const position = `Cost ${index + 1}`;
    const entry = cost as Record<string, unknown>;
    const keys = Object.keys(entry);
    if (!sameKeys(keys, COST_KEYS)) {
      issues.push({
        severity: 'error',
        code: 'schema-cost-keys',
        message: `${position}: costs must have exactly [${COST_KEYS.join(', ')}] in that order (found: ${keys.join(', ')}).`,
      });
    }
    if (!isNonEmptyString(entry.Rarity)) {
      issues.push({ severity: 'error', code: 'schema-cost-rarity', message: `${position}: "Rarity" must be a non-empty string.` });
    } else if (seen.has(entry.Rarity.toLowerCase())) {
      issues.push({ severity: 'error', code: 'schema-cost-rarity-duplicate', message: `${position}: "${entry.Rarity}" is priced more than once.` });
    } else {
      seen.add(entry.Rarity.toLowerCase());
    }
    for (const key of ['CoinsBase', 'CardsBase', 'CostModifier', 'GrowthModifier']) {
      if (!isFiniteNumber(entry[key])) {
        issues.push({ severity: 'error', code: 'schema-cost-value', message: `${position}: "${key}" must be a number, not ${JSON.stringify(entry[key])}.` });
      }
    }
  });

  if (isNonEmptyString(record.ReferenceRarity) && costs.length > 0 && !seen.has(record.ReferenceRarity.toLowerCase())) {
    issues.push({
      severity: 'error',
      code: 'schema-reference-rarity-unpriced',
      message: `"ReferenceRarity" is "${record.ReferenceRarity}", which no Costs row prices.`,
    });
  }

  return issues;
}

/** Pretty-prints the config exactly as it should be written to disk. */
export function serializeHeroUpgradeConfig(config: HeroUpgradeConfig): string {
  return JSON.stringify(config, null, 2);
}
