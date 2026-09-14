/**
 * Cross-config validation.
 *
 * The eight ConfigCat settings form a reference graph. Each existing validator
 * checks one payload in isolation, and ConfigCat sees only opaque strings, so
 * nothing today checks the edges between them: an arena on the trophy road
 * that no arenas entry defines, a hero whose rarity has no upgrade cost row, a
 * bot count that no longer matches the number of scoring places.
 *
 * These checks are read-only and run over whatever subset of the config set is
 * loaded. A rule whose inputs are absent is skipped, never failed - a partial
 * workspace reports what it can rather than drowning the real findings.
 */

import { ARENA_BOT_DIFFICULTIES, botLevelName } from '../lib/arenaDifficulties';
import type { Issue } from '../lib/types';
import type { ConfigSet, DomainId } from '../domains/types';
import { canCheck, canCheckRewardsFor, emptyRegistry, type IdRegistry } from './registry';

/** A reward reference, with enough context to name it in a message. */
interface RewardRef {
  id: string;
  where: string;
  /** The config that makes the reference, so it is judged against its own sheet. */
  domain: DomainId;
}

function error(code: string, message: string): Issue {
  return { severity: 'error', code, message };
}

function warning(code: string, message: string): Issue {
  return { severity: 'warning', code, message };
}

/** Lists up to `limit` items, then says how many more there were. */
function summarize(values: string[], limit = 5): string {
  if (values.length <= limit) return values.join(', ');
  return `${values.slice(0, limit).join(', ')} and ${values.length - limit} more`;
}

/**
 * Reward IDs encode what they grant: `reward.hero.cinder` grants the hero
 * `heroes.cinder`, `reward.arena.mysticforest` grants `arena.mysticforest`.
 * Note the arena prefix is singular in IDs but plural in the config key.
 */
function derivedTarget(rewardId: string): { namespace: 'heroes' | 'arenas'; id: string } | null {
  const hero = /^reward\.hero\.(.+)$/.exec(rewardId);
  if (hero) return { namespace: 'heroes', id: `heroes.${hero[1]}` };
  const arena = /^reward\.arena\.(.+)$/.exec(rewardId);
  if (arena) return { namespace: 'arenas', id: `arena.${arena[1]}` };
  return null;
}

/** Every reward ID referenced anywhere, tagged with where it was referenced. */
export function collectRewardRefs(set: ConfigSet): RewardRef[] {
  const refs: RewardRef[] = [];

  for (const milestone of set.trophyRoad?.Milestones ?? []) {
    const record = milestone as unknown as Record<string, unknown>;
    if (typeof record.RewardID === 'string') {
      refs.push({ id: record.RewardID, where: `trophy road at ${record.Trophies} trophies`, domain: 'trophyRoad' });
    }
    const unlocks = record.Unlocks;
    if (Array.isArray(unlocks)) {
      for (const unlock of unlocks) {
        const id = (unlock as Record<string, unknown>)?.RewardID;
        if (typeof id === 'string') {
          refs.push({
            id,
            where: `trophy road unlock at ${record.Trophies} trophies`,
            domain: 'trophyRoad',
          });
        }
      }
    }
  }

  (set.battlePass?.Tiers ?? []).forEach((tier, index) => {
    for (const track of ['Free', 'Premium'] as const) {
      const id = tier?.[track]?.RewardID;
      if (typeof id === 'string') {
        refs.push({
          id,
          where: `battle pass tier ${index + 1} (${track.toLowerCase()})`,
          domain: 'battlePass',
        });
      }
    }
  });

  for (const product of set.shop?.Products ?? []) {
    for (const content of product?.Contents ?? []) {
      if (typeof content?.RewardID === 'string') {
        refs.push({ id: content.RewardID, where: `shop product "${product.ID}"`, domain: 'shop' });
      }
    }
  }

  return refs;
}

/* ------------------------------------------------------------- the rules -- */

