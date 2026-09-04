import { requireNumber, resolveColumns, type ColumnSpec } from './columns';
import { isBlankRow } from './normalize';
import type {
  Issue,
  MatchTrophyConfig,
  MatchTrophyPreviewRow,
  MatchTrophyTransformResult,
  RawSheet,
} from './types';

/**
 * Turns the Trophies By Place tab into `matchTrophySettings`.
 *
 * One row per finishing place: the place number and the trophy delta a racer
 * in that place receives (negative for a loss). The output is an array indexed
 * by place, so the places must run 1..N with no gaps or duplicates - a gap
 * would silently shift every place below it.
 */

const COLUMN_LABELS = {
  place: ['place', 'finishing place', 'position', 'rank', 'placement'],
  trophies: ['trophies', 'trophy', 'trophy delta', 'trophies delta', 'trophy change', 'trophies won'],
} as const;

type FieldName = keyof typeof COLUMN_LABELS;

const COLUMN_SPEC: ColumnSpec<FieldName> = {
  labels: COLUMN_LABELS,
  titles: { place: 'Place', trophies: 'Trophies' },
  missingCode: 'matchtrophy-missing-column',
};

const PLACE_CODES = { missing: 'matchtrophy-place-missing', nonNumeric: 'matchtrophy-place-invalid' };
const TROPHY_CODES = { missing: 'matchtrophy-trophies-missing', nonNumeric: 'matchtrophy-trophies-invalid' };

export interface MatchTrophyTransformInput {
  /** The Trophies By Place tab. */
  places: RawSheet;
}

function ordinal(place: number): string {
  const mod100 = place % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}

/** Builds the match trophy config. Rows may appear in any order; places decide the output order. */
export function transformMatchTrophy(input: MatchTrophyTransformInput): MatchTrophyTransformResult {
  const issues: Issue[] = [];
  const sheet = input.places;
  const tab = `"${sheet.name}" tab`;

  const { index } = resolveColumns(sheet, ['place', 'trophies'], COLUMN_SPEC, issues);

  const rows: MatchTrophyPreviewRow[] = [];
  const rowsByPlace = new Map<number, number>();
  let dataRows = 0;

  for (let r = 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    if (isBlankRow(row)) continue;
    dataRows += 1;

    const place = requireNumber(row, index.place, `Row ${sheetRow} of the ${tab}: Place`, sheetRow, issues, PLACE_CODES);
    if (place === null) continue;
    if (!Number.isInteger(place) || place < 1) {
      issues.push({
        severity: 'error',
        code: 'matchtrophy-place-invalid',
        message: `Row ${sheetRow} of the ${tab}: Place must be a whole number of 1 or more, not ${place}.`,
        sheetRow,
      });
      continue;
    }

    const earlier = rowsByPlace.get(place);
    if (earlier !== undefined) {
      issues.push({
        severity: 'error',
        code: 'matchtrophy-place-duplicate',
        message: `${ordinal(place)} place appears twice on the ${tab} (rows ${earlier} and ${sheetRow}). Each place is listed once.`,
        sheetRow,
      });
      continue;
    }
    rowsByPlace.set(place, sheetRow);
    const where = `${ordinal(place)} place on the ${tab}`;

    const trophies = requireNumber(row, index.trophies, `${where}: Trophies`, sheetRow, issues, TROPHY_CODES);
    if (trophies === null) continue;
    if (!Number.isInteger(trophies)) {
      issues.push({
        severity: 'error',
        code: 'matchtrophy-trophies-invalid',
        message: `${where}: Trophies must be a whole number (negative for a loss), not ${trophies}.`,
        sheetRow,
      });
      continue;
    }

    rows.push({ place, trophies, sheetRow });
  }

  rows.sort((a, b) => a.place - b.place);

  // Places must be a complete 1..N run: the output is indexed by place.
  let sequenceOk = true;
  rows.forEach((row, i) => {
    if (row.place !== i + 1) {
      if (sequenceOk) {
        issues.push({
          severity: 'error',
          code: 'matchtrophy-place-gap',
          message: `The ${tab} skips ${ordinal(i + 1)} place: expected place ${i + 1} but found ${row.place}. Places must run 1 to ${rows.length} with no gaps.`,
          sheetRow: row.sheetRow,
        });
      }
      sequenceOk = false;
    }
  });

  if (sequenceOk && rows.length > 0) {
    if (rows[0].trophies <= 0) {
      issues.push({
        severity: 'warning',
        code: 'matchtrophy-first-place-nonpositive',
        message: `1st place awards ${rows[0].trophies} trophies. Winning a race would not gain trophies.`,
        sheetRow: rows[0].sheetRow,
      });
    }
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].trophies > rows[i - 1].trophies) {
        issues.push({
          severity: 'warning',
          code: 'matchtrophy-not-descending',
          message: `${ordinal(rows[i].place)} place awards more trophies (${rows[i].trophies}) than ${ordinal(rows[i - 1].place)} place (${rows[i - 1].trophies}). Lower places usually award less.`,
          sheetRow: rows[i].sheetRow,
        });
      }
    }
  }

  if (dataRows === 0) {
    issues.push({
      severity: 'error',
      code: 'matchtrophy-empty',
      message: `The ${tab} contains no place rows.`,
    });
  }

  const config: MatchTrophyConfig = {
    TrophiesByPlace: sequenceOk ? rows.map((row) => row.trophies) : [],
  };
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return {
    config,
    preview: rows,
    issues,
    stats: {
      places: config.TrophiesByPlace.length,
      errors,
      warnings: issues.length - errors,
    },
  };
}
