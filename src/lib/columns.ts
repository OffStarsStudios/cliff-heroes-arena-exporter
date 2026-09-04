import { headerTokens, isBlank, parseNumber } from './normalize';
import type { Issue, RawCell, RawSheet } from './types';

/**
 * Header-driven column resolution shared by the tabular exporters.
 *
 * Columns are found by header text, never by position, so a designer can add
 * or reorder columns freely. A column an exporter needs but cannot find is
 * reported by its title.
 */

export function headerText(row: RawCell[], index: number): string {
  const cell = row[index] ?? null;
  return isBlank(cell) ? '' : String(cell).trim();
}

/** Every header of a sheet as trimmed text, padded to the widest row. */
export function sheetHeaders(sheet: RawSheet, headerRowIndex = 0): string[] {
  const headerRow = sheet.rows[headerRowIndex] ?? [];
  const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), headerRow.length);
  return Array.from({ length: width }, (_, i) => headerText(headerRow, i));
}

/**
 * Finds a column by header text. Earlier spellings in the accepted list win,
 * so a bare `Speed` header never steals the `Max Speed` column.
 */
export function findColumn(headers: string[], accepted: readonly string[]): number {
  let best = -1;
  let bestRank = Infinity;
  headers.forEach((header, index) => {
    const tokens = headerTokens(header).join(' ');
    if (tokens === '') return;
    const rank = accepted.indexOf(tokens);
    if (rank >= 0 && rank < bestRank) {
      bestRank = rank;
      best = index;
    }
  });
  return best;
}

export interface ColumnSpec<F extends string> {
  /** Accepted header spellings per logical field, best first. Matching is token-based. */
  labels: Record<F, readonly string[]>;
  /** How each field is named in messages. */
  titles: Record<F, string>;
  /** Issue code for a required column that is absent. */
  missingCode: string;
}

export interface Columns<F extends string> {
  headers: string[];
  index: Partial<Record<F, number>>;
}

/** Resolves the required columns of a tab, reporting any that are absent. */
export function resolveColumns<F extends string>(
  sheet: RawSheet,
  fields: readonly F[],
  spec: ColumnSpec<F>,
  issues: Issue[],
): Columns<F> {
  const headers = sheetHeaders(sheet);
  const index: Partial<Record<F, number>> = {};
  for (const field of fields) {
    const found = findColumn(headers, spec.labels[field]);
    if (found === -1) {
      issues.push({
        severity: 'error',
        code: spec.missingCode,
        message: `The "${sheet.name}" tab has no "${spec.titles[field]}" column.`,
      });
      continue;
    }
    index[field] = found;
  }
  return { headers, index };
}

export interface NumberCodes {
  missing: string;
  nonNumeric: string;
}

/** Reads a required numeric cell, reporting rather than substituting on failure. */
export function requireNumber(
  row: RawCell[],
  column: number | undefined,
  what: string,
  sheetRow: number,
  issues: Issue[],
  codes: NumberCodes,
): number | null {
  if (column === undefined) return null;
  const cell = row[column] ?? null;
  if (isBlank(cell)) {
    issues.push({ severity: 'error', code: codes.missing, message: `${what} is empty.`, sheetRow });
    return null;
  }
  const parsed = parseNumber(cell);
  if (!parsed.ok) {
    issues.push({
      severity: 'error',
      code: codes.nonNumeric,
      message: `${what} is not a number (found ${JSON.stringify(cell)}).`,
      sheetRow,
    });
    return null;
  }
  return parsed.value;
}
