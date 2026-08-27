import { readWorkbookBytes } from './workbook';
import type { RawWorkbook } from './types';

/** Endpoint served by the dev server plugin and by `server/index.mjs`. */
const PROXY_PATH = '/api/gsheet';

export class GoogleSheetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsError';
  }
}

const ACCESS_HINT =
  'Open the sheet, choose Share, and set General access to "Anyone with the link" (Viewer is enough). Private sheets cannot be read without signing in.';

/** Pulls the spreadsheet id out of any of the URL shapes Google hands out. */
export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  // A bare id pasted on its own.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;

  const patterns = [
    /\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/, // published-to-web links
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /[?&]id=([a-zA-Z0-9-_]+)/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** True for the `/spreadsheets/d/e/<token>` published-to-web form. */
export function isPublishedLink(input: string): boolean {
  return /\/spreadsheets\/d\/e\//.test(input);
}

/** Builds the public xlsx export URL for a spreadsheet. */
export function buildExportUrl(input: string, id: string): string {
  if (isPublishedLink(input)) {
    return `https://docs.google.com/spreadsheets/d/e/${id}/pub?output=xlsx`;
  }
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
}

/** A best-effort human-readable name for the download filename. */
function sourceNameFor(id: string): string {
  return `google-sheet-${id.slice(0, 12)}.xlsx`;
}

/**
 * Google answers unauthorised requests with an HTML sign-in page rather than a
 * 4xx, so sniff the payload rather than trusting the status code.
 */
function looksLikeXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** Reads the `{ error }` message our own proxy returns, when there is one. */
async function proxyMessage(response: Response): Promise<string | null> {
  if (!response.headers.get('content-type')?.includes('application/json')) return null;
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' && body.error.trim() !== '' ? body.error : null;
  } catch {
    return null;
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    const detail = await proxyMessage(response);
    if (detail !== null) throw new GoogleSheetsError(detail);
    if (response.status === 401 || response.status === 403) {
      throw new GoogleSheetsError(`Google refused access to that sheet (HTTP ${response.status}). ${ACCESS_HINT}`);
    }
    if (response.status === 404) {
      throw new GoogleSheetsError(
        'No spreadsheet was found at that link (HTTP 404). Check the URL is correct and still exists.',
      );
    }
    throw new GoogleSheetsError(`Could not load the sheet (HTTP ${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Loads a publicly readable Google Sheet as a workbook.
 *
 * Requests go through the app's own `/api/gsheet` endpoint, because Google's
 * export URLs send no CORS headers. If that endpoint is unavailable (a purely
 * static deployment) the direct URL is tried as a fallback.
 */
export async function loadGoogleSheet(input: string): Promise<RawWorkbook> {
  const id = extractSpreadsheetId(input);
  if (id === null) {
    throw new GoogleSheetsError(
      'That does not look like a Google Sheets link. Expected something like https://docs.google.com/spreadsheets/d/<id>/edit',
    );
  }

  const exportUrl = buildExportUrl(input, id);
  let bytes: Uint8Array;

  try {
    bytes = await fetchBytes(`${PROXY_PATH}?url=${encodeURIComponent(exportUrl)}`);
  } catch (proxyError) {
    if (proxyError instanceof GoogleSheetsError) throw proxyError;
    try {
      bytes = await fetchBytes(exportUrl);
    } catch {
      throw new GoogleSheetsError(
        `Could not reach Google Sheets. ${ACCESS_HINT} If the sheet is public, the browser may be blocking the cross-origin request - run the app with "npm run dev" or "npm start" so it can fetch on your behalf.`,
      );
    }
  }

  if (!looksLikeXlsx(bytes)) {
    throw new GoogleSheetsError(`That sheet is not accessible via link. ${ACCESS_HINT}`);
  }

  try {
    return readWorkbookBytes(bytes, sourceNameFor(id));
  } catch (error) {
    throw new GoogleSheetsError(
      `The sheet downloaded but could not be parsed as a workbook: ${(error as Error).message}`,
    );
  }
}
