import { makeNameResolver, type NameResolution } from './nameResolve';

/**
 * Every parameter name a hero `Power` block is allowed to contain, with the
 * value type it must hold.
 *
 * This is the schema, transcribed from the live ConfigCat hero config - it is
 * deliberately a constant rather than something inferred from the sheet,
 * because inferring the allowed names from the same cells we are checking
 * would validate nothing. A typo in the sheet must fail against this list.
 *
 * When the game gains a new power parameter, add it here. That is the only
 * edit required; the sheet can then use it immediately.
 */
const POWER_PARAM_TYPES = {
  // Present on every hero, read from their own dedicated columns.
  ActivationDelay: 'number',
  Duration: 'number',
  // Cliff, Flick
  SpeedMultiplier: 'number',
  EvasionExtension: 'number',
  MaxDuration: 'number',
  EvasionCheckDistance: 'number',
  EndsOnObstacleHit: 'boolean',
  // Pedro, Glint, Cinder
  DropDistance: 'number',
  FloatDistance: 'number',
  SlowdownDuration: 'number',
  SlowdownStrength: 'number',
  Damage: 'number',
  DamageInterval: 'number',
  WeightDuration: 'number',
  AccelerationMultiplier: 'number',
  NextHitPenaltyMultiplier: 'number',
  // Tank
  Radius: 'number',
  AbsorbedHits: 'number',
  HitPenaltyMultiplier: 'number',
} as const satisfies Record<string, 'number' | 'boolean'>;

export type PowerParamName = keyof typeof POWER_PARAM_TYPES;
export type PowerParamType = 'number' | 'boolean';

/** Canonical parameter names, in schema order. */
export const POWER_PARAM_NAMES = Object.keys(POWER_PARAM_TYPES) as PowerParamName[];

/** The two parameters that come from fixed columns rather than name/value pairs. */
export const FIXED_POWER_PARAMS: PowerParamName[] = ['ActivationDelay', 'Duration'];

export function powerParamType(name: PowerParamName): PowerParamType {
  return POWER_PARAM_TYPES[name];
}

const RESOLVER = makeNameResolver(POWER_PARAM_NAMES);

/**
 * The closest canonical name, when one is near enough that a typo is the most
 * likely explanation. The threshold scales with length so short names such as
 * `Damage` need a closer match than `NextHitPenaltyMultiplier`.
 */
export function suggestPowerParam(raw: string): PowerParamName | null {
  return RESOLVER.suggest(raw);
}

export type ParamNameResolution = NameResolution<PowerParamName>;

/**
 * Resolves a parameter name typed in the sheet to its canonical spelling.
 * The canonical name is always what the exporter emits, so the JSON key never
 * inherits a sheet author's capitalisation.
 */
export function resolvePowerParamName(raw: string): ParamNameResolution {
  return RESOLVER.resolve(raw);
}
