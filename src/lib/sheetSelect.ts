import { detectColumns } from './columnDetect';
import { normalizeHeader } from './normalize';
import type { RawSheet, RawWorkbook } from './types';

export interface SheetSelection {
  progression: string | null;
  arenas: string | null;
  rewards: string | null;
}

function tokens(name: string): string[] {
  const normalized = normalizeHeader(name);
  return normalized === '' ? [] : normalized.split(' ');
}

/** Highest trailing number in the sheet name, used to prefer `Option 2` over `Option 1`. */
function variantNumber(name: string): number {
  const matches = normalizeHeader(name).match(/\d+/g);
  if (!matches) return 0;
  return Math.max(...matches.map((value) => Number(value)));
}

function scoreProgression(sheet: RawSheet): number {
  const words = tokens(sheet.name);
  let score = 0;
  if (words.includes('progress') || words.includes('progression')) score += 40;
  if (words.includes('arena') || words.includes('arenas')) score += 20;
  if (words.includes('option')) score += 25 + Math.min(variantNumber(sheet.name), 20);
  if (words.includes('milestone') || words.includes('milestones')) score += 20;
  // Seasonal / event variants are a different ladder.
  if (words.includes('seasonal') || words.includes('season') || words.includes('event')) score -= 45;

  // Reward the sheet that actually parses as a progression table.
  const detected = detectColumns(sheet);
  if (detected.mapping.trophiesIndex !== null) score += 12;
  if (detected.mapping.arenaIndex !== null) score += 8;
  score += Math.min(detected.mapping.rewardSlots.length, 3) * 4;
  if (sheet.rows.length > 3) score += 3;

  return score;
}

/** Scores a sheet as a two-column lookup table for the given keyword family. */
function scoreLookup(sheet: RawSheet, keywords: string[]): number {
  const words = tokens(sheet.name);
  let score = 0;
  if (keywords.some((keyword) => words.includes(keyword))) score += 40;
  if (words.length === 1 && keywords.includes(words[0])) score += 25;
  if (words.includes('progress') || words.includes('progression') || words.includes('option')) score -= 50;

  // Lookup tabs are narrow and have an id-ish column.
  const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width >= 2 && width <= 4) score += 15;
  const header = sheet.rows[0] ?? [];
  if (header.some((cell) => tokens(String(cell ?? '')).includes('id'))) score += 20;
  if (sheet.rows.length >= 2) score += 5;

  return score;
}

function bestSheet(sheets: RawSheet[], score: (sheet: RawSheet) => number, minimum: number): string | null {
  let bestName: string | null = null;
  let bestScore = minimum;
  for (const sheet of sheets) {
    const value = score(sheet);
    if (value > bestScore) {
      bestScore = value;
      bestName = sheet.name;
    }
  }
  return bestName;
}

/**
 * Picks sensible default tabs. Names such as `Arena Progress Option 2`,
 * `Arenas` and `Reward`/`Rewards` win, but nothing is hardcoded: scoring falls
 * back to the structure of each sheet.
 */
export function autoSelectSheets(workbook: RawWorkbook): SheetSelection {
  const sheets = workbook.sheets;

  const arenas = bestSheet(sheets, (sheet) => scoreLookup(sheet, ['arena', 'arenas']), 30);
  const rewards = bestSheet(sheets, (sheet) => scoreLookup(sheet, ['reward', 'rewards']), 30);

  const progressionCandidates = sheets.filter(
    (sheet) => sheet.name !== arenas && sheet.name !== rewards,
  );
  const progression =
    bestSheet(progressionCandidates.length > 0 ? progressionCandidates : sheets, scoreProgression, 0) ??
    (sheets[0]?.name ?? null);

  return { progression, arenas, rewards };
}
