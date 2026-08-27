import { headerTokens, isBlank, normalizeHeader } from './normalize';
import type {
  ColumnMapping,
  ColumnRole,
  DetectionReport,
  RawCell,
  RawSheet,
  RewardSlot,
} from './types';

/** Words that mean "this column bounds a range", never the milestone value. */
const RANGE_WORDS = new Set([
  'min',
  'minimum',
  'max',
  'maximum',
  'range',
  'cumulative',
  'total',
  'start',
  'end',
  'from',
  'to',
  'delta',
  'diff',
  'gain',
  'lower',
  'upper',
]);

const AMOUNT_WORDS = new Set(['amount', 'amt', 'qty', 'quantity', 'count', 'value', 'number', 'num']);

const REWARD_WORDS = new Set(['reward', 'rewards', 'unlock', 'unlocks', 'unlocked', 'hero', 'heroes', 'item', 'items', 'drop', 'drops', 'prize']);

const TROPHY_WORDS = new Set(['trophy', 'trophies']);

/** Headers that mention trophies but describe something else entirely. */
const TROPHY_NOISE = new Set(['match', 'matches', 'game', 'games', 'playtime', 'time', 'level', 'per']);

/** Converts a zero-based column index to a spreadsheet letter (0 -> A). */
export function columnLetter(index: number): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

function isAmountHeader(header: RawCell): boolean {
  const tokens = headerTokens(header);
  if (tokens.length === 0) return false;
  if (tokens.some((t) => TROPHY_WORDS.has(t))) return false;
  return tokens.some((t) => AMOUNT_WORDS.has(t));
}

/**
 * Scores a header as the milestone trophy column. Returns `-1` for headers
 * that are disqualified (range bounds, unrelated metrics).
 */
export function scoreTrophyHeader(header: RawCell): number {
  const normalized = normalizeHeader(header);
  const tokens = headerTokens(header);
  if (!tokens.some((t) => TROPHY_WORDS.has(t))) return -1;
  if (tokens.some((t) => RANGE_WORDS.has(t))) return -1;
  if (tokens.some((t) => TROPHY_NOISE.has(t))) return -1;
  if (normalized === 'trophy' || normalized === 'trophies') return 100;
  if (tokens.some((t) => ['count', 'required', 'requirement', 'requirements', 'req', 'needed', 'threshold', 'at'].includes(t))) {
    return 95;
  }
  return 60;
}

/** Scores a header as the arena-name column. */
export function scoreArenaHeader(header: RawCell): number {
  const normalized = normalizeHeader(header);
  const tokens = headerTokens(header);
  if (!tokens.includes('arena') && !tokens.includes('arenas')) return -1;
  // An arena *reward*/*unlock* column is a reward slot, not the arena column.
  if (tokens.some((t) => REWARD_WORDS.has(t))) return -1;
  if (tokens.includes('id') || /arenaid$/.test(normalized.replace(/\s+/g, ''))) return -1;
  if (normalized === 'arena' || normalized === 'arena name' || normalized === 'arenas') return 100;
  if (tokens.some((t) => RANGE_WORDS.has(t))) return 20;
  return 60;
}

/** True when a header names a reward (as opposed to its amount). */
export function isRewardNameHeader(header: RawCell): boolean {
  const tokens = headerTokens(header);
  if (tokens.length === 0) return false;
  if (isAmountHeader(header)) return false;
  if (tokens.includes('id')) return false;
  return tokens.some((t) => REWARD_WORDS.has(t));
}

/**
 * Pairs every reward-name column with the amount column that follows it,
 * searching only up to the next reward-name column so slots never steal each
 * other's amounts.
 */
export function detectRewardSlots(headers: RawCell[]): RewardSlot[] {
  const nameIndexes = headers.map((h, i) => (isRewardNameHeader(h) ? i : -1)).filter((i) => i >= 0);
  const labelCounts = new Map<string, number>();

  return nameIndexes.map((nameIndex, position) => {
    const limit = position + 1 < nameIndexes.length ? nameIndexes[position + 1] : headers.length;
    let amountIndex: number | null = null;
    for (let i = nameIndex + 1; i < limit; i += 1) {
      if (isAmountHeader(headers[i])) {
        amountIndex = i;
        break;
      }
    }

    const base = String(headers[nameIndex] ?? '').trim() || `Column ${columnLetter(nameIndex)}`;
    const seen = (labelCounts.get(base) ?? 0) + 1;
    labelCounts.set(base, seen);
    const duplicated = nameIndexes.filter((i) => String(headers[i] ?? '').trim() === base).length > 1;
    const label = duplicated ? `${base} ${seen}` : base;

    return { nameIndex, amountIndex, label };
  });
}

function pickBest(headers: RawCell[], score: (h: RawCell) => number): { index: number | null; tied: boolean } {
  let best = 0;
  let bestIndex: number | null = null;
  let tied = false;
  headers.forEach((header, index) => {
    const value = score(header);
    if (value <= 0) return;
    if (value > best) {
      best = value;
      bestIndex = index;
      tied = false;
    } else if (value === best) {
      tied = true;
    }
  });
  return { index: bestIndex, tied };
}

/**
 * Finds the header row: the row in the first `maxScan` rows that yields the
 * strongest set of recognisable headers. Falls back to the first non-blank row.
 */
export function detectHeaderRow(rows: RawCell[][], maxScan = 10): number {
  let bestRow = -1;
  let bestScore = 0;
  const limit = Math.min(rows.length, maxScan);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    const filled = row.filter((cell) => !isBlank(cell)).length;
    if (filled < 2) continue;
    let score = 0;
    if (pickBest(row, scoreTrophyHeader).index !== null) score += 3;
    if (pickBest(row, scoreArenaHeader).index !== null) score += 2;
    score += Math.min(detectRewardSlots(row).length, 4) * 2;
    // Prefer rows whose cells are text labels rather than data.
    score += row.some((cell) => typeof cell === 'string' && cell.trim() !== '') ? 1 : 0;
    // Dotted identifiers (`reward.currency.coins`) are data, never headers.
    score -= row.filter((cell) => typeof cell === 'string' && /[a-z]\.[a-z]/i.test(cell)).length;
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  if (bestRow >= 0) return bestRow;
  return rows.findIndex((row) => row.some((cell) => !isBlank(cell)));
}

/** Runs full automatic column detection against a progression sheet. */
export function detectColumns(sheet: RawSheet): DetectionReport {
  const headerRowIndex = detectHeaderRow(sheet.rows);
  const headerRow = headerRowIndex >= 0 ? sheet.rows[headerRowIndex] : [];
  const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), headerRow.length);
  const headers: string[] = [];
  for (let i = 0; i < width; i += 1) {
    const cell = headerRow[i];
    headers.push(isBlank(cell) ? '' : String(cell).trim());
  }

  const trophies = pickBest(headers, scoreTrophyHeader);
  const arena = pickBest(headers, scoreArenaHeader);
  const rewardSlots = detectRewardSlots(headers);

  const uncertain: ColumnRole[] = [];
  if (trophies.index === null || trophies.tied) uncertain.push('trophies');
  if (arena.index === null || arena.tied) uncertain.push('arena');

  const mapping: ColumnMapping = {
    trophiesIndex: trophies.index,
    arenaIndex: arena.index,
    rewardSlots,
  };

  return { mapping, headers, headerRowIndex, uncertain };
}
