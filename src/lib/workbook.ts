import * as XLSX from 'xlsx';
import type { RawCell, RawSheet, RawWorkbook } from './types';

/** Cell values SheetJS hands back before we normalize them. */
type SheetJsCell = string | number | boolean | Date | null | undefined;

function toRawCell(value: SheetJsCell): RawCell {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  return String(value);
}

/**
 * Trims the trailing all-empty rows that spreadsheet editors leave behind when
 * a sheet has been formatted well past its data.
 */
function trimTrailingBlankRows(rows: RawCell[][]): RawCell[][] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((cell) => cell === null || String(cell).trim() === '')) {
    end -= 1;
  }
  return rows.slice(0, end);
}

/** Converts a parsed SheetJS workbook into our plain grid model. */
export function toRawWorkbook(workbook: XLSX.WorkBook, sourceName: string): RawWorkbook {
  const sheets: RawSheet[] = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<SheetJsCell[]>(worksheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const rows = grid.map((row) => (Array.isArray(row) ? row.map(toRawCell) : []));
    // Pad every row to the widest row so column indexes are stable.
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const padded = rows.map((row) => {
      const copy = row.slice();
      while (copy.length < width) copy.push(null);
      return copy;
    });
    return { name, rows: trimTrailingBlankRows(padded) };
  });

  return { sourceName, sheets };
}

/** Reads an .xlsx/.xls/.csv byte buffer into the grid model. */
export function readWorkbookBytes(bytes: ArrayBuffer | Uint8Array, sourceName: string): RawWorkbook {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('That workbook contains no sheets.');
  }
  return toRawWorkbook(workbook, sourceName);
}

/** Reads a browser File object. */
export async function readWorkbookFile(file: File): Promise<RawWorkbook> {
  const buffer = await file.arrayBuffer();
  return readWorkbookBytes(buffer, file.name);
}
