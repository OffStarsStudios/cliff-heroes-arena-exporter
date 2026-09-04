import { normalizeHeader } from './normalize';

/**
 * Fuzzy name resolution against a fixed list of canonical names.
 *
 * Used wherever a sheet cell has to name something the game knows by an exact
 * spelling - power parameters, bot difficulties, later the shop enums. The list
 * is always a constant transcribed from the game, never inferred from the
 * sheet: checking cells against themselves would validate nothing.
 */

/**
 * Squashes a name to its comparison key: `EndsOnObstacleHit`,
 * `ends on obstacle hit`, `Ends_On_Obstacle_Hit` and `ENDSONOBSTACLEHIT` all
 * collapse to the same key, so only genuine misspellings are rejected.
 */
export function squash(name: string): string {
  return normalizeHeader(name).replace(/ /g, '');
}

/** Standard Levenshtein distance, used only to suggest a correction. */
export function editDistance(a: string, b: string): number {
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

export type NameResolution<T extends string> =
  /** Spelled exactly as the schema has it. */
  | { status: 'exact'; name: T }
  /** Recognised, but written with different case/spacing; `name` is what gets emitted. */
  | { status: 'corrected'; name: T }
  /** Not a known name. `suggestion` is set when a near match exists. */
  | { status: 'unknown'; suggestion: T | null };

export interface NameResolver<T extends string> {
  /** Canonical names, in schema order. */
  readonly names: readonly T[];
  /** Resolves a name typed in the sheet to its canonical spelling. */
  resolve(raw: string): NameResolution<T>;
  /**
   * The closest canonical name, when one is near enough that a typo is the
   * most likely explanation. The threshold scales with length so short names
   * need a closer match than long ones.
   */
  suggest(raw: string): T | null;
}

export function makeNameResolver<T extends string>(names: readonly T[]): NameResolver<T> {
  const bySquashed = new Map<string, T>(names.map((name) => [squash(name), name]));

  const suggest = (raw: string): T | null => {
    const key = squash(raw);
    if (key === '') return null;

    let best: T | null = null;
    let bestDistance = Infinity;
    for (const name of names) {
      const distance = editDistance(key, squash(name));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = name;
      }
    }

    const limit = Math.max(1, Math.floor(key.length / 4));
    return best !== null && bestDistance <= limit ? best : null;
  };

  const resolve = (raw: string): NameResolution<T> => {
    const canonical = bySquashed.get(squash(raw));
    if (canonical === undefined) return { status: 'unknown', suggestion: suggest(raw) };
    // Surrounding whitespace counts as a spelling difference: the canonical
    // name is what gets emitted either way, and the sheet author should know.
    return canonical === raw
      ? { status: 'exact', name: canonical }
      : { status: 'corrected', name: canonical };
  };

  return { names, resolve, suggest };
}
