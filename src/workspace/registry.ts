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
 */

import { buildLookup } from '../lib/lookups';
import type { Issue, LookupTable, RawSheet } from '../lib/types';
import type { ConfigSet } from '../domains/types';

/** Where a namespace's IDs came from, so messages can say what was consulted. */
export type IdSource = 'Arenas lookup tab' | 'Rewards lookup tab' | 'Heroes lookup tab' | 'arenasSettings' | 'heroesSettings';

export interface IdRegistry {
  arenas: Set<string>;
  rewards: Set<string>;
  heroes: Set<string>;
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

/**
 * Builds a registry from the workbook's lookup tabs. Lookup parsing issues are
 * returned rather than thrown, because a malformed Rewards tab should degrade
 * reward checking to "unknown", not block the checks that do not need it.
 */
export function registryFromWorkbook(sheets: WorkbookLookupSheets): {
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
