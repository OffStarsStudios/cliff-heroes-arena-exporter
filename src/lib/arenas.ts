import { ARENA_BOT_DIFFICULTIES, resolveDifficulty } from './arenaDifficulties';
import { requireNumber, resolveColumns, type ColumnSpec } from './columns';
import { resolveLookup } from './lookups';
import { cellText, headerTokens, isBlankRow, normalizeName } from './normalize';
import type {
  ArenaDefinition,
  ArenaPreviewRow,
  ArenasTransformResult,
  Issue,
  LookupTable,
  RawCell,
  RawSheet,
} from './types';

/**
 * Turns the Arena Settings tab into `arenasSettings`.
 *
 * One row per arena: the arena's name (resolved to its ID through the Arenas
 * lookup tab - IDs are never constructed from names), its track count, and one
 * `Bot N Level` column per bot. The bot columns are found by header, so a
 * fourth bot is a matter of adding a `Bot 4 Level` column.
 */

/* -------------------------------------------------------------- columns -- */

const COLUMN_LABELS = {
  arenaName: ['arena name', 'name', 'arena'],
  trackCount: ['track count', 'tracks', 'track', 'number of tracks', 'track amount'],
} as const;

type FieldName = keyof typeof COLUMN_LABELS;

const COLUMN_SPEC: ColumnSpec<FieldName> = {
  labels: COLUMN_LABELS,
  titles: { arenaName: 'Arena Name', trackCount: 'Track Count' },
  missingCode: 'arenas-missing-column',
};

const TRACK_COUNT_CODES = {
  missing: 'arenas-track-count-missing',
  nonNumeric: 'arenas-track-count-invalid',
};

/** IDs the game reads verbatim; the convention is `arena.` plus lowercase letters and digits. */
const ID_PATTERN = /^arena\.[a-z0-9]+$/;

export interface BotColumn {
  /** Zero-based column index. */
  index: number;
  /** The N in `Bot N Level`. */
  number: number;
  /** Header text as it appears in the sheet, for messages. */
  header: string;
}

/**
 * Finds the bot level columns: `Bot 1 Level`, `Bot Level 1`, `Bot 1 Difficulty`
 * or just `Bot 1`, in any order. Columns are read in numeric order, so a sheet
 * that lists `Bot 3 Level` before `Bot 2 Level` still exports bots 1, 2, 3.
 */
export function findBotColumns(headers: string[], issues: Issue[]): BotColumn[] {
  const found: BotColumn[] = [];
  headers.forEach((header, index) => {
    const tokens = headerTokens(header);
    if (tokens.length === 0) return;

    // A bot column names exactly one bot number, the word "bot" (possibly
    // glued to the number, as in `Bot1`), and nothing else but "level" or
    // "difficulty". Anything more specific is some other column.
    let number: number | null = null;
    let sawBot = false;
    const extras: string[] = [];
    for (const token of tokens) {
      const glued = /^bots?(\d+)$/.exec(token);
      if (glued) {
        if (number !== null) return;
        number = Number(glued[1]);
        sawBot = true;
        continue;
      }
      if (/^\d+$/.test(token)) {
        if (number !== null) return;
        number = Number(token);
        continue;
      }
      if (token === 'bot' || token === 'bots') {
        sawBot = true;
        continue;
      }
      extras.push(token);
    }
    if (number === null || !sawBot) return;
    if (!extras.every((word) => word === 'level' || word === 'difficulty')) return;

    found.push({ index, number, header });
  });

  found.sort((a, b) => a.number - b.number || a.index - b.index);

  const numbering = found.map((column) => column.number);
  const expected = found.map((_, i) => i + 1);
  if (found.length > 0 && numbering.some((value, i) => value !== expected[i])) {
    issues.push({
      severity: 'warning',
      code: 'arenas-bot-column-numbering',
      message: `Bot level columns are numbered ${numbering.join(', ')} - expected ${expected.join(', ')}. Columns are read in numeric order, so the export still lists the bots in that order.`,
    });
  }

  return found;
}

/* ------------------------------------------------------------ transform -- */

