import type { Issue, MatchTrophyConfig } from './types';

function sameKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/**
 * Final gate before export: re-checks the generated object against the exact
 * output schema. Deliberately independent of the transformer so a regression
 * there cannot ship a malformed config.
 */
export function validateMatchTrophyConfig(config: MatchTrophyConfig): Issue[] {
  const issues: Issue[] = [];

  const rootKeys = Object.keys(config);
  if (!sameKeys(rootKeys, ['TrophiesByPlace'])) {
    issues.push({
      severity: 'error',
      code: 'schema-root',
      message: `The root object must contain exactly one property, "TrophiesByPlace" (found: ${rootKeys.join(', ') || 'none'}).`,
    });
    return issues;
  }

  const places = config.TrophiesByPlace as unknown;
  if (!Array.isArray(places)) {
    issues.push({ severity: 'error', code: 'schema-root', message: '"TrophiesByPlace" must be an array.' });
    return issues;
  }

  if (places.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-places',
      message: 'The generated config lists no finishing places.',
    });
  }

  places.forEach((value, index) => {
    if (!(typeof value === 'number' && Number.isInteger(value))) {
      issues.push({
        severity: 'error',
        code: 'schema-trophies',
        message: `Place ${index + 1}: the trophy delta must be a whole number, not ${JSON.stringify(value)}.`,
      });
    }
  });

  return issues;
}

/** Pretty-prints the config exactly as it should be written to disk. */
export function serializeMatchTrophyConfig(config: MatchTrophyConfig): string {
  return JSON.stringify(config, null, 2);
}
