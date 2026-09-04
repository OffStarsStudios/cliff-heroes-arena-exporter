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

import type { Issue } from '../lib/types';
import type { ConfigSet } from '../domains/types';
import { canCheck, emptyRegistry, type IdRegistry } from './registry';

/** A reward reference, with enough context to name it in a message. */
interface RewardRef {
  id: string;
  where: string;
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
      refs.push({ id: record.RewardID, where: `trophy road at ${record.Trophies} trophies` });
    }
    const unlocks = record.Unlocks;
    if (Array.isArray(unlocks)) {
      for (const unlock of unlocks) {
        const id = (unlock as Record<string, unknown>)?.RewardID;
        if (typeof id === 'string') {
          refs.push({ id, where: `trophy road unlock at ${record.Trophies} trophies` });
        }
      }
    }
  }

  (set.battlePass?.Tiers ?? []).forEach((tier, index) => {
    for (const track of ['Free', 'Premium'] as const) {
      const id = tier?.[track]?.RewardID;
      if (typeof id === 'string') {
        refs.push({ id, where: `battle pass tier ${index + 1} (${track.toLowerCase()})` });
      }
    }
  });

  for (const product of set.shop?.Products ?? []) {
    for (const content of product?.Contents ?? []) {
      if (typeof content?.RewardID === 'string') {
        refs.push({ id: content.RewardID, where: `shop product "${product.ID}"` });
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
 * These two configs speak different languages: arenas name difficulties
 * ("Easy", "VeryHard") while bots number them (0..4). The mapping between them
 * is declared in no config and lives only in the Unity client, so the strongest
 * available check is on cardinality. The unmapped state is reported every run,
 * not because something is wrong today, but because the missing mapping is
 * itself the risk.
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

  const levels = (set.bots.Bots ?? [])
    .map((bot) => bot?.Level)
    .filter((level): level is number => typeof level === 'number');

  if (names.size > levels.length) {
    issues.push(
      error(
        'graph-bot-difficulty-count',
        `arenasSettings uses ${names.size} distinct difficulty names (${summarize([...names])}) but botsSettings defines only ${levels.length} levels. At least one difficulty cannot map to a bot.`,
      ),
    );
    return;
  }

  issues.push(
    warning(
      'graph-bot-difficulty-unmapped',
      `The mapping from difficulty names (${summarize([...names])}) to bot levels (${levels.join(', ')}) is declared in no config - only the Unity client knows it. Renaming a difficulty or adding a bot level cannot be checked here. Consider carrying the mapping in botsSettings.`,
      ),
  );
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
  if (typeof reference === 'string' && reference !== '' && !priced.has(reference)) {
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
    if (typeof hero?.Rarity !== 'string' || hero.Rarity === '') continue;
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

/** bots.BotLevel = max(Level), and Level runs 0..N with no gaps or duplicates. */
function checkBotLevels(set: ConfigSet, issues: Issue[]): void {
  if (!set.bots) return;

  const levels = (set.bots.Bots ?? [])
    .map((bot) => bot?.Level)
    .filter((level): level is number => typeof level === 'number');
  if (levels.length === 0) return;

  const max = Math.max(...levels);
  if (typeof set.bots.BotLevel === 'number' && set.bots.BotLevel !== max) {
    issues.push(
      error(
        'graph-botlevel-header',
        `botsSettings declares BotLevel ${set.bots.BotLevel}, but the highest level defined in Bots is ${max}.`,
      ),
    );
  }

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

  const missing: number[] = [];
  for (let level = 0; level <= max; level += 1) if (!seen.has(level)) missing.push(level);
  if (missing.length > 0) {
    issues.push(
      error(
        'graph-bot-level-gap',
        `botsSettings is missing bot level ${summarize(missing.map(String))}. Levels must run 0..${max} with no gaps, the same rule hero levels follow.`,
      ),
    );
  }
}

/**
 * Reward IDs resolve, and the ones that name a hero or an arena name one that
 * exists. The lookup check is skipped when no Rewards tab has been loaded,
 * because an empty namespace means "cannot check", not "nothing is valid".
 */
function checkRewards(set: ConfigSet, registry: IdRegistry, issues: Issue[]): void {
  const refs = collectRewardRefs(set);
  if (refs.length === 0) return;

  if (canCheck(registry, 'rewards')) {
    const unknown = new Map<string, string[]>();
    for (const ref of refs) {
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
  checkRewards(set, registry, issues);

  return {
    issues,
    missing: ALL_DOMAINS.filter((domain) => set[domain] === undefined),
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  };
}