/** trophyRoad.ArenaID -> arenas.ID, and the reverse as a warning. */
function checkArenaReferences(set: ConfigSet, issues: Issue[]): void {
  if (!set.trophyRoad || !set.arenas) return;

  const defined = new Set(
    (set.arenas.Arenas ?? []).map((arena) => arena?.ID).filter(Boolean) as string[],
  );
  const onRoad = new Set<string>();

  for (const milestone of set.trophyRoad.Milestones ?? []) {
    const record = milestone as unknown as Record<string, unknown>;
    const id = record.ArenaID;
    if (typeof id !== 'string') continue;
    onRoad.add(id);
    if (!defined.has(id)) {
      issues.push(
        error(
          'graph-arena-undefined',
          `The trophy road introduces arena "${id}", but arenasSettings does not define it. Players reaching that milestone would enter an arena with no track count and no bot levels.`,
        ),
      );
    }
  }

  for (const id of defined) {
    if (!onRoad.has(id)) {
      issues.push(
        warning(
          'graph-arena-unreachable',
          `arenasSettings defines arena "${id}", but no trophy road milestone introduces it, so it is unreachable.`,
        ),
      );
    }
  }
}

/**
 * arenas.BotLevels[] -> bots.Bots[].Level.
 *
 * The two configs write the same thing two ways: arenas name a difficulty
 * ("Easy", "VeryHard") and bots number it, and both are read into the game's
 * one `BotLevel` enum. The mapping is therefore not unknown - it is the enum's
 * own order, which `ARENA_BOT_DIFFICULTIES` carries - so this checks the real
 * join rather than guessing at cardinality: every difficulty an arena races at
 * must be tuned in botsSettings under the number that names it.
 */
function checkBotDifficulties(set: ConfigSet, issues: Issue[]): void {
  if (!set.arenas || !set.bots) return;

  const names = new Set<string>();
  for (const arena of set.arenas.Arenas ?? []) {
    for (const name of arena?.BotLevels ?? []) {
      if (typeof name === 'string' && name !== '') names.add(name);
    }
  }
  if (names.size === 0) return;

  const tuned = new Set(
    (set.bots.Bots ?? []).map((bot) => bot?.Level).filter((level): level is number => typeof level === 'number'),
  );

  const untuned: string[] = [];
  for (const name of names) {
    const level = (ARENA_BOT_DIFFICULTIES as readonly string[]).indexOf(name);
    // A name outside the enum is arenasSettings' own problem, and its schema
    // gate has already said so. Here it is only not a difficulty to tune.
    if (level !== -1 && !tuned.has(level)) untuned.push(`${name} (level ${level})`);
  }

  if (untuned.length > 0) {
    issues.push(
      error(
        'graph-bot-difficulty-untuned',
        `arenasSettings races bots at ${summarize(untuned)}, which botsSettings does not tune. The game keeps the tuning compiled into the build for a difficulty it cannot find here.`,
      ),
    );
  }
}

/** arenas.BotLevels.length + 1 = matchTrophy.TrophiesByPlace.length */
function checkRacerCount(set: ConfigSet, issues: Issue[]): void {
  if (!set.arenas || !set.matchTrophy) return;

  const places = set.matchTrophy.TrophiesByPlace;
  if (!Array.isArray(places) || places.length === 0) return;

  for (const arena of set.arenas.Arenas ?? []) {
    const bots = arena?.BotLevels?.length;
    if (typeof bots !== 'number') continue;
    if (bots + 1 !== places.length) {
      issues.push(
        error(
          'graph-places-mismatch',
          `Arena "${arena.ID}" runs ${bots} bots, so a race has ${bots + 1} racers, but matchTrophySettings awards trophies for ${places.length} places. Some finishing position has no trophy value.`,
        ),
      );
    }
  }
}

