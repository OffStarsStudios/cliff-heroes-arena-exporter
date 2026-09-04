/**
 * Payload types for the eight ConfigCat settings that make up the live config.
 *
 * Seven of them are produced by the spreadsheet exporters and have their
 * types in `../lib/types`. `battlePass` is still hand-authored JSON pasted
 * into the ConfigCat dashboard; its shape is transcribed here from the live
 * value so the config graph can be checked.
 */

import type {
  ArenaDefinition,
  ArenaProgressConfig,
  ArenasConfig,
  BotTuning,
  BotsConfig,
  HeroesConfig,
  HeroUpgradeConfig,
  MatchTrophyConfig,
  RarityCost,
  ShopConfig,
  ShopContent,
  ShopProduct,
  ShopSoldIn,
} from '../lib/types';

export type {
  ArenaDefinition,
  ArenaProgressConfig,
  ArenasConfig,
  BotTuning,
  BotsConfig,
  HeroesConfig,
  HeroUpgradeConfig,
  MatchTrophyConfig,
  RarityCost,
  ShopConfig,
  ShopContent,
  ShopProduct,
  ShopSoldIn,
};

/* ----------------------------------------------------------- battlePass -- */

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

/* ------------------------------------------------------------- the set -- */

export type DomainId =
  | 'heroes'
  | 'trophyRoad'
  | 'bots'
  | 'heroUpgrade'
  | 'matchTrophy'
  | 'arenas'
  | 'shop'
  | 'battlePass';

/** Domains that have an exporter page, and therefore their own workbook. */
export type ExporterDomain = 'heroes' | 'trophyRoad' | 'arenas' | 'matchTrophy' | 'bots' | 'heroUpgrade' | 'shop';

export const EXPORTER_DOMAINS: ExporterDomain[] = [
  'heroes',
  'trophyRoad',
  'arenas',
  'matchTrophy',
  'bots',
  'heroUpgrade',
  'shop',
];

/** The ConfigCat setting key each domain publishes to. */
export const SETTING_KEYS: Record<DomainId, string> = {
  heroes: 'heroesSettings',
  trophyRoad: 'trophyRoadSettings',
  bots: 'botsSettings',
  heroUpgrade: 'heroUpgradeSettings',
  matchTrophy: 'matchTrophySettings',
  arenas: 'arenasSettings',
  shop: 'shopSettings',
  battlePass: 'battlePassSettings',
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
  battlePass: 'config/battlePass.json',
};

export const DOMAIN_LABELS: Record<DomainId, string> = {
  heroes: 'Heroes',
  trophyRoad: 'Trophy road',
  bots: 'Bots',
  heroUpgrade: 'Hero upgrades',
  matchTrophy: 'Match trophies',
  arenas: 'Arenas',
  shop: 'Shop',
  battlePass: 'Battle pass',
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
  battlePass?: BattlePassConfig;
}
