/**
 * The shared ID registry.
 *
 * Every config references IDs that are defined somewhere else: the trophy road
 * names arenas and rewards, the shop names rewards, rewards name heroes and
 * arenas in turn. Nothing checks those references today.
 *
 * The workbook already carries Arenas, Rewards and Heroes lookup tabs, and
 * `buildLookup` already parses them with ambiguity detection. This promotes
 * those tables from an arena-exporter detail to a workspace-wide registry that
 * every domain can be checked against.
 *
 * The registry is additive and always optional. A namespace with no known IDs
 * means "we cannot check this", never "nothing is valid" - the graph checker
 * skips rules whose namespace is empty rather than reporting false errors.
 *
 * Rewards carry one more restriction, and it is the reason `rewardScope`
 * exists. `arenasSettings` and `heroesSettings` are complete: they are the
 * definitive list of what the game has, so an arena or hero missing from them
 * genuinely does not exist. A workbook's Rewards lookup tab is not. It lists
 * the rewards that one sheet needs a name for, and nothing obliges the battle
 * pass sheet to name a reward only the trophy road grants. Treating it as the
 * game's reward list made loading the battle pass report the trophy road's own
 * rewards as missing - errors that blocked publishing and that publishing the
 * battle pass could not possibly have caused. So a reward set is authoritative
 * only for the domains in its scope, which for a workbook is the one config
 * that workbook builds.
 */

import { buildLookup } from '../lib/lookups';
import type { Issue, LookupTable, RawSheet } from '../lib/types';
import type { ConfigSet, DomainId } from '../domains/types';

/** Where a namespace's IDs came from, so messages can say what was consulted. */
export type IdSource = 'Arenas lookup tab' | 'Rewards lookup tab' | 'Heroes lookup tab' | 'arenasSettings' | 'heroesSettings';

export interface IdRegistry {
  arenas: Set<string>;
  rewards: Set<string>;
  heroes: Set<string>;
  /**
   * The domains whose reward references this reward set may be judged against.
   * A lookup tab covers its own workbook's config and no other, so an ID it
   * does not list means "this sheet never names it", not "it does not exist".
   */
  rewardScope: Set<DomainId>;
  sources: {
    arenas: IdSource[];
    rewards: IdSource[];
    heroes: IdSource[];
  };
}

export function emptyRegistry(): IdRegistry {
  return {
    arenas: new Set(),
    rewards: new Set(),
    heroes: new Set(),
    rewardScope: new Set(),
    sources: { arenas: [], rewards: [], heroes: [] },
  };
}

/** The exact IDs a lookup tab defines, ignoring the display names. */
export function idsFromLookup(table: LookupTable): Set<string> {
  return new Set(table.entries.map((entry) => entry.id));
}

export interface WorkbookLookupSheets {
  arenas?: RawSheet;
  rewards?: RawSheet;
  heroes?: RawSheet;
}

/** A registry holding just what one workbook's Rewards tab defines, scoped to it. */
export function rewardRegistryFromLookup(table: LookupTable, domain: DomainId): IdRegistry {
  const registry = emptyRegistry();
  for (const id of idsFromLookup(table)) registry.rewards.add(id);
  if (registry.rewards.size === 0) return registry;
  registry.rewardScope.add(domain);
  registry.sources.rewards.push('Rewards lookup tab');
  return registry;
}

/**
 * Builds a registry from the workbook's lookup tabs. Lookup parsing issues are
 * returned rather than thrown, because a malformed Rewards tab should degrade
 * reward checking to "unknown", not block the checks that do not need it.
 *
 * `domain` is the config this workbook builds, and is what the reward set is
 * scoped to - see the note on `rewardScope`.
 */
export function registryFromWorkbook(sheets: WorkbookLookupSheets, domain: DomainId): {
  registry: IdRegistry;
  issues: Issue[];
} {
  const registry = emptyRegistry();
  const issues: Issue[] = [];

  const load = (sheet: RawSheet | undefined, kind: 'arena' | 'reward' | 'hero', into: Set<string>, source: IdSource, sources: IdSource[]) => {
    if (!sheet) return;
    const built = buildLookup(sheet, kind);
    issues.push(...built.issues);
    const ids = idsFromLookup(built.table);
    if (ids.size === 0) return;
    for (const id of ids) into.add(id);
    sources.push(source);
  };

  load(sheets.arenas, 'arena', registry.arenas, 'Arenas lookup tab', registry.sources.arenas);
  load(sheets.rewards, 'reward', registry.rewards, 'Rewards lookup tab', registry.sources.rewards);
  load(sheets.heroes, 'hero', registry.heroes, 'Heroes lookup tab', registry.sources.heroes);
  if (registry.rewards.size > 0) registry.rewardScope.add(domain);

  return { registry, issues };
}

/**
 * Builds a registry from the published configs themselves.
 *
 * `arenasSettings` and `heroesSettings` are the definitive list of what exists
 * in the live game, so they are a legitimate ID source even with no workbook
 * loaded. There is no published config that defines rewards, which is why the
 * reward namespace can only ever come from the workbook.
 */
export function registryFromConfigs(set: ConfigSet): IdRegistry {
  const registry = emptyRegistry();

  if (set.arenas) {
    for (const arena of set.arenas.Arenas ?? []) {
      if (typeof arena?.ID === 'string' && arena.ID !== '') registry.arenas.add(arena.ID);
    }
    if (registry.arenas.size > 0) registry.sources.arenas.push('arenasSettings');
  }

  if (set.heroes) {
    for (const hero of set.heroes.Heroes ?? []) {
      if (typeof hero?.ID === 'string' && hero.ID !== '') registry.heroes.add(hero.ID);
    }
    if (registry.heroes.size > 0) registry.sources.heroes.push('heroesSettings');
  }

  return registry;
}

/** Unions registries, keeping every contributing source for messaging. */
export function mergeRegistries(...parts: IdRegistry[]): IdRegistry {
  const merged = emptyRegistry();
  for (const part of parts) {
    for (const id of part.arenas) merged.arenas.add(id);
    for (const id of part.rewards) merged.rewards.add(id);
    for (const id of part.heroes) merged.heroes.add(id);
    for (const domain of part.rewardScope) merged.rewardScope.add(domain);
    for (const source of part.sources.arenas) if (!merged.sources.arenas.includes(source)) merged.sources.arenas.push(source);
    for (const source of part.sources.rewards) if (!merged.sources.rewards.includes(source)) merged.sources.rewards.push(source);
    for (const source of part.sources.heroes) if (!merged.sources.heroes.includes(source)) merged.sources.heroes.push(source);
  }
  return merged;
}

/** True when a namespace has enough content to judge an unknown ID against. */
export function canCheck(registry: IdRegistry, namespace: 'arenas' | 'rewards' | 'heroes'): boolean {
  return registry[namespace].size > 0;
}

/**
 * True when a reward reference made by `domain` can be judged against the
 * known reward IDs - which needs both some IDs and a scope that covers that
 * domain. A reference from a config the loaded workbook has nothing to do with
 * is unjudgeable, not wrong.
 */
export function canCheckRewardsFor(registry: IdRegistry, domain: DomainId): boolean {
  return registry.rewards.size > 0 && registry.rewardScope.has(domain);
}