/** heroes.Rarity -> heroUpgrade.Costs[].Rarity, and ReferenceRarity likewise. */
function checkRarities(set: ConfigSet, issues: Issue[]): void {
  if (!set.heroUpgrade) return;

  const priced = new Set(
    (set.heroUpgrade.Costs ?? []).map((cost) => cost?.Rarity).filter(Boolean) as string[],
  );
  if (priced.size === 0) return;

  const reference = set.heroUpgrade.ReferenceRarity;
  if (typeof reference === 'string' && !priced.has(reference)) {
    issues.push(
      error(
        'graph-reference-rarity',
        `heroUpgradeSettings uses "${reference}" as its ReferenceRarity, but no Costs row defines that rarity.`,
      ),
    );
  }

  if (!set.heroes) return;
  const unpriced = new Map<string, string[]>();
  for (const hero of set.heroes.Heroes ?? []) {
    if (typeof hero?.Rarity !== 'string') continue;
    if (priced.has(hero.Rarity)) continue;
    const list = unpriced.get(hero.Rarity) ?? [];
    list.push(hero.ID);
    unpriced.set(hero.Rarity, list);
  }
  for (const [rarity, heroes] of unpriced) {
    issues.push(
      error(
        'graph-rarity-unpriced',
        `Rarity "${rarity}" has no row in heroUpgradeSettings.Costs, so ${summarize(heroes)} cannot be upgraded.`,
      ),
    );
  }
}

/**
 * bots.Bots[].Level covers the game's `BotLevel` enum exactly once each.
 *
 * The client reads the level into that enum and then looks each difficulty up
 * by value, keeping the tuning compiled into the build for anything it does not
 * find. So a level past the end of the enum tunes nothing, and a level left out
 * is a difficulty quietly still running on the build's own numbers.
 */
function checkBotLevels(set: ConfigSet, issues: Issue[]): void {
  if (!set.bots) return;

  const levels = (set.bots.Bots ?? [])
    .map((bot) => bot?.Level)
    .filter((level): level is number => typeof level === 'number');
  if (levels.length === 0) return;

  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const level of levels) {
    if (seen.has(level)) duplicates.add(level);
    seen.add(level);
  }
  if (duplicates.size > 0) {
    issues.push(
      error(
        'graph-bot-level-duplicate',
        `botsSettings defines level ${summarize([...duplicates].map(String))} more than once. Which row wins is undefined.`,
      ),
    );
  }

  const unknown = [...seen].filter((level) => botLevelName(level) === null);
  if (unknown.length > 0) {
    issues.push(
      error(
        'graph-bot-level-unknown',
        `botsSettings tunes level ${summarize(unknown.map(String))}, which names no difficulty the game has. Its levels are ${ARENA_BOT_DIFFICULTIES.map((name, level) => `${level} ${name}`).join(', ')}.`,
      ),
    );
  }

  const missing = ARENA_BOT_DIFFICULTIES.filter((_, level) => !seen.has(level)).map(
    (name) => `${name} (level ${(ARENA_BOT_DIFFICULTIES as readonly string[]).indexOf(name)})`,
  );
  if (missing.length > 0) {
    issues.push(
      error(
        'graph-bot-level-gap',
        `botsSettings does not tune ${summarize(missing)}. All ${ARENA_BOT_DIFFICULTIES.length} difficulties are tuned in one table, since the game keeps the build's own values for any it cannot find.`,
      ),
    );
  }
}

/**
 * battlePass.PremiumProductID -> shop.Products[].ID.
 *
 * The premium track is bought as a shop product, and the two configs are
 * joined by nothing but that string. A pass whose product does not exist, or
 * exists but is switched off, still shows its premium rewards to the player
 * with no way to buy them.
 */