export interface ArenasTransformInput {
  /** The Arena Settings tab. */
  settings: RawSheet;
  /** Arena name -> arena ID, built from the Arenas lookup tab. */
  arenas: LookupTable;
}

interface BotRead {
  levels: string[];
  ok: boolean;
}

function readBotLevels(
  row: RawCell[],
  columns: BotColumn[],
  where: string,
  sheetRow: number,
  issues: Issue[],
): BotRead {
  const cells = columns.map((column) => ({ column, text: cellText(row[column.index] ?? null) }));
  const lastFilled = cells.reduce((last, cell, i) => (cell.text !== null ? i : last), -1);

  if (lastFilled === -1) {
    issues.push({
      severity: 'error',
      code: 'arenas-no-bots',
      message: `${where} has no bot levels. Every arena needs at least one bot.`,
      sheetRow,
    });
    return { levels: [], ok: false };
  }

  const gap = cells.findIndex((cell, i) => i < lastFilled && cell.text === null);
  if (gap !== -1) {
    issues.push({
      severity: 'error',
      code: 'arenas-bot-level-gap',
      message: `${where}: "${cells[gap].column.header}" is empty but "${cells[lastFilled].column.header}" is set. Bot levels are read left to right, so fill them without gaps.`,
      sheetRow,
    });
    return { levels: [], ok: false };
  }

  const levels: string[] = [];
  let ok = true;
  for (const cell of cells.slice(0, lastFilled + 1)) {
    const raw = cell.text as string;
    const resolved = resolveDifficulty(raw);
    if (resolved.status === 'unknown') {
      const hint =
        resolved.suggestion === null
          ? `The accepted names are ${ARENA_BOT_DIFFICULTIES.join(', ')}.`
          : `Did you mean "${resolved.suggestion}"?`;
      issues.push({
        severity: 'error',
        code: 'arenas-difficulty-unknown',
        message: `${where}: "${raw}" in "${cell.column.header}" is not a bot difficulty the game knows. ${hint}`,
        sheetRow,
      });
      ok = false;
      continue;
    }
    if (resolved.status === 'corrected') {
      issues.push({
        severity: 'warning',
        code: 'arenas-difficulty-spelling',
        message: `${where}: "${raw}" in "${cell.column.header}" is spelled differently from the schema and is exported as "${resolved.name}".`,
        sheetRow,
      });
    }
    levels.push(resolved.name);
  }
  return { levels, ok };
}

/**
 * Builds the arenas config. Arena order follows the settings tab; IDs always
 * come from the Arenas lookup tab.
 */
