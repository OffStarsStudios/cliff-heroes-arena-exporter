import { ARENA_BOT_DIFFICULTIES, botLevelName } from './arenaDifficulties';
import type { BotsConfig, Issue } from './types';

const ROOT_KEYS = ['Bots'];
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

  // One entry per member of the game's BotLevel enum, in its declared order.
  // The client looks each difficulty up by value and keeps the tuning compiled
  // into the build for any it cannot find, so a short table is a silent partial
  // publish rather than an error the game reports.
  if (bots.length > 0 && levels.length !== ARENA_BOT_DIFFICULTIES.length) {
    issues.push({
      severity: 'error',
      code: 'schema-level-sequence',
      message: `"Bots" must tune all ${ARENA_BOT_DIFFICULTIES.length} difficulties the game declares (${ARENA_BOT_DIFFICULTIES.join(', ')}), not ${levels.length}.`,
    });
  }
  levels.forEach((level, index) => {
    if (level !== index) {
      issues.push({
        severity: 'error',
        code: 'schema-level-sequence',
        message: `Bot ${index + 1} has level ${level}; levels must run 0, 1, 2... in order, matching ${ARENA_BOT_DIFFICULTIES.join(', ')}.`,
      });
    } else if (botLevelName(level) === null) {
      issues.push({
        severity: 'error',
        code: 'schema-level-unknown',
        message: `Bot ${index + 1} has level ${level}, which names no difficulty the game declares (0 to ${ARENA_BOT_DIFFICULTIES.length - 1}).`,
      });
    }
  });

  return issues;
}

/** Pretty-prints the config exactly as it should be written to disk. */
export function serializeBotsConfig(config: BotsConfig): string {
  return JSON.stringify(config, null, 2);
}
