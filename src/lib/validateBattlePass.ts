import { BATTLE_PASS_KEYS, parseStartUtc } from './battlePass';
import type { BattlePassConfig, Issue } from './types';

const TIER_KEYS = ['Free', 'Premium'];
const REWARD_KEYS = ['RewardID', 'Amount'];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isWhole(value: unknown, minimum: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

/** True when `keys` is `expected` with some entries left out, in the same order. */
function inSchemaOrder(keys: string[], expected: readonly string[]): boolean {
  let cursor = 0;
  for (const key of keys) {
    const at = expected.indexOf(key, cursor);
    if (at === -1) return false;
    cursor = at + 1;
  }
  return true;
}

/**
 * Final gate before export: re-checks the generated object against the exact
 * output schema, including property order. Deliberately independent of the
 * transformer so a regression there cannot ship a malformed config.
 */
export function validateBattlePassConfig(config: BattlePassConfig): Issue[] {
  const issues: Issue[] = [];

  const rootKeys = Object.keys(config);
  if (
    rootKeys.length !== BATTLE_PASS_KEYS.length ||
    rootKeys.some((key, index) => key !== BATTLE_PASS_KEYS[index])
  ) {
    issues.push({
      severity: 'error',
      code: 'schema-root',
      message: `The root object must contain exactly [${BATTLE_PASS_KEYS.join(', ')}] in that order (found: ${rootKeys.join(', ') || 'none'}).`,
    });
    return issues;
  }

  for (const key of ['SeasonID', 'SeasonName', 'PremiumProductID', 'SkipCurrencyID'] as const) {
    if (!isNonEmptyString(config[key])) {
      issues.push({
        severity: 'error',
        code: 'schema-season-text',
        message: `"${key}" must be a non-empty string, not ${JSON.stringify(config[key])}.`,
      });
    }
  }

  // The art is the one field the client accepts empty, but it is always written.
  if (typeof config.FinalRewardArt !== 'string') {
    issues.push({
      severity: 'error',
      code: 'schema-season-text',
      message: `"FinalRewardArt" must be a string, empty when there is no art, not ${JSON.stringify(config.FinalRewardArt)}.`,
    });
  }

  if (typeof config.StartUtc !== 'string' || parseStartUtc(config.StartUtc) !== config.StartUtc) {
    issues.push({
      severity: 'error',
      code: 'schema-start-utc',
      message: `"StartUtc" must be a UTC timestamp written as YYYY-MM-DD HH:mm, not ${JSON.stringify(config.StartUtc)}.`,
    });
  }

  if (!isWhole(config.DurationDays, 1)) {
    issues.push({
      severity: 'error',
      code: 'schema-duration',
      message: `"DurationDays" must be a whole number of 1 or more, not ${JSON.stringify(config.DurationDays)}.`,
    });
  }
  if (!isWhole(config.TokensPerTier, 1)) {
    issues.push({
      severity: 'error',
      code: 'schema-tokens',
      message: `"TokensPerTier" must be a whole number of 1 or more, not ${JSON.stringify(config.TokensPerTier)}.`,
    });
  }
  if (!isWhole(config.SkipTierCost, 0)) {
    issues.push({
      severity: 'error',
      code: 'schema-skip-cost',
      message: `"SkipTierCost" must be a whole number of 0 or more, not ${JSON.stringify(config.SkipTierCost)}.`,
    });
  }

  const tiers = config.Tiers as unknown;
  if (!Array.isArray(tiers)) {
    issues.push({ severity: 'error', code: 'schema-tiers', message: '"Tiers" must be an array.' });
    return issues;
  }
  if (tiers.length === 0) {
    issues.push({ severity: 'error', code: 'no-tiers', message: 'The generated config lists no tiers.' });
  }

  tiers.forEach((tier, index) => {
    const position = `Tier ${index + 1}`;
    if (tier === null || typeof tier !== 'object' || Array.isArray(tier)) {
      issues.push({ severity: 'error', code: 'schema-tier', message: `${position}: must be an object.` });
      return;
    }
    const record = tier as Record<string, unknown>;
    const keys = Object.keys(record);
    if (!inSchemaOrder(keys, TIER_KEYS)) {
      issues.push({
        severity: 'error',
        code: 'schema-tier-keys',
        message: `${position}: keys must be [${TIER_KEYS.join(', ')}] with unused ones omitted (found: ${keys.join(', ') || 'none'}).`,
      });
    }

    for (const track of TIER_KEYS) {
      if (!(track in record)) continue;
      const reward = record[track];
      if (reward === null || typeof reward !== 'object' || Array.isArray(reward)) {
        issues.push({
          severity: 'error',
          code: 'schema-reward',
          message: `${position}, ${track.toLowerCase()} track: must be an object with a reward ID and an amount.`,
        });
        continue;
      }
      const entry = reward as Record<string, unknown>;
      const entryKeys = Object.keys(entry);
      if (entryKeys.length !== REWARD_KEYS.length || entryKeys.some((key, i) => key !== REWARD_KEYS[i])) {
        issues.push({
          severity: 'error',
          code: 'schema-reward-keys',
          message: `${position}, ${track.toLowerCase()} track: must contain exactly [${REWARD_KEYS.join(', ')}] (found: ${entryKeys.join(', ') || 'none'}).`,
        });
      }
      if (!isNonEmptyString(entry.RewardID)) {
        issues.push({
          severity: 'error',
          code: 'schema-reward-id',
          message: `${position}, ${track.toLowerCase()} track: "RewardID" must be a non-empty string.`,
        });
      }
      if (!isWhole(entry.Amount, 1)) {
        issues.push({
          severity: 'error',
          code: 'schema-reward-amount',
          message: `${position}, ${track.toLowerCase()} track: "Amount" must be a whole number of 1 or more, not ${JSON.stringify(entry.Amount)}.`,
        });
      }
    }
  });

  return issues;
}

/** Pretty-prints the config exactly as it should be written to disk. */
export function serializeBattlePassConfig(config: BattlePassConfig): string {
  return JSON.stringify(config, null, 2);
}
