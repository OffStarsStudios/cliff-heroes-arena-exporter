import type { BotsConfig, Issue } from './types';

const ROOT_KEYS = ['BotLevel', 'Bots'];
const BOT_KEYS = [
  'Level',
  'MinJumpInterval',
  'MaxJumpInterval',
  'MinDodgeChance',
  'MaxDodgeChance',
  'RaycastDistance',
  'RaycastInterval',
  'MinFireInterval',
  'MaxFireInterval',
];

function sameKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Final gate before export: re-checks the generated object against the exact
 * output schema, including property order. Deliberately independent of the
 * transformer so a regression there cannot ship a malformed config.
 */
export function validateBotsConfig(config: BotsConfig): Issue[] {
  const issues: Issue[] = [];

  const rootKeys = Object.keys(config);
  if (!sameKeys(rootKeys, ROOT_KEYS)) {
    issues.push({
      severity: 'error',
      code: 'schema-root',
      message: `The root object must contain exactly [${ROOT_KEYS.join(', ')}] in that order (found: ${rootKeys.join(', ') || 'none'}).`,
    });
    return issues;
  }

  const bots = config.Bots as unknown;
  if (!Array.isArray(bots)) {
    issues.push({ severity: 'error', code: 'schema-root', message: '"Bots" must be an array.' });
    return issues;
  }

  if (bots.length === 0) {
    issues.push({ severity: 'error', code: 'no-bots', message: 'The generated config contains no bot levels.' });
  }

  const levels: number[] = [];
  bots.forEach((bot, index) => {
    const position = `Bot ${index + 1}`;
    const record = bot as Record<string, unknown>;
    const keys = Object.keys(record);
    if (!sameKeys(keys, BOT_KEYS)) {
      issues.push({
        severity: 'error',
        code: 'schema-bot-keys',
        message: `${position}: bots must have exactly [${BOT_KEYS.join(', ')}] in that order (found: ${keys.join(', ')}).`,
      });
    }
    for (const key of BOT_KEYS) {
      if (!isFiniteNumber(record[key])) {
        issues.push({
          severity: 'error',
          code: 'schema-bot-value',
          message: `${position}: "${key}" must be a number, not ${JSON.stringify(record[key])}.`,
        });
      }
    }
    if (isFiniteNumber(record.Level)) levels.push(record.Level);
  });

  levels.forEach((level, index) => {
    if (level !== index) {
      issues.push({
        severity: 'error',
        code: 'schema-level-sequence',
        message: `Bot ${index + 1} has level ${level}; levels must run 0, 1, 2... in order.`,
      });
    }
  });

  const max = levels.length === 0 ? 0 : Math.max(...levels);
  if (!isFiniteNumber(config.BotLevel) || config.BotLevel !== max) {
    issues.push({
      severity: 'error',
      code: 'schema-botlevel',
      message: `"BotLevel" must equal the highest level in Bots (${max}), not ${JSON.stringify(config.BotLevel)}.`,
    });
  }

  return issues;
}

/** Pretty-prints the config exactly as it should be written to disk. */
export function serializeBotsConfig(config: BotsConfig): string {
  return JSON.stringify(config, null, 2);
}
