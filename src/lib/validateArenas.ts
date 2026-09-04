import { isArenaBotDifficulty, ARENA_BOT_DIFFICULTIES } from './arenaDifficulties';
import type { ArenasConfig, Issue } from './types';

const ARENA_KEYS = ['ID', 'TrackCount', 'BotLevels'];

function sameKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Final gate before export: re-checks the generated object against the exact
 * output schema, including property order. Deliberately independent of the
 * transformer so a regression there cannot ship a malformed config.
 */
export function validateArenasConfig(config: ArenasConfig): Issue[] {
  const issues: Issue[] = [];

  const rootKeys = Object.keys(config);
  if (!sameKeys(rootKeys, ['Arenas'])) {
    issues.push({
      severity: 'error',
      code: 'schema-root',
      message: `The root object must contain exactly one property, "Arenas" (found: ${rootKeys.join(', ') || 'none'}).`,
    });
    return issues;
  }

  if (!Array.isArray(config.Arenas)) {
    issues.push({ severity: 'error', code: 'schema-root', message: '"Arenas" must be an array.' });
    return issues;
  }

  if (config.Arenas.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-arenas',
      message: 'The generated config contains no arenas.',
    });
  }

  const seen = new Set<string>();
  config.Arenas.forEach((arena, index) => {
    const position = `Arena ${index + 1}`;
    const record = arena as unknown as Record<string, unknown>;
    const keys = Object.keys(record);

    if (!sameKeys(keys, ARENA_KEYS)) {
      issues.push({
        severity: 'error',
        code: 'schema-arena-keys',
        message: `${position}: arenas must have exactly [${ARENA_KEYS.join(', ')}] in that order (found: ${keys.join(', ')}).`,
      });
    }

    if (!isNonEmptyString(record.ID)) {
      issues.push({
        severity: 'error',
        code: 'schema-arena-id',
        message: `${position}: "ID" must be a non-empty string.`,
      });
    } else if (seen.has(record.ID)) {
      issues.push({
        severity: 'error',
        code: 'schema-arena-id-duplicate',
        message: `${position}: "${record.ID}" is defined more than once.`,
      });
    } else {
      seen.add(record.ID);
    }

    if (!(typeof record.TrackCount === 'number' && Number.isInteger(record.TrackCount) && record.TrackCount >= 1)) {
      issues.push({
        severity: 'error',
        code: 'schema-track-count',
        message: `${position}: "TrackCount" must be a whole number of 1 or more, not ${JSON.stringify(record.TrackCount)}.`,
      });
    }

    const levels = record.BotLevels;
    if (!Array.isArray(levels) || levels.length === 0) {
      issues.push({
        severity: 'error',
        code: 'schema-bot-levels',
        message: `${position}: "BotLevels" must be a non-empty array of difficulty names.`,
      });
    } else {
      levels.forEach((level, levelIndex) => {
        if (!isArenaBotDifficulty(level)) {
          issues.push({
            severity: 'error',
            code: 'schema-bot-level-name',
            message: `${position}, bot ${levelIndex + 1}: ${JSON.stringify(level)} is not one of ${ARENA_BOT_DIFFICULTIES.join(', ')}.`,
          });
        }
      });
    }
  });

  return issues;
}

/** Pretty-prints the config exactly as it should be written to disk. */
export function serializeArenasConfig(config: ArenasConfig): string {
  return JSON.stringify(config, null, 2);
}
