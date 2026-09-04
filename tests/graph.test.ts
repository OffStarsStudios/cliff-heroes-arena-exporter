import { describe, expect, it } from 'vitest';
import { validateGraph } from '../src/workspace/graph';
import { emptyRegistry, mergeRegistries, registryFromConfigs, type IdRegistry } from '../src/workspace/registry';
import type { ArenasConfig, BattlePassConfig, BotsConfig, ConfigSet, HeroUpgradeConfig, MatchTrophyConfig, ShopConfig } from '../src/domains/types';
import type { ArenaProgressConfig, HeroEntry, HeroesConfig } from '../src/lib/types';

import arenasJson from '../config/arenas.json';
import battlePassJson from '../config/battlePass.json';
import botsJson from '../config/bots.json';
import heroUpgradeJson from '../config/heroUpgrade.json';
import matchTrophyJson from '../config/matchTrophy.json';
import shopJson from '../config/shop.json';
import trophyRoadJson from '../config/trophyRoad.json';

/**
 * The seven live payloads, exactly as they are published today. `heroesSettings`
 * is not among them - it is pulled from ConfigCat at runtime rather than kept
 * as a fixture - so hero-dependent rules are exercised with the small synthetic
 * hero sets below.
 */
const live = {
  arenas: arenasJson as ArenasConfig,
  battlePass: battlePassJson as BattlePassConfig,
  bots: botsJson as BotsConfig,
  heroUpgrade: heroUpgradeJson as HeroUpgradeConfig,
  matchTrophy: matchTrophyJson as MatchTrophyConfig,
  shop: shopJson as ShopConfig,
  trophyRoad: trophyRoadJson as unknown as ArenaProgressConfig,
};

/** A deep copy, so a test that mutates a fixture cannot leak into the next. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hero(id: string, rarity: string): HeroEntry {
  return {
    ID: id,
    MaxSpeed: 24.8,
    SpeedIncreasePerSecond: 0.05,
    Rarity: rarity,
    PowerCooldown: 5,
    Levels: [],
    Power: { ActivationDelay: 0, Duration: 3 },
  };
}

function heroes(...entries: HeroEntry[]): HeroesConfig {
  return { Heroes: entries };
}

/** A registry that knows the given reward IDs, as a Rewards lookup tab would. */
function rewardsKnown(...ids: string[]): IdRegistry {
  const registry = emptyRegistry();
  for (const id of ids) registry.rewards.add(id);
  if (ids.length > 0) registry.sources.rewards.push('Rewards lookup tab');
  return registry;
}

function check(set: ConfigSet, extra: IdRegistry = emptyRegistry()) {
  return validateGraph(set, mergeRegistries(registryFromConfigs(set), extra));
}

function codes(set: ConfigSet, extra?: IdRegistry): string[] {
  return check(set, extra).issues.map((issue) => issue.code);
}

describe('the live config set', () => {
  it('has no cross-config errors as published', () => {
    const report = check(live);
    expect(report.errors).toBe(0);
  });

  it('reports the undeclared difficulty mapping, since no config carries it', () => {
    expect(codes(live)).toContain('graph-bot-difficulty-unmapped');
  });

  it('says which domains it could not check', () => {
    expect(check(live).missing).toEqual(['heroes']);
  });
});

describe('a rule is skipped rather than failed when its inputs are absent', () => {
  it('checks no arena references without arenasSettings', () => {
    const { arenas: _dropped, ...rest } = live;
    expect(codes(rest)).not.toContain('graph-arena-undefined');
  });

  it('checks no reward IDs without a Rewards lookup tab', () => {
    expect(codes(live)).not.toContain('graph-reward-unknown');
  });

  it('reports nothing at all for an empty workspace', () => {
    expect(check({}).issues).toEqual([]);
  });
});

describe('arena references', () => {
  it('flags an arena introduced on the road that arenasSettings does not define', () => {
    const trophyRoad = clone(live.trophyRoad);
    trophyRoad.Milestones.push({ Trophies: 5000, ArenaID: 'arena.frozenpeak' });
    expect(codes({ ...live, trophyRoad })).toContain('graph-arena-undefined');
  });

  it('warns about a defined arena that no milestone introduces', () => {
    const arenas = clone(live.arenas);
    arenas.Arenas.push({ ID: 'arena.frozenpeak', TrackCount: 25, BotLevels: ['Hard', 'Hard', 'Hard'] });
    const report = check({ ...live, arenas });
    expect(report.issues.map((i) => i.code)).toContain('graph-arena-unreachable');
    expect(report.errors).toBe(0);
  });
});

