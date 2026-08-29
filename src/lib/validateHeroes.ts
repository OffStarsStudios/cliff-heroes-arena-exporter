import { FIXED_POWER_PARAMS, POWER_PARAM_NAMES, powerParamType, type PowerParamName } from './powerParams';
import type { HeroesConfig, Issue } from './types';

const HERO_KEYS = ['ID', 'MaxSpeed', 'SpeedIncreasePerSecond', 'Rarity', 'PowerCooldown', 'Levels', 'Power'];
const LEVEL_KEYS = ['Health', 'Speed', 'Grip'];

const KNOWN_PARAMS = new Set<string>(POWER_PARAM_NAMES);

function sameKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** True when the number carries at most one digit after the decimal point. */
function hasAtMostOneDecimal(value: number): boolean {
  return Math.round(value * 10) === value * 10;
}

/**
 * Final gate before export: re-checks the generated object against the exact
 * output schema, including property order and power parameter names. This is
 * deliberately independent of the transformer, so a regression there cannot
 * ship a malformed config.
 */
export function validateHeroesConfig(config: HeroesConfig): Issue[] {
  const issues: Issue[] = [];

  const rootKeys = Object.keys(config);
  if (!sameKeys(rootKeys, ['Heroes'])) {
    issues.push({
      severity: 'error',
      code: 'schema-root',
      message: `The root object must contain exactly one property, "Heroes" (found: ${rootKeys.join(', ') || 'none'}).`,
    });
    return issues;
  }

  if (!Array.isArray(config.Heroes)) {
    issues.push({ severity: 'error', code: 'schema-root', message: '"Heroes" must be an array.' });
    return issues;
  }

  if (config.Heroes.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-heroes',
      message: 'The generated config contains no heroes.',
    });
  }

  const seenIds = new Set<string>();

  config.Heroes.forEach((hero, index) => {
    const record = hero as unknown as Record<string, unknown>;
    const position = `Hero ${index + 1}${isNonEmptyString(record.ID) ? ` (${record.ID})` : ''}`;
    const keys = Object.keys(record);

    if (!sameKeys(keys, HERO_KEYS)) {
      issues.push({
        severity: 'error',
        code: 'schema-hero-keys',
        message: `${position}: must have exactly [${HERO_KEYS.join(', ')}] in that order (found: ${keys.join(', ')}).`,
      });
    }

    if (!isNonEmptyString(record.ID)) {
      issues.push({
        severity: 'error',
        code: 'schema-hero-id',
        message: `${position}: "ID" must be a non-empty string.`,
      });
    } else if (seenIds.has(record.ID)) {
      issues.push({
        severity: 'error',
        code: 'schema-hero-id-duplicate',
        message: `${position}: the ID "${record.ID}" is used by more than one hero.`,
      });
    } else {
      seenIds.add(record.ID);
    }

    for (const key of ['MaxSpeed', 'SpeedIncreasePerSecond', 'PowerCooldown'] as const) {
      if (!isFiniteNumber(record[key])) {
        issues.push({
          severity: 'error',
          code: 'schema-hero-number',
          message: `${position}: "${key}" must be a number, not ${JSON.stringify(record[key])}.`,
        });
      }
    }

    if (!isNonEmptyString(record.Rarity)) {
      issues.push({
        severity: 'error',
        code: 'schema-hero-rarity',
        message: `${position}: "Rarity" must be a non-empty string.`,
      });
    }

    const levels = record.Levels;
    if (!Array.isArray(levels) || levels.length === 0) {
      issues.push({
        severity: 'error',
        code: 'schema-levels',
        message: `${position}: "Levels" must be a non-empty array.`,
      });
    } else {
      levels.forEach((level, levelIndex) => {
        const levelRecord = level as Record<string, unknown>;
        const levelKeys = Object.keys(levelRecord);
        if (!sameKeys(levelKeys, LEVEL_KEYS)) {
          issues.push({
            severity: 'error',
            code: 'schema-level-keys',
            message: `${position}, level ${levelIndex + 1}: must have exactly [${LEVEL_KEYS.join(', ')}] in that order (found: ${levelKeys.join(', ')}).`,
          });
          return;
        }
        for (const key of LEVEL_KEYS) {
          const value = levelRecord[key];
          if (!isFiniteNumber(value)) {
            issues.push({
              severity: 'error',
              code: 'schema-level-number',
              message: `${position}, level ${levelIndex + 1}: "${key}" must be a number, not ${JSON.stringify(value)}.`,
            });
          } else if (!hasAtMostOneDecimal(value)) {
            issues.push({
              severity: 'error',
              code: 'schema-level-precision',
              message: `${position}, level ${levelIndex + 1}: "${key}" is ${value}, which has more than one decimal place.`,
            });
          }
        }
      });
    }

    const power = record.Power;
    if (typeof power !== 'object' || power === null || Array.isArray(power)) {
      issues.push({
        severity: 'error',
        code: 'schema-power',
        message: `${position}: "Power" must be an object.`,
      });
      return;
    }

    const powerRecord = power as Record<string, unknown>;
    const powerKeys = Object.keys(powerRecord);

    // ActivationDelay and Duration lead, in that order, on every hero.
    if (powerKeys[0] !== FIXED_POWER_PARAMS[0] || powerKeys[1] !== FIXED_POWER_PARAMS[1]) {
      issues.push({
        severity: 'error',
        code: 'schema-power-order',
        message: `${position}: "Power" must start with ${FIXED_POWER_PARAMS.join(' then ')} (found: ${powerKeys.slice(0, 2).join(', ') || 'nothing'}).`,
      });
    }

    for (const key of powerKeys) {
      if (!KNOWN_PARAMS.has(key)) {
        issues.push({
          severity: 'error',
          code: 'schema-power-unknown',
          message: `${position}: "${key}" is not a power parameter the game reads.`,
        });
        continue;
      }
      const expected = powerParamType(key as PowerParamName);
      const value = powerRecord[key];
      if (expected === 'boolean' && typeof value !== 'boolean') {
        issues.push({
          severity: 'error',
          code: 'schema-power-type',
          message: `${position}: "${key}" must be a boolean, not ${JSON.stringify(value)}.`,
        });
      }
      if (expected === 'number' && !isFiniteNumber(value)) {
        issues.push({
          severity: 'error',
          code: 'schema-power-type',
          message: `${position}: "${key}" must be a number, not ${JSON.stringify(value)}.`,
        });
      }
    }
  });

  return issues;
}

/** Pretty-prints the config exactly as it should be written to disk. */
export function serializeHeroesConfig(config: HeroesConfig): string {
  return JSON.stringify(config, null, 2);
}
