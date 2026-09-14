import { describe, expect, it } from 'vitest';
import { REWARDS, REWARDS_BY_ID, REWARDS_BY_NAME, isRewardId } from '../src/lib/rewards';
import { buildLookup } from '../src/lib/lookups';
import { sheet } from './helpers';

describe('the reward library', () => {
  it('covers every family the client derives rewards from', () => {
    const families = new Set(REWARDS.map((reward) => reward.family));
    expect([...families].sort()).toEqual(['arena', 'currency', 'hero', 'lootbox', 'skin']);
  });

  it('names currencies plainly and everything else by its family', () => {
    for (const reward of REWARDS) {
      if (reward.family === 'currency') {
        expect(reward.name).not.toContain(' - ');
      } else {
        const prefix = reward.family[0].toUpperCase() + reward.family.slice(1);
        expect(reward.name.startsWith(`${prefix} - `)).toBe(true);
      }
    }
  });

  it('has no duplicate ID or name', () => {
    expect(REWARDS_BY_ID.size).toBe(REWARDS.length);
    expect(REWARDS_BY_NAME.size).toBe(REWARDS.length);
  });

  it('carries the IDs the live configs actually use', () => {
    // Sampled across every family, so a regeneration that renamed an ID rather
    // than a label would fail here rather than at publish time.
    for (const id of [
      'reward.currency.coins',
      'reward.currency.cards',
      'reward.hero.cinder',
      'reward.skin.flick.ghost',
      'reward.arena.mysticforest',
      'reward.lootbox.common',
    ]) {
      expect(isRewardId(id)).toBe(true);
    }
  });

  it('names rewards the way the sheets do', () => {
    expect(REWARDS_BY_ID.get('reward.currency.cards')?.name).toBe('Upgrade Cards');
    expect(REWARDS_BY_ID.get('reward.arena.lostoasis')?.name).toBe('Arena - Lost Oasis');
    expect(REWARDS_BY_ID.get('reward.skin.guy.superspace')?.name).toBe('Skin - Guy Super Space');
  });
});

describe('a Rewards lookup tab is checked against the library', () => {
  const rows = (...entries: string[][]) => sheet('Rewards', [['Reward Name', 'Reward ID'], ...entries]);

  it('accepts IDs the game registers', () => {
    const build = buildLookup(rows(['Coins', 'reward.currency.coins']), 'reward');
    expect(build.issues).toEqual([]);
    expect(build.table.byNormalizedName.get('coins')).toBe('reward.currency.coins');
  });

  it('refuses an ID the game registers nothing under', () => {
    const build = buildLookup(rows(['Ghost Coins', 'reward.currency.ghostcoins']), 'reward');
    expect(build.issues.map((issue) => issue.code)).toContain('lookup-unknown-reward');
    expect(build.issues[0].message).toContain('reward.currency.ghostcoins');
    // Refused rather than exported: the client would drop whatever names it.
    expect(build.table.byNormalizedName.has('ghost coins')).toBe(false);
  });

  it('leaves the other lookup kinds alone', () => {
    // Arenas and heroes have their own IDs and are not reward IDs at all.
    const arenas = buildLookup(sheet('Arenas', [['Arena Name', 'Arena ID'], ['Lost Oasis', 'arena.lostoasis']]), 'arena');
    expect(arenas.issues).toEqual([]);
  });
});
