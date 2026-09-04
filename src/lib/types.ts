/** Shared domain types for the spreadsheet -> JSON pipeline. */

/** A worksheet reduced to a rectangular grid of raw cell values. */
export interface RawSheet {
  name: string;
  /** Row-major grid. `null` means the cell was empty. */
  rows: RawCell[][];
}

export type RawCell = string | number | boolean | null;

export interface RawWorkbook {
  /** Where the workbook came from, used for the default download filename. */
  sourceName: string;
  sheets: RawSheet[];
}

/** Logical roles a progression column can play. */
export type ColumnRole = 'trophies' | 'arena';

/**
 * One reward slot on the progression sheet: a reward-name column optionally
 * paired with the amount column that belongs to it.
 */
export interface RewardSlot {
  /** Zero-based column index of the reward name. */
  nameIndex: number;
  /** Zero-based column index of the amount, or `null` when the sheet has none. */
  amountIndex: number | null;
  /** Header text as it appears in the sheet, for the mapping UI. */
  label: string;
}

/** Resolved mapping from sheet columns to logical progression fields. */
export interface ColumnMapping {
  trophiesIndex: number | null;
  arenaIndex: number | null;
  rewardSlots: RewardSlot[];
}

/** How confident automatic detection was, per field. */
export interface DetectionReport {
  mapping: ColumnMapping;
  headers: string[];
  headerRowIndex: number;
  /** Fields the detector could not resolve with confidence. */
  uncertain: ColumnRole[];
}

/** A lookup table (Arenas or Rewards) reduced to name -> id. */
export interface LookupTable {
  /** Lowercased+trimmed name -> exact id from the sheet. */
  byNormalizedName: Map<string, string>;
  /** Normalized names that appear more than once with conflicting ids. */
  ambiguous: Map<string, string[]>;
  /** Original display names, in sheet order. */
  entries: LookupEntry[];
  nameHeader: string;
  idHeader: string;
}

export interface LookupEntry {
  name: string;
  id: string;
}

/** Intermediate, human-inspectable view of one parsed sheet row. */
export interface ParsedRow {
  /** 1-based row number in the original sheet, for error messages. */
  sheetRow: number;
  trophiesRaw: RawCell;
  arenaRaw: RawCell;
  /** Arena after forward-filling blank cells from the row above. */
  arenaName: string | null;
  rewards: ParsedReward[];
  /** True when this row introduces its arena (first row of the arena block). */
  isArenaMilestone: boolean;
}

export interface ParsedReward {
  slotLabel: string;
  name: string;
  amountRaw: RawCell;
}

/** The two milestone shapes the exporter emits. */
export interface RewardMilestone {
  Trophies: number;
  RewardID: string;
  Amount: number;
}

export interface ArenaMilestone {
  Trophies: number;
  ArenaID: string;
  Unlocks?: { RewardID: string }[];
}

export type Milestone = RewardMilestone | ArenaMilestone;

export interface ArenaProgressConfig {
  Milestones: Milestone[];
}

export type IssueSeverity = 'error' | 'warning';

export interface Issue {
  severity: IssueSeverity;
  /** Stable code so the UI can group/filter. */
  code: string;
  message: string;
  /** 1-based sheet row the issue came from, when applicable. */
  sheetRow?: number;
}

/** A row of the pre-export preview table. */
export interface PreviewRow {
  trophies: number | null;
  type: 'Arena' | 'Arena Unlock' | 'Reward';
  label: string;
  amount: number | null;
  sheetRow: number;
}

export interface TransformResult {
  config: ArenaProgressConfig;
  preview: PreviewRow[];
  issues: Issue[];
  stats: {
    milestones: number;
    arenas: number;
    arenaUnlockMilestones: number;
    rewardMilestones: number;
    errors: number;
    warnings: number;
  };
}

/* ---------------------------------------------------------------- Heroes -- */

/** One level's rolled-up stats. Base stat x that level's multiplier. */
export interface HeroLevel {
  Health: number;
  Speed: number;
  Grip: number;
}

/**
 * A hero's power block. `ActivationDelay` and `Duration` are always present;
 * the remaining parameters differ per hero and are validated by name against
 * the schema in `powerParams.ts`.
 */
export interface HeroPower {
  ActivationDelay: number;
  Duration: number;
  [param: string]: number | boolean;
}

export interface HeroEntry {
  ID: string;
  MaxSpeed: number;
  SpeedIncreasePerSecond: number;
  Rarity: string;
  PowerCooldown: number;
  Levels: HeroLevel[];
  Power: HeroPower;
}

export interface HeroesConfig {
  Heroes: HeroEntry[];
}

/** A row of the hero preview table. */
export interface HeroPreviewRow {
  name: string;
  id: string;
  rarity: string;
  maxSpeed: number;
  levelCount: number;
  first: HeroLevel | null;
  last: HeroLevel | null;
  powerParams: string[];
  sheetRow: number;
}

