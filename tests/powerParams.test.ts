import { describe, expect, it } from 'vitest';
import {
  POWER_PARAM_NAMES,
  powerParamType,
  resolvePowerParamName,
  suggestPowerParam,
} from '../src/lib/powerParams';

describe('power parameter names', () => {
  it('covers every parameter used by the live hero config', () => {
    // Transcribed from the ConfigCat hero config, hero by hero.
    const used = [
      'ActivationDelay', 'Duration',
      'SpeedMultiplier', 'EvasionExtension', 'MaxDuration', 'EvasionCheckDistance', 'EndsOnObstacleHit',
      'DropDistance', 'FloatDistance', 'SlowdownDuration', 'SlowdownStrength', 'Damage', 'DamageInterval',
      'WeightDuration', 'AccelerationMultiplier', 'NextHitPenaltyMultiplier',
      'Radius', 'AbsorbedHits', 'HitPenaltyMultiplier',
    ];
    for (const name of used) expect(POWER_PARAM_NAMES).toContain(name);
    expect(POWER_PARAM_NAMES).toHaveLength(used.length);
  });

  it('types EndsOnObstacleHit as the only boolean', () => {
    const booleans = POWER_PARAM_NAMES.filter((name) => powerParamType(name) === 'boolean');
    expect(booleans).toEqual(['EndsOnObstacleHit']);
  });

  it('accepts exact spellings', () => {
    for (const name of POWER_PARAM_NAMES) {
      expect(resolvePowerParamName(name)).toEqual({ status: 'exact', name });
    }
  });

  it('accepts case, spacing and punctuation variants, emitting the canonical name', () => {
    const variants = [
      ['speedmultiplier', 'SpeedMultiplier'],
      ['Speed Multiplier', 'SpeedMultiplier'],
      ['SPEED_MULTIPLIER', 'SpeedMultiplier'],
      ['ends on obstacle hit', 'EndsOnObstacleHit'],
      ['drop-distance', 'DropDistance'],
      ['  Damage  ', 'Damage'],
    ] as const;
    for (const [raw, expected] of variants) {
      expect(resolvePowerParamName(raw)).toEqual({ status: 'corrected', name: expected });
    }
  });

  it('rejects misspellings and suggests the intended parameter', () => {
    expect(resolvePowerParamName('SpeedMultiplyer')).toEqual({
      status: 'unknown',
      suggestion: 'SpeedMultiplier',
    });
    expect(resolvePowerParamName('DropDistanse')).toEqual({
      status: 'unknown',
      suggestion: 'DropDistance',
    });
    expect(resolvePowerParamName('EvasionExtention')).toEqual({
      status: 'unknown',
      suggestion: 'EvasionExtension',
    });
  });

  it('rejects a plausible-sounding parameter the game does not read', () => {
    const resolved = resolvePowerParamName('JumpHeight');
    expect(resolved.status).toBe('unknown');
    // Nothing close enough to guess at, so no misleading suggestion.
    expect(suggestPowerParam('JumpHeight')).toBeNull();
  });

  it('does not suggest a wildly different parameter for a short typo', () => {
    // "Radius" and "Damage" are both short: a suggestion must be a near miss,
    // not simply the closest of a small set.
    expect(suggestPowerParam('Zzzzzz')).toBeNull();
  });
});
