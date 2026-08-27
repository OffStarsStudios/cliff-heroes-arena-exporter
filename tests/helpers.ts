import { buildLookup } from '../src/lib/lookups';
import { detectColumns } from '../src/lib/columnDetect';
import { transform } from '../src/lib/transform';
import type { RawCell, RawSheet, TransformResult } from '../src/lib/types';

/** Builds a RawSheet from a literal grid, padding rows to equal width. */
export function sheet(name: string, rows: RawCell[][]): RawSheet {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return {
    name,
    rows: rows.map((row) => {
      const copy = row.slice();
      while (copy.length < width) copy.push(null);
      return copy;
    }),
  };
}

export interface RunOptions {
  progression: RawSheet;
  arenas: RawSheet;
  rewards: RawSheet;
}

/** Runs the full detect -> lookup -> transform pipeline the UI runs. */
export function run(options: RunOptions): TransformResult {
  const detection = detectColumns(options.progression);
  const arenas = buildLookup(options.arenas, 'arena');
  const rewards = buildLookup(options.rewards, 'reward');
  const result = transform({
    progression: options.progression,
    headerRowIndex: detection.headerRowIndex,
    mapping: detection.mapping,
    arenas: arenas.table,
    rewards: rewards.table,
  });
  return {
    ...result,
    issues: [...arenas.issues, ...rewards.issues, ...result.issues],
  };
}

export const ARENAS_SHEET = sheet('Arenas', [
  ['Arena Name', 'ArenaID'],
  ['Lost Oasis', 'arena.lostoasis'],
  ['Mystic Forest', 'arena.mysticforest'],
  ['Sakura Cliffs', 'arena.sakuracliffs'],
]);

export const REWARDS_SHEET = sheet('Rewards', [
  ['RewardName', 'RewardID'],
  ['Coins', 'reward.currency.coins'],
  ['Upgrade_Cards', 'reward.currency.cards'],
  ['Arena_Mystic_Forest', 'reward.arena.mysticforest'],
  ['Hero_Glint', 'reward.hero.glint'],
]);

/** Errors only, as plain messages - handy for assertions. */
export function errorMessages(result: TransformResult): string[] {
  return result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
}
