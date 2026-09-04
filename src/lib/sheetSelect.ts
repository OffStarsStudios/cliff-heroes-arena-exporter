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

/* ---------------------------------------------------------------- Heroes -- */

/** A type alias rather than an interface so it satisfies the generic tab-selection constraint. */
export type HeroSheetSelection = {
  heroes: string | null;
  baseStats: string | null;
  levelFactors: string | null;
  powerSettings: string | null;
};

/** Scores a sheet against a keyword set, rewarding the tab's actual shape. */
function scoreHeroTab(sheet: RawSheet, required: string[], bonus: string[], negative: string[]): number {
  const words = tokens(sheet.name);
  let score = 0;
  if (required.every((keyword) => words.includes(keyword))) score += 50;
  else if (required.some((keyword) => words.includes(keyword))) score += 15;
  for (const keyword of bonus) if (words.includes(keyword)) score += 12;
  for (const keyword of negative) if (words.includes(keyword)) score -= 40;

  const header = sheet.rows[0] ?? [];
  const headerWords = header.flatMap((cell) => tokens(String(cell ?? '')));
  for (const keyword of [...required, ...bonus]) {
    if (headerWords.includes(keyword)) score += 6;
  }
  if (sheet.rows.length >= 2) score += 3;
  return score;
}

/**
 * Picks default tabs for a hero workbook. Names such as `Base Stats`,
 * `Stats Level Factors` and `Power Settings` win, but as with the arena
 * selector nothing is hardcoded to this particular workbook: the column
 * headers contribute to the score too.
 */
export function autoSelectHeroSheets(workbook: RawWorkbook): HeroSheetSelection {
  const sheets = workbook.sheets;

  const levelFactors = bestSheet(
    sheets,
    (sheet) => scoreHeroTab(sheet, ['factors'], ['level', 'multiplier', 'stats'], []),
    20,
  );
  const powerSettings = bestSheet(
    sheets,
    (sheet) => scoreHeroTab(sheet, ['power'], ['settings', 'powerup', 'special'], ['factors']),
    20,
  );
  const baseStats = bestSheet(
    sheets,
    (sheet) => scoreHeroTab(sheet, ['base'], ['stats', 'rarity'], ['factors', 'power']),
    20,
  );
  const heroes = bestSheet(
    sheets,
    (sheet) => scoreHeroTab(sheet, ['heroes'], ['hero', 'id'], ['base', 'factors', 'power', 'stats']),
    20,
  );

  return { heroes, baseStats, levelFactors, powerSettings };
}

/* ---------------------------------------------------------------- Arenas -- */

/** A type alias rather than an interface so it satisfies the generic tab-selection constraint. */
export type ArenaSheetSelection = {
  /** The Arena Name -> Arena ID lookup tab. */
  arenas: string | null;
  /** The per-arena settings tab: track count and bot levels. */
  settings: string | null;
};

function headerWords(sheet: RawSheet): string[] {
  return (sheet.rows[0] ?? []).flatMap((cell) => tokens(String(cell ?? '')));
}

/**
 * Scores a sheet as the arena settings tab. The name helps, but the headers
 * decide: only a tab with track and bot columns can pass the minimum, so a
 * hero workbook's `Power Settings` tab never qualifies on its name alone.
 */
function scoreArenaSettings(sheet: RawSheet): number {
  const words = tokens(sheet.name);
  const headers = headerWords(sheet);
  let score = 0;
  if (words.includes('settings') || words.includes('setting')) score += 30;
  if (words.includes('arena') || words.includes('arenas')) score += 15;
  if (headers.includes('track') || headers.includes('tracks')) score += 25;
  if (headers.includes('bot') || headers.includes('bots')) score += 25;
  // A lookup tab names IDs; a settings tab never does.
  if (headers.includes('id')) score -= 30;
  if (sheet.rows.length >= 2) score += 3;
  return score;
}

/** Picks default tabs for an arenas workbook: the settings tab, then the lookup. */
export function autoSelectArenaSheets(workbook: RawWorkbook): ArenaSheetSelection {
  const sheets = workbook.sheets;
  const settings = bestSheet(sheets, scoreArenaSettings, 50);
  const lookupCandidates = sheets.filter((sheet) => sheet.name !== settings);
  const arenas = bestSheet(
    lookupCandidates,
    (sheet) => {
      const headers = headerWords(sheet);
      const penalty = headers.includes('track') || headers.includes('bot') ? 50 : 0;
      return scoreLookup(sheet, ['arena', 'arenas']) - penalty;
    },
    30,
  );
  return { arenas, settings };
}

/* --------------------------------------------------------------- Dataset -- */

/** Which exporter a freshly loaded workbook looks like it is for. */
export type Dataset = 'arena' | 'heroes' | 'arenas';

/**
 * Guesses the dataset so the right exporter opens by default. A hero workbook
 * is one where the hero tabs all resolve; an arenas workbook is one with a
 * settings tab beside its lookup; anything else is treated as a trophy road.
 */
export function detectDataset(workbook: RawWorkbook): Dataset {
  const hero = autoSelectHeroSheets(workbook);
  const heroTabs = [hero.heroes, hero.baseStats, hero.levelFactors, hero.powerSettings].filter(
    (name) => name !== null,
  ).length;
  if (heroTabs === 4) return 'heroes';

  const arenas = autoSelectArenaSheets(workbook);
  if (arenas.settings !== null && arenas.arenas !== null) return 'arenas';

  const arena = autoSelectSheets(workbook);
  const arenaTabs = [arena.arenas, arena.rewards].filter((name) => name !== null).length;
  return heroTabs > arenaTabs + 1 ? 'heroes' : 'arena';
}