function checkPassProduct(set: ConfigSet, issues: Issue[]): void {
  if (!set.battlePass || !set.shop) return;

  const id = set.battlePass.PremiumProductID;
  if (typeof id !== 'string' || id === '') return;

  const products = set.shop.Products ?? [];
  if (products.length === 0) return;

  const product = products.find((candidate) => candidate?.ID === id);
  if (product === undefined) {
    // Naming the pass products the shop does sell separates the two ways this
    // happens: the pass names the wrong product, or the shop sheet that defines
    // the right one has not been published yet. The message cannot tell which,
    // but the list makes it obvious to somebody who can.
    const family = id.split('.').slice(0, 2).join('.');
    const near = products
      .map((candidate) => candidate?.ID)
      .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.startsWith(`${family}.`));
    const hint =
      near.length === 0
        ? ''
        : ` The shop does sell ${summarize(near)}, so either the pass names the wrong product or the shop config defining "${id}" has not been published yet.`;
    issues.push(
      error(
        'graph-pass-product-undefined',
        `battlePassSettings sells the premium track as "${id}", but shopSettings defines no product with that ID. The pass could not be bought.${hint}`,
      ),
    );
    return;
  }
  if (product.IsEnabled === false) {
    issues.push(
      warning(
        'graph-pass-product-disabled',
        `The premium pass product "${id}" is disabled in shopSettings, so the premium track is visible but cannot be bought.`,
      ),
    );
  }
}

/**
 * Reward IDs resolve, and the ones that name a hero or an arena name one that
 * exists.
 *
 * The two halves are checked against different kinds of source, and that is
 * why only one of them is scoped. A hero or arena reward is judged against
 * `heroesSettings` and `arenasSettings`, which are the complete list of what
 * the game has, so the check holds for a reference from any config. The
 * lookup check is judged against a Rewards tab, which lists what one workbook
 * needs and is under no obligation to name another config's rewards - so it
 * only judges the references that workbook's own config makes.
 */
function checkRewards(set: ConfigSet, registry: IdRegistry, issues: Issue[]): void {
  const refs = collectRewardRefs(set);
  if (refs.length === 0) return;

  const unknown = new Map<string, string[]>();
  for (const ref of refs) {
    if (!canCheckRewardsFor(registry, ref.domain)) continue;
    if (registry.rewards.has(ref.id)) continue;
    const list = unknown.get(ref.id) ?? [];
    list.push(ref.where);
    unknown.set(ref.id, list);
  }
  for (const [id, wheres] of unknown) {
    issues.push(
      error(
        'graph-reward-unknown',
        `Reward "${id}" is referenced by ${summarize(wheres, 3)} but is not defined in the ${registry.sources.rewards.join(' or ')}.`,
      ),
    );
  }

  const reported = new Set<string>();
  for (const ref of refs) {
    const target = derivedTarget(ref.id);
    if (!target) continue;
    if (!canCheck(registry, target.namespace)) continue;
    if (registry[target.namespace].has(target.id)) continue;
    if (reported.has(ref.id)) continue;
    reported.add(ref.id);
    issues.push(
      error(
        target.namespace === 'heroes' ? 'graph-hero-reward-missing' : 'graph-arena-reward-missing',
        `Reward "${ref.id}" (${ref.where}) grants ${target.namespace === 'heroes' ? 'hero' : 'arena'} "${target.id}", which is not defined in the ${registry.sources[target.namespace].join(' or ')}.`,
      ),
    );
  }
}

/* ------------------------------------------------------------- the entry -- */

export interface GraphReport {
  issues: Issue[];
  /** Domains that were absent, so the UI can say what was not checked. */
  missing: (keyof ConfigSet)[];
  errors: number;
  warnings: number;
}

const ALL_DOMAINS: (keyof ConfigSet)[] = [
  'heroes',
  'trophyRoad',
  'bots',
  'heroUpgrade',
  'matchTrophy',
  'arenas',
  'shop',
  'battlePass',
];

/** Runs every cross-config rule over whatever is loaded. */
export function validateGraph(set: ConfigSet, registry: IdRegistry = emptyRegistry()): GraphReport {
  const issues: Issue[] = [];

  checkArenaReferences(set, issues);
  checkBotDifficulties(set, issues);
  checkRacerCount(set, issues);
  checkRarities(set, issues);
  checkBotLevels(set, issues);
  checkPassProduct(set, issues);
  checkRewards(set, registry, issues);

  return {
    issues,
    missing: ALL_DOMAINS.filter((domain) => set[domain] === undefined),
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  };
}
