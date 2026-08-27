import type { RawCell } from './types';

/**
 * Normalizes a lookup / progression name for matching only.
 * The exact stored id is always returned from the lookup table itself.
 */
export function normalizeName(value: RawCell): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

/**
 * Normalizes a header for fuzzy column detection: lowercase, collapse
 * whitespace, and drop trivial punctuation that sheet authors add freely
 * (`Reward Amount:` / `reward_amount` / `Reward-Amount` all collapse to the
 * same token stream).
 */
export function normalizeHeader(value: RawCell): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u2018\u2019\u201c\u201d]/g, '')
    // Split camelCase/PascalCase so `RewardName` and `ArenaID` tokenize the
    // same way as `Reward Name` and `Arena ID`.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-./\u005C:#()[\]{}*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Splits a normalized header into word tokens. */
export function headerTokens(value: RawCell): string[] {
  const normalized = normalizeHeader(value);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

export function isBlank(value: RawCell): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

/** True when every cell in the row is blank. */
export function isBlankRow(row: RawCell[]): boolean {
  return row.every(isBlank);
}

/** A display string for a cell, trimmed, or `null` when blank. */
export function cellText(value: RawCell): string | null {
  if (isBlank(value)) return null;
  return String(value).trim();
}

export interface NumberParse {
  ok: boolean;
  value: number;
}

/**
 * Parses a numeric cell. Accepts real numbers and numeric-looking strings
 * (including thousands separators and a trailing/leading currency-ish symbol),
 * because sheet cells are routinely text-formatted.
 */
export function parseNumber(value: RawCell): NumberParse {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: NaN };
  }
  if (typeof value === 'boolean' || value === null || value === undefined) {
    return { ok: false, value: NaN };
  }
  const cleaned = String(value).trim().replace(/,/g, '');
  if (cleaned === '') return { ok: false, value: NaN };
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) return { ok: false, value: NaN };
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, value: NaN };
}

/**
 * Rounds away binary float noise that xlsx serialisation introduces
 * (e.g. 50.000000000000004) without altering genuinely fractional values.
 */
export function cleanNumber(value: number): number {
  const rounded = Math.round(value * 1e9) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
}