export function transformArenas(input: ArenasTransformInput): ArenasTransformResult {
  const issues: Issue[] = [];
  const sheet = input.settings;
  const tab = `"${sheet.name}" tab`;

  const { headers, index } = resolveColumns(sheet, ['arenaName', 'trackCount'], COLUMN_SPEC, issues);
  const botColumns = findBotColumns(headers, issues);
  if (botColumns.length === 0) {
    issues.push({
      severity: 'error',
      code: 'arenas-missing-column',
      message: `The ${tab} has no bot level columns. Expected headers such as "Bot 1 Level", "Bot 2 Level".`,
    });
  }

  const arenas: ArenaDefinition[] = [];
  const preview: ArenaPreviewRow[] = [];
  const rowsByName = new Map<string, number>();
  const rowsById = new Map<string, { name: string; sheetRow: number }>();
  const usedLookupNames = new Set<string>();
  let namedRows = 0;

  for (let r = 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    if (isBlankRow(row)) continue;

    const name = index.arenaName === undefined ? null : cellText(row[index.arenaName]);
    if (name === null) {
      if (index.arenaName !== undefined) {
        issues.push({
          severity: 'error',
          code: 'arenas-name-missing',
          message: `Row ${sheetRow} of the ${tab} has values but no arena name, so it cannot be exported.`,
          sheetRow,
        });
      }
      continue;
    }
    namedRows += 1;
    const where = `"${name}" on the ${tab}`;

    const key = normalizeName(name);
    const earlier = rowsByName.get(key);
    if (earlier !== undefined) {
      issues.push({
        severity: 'error',
        code: 'arenas-duplicate',
        message: `"${name}" is configured twice on the ${tab} (rows ${earlier} and ${sheetRow}). Each arena is configured once.`,
        sheetRow,
      });
      continue;
    }
    rowsByName.set(key, sheetRow);

    const resolved = resolveLookup(input.arenas, name);
    if (!resolved.ok) {
      issues.push({
        severity: 'error',
        code: resolved.reason === 'ambiguous' ? 'arenas-id-ambiguous' : 'arenas-id-missing',
        message:
          resolved.reason === 'ambiguous'
            ? `"${name}" appears more than once on the Arenas tab with different IDs (${(resolved.candidates ?? []).join(', ')}).`
            : `"${name}" has no entry on the Arenas tab, so there is no Arena ID to export.`,
        sheetRow,
      });
      continue;
    }
    usedLookupNames.add(key);
    const id = resolved.id;

    if (!ID_PATTERN.test(id)) {
      issues.push({
        severity: 'warning',
        code: 'arenas-id-format',
        message: `"${id}" does not follow the arena.<name> pattern (lowercase letters and digits). The game matches IDs exactly, so check the trophy road spells it the same way.`,
        sheetRow,
      });
    }

    const sameId = rowsById.get(id);
    if (sameId !== undefined) {
      issues.push({
        severity: 'error',
        code: 'arenas-duplicate',
        message: `"${name}" (row ${sheetRow}) and "${sameId.name}" (row ${sameId.sheetRow}) both resolve to ${id}. Each arena is configured once.`,
        sheetRow,
      });
      continue;
    }
    rowsById.set(id, { name, sheetRow });

    const trackCount = requireNumber(
      row,
      index.trackCount,
      `${where}: Track Count`,
      sheetRow,
      issues,
      TRACK_COUNT_CODES,
    );
    if (trackCount === null) continue;
    if (!Number.isInteger(trackCount) || trackCount < 1) {
      issues.push({
        severity: 'error',
        code: 'arenas-track-count-invalid',
        message: `${where}: Track Count must be a whole number of 1 or more, not ${trackCount}.`,
        sheetRow,
      });
      continue;
    }

    if (botColumns.length === 0) continue;
    const bots = readBotLevels(row, botColumns, where, sheetRow, issues);
    if (!bots.ok) continue;

    arenas.push({ ID: id, TrackCount: trackCount, BotLevels: bots.levels });
    preview.push({ name, id, trackCount, botLevels: bots.levels, sheetRow });
  }

  // Every arena should run the same number of bots: match trophies are
  // awarded per finishing place, and there is one such table for all arenas.
  const counts = new Set(arenas.map((arena) => arena.BotLevels.length));
  if (counts.size > 1) {
    const listing = preview.map((row) => `${row.name}: ${row.botLevels.length}`).join(', ');
    issues.push({
      severity: 'warning',
      code: 'arenas-bot-count-uneven',
      message: `Arenas run different numbers of bots (${listing}). Match trophies are awarded per finishing place, so every arena is expected to run the same number of bots.`,
    });
  }

  for (const entry of input.arenas.entries) {
    if (usedLookupNames.has(normalizeName(entry.name))) continue;
    if (rowsByName.has(normalizeName(entry.name))) continue;
    issues.push({
      severity: 'warning',
      code: 'arenas-unused-lookup',
      message: `The Arenas tab defines "${entry.name}" (${entry.id}) but the ${tab} has no row for it, so it will not be exported.`,
    });
  }

  if (namedRows === 0) {
    issues.push({
      severity: 'error',
      code: 'arenas-empty',
      message: `The ${tab} contains no arena rows.`,
    });
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return {
    config: { Arenas: arenas },
    preview,
    issues,
    stats: {
      arenas: arenas.length,
      bots: arenas.reduce((sum, arena) => sum + arena.BotLevels.length, 0),
      errors,
      warnings: issues.length - errors,
    },
  };
}