describe('racer count', () => {
  it('flags an arena whose bot count leaves a finishing place with no trophy value', () => {
    const arenas = clone(live.arenas);
    arenas.Arenas[0].BotLevels.push('Medium');
    expect(codes({ ...live, arenas })).toContain('graph-places-mismatch');
  });

  it('accepts every arena when bots plus the player match the places', () => {
    expect(codes(live)).not.toContain('graph-places-mismatch');
  });
});

describe('bot difficulties', () => {
  it('errors when more difficulty names are used than there are bot levels', () => {
    const bots = clone(live.bots);
    bots.Bots = bots.Bots.slice(0, 2);
    bots.BotLevel = 1;
    expect(codes({ ...live, bots })).toContain('graph-bot-difficulty-count');
  });
});

describe('bot levels', () => {
  it('flags a BotLevel header that disagrees with the array', () => {
    const bots = clone(live.bots);
    bots.BotLevel = 5;
    expect(codes({ ...live, bots })).toContain('graph-botlevel-header');
  });

  it('flags a gap in the level sequence', () => {
    const bots = clone(live.bots);
    bots.Bots.splice(2, 1);
    expect(codes({ ...live, bots })).toContain('graph-bot-level-gap');
  });

  it('flags a duplicated level', () => {
    const bots = clone(live.bots);
    bots.Bots.push(clone(bots.Bots[1]));
    expect(codes({ ...live, bots })).toContain('graph-bot-level-duplicate');
  });
});

describe('rarities', () => {
  it('flags a hero whose rarity has no upgrade cost row', () => {
    const set = { ...live, heroes: heroes(hero('heroes.cliff', 'Ultra')) };
    expect(codes(set)).toContain('graph-rarity-unpriced');
  });

  it('accepts a hero whose rarity is priced', () => {
    const set = { ...live, heroes: heroes(hero('heroes.cliff', 'Rare')) };
    expect(codes(set)).not.toContain('graph-rarity-unpriced');
  });

  it('flags a ReferenceRarity with no Costs row', () => {
    const heroUpgrade = clone(live.heroUpgrade);
    heroUpgrade.ReferenceRarity = 'Ultra';
    expect(codes({ ...live, heroUpgrade })).toContain('graph-reference-rarity');
  });
});

describe('rewards', () => {
  it('flags a reward the Rewards lookup tab does not define', () => {
    const known = rewardsKnown('reward.currency.coins', 'reward.currency.cards');
    expect(codes(live, known)).toContain('graph-reward-unknown');
  });

  it('flags a hero reward naming a hero that heroesSettings does not define', () => {
    const set = { ...live, heroes: heroes(hero('heroes.cliff', 'Rare')) };
    expect(codes(set)).toContain('graph-hero-reward-missing');
  });

  it('accepts hero rewards once every granted hero exists', () => {
    const set = {
      ...live,
      heroes: heroes(hero('heroes.cliff', 'Rare'), hero('heroes.glint', 'Rare'), hero('heroes.cinder', 'Epic')),
    };
    expect(codes(set)).not.toContain('graph-hero-reward-missing');
  });

  it('flags an arena reward naming an arena that arenasSettings does not define', () => {
    const trophyRoad = clone(live.trophyRoad);
    trophyRoad.Milestones.push({
      Trophies: 5000,
      ArenaID: 'arena.frozenpeak',
      Unlocks: [{ RewardID: 'reward.arena.frozenpeak' }],
    });
    expect(codes({ ...live, trophyRoad })).toContain('graph-arena-reward-missing');
  });

  it('reports each unknown reward once, however many places reference it', () => {
    const shop = clone(live.shop);
    shop.Products.push({
      ID: 'shop.featured.ghost',
      SoldIn: 'RealMoney',
      IsEnabled: true,
      Contents: [{ RewardID: 'reward.hero.ghost', Amount: 1 }],
    });
    shop.Products.push({
      ID: 'shop.featured.ghost.again',
      SoldIn: 'RealMoney',
      IsEnabled: true,
      Contents: [{ RewardID: 'reward.hero.ghost', Amount: 1 }],
    });
    const set = { ...live, shop, heroes: heroes(hero('heroes.cliff', 'Rare')) };
    const ghost = check(set).issues.filter((issue) => issue.message.includes('reward.hero.ghost'));
    expect(ghost).toHaveLength(1);
  });
});
