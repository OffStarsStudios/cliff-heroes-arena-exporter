import { normalizeHeader } from './normalize';

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

/**
 * Squashes a name to its comparison key: `EndsOnObstacleHit`,
 * `ends on obstacle hit`, `Ends_On_Obstacle_Hit` and `ENDSONOBSTACLEHIT` all
 * collapse to the same key, so only genuine misspellings are rejected.
 */
function squash(name: string): string {
  return normalizeHeader(name).replace(/ /g, '');
}

const BY_SQUASHED = new Map<string, PowerParamName>(
  POWER_PARAM_NAMES.map((name) => [squash(name), name]),
);

/** Standard Levenshtein distance, used only to suggest a correction. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The closest canonical name, when one is near enough that a typo is the most
 * likely explanation. The threshold scales with length so short names such as
 * `Damage` need a closer match than `NextHitPenaltyMultiplier`.
 */
export function suggestPowerParam(raw: string): PowerParamName | null {
  const key = squash(raw);
  if (key === '') return null;

  let best: PowerParamName | null = null;
  let bestDistance = Infinity;
  for (const name of POWER_PARAM_NAMES) {
    const distance = editDistance(key, squash(name));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }

  const limit = Math.max(1, Math.floor(key.length / 4));
  return best !== null && bestDistance <= limit ? best : null;
}

export type ParamNameResolution =
  /** Spelled exactly as the schema has it. */
  | { status: 'exact'; name: PowerParamName }
  /** Recognised, but written with different case/spacing; `name` is what gets emitted. */
  | { status: 'corrected'; name: PowerParamName }
  /** Not a known parameter. `suggestion` is set when a near match exists. */
  | { status: 'unknown'; suggestion: PowerParamName | null };

/**
 * Resolves a parameter name typed in the sheet to its canonical spelling.
 * The canonical name is always what the exporter emits, so the JSON key never
 * inherits a sheet author's capitalisation.
 */
export function resolvePowerParamName(raw: string): ParamNameResolution {
  const trimmed = raw.trim();
  const canonical = BY_SQUASHED.get(squash(trimmed));
  if (canonical === undefined) {
    return { status: 'unknown', suggestion: suggestPowerParam(trimmed) };
  }
  return canonical === trimmed ? { status: 'exact', name: canonical } : { status: 'corrected', name: canonical };
}
