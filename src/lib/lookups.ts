import { headerTokens, isBlank, normalizeName } from './normalize';
import type { Issue, LookupEntry, LookupTable, RawCell, RawSheet } from './types';

export type LookupKind = 'arena' | 'reward';

const ID_LABELS = ['id', 'ids', 'key', 'code'];
const NAME_LABELS = ['name', 'names', 'label', 'title', 'display'];

/** Data rows in these tables carry dotted identifiers; header rows never do. */
function looksLikeIdentifier(cell: RawCell): boolean {
  return typeof cell === 'string' && /[a-z]\.[a-z]/i.test(cell);
}

function hasLabel(row: RawCell[], labels: string[]): boolean {
  return row.some((cell) => headerTokens(cell).some((token) => labels.includes(token)));
}

/**
 * Finds the header row of a lookup table, or `-1` when the sheet starts
 * straight into data.
 *
 * Lookup tabs are far simpler than the progression sheet, so the progression
 * detector's keyword scoring is the wrong tool here: every data row in a
 * Rewards tab contains the word "reward". Instead, the first populated row is
 * the header row only when it reads as column labels.
 */
export function detectLookupHeaderRow(rows: RawCell[][], maxScan = 5): number {
  const limit = Math.min(rows.length, maxScan);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (row.filter((cell) => !isBlank(cell)).length < 2) continue;
    if (row.some(looksLikeIdentifier)) return -1;
    if (hasLabel(row, ID_LABELS) || hasLabel(row, NAME_LABELS)) return i;
    // The first populated row is data, not headers.
    return -1;
  }
  return -1;
}

export interface LookupBuild {
  table: LookupTable;
  issues: Issue[];
}

/**
 * Picks the id column: the column whose header ends in / contains "id".
 * Falls back to the second populated column, which is the near-universal shape
 * of these two-column lookup tabs.
 */
function pickIdColumn(headers: string[]): number | null {
  const scored = headers.map((header, index) => {
    const tokens = headerTokens(header);
    const squashed = tokens.join('');
    if (tokens.includes('id')) return { index, score: 100 };
    if (/id$/.test(squashed) && squashed.length > 2) return { index, score: 90 };
    if (tokens.includes('key') || tokens.includes('code')) return { index, score: 70 };
    return { index, score: 0 };
  });
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), { index: -1, score: 0 });
  return best.score > 0 ? best.index : null;
}

function pickNameColumn(headers: string[], idIndex: number | null): number | null {
  const scored = headers.map((header, index) => {
    if (index === idIndex) return { index, score: -1 };
    const tokens = headerTokens(header);
    if (tokens.length === 0) return { index, score: 0 };
    if (tokens.includes('name')) return { index, score: 100 };
    if (tokens.includes('label') || tokens.includes('title') || tokens.includes('display')) {
      return { index, score: 80 };
    }
    return { index, score: 10 };
  });
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), { index: -1, score: 0 });
  return best.score > 0 ? best.index : null;
}

const KIND_LABEL: Record<LookupKind, string> = { arena: 'Arenas', reward: 'Rewards' };

/**
 * Builds a name -> id lookup from a two-column lookup sheet.
 * Matching keys are normalized, but the id returned is always the exact string
 * stored in the sheet.
 */
export function buildLookup(sheet: RawSheet, kind: LookupKind): LookupBuild {
  const issues: Issue[] = [];
  const label = KIND_LABEL[kind];
  const headerRowIndex = detectLookupHeaderRow(sheet.rows);
  const headerRow = headerRowIndex >= 0 ? sheet.rows[headerRowIndex] : [];
  const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), headerRow.length);
  const headers: string[] = [];
  for (let i = 0; i < width; i += 1) {
    const cell: RawCell = headerRow[i] ?? null;
    headers.push(isBlank(cell) ? '' : String(cell).trim());
  }

  let idIndex = pickIdColumn(headers);
  let nameIndex = pickNameColumn(headers, idIndex);
  if (idIndex === null && width >= 2) idIndex = 1;
  if (nameIndex === null && width >= 1) nameIndex = idIndex === 0 ? 1 : 0;

  const entries: LookupEntry[] = [];
  const byNormalizedName = new Map<string, string>();
  const seen = new Map<string, Set<string>>();

  if (idIndex === null || nameIndex === null || idIndex === nameIndex) {
    issues.push({
      severity: 'error',
      code: 'lookup-shape',
      message: `The "${sheet.name}" sheet does not look like a ${label} lookup table. It needs a name column and an ID column.`,
    });
    return {
      table: { byNormalizedName, ambiguous: new Map(), entries, nameHeader: '', idHeader: '' },
      issues,
    };
  }

  for (let r = headerRowIndex + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const nameCell = row[nameIndex] ?? null;
    const idCell = row[idIndex] ?? null;
    if (isBlank(nameCell) && isBlank(idCell)) continue;

    const name = String(nameCell ?? '').trim();
    const id = String(idCell ?? '').trim();

    if (name === '' || id === '') {
      issues.push({
        severity: 'warning',
        code: 'lookup-incomplete-row',
        message: `Row ${r + 1} of "${sheet.name}" is missing ${name === '' ? 'a name' : 'an ID'} and was skipped.`,
        sheetRow: r + 1,
      });
      continue;
    }

    entries.push({ name, id });
    const key = normalizeName(name);
    const ids = seen.get(key) ?? new Set<string>();
    ids.add(id);
    seen.set(key, ids);
    if (!byNormalizedName.has(key)) byNormalizedName.set(key, id);
  }

  const ambiguous = new Map<string, string[]>();
  for (const [key, ids] of seen) {
    if (ids.size > 1) {
      ambiguous.set(key, [...ids]);
      byNormalizedName.delete(key);
      issues.push({
        severity: 'error',
        code: 'lookup-ambiguous',
        message: `"${key}" appears more than once in the ${label} lookup table with different IDs (${[...ids].join(', ')}). Remove the duplicate before exporting.`,
      });
    }
  }

  if (entries.length === 0) {
    issues.push({
      severity: 'error',
      code: 'lookup-empty',
      message: `The ${label} lookup sheet "${sheet.name}" contains no rows.`,
    });
  }

  return {
    table: {
      byNormalizedName,
      ambiguous,
      entries,
      nameHeader: headers[nameIndex] ?? '',
      idHeader: headers[idIndex] ?? '',
    },
    issues,
  };
}

export type ResolveResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'missing' | 'ambiguous'; candidates?: string[] };

/** Resolves a display name to its exact id. Never fabricates an id. */
export function resolveLookup(table: LookupTable, name: string): ResolveResult {
  const key = normalizeName(name);
  if (table.ambiguous.has(key)) {
    return { ok: false, reason: 'ambiguous', candidates: table.ambiguous.get(key) };
  }
  const id = table.byNormalizedName.get(key);
  if (id === undefined) return { ok: false, reason: 'missing' };
  return { ok: true, id };
}
