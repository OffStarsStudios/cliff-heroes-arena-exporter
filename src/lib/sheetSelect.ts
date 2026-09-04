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

/* -------------------------------------------------------- Match trophies -- */

export type MatchTrophySheetSelection = {
  /** The Trophies By Place tab. */
  places: string | null;
};

/**
 * Scores a sheet as the trophies-by-place tab. Headers decide: it needs both a
 * place column and a trophies column, which no trophy-road or hero tab has.
 */
function scoreMatchTrophy(sheet: RawSheet): number {
  const words = tokens(sheet.name);
  const headers = headerWords(sheet);
  let score = 0;
  if (words.includes('place') || words.includes('places')) score += 20;
  if (words.includes('trophies') || words.includes('trophy')) score += 15;
  if (words.includes('match')) score += 10;
  const hasPlace = headers.includes('place') || headers.includes('position') || headers.includes('rank');
  const hasTrophies = headers.includes('trophies') || headers.includes('trophy');
  if (hasPlace && hasTrophies) score += 50;
  if (sheet.rows.length >= 2) score += 3;
  return score;
}

export function autoSelectMatchTrophySheets(workbook: RawWorkbook): MatchTrophySheetSelection {
  return { places: bestSheet(workbook.sheets, scoreMatchTrophy, 50) };
}

/* ------------------------------------------------------------------ Bots -- */

export type BotsSheetSelection = {
  /** The Bots tab: one row per level. */
  bots: string | null;
};

/** Scores a sheet as the bots tab: a level column beside the tuning columns. */
function scoreBots(sheet: RawSheet): number {
  const words = tokens(sheet.name);
  const headers = headerWords(sheet);
  let score = 0;
  if (words.includes('bot') || words.includes('bots')) score += 30;
  const hasLevel = headers.includes('level') || headers.includes('lvl');
  const tuning = ['jump', 'dodge', 'raycast', 'fire'].filter((word) => headers.includes(word)).length;
  if (hasLevel && tuning >= 2) score += 50;
  if (sheet.rows.length >= 2) score += 3;
  return score;
}

export function autoSelectBotsSheets(workbook: RawWorkbook): BotsSheetSelection {
  return { bots: bestSheet(workbook.sheets, scoreBots, 50) };
}

/* ---------------------------------------------------------- Hero upgrades -- */

export type HeroUpgradeSheetSelection = {
  /** The Growth key/value tab. */
  growth: string | null;
  /** The Costs tab: one row per rarity. */
  costs: string | null;
};

function scoreGrowth(sheet: RawSheet): number {
  const words = tokens(sheet.name);
  const headers = headerWords(sheet);
  const firstColumn = sheet.rows.slice(0, 8).flatMap((row) => tokens(String(row[0] ?? '')));
  let score = 0;
  if (words.includes('growth')) score += 30;
  if (words.includes('settings') || words.includes('setting') || words.includes('scalars')) score += 10;
  if (words.includes('upgrade') || words.includes('upgrades')) score += 10;
  if (headers.includes('value') || headers.includes('values')) score += 20;
  // The setting names themselves are the strongest signal.
  if (firstColumn.includes('growth') && firstColumn.includes('rounding')) score += 40;
  if (headers.includes('rarity')) score -= 40;
  if (sheet.rows.length >= 2) score += 3;
  return score;
}

function scoreCosts(sheet: RawSheet): number {
  const words = tokens(sheet.name);
  const headers = headerWords(sheet);
  let score = 0;
  if (words.includes('costs') || words.includes('cost')) score += 30;
  if (words.includes('rarity') || words.includes('rarities')) score += 15;
  const hasRarity = headers.includes('rarity');
  const hasBases = headers.includes('coins') || headers.includes('cards') || headers.includes('base');
  if (hasRarity && hasBases && headers.includes('modifier')) score += 50;
  if (sheet.rows.length >= 2) score += 3;
  return score;
}

export function autoSelectHeroUpgradeSheets(workbook: RawWorkbook): HeroUpgradeSheetSelection {
  const costs = bestSheet(workbook.sheets, scoreCosts, 50);
  const growth = bestSheet(
    workbook.sheets.filter((sheet) => sheet.name !== costs),
    scoreGrowth,
    50,
  );
  return { growth, costs };
}

/* ------------------------------------------------------------------ Shop -- */

export type ShopSheetSelection = {
  /** The Products tab. */
  products: string | null;
  /** The Reward Name -> Reward ID lookup tab. */
  rewards: string | null;
};

function scoreProducts(sheet: RawSheet): number {
  const words = tokens(sheet.name);
  const headers = headerWords(sheet);
  let score = 0;
  if (words.includes('products') || words.includes('product')) score += 30;
  if (words.includes('shop') || words.includes('store')) score += 15;
  const hasSale = headers.includes('sold') || headers.includes('enabled') || headers.includes('price');
  const hasContents = headers.includes('reward') || headers.includes('amount');
  if (hasSale && hasContents) score += 50;
  if (sheet.rows.length >= 2) score += 3;
  return score;
}

export function autoSelectShopSheets(workbook: RawWorkbook): ShopSheetSelection {
  const products = bestSheet(workbook.sheets, scoreProducts, 50);
  const rewards = bestSheet(
    workbook.sheets.filter((sheet) => sheet.name !== products),
    (sheet) => scoreLookup(sheet, ['reward', 'rewards']),
    30,
  );
  return { products, rewards };
}

/* --------------------------------------------------------------- Dataset -- */

/** Which exporter a freshly loaded workbook looks like it is for. */
export type Dataset = 'arena' | 'heroes' | 'arenas' | 'matchTrophy' | 'bots' | 'heroUpgrade' | 'shop';

/**
 * Guesses the dataset so the right exporter opens by default. A hero workbook
 * is one where the hero tabs all resolve; an arenas workbook is one with a
 * settings tab beside its lookup; a match-trophy workbook has a places tab;
 * anything else is treated as a trophy road.
 */
export function detectDataset(workbook: RawWorkbook): Dataset {
  const hero = autoSelectHeroSheets(workbook);
  const heroTabs = [hero.heroes, hero.baseStats, hero.levelFactors, hero.powerSettings].filter(
    (name) => name !== null,
  ).length;
  if (heroTabs === 4) return 'heroes';

  const arenas = autoSelectArenaSheets(workbook);
  if (arenas.settings !== null && arenas.arenas !== null) return 'arenas';

  if (autoSelectMatchTrophySheets(workbook).places !== null) return 'matchTrophy';
  if (autoSelectBotsSheets(workbook).bots !== null) return 'bots';

  const upgrade = autoSelectHeroUpgradeSheets(workbook);
  if (upgrade.growth !== null && upgrade.costs !== null) return 'heroUpgrade';

  const shop = autoSelectShopSheets(workbook);
  if (shop.products !== null && shop.rewards !== null) return 'shop';

  const arena = autoSelectSheets(workbook);
  const arenaTabs = [arena.arenas, arena.rewards].filter((name) => name !== null).length;
  return heroTabs > arenaTabs + 1 ? 'heroes' : 'arena';
}
