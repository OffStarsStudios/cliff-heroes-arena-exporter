/** Shared domain types for the spreadsheet -> JSON pipeline. */

import type { ShopSoldIn } from './currencies';
import type { Rarity } from './rarities';

export type { ShopSoldIn };

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

/**
 * One card an arena opens with. `Amount` is omitted where the sheet names no
 * figure, which the client reads as "pay whatever the reward is authored to
 * pay" - the same as zero, and how every unlock in the live config is written.
 */
export interface ArenaUnlock {
  RewardID: string;
  Amount?: number;
}

export interface ArenaMilestone {
  Trophies: number;
  ArenaID: string;
  Unlocks?: ArenaUnlock[];
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
  /** One of `RARITIES`: the client reads it into an enum that throws on anything else. */
  Rarity: Rarity;
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
  rarity: Rarity;
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

/**
 * One difficulty step. `Level` is the game's `BotLevel` enum as a number, so it
 * runs 0 (`VeryEasy`) to 4 (`VeryHard`) and every one of them is tuned.
 */
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
  Bots: BotTuning[];
}

export interface BotPreviewRow {
  level: number;
  /** The name the game's `BotLevel` enum gives this level, e.g. `Medium`. */
  name: string;
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
  Rarity: Rarity;
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
  ReferenceRarity: Rarity;
  CardsPayoutModifier: number;
  Costs: RarityCost[];
}

export interface HeroUpgradePreviewRow {
  rarity: Rarity;
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

export interface ShopContent {
  RewardID: string;
  Amount: number;
}

/**
 * One product as the client reads it.
 *
 * Every field but `ID` is applied independently and only when present, so the
 * fields a product carries are not dictated by how it is sold - a product can
 * hold a gem price and a dollar tier at once, which is how it is moved between
 * the two without a re-send. Two pairings do matter, because without them the
 * client has nothing to charge: real money needs a `PriceTier` (the tier is the
 * SKU) and a currency needs a `PriceInCurrency`.
 *
 * `IsListed` is written only when false.
 */
export interface ShopProduct {
  ID: string;
  SoldIn: ShopSoldIn;
  /** Dollars, and the store SKU charged: one of `PRICE_TIERS`. */
  PriceTier?: number;
  IsEnabled: boolean;
  IsListed?: boolean;
  PriceInCurrency?: number;
  BadgeLabel?: string;
  OfferDurationHours?: number;
  CooldownHours?: number;
  DailyLimit?: number;
  /** Overrides where the card sits in its section. */
  SortOverride?: number;
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
  /** The currency price, where it is sold in one. */
  price: number | null;
  /** The dollar tier, where it is sold for money. */
  priceTier: number | null;
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

/* ----------------------------------------------------------- Battle pass -- */

export interface BattlePassReward {
  RewardID: string;
  Amount: number;
}

/** One tier of the pass. Either track may be absent on a given tier. */
export interface BattlePassTier {
  Free?: BattlePassReward;
  Premium?: BattlePassReward;
}

export interface BattlePassConfig {
  SeasonID: string;
  SeasonName: string;
  /** `YYYY-MM-DD HH:mm`, UTC. */
  StartUtc: string;
  DurationDays: number;
  TokensPerTier: number;
  /** A `shop.*` product ID that must exist in shopSettings. */
  PremiumProductID: string;
  SkipTierCost: number;
  SkipCurrencyID: string;
  FinalRewardArt: string;
  Tiers: BattlePassTier[];
}

export interface BattlePassPreviewRow {
  /** 1-based tier number, which is also its position in `Tiers`. */
  tier: number;
  freeName: string | null;
  freeAmount: number | null;
  premiumName: string | null;
  premiumAmount: number | null;
  sheetRow: number;
}

export interface BattlePassTransformResult {
  config: BattlePassConfig;
  preview: BattlePassPreviewRow[];
  issues: Issue[];
  stats: {
    tiers: number;
    free: number;
    premium: number;
    errors: number;
    warnings: number;
  };
}
