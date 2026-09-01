/**
 * Payload types for the seven ConfigCat settings that make up the live config.
 *
 * Two of them (`heroes`, `trophyRoad`) are produced by the spreadsheet
 * exporters and already have types in `../lib/types`. The other five are
 * hand-authored JSON pasted into the ConfigCat dashboard; their shapes are
 * transcribed here from the live values so the config graph can be checked.
 */

import type { ArenaProgressConfig, HeroesConfig } from '../lib/types';

export type { ArenaProgressConfig, HeroesConfig };

/* ------------------------------------------------------------------ bots -- */

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

/* ----------------------------------------------------------- heroUpgrade -- */

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

/* ---------------------------------------------------------- matchTrophy -- */

/** Trophy delta per finishing place. Its length is the racer count. */
export interface MatchTrophyConfig {
  TrophiesByPlace: number[];
}

/* --------------------------------------------------------------- arenas -- */

export interface ArenaDefinition {
  ID: string;
  TrackCount: number;
  /** Difficulty names, one per bot. Resolved to `BotsConfig` levels by the client. */
  BotLevels: string[];
}

export interface ArenasConfig {
  Arenas: ArenaDefinition[];
}

/* ----------------------------------------------------------------- shop -- */

export interface ShopContent {
  RewardID: string;
  Amount: number;
}

/**
 * Polymorphic with no discriminator field: the product variant is inferred
 * from the `ID` prefix. `shop.featured.*` carries `BadgeLabel` and
 * `OfferDurationHours`, `shop.skin.*` carries `PriceInCurrency`,
 * `shop.free.*` carries `CooldownHours`, `shop.rv.*` carries `DailyLimit`,
 * and the currency tiers carry no price at all because they are priced
 * store-side as IAPs.
 */
export interface ShopProduct {
  ID: string;
  IsEnabled: boolean;
  BadgeLabel?: string;
  OfferDurationHours?: number;
  PriceInCurrency?: number;
  CooldownHours?: number;
  DailyLimit?: number;
  Contents: ShopContent[];
}

export interface ShopConfig {
  Products: ShopProduct[];
}

/* ------------------------------------------------------------- the set -- */

export type DomainId =
  | 'heroes'
  | 'trophyRoad'
  | 'bots'
  | 'heroUpgrade'
  | 'matchTrophy'
  | 'arenas'
  | 'shop';

/** The ConfigCat setting key each domain publishes to. */
export const SETTING_KEYS: Record<DomainId, string> = {
  heroes: 'heroesSettings',
  trophyRoad: 'trophyRoadSettings',
  bots: 'botsSettings',
  heroUpgrade: 'heroUpgradeSettings',
  matchTrophy: 'matchTrophySettings',
  arenas: 'arenasSettings',
  shop: 'shopSettings',
};

/** Where each domain's payload is recorded in git, as the deployed baseline. */
export const GIT_PATHS: Record<DomainId, string> = {
  heroes: 'config/heroes.json',
  trophyRoad: 'config/trophyRoad.json',
  bots: 'config/bots.json',
  heroUpgrade: 'config/heroUpgrade.json',
  matchTrophy: 'config/matchTrophy.json',
  arenas: 'config/arenas.json',
  shop: 'config/shop.json',
};

export const DOMAIN_LABELS: Record<DomainId, string> = {
  heroes: 'Heroes',
  trophyRoad: 'Trophy road',
  bots: 'Bots',
  heroUpgrade: 'Hero upgrades',
  matchTrophy: 'Match trophies',
  arenas: 'Arenas',
  shop: 'Shop',
};

/**
 * Every payload the console knows about. Each is optional: the graph checker
 * runs over whatever subset is loaded and silently skips rules whose inputs
 * are absent, so a partially loaded workspace still reports what it can.
 */
export interface ConfigSet {
  heroes?: HeroesConfig;
  trophyRoad?: ArenaProgressConfig;
  bots?: BotsConfig;
  heroUpgrade?: HeroUpgradeConfig;
  matchTrophy?: MatchTrophyConfig;
  arenas?: ArenasConfig;
  shop?: ShopConfig;
}