export interface HeroTransformResult {
  config: HeroesConfig;
  preview: HeroPreviewRow[];
  issues: Issue[];
  stats: {
    heroes: number;
    levels: number;
    powerParams: number;
    errors: number;
    warnings: number;
  };
}

/* ---------------------------------------------------------------- Arenas -- */

export interface ArenaDefinition {
  ID: string;
  TrackCount: number;
  /** Difficulty names, one per bot. Resolved to `BotsConfig` levels by the client. */
  BotLevels: string[];
}

export interface ArenasConfig {
  Arenas: ArenaDefinition[];
}

/** A row of the arena preview table. */
export interface ArenaPreviewRow {
  name: string;
  id: string;
  trackCount: number;
  botLevels: string[];
  sheetRow: number;
}

export interface ArenasTransformResult {
  config: ArenasConfig;
  preview: ArenaPreviewRow[];
  issues: Issue[];
  stats: {
    arenas: number;
    bots: number;
    errors: number;
    warnings: number;
  };
}

/* --------------------------------------------------------- Match trophies -- */

/** Trophy delta per finishing place. Its length is the racer count. */
export interface MatchTrophyConfig {
  TrophiesByPlace: number[];
}

export interface MatchTrophyPreviewRow {
  place: number;
  trophies: number;
  sheetRow: number;
}

export interface MatchTrophyTransformResult {
  config: MatchTrophyConfig;
  preview: MatchTrophyPreviewRow[];
  issues: Issue[];
  stats: {
    places: number;
    errors: number;
    warnings: number;
  };
}

/* ------------------------------------------------------------------ Bots -- */

/** One difficulty step. Levels are numeric and run 0..N. */
export interface BotTuning {
  Level: number;
  MinJumpInterval: number;
  MaxJumpInterval: number;
  MinDodgeChance: number;
  MaxDodgeChance: number;
  RaycastDistance: number;
  RaycastInterval: number;
  MinFireInterval: number;
  MaxFireInterval: number;
}

export interface BotsConfig {
  /** Highest defined level. Must equal the maximum `Level` in `Bots`. */
  BotLevel: number;
  Bots: BotTuning[];
}

export interface BotPreviewRow {
  level: number;
  jump: [number, number];
  dodge: [number, number];
  raycast: [number, number];
  fire: [number, number];
  sheetRow: number;
}

export interface BotsTransformResult {
  config: BotsConfig;
  preview: BotPreviewRow[];
  issues: Issue[];
  stats: {
    levels: number;
    errors: number;
    warnings: number;
  };
}

/* ---------------------------------------------------------- Hero upgrades -- */

export interface RarityCost {
  Rarity: string;
  CoinsBase: number;
  CardsBase: number;
  CostModifier: number;
  GrowthModifier: number;
}

/**
 * Generative: the client rolls a cost curve out of these growth factors and
 * per-rarity bases rather than reading a table of levels.
 */
export interface HeroUpgradeConfig {
  CoinsGrowth: number;
  CardsGrowth: number;
  CoinsRounding: number;
  CardsRounding: number;
  ReferenceRarity: string;
  CardsPayoutModifier: number;
  Costs: RarityCost[];
}

export interface HeroUpgradePreviewRow {
  rarity: string;
  coinsBase: number;
  cardsBase: number;
  costModifier: number;
  growthModifier: number;
  sheetRow: number;
}

export interface HeroUpgradeTransformResult {
  config: HeroUpgradeConfig;
  preview: HeroUpgradePreviewRow[];
  issues: Issue[];
  stats: {
    rarities: number;
    errors: number;
    warnings: number;
  };
}

/* ------------------------------------------------------------------ Shop -- */

export type ShopSoldIn = 'RealMoney' | 'Gems' | 'Free' | 'Ad';

export interface ShopContent {
  RewardID: string;
  Amount: number;
}

/**
 * Which optional fields a product carries follows from how it is sold:
 * `Gems` products carry `PriceInCurrency`, `Free` products `CooldownHours`,
 * `Ad` products `DailyLimit`; real-money products are priced store-side.
 * `IsListed` is written only when false.
 */
export interface ShopProduct {
  ID: string;
  SoldIn: ShopSoldIn;
  IsEnabled: boolean;
  IsListed?: boolean;
  PriceInCurrency?: number;
  BadgeLabel?: string;
  OfferDurationHours?: number;
  CooldownHours?: number;
  DailyLimit?: number;
  Contents: ShopContent[];
}

export interface ShopConfig {
  Products: ShopProduct[];
}

export interface ShopPreviewRow {
  id: string;
  soldIn: ShopSoldIn;
  enabled: boolean;
  listed: boolean;
  price: number | null;
  badge: string | null;
  /** "Coins x3500" per granted reward. */
  contents: string[];
  sheetRow: number;
}

export interface ShopTransformResult {
  config: ShopConfig;
  preview: ShopPreviewRow[];
  issues: Issue[];
  stats: {
    products: number;
    enabled: number;
    contents: number;
    errors: number;
    warnings: number;
  };
}
