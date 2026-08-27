import type { ArenaProgressConfig, Issue } from './types';

const REWARD_KEYS = ['Trophies', 'RewardID', 'Amount'];
const ARENA_KEYS = ['Trophies', 'ArenaID'];
const ARENA_KEYS_WITH_UNLOCKS = ['Trophies', 'ArenaID', 'Unlocks'];

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
 * output schema, including property order. This is deliberately independent of
 * the transformer so a regression there cannot ship a malformed config.
 */
export function validateConfig(config: ArenaProgressConfig): Issue[] {
  const issues: Issue[] = [];

  const rootKeys = Object.keys(config);
  if (!sameKeys(rootKeys, ['Milestones'])) {
    issues.push({
      severity: 'error',
      code: 'schema-root',
      message: `The root object must contain exactly one property, "Milestones" (found: ${rootKeys.join(', ') || 'none'}).`,
    });
    return issues;
  }

  if (!Array.isArray(config.Milestones)) {
    issues.push({ severity: 'error', code: 'schema-root', message: '"Milestones" must be an array.' });
    return issues;
  }

  if (config.Milestones.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-milestones',
      message: 'The generated config contains no milestones.',
    });
  }

  config.Milestones.forEach((milestone, index) => {
    const position = `Milestone ${index + 1}`;
    const record = milestone as unknown as Record<string, unknown>;
    const keys = Object.keys(record);

    if (!isFiniteNumber(record.Trophies)) {
      issues.push({
        severity: 'error',
        code: 'schema-trophies',
        message: `${position}: "Trophies" must be a number, not ${JSON.stringify(record.Trophies)}.`,
      });
    }

    if ('ArenaID' in record) {
      const expected = 'Unlocks' in record ? ARENA_KEYS_WITH_UNLOCKS : ARENA_KEYS;
      if (!sameKeys(keys, expected)) {
        issues.push({
          severity: 'error',
          code: 'schema-arena-keys',
          message: `${position}: arena milestones must have exactly [${expected.join(', ')}] in that order (found: ${keys.join(', ')}).`,
        });
      }
      if (!isNonEmptyString(record.ArenaID)) {
        issues.push({
          severity: 'error',
          code: 'schema-arena-id',
          message: `${position}: "ArenaID" must be a non-empty string.`,
        });
      }
      if ('Unlocks' in record) {
        const unlocks = record.Unlocks;
        if (!Array.isArray(unlocks) || unlocks.length === 0) {
          issues.push({
            severity: 'error',
            code: 'schema-unlocks',
            message: `${position}: "Unlocks" must be a non-empty array. Omit it entirely when there are no unlocks.`,
          });
        } else {
          unlocks.forEach((unlock, unlockIndex) => {
            const unlockKeys = Object.keys(unlock as Record<string, unknown>);
            const unlockRecord = unlock as Record<string, unknown>;
            if (!sameKeys(unlockKeys, ['RewardID'])) {
              issues.push({
                severity: 'error',
                code: 'schema-unlock-keys',
                message: `${position}, unlock ${unlockIndex + 1}: must contain exactly "RewardID" (found: ${unlockKeys.join(', ')}).`,
              });
            }
            if (!isNonEmptyString(unlockRecord.RewardID)) {
              issues.push({
                severity: 'error',
                code: 'schema-unlock-id',
                message: `${position}, unlock ${unlockIndex + 1}: "RewardID" must be a non-empty string.`,
              });
            }
          });
        }
      }
      return;
    }

    if (!sameKeys(keys, REWARD_KEYS)) {
      issues.push({
        severity: 'error',
        code: 'schema-reward-keys',
        message: `${position}: reward milestones must have exactly [${REWARD_KEYS.join(', ')}] in that order (found: ${keys.join(', ')}).`,
      });
    }
    if (!isNonEmptyString(record.RewardID)) {
      issues.push({
        severity: 'error',
        code: 'schema-reward-id',
        message: `${position}: "RewardID" must be a non-empty string.`,
      });
    }
    if (!isFiniteNumber(record.Amount)) {
      issues.push({
        severity: 'error',
        code: 'schema-amount',
        message: `${position}: "Amount" must be a number, not ${JSON.stringify(record.Amount)}.`,
      });
    }
  });

  return issues;
}

/** Pretty-prints the config exactly as it should be written to disk. */
export function serializeConfig(config: ArenaProgressConfig): string {
  return JSON.stringify(config, null, 2);
}
