import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readWorkbookBytes } from '../src/lib/workbook';
import { autoSelectSheets } from '../src/lib/sheetSelect';
import { detectColumns } from '../src/lib/columnDetect';
import { buildLookup } from '../src/lib/lookups';
import { transform } from '../src/lib/transform';
import { serializeConfig, validateConfig } from '../src/lib/validate';
import type { RawSheet, RawWorkbook } from '../src/lib/types';

const FIXTURE = fileURLToPath(new URL('../fixtures/arena-progression.xlsx', import.meta.url));

function load(): RawWorkbook {
  return readWorkbookBytes(readFileSync(FIXTURE), 'arena-progression.xlsx');
}

function sheetNamed(workbook: RawWorkbook, name: string | null): RawSheet {
  const found = workbook.sheets.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Sheet not found: ${name}`);
  return found;
}

describe('the real Cliff Heroes workbook', () => {
  const workbook = load();

  it('lists every tab', () => {
    expect(workbook.sheets.map((s) => s.name)).toEqual([
      'dynamic numbers',
      'Arena progression',
      'Arena Progress Option 2',
      'Arenas',
      'Rewards',
      'Seasonal progression',
    ]);
  });

  it('auto-selects the expected tabs', () => {
    expect(autoSelectSheets(workbook)).toEqual({
      progression: 'Arena Progress Option 2',
      arenas: 'Arenas',
      rewards: 'Rewards',
    });
  });

  it('detects the progression columns', () => {
    const detected = detectColumns(sheetNamed(workbook, 'Arena Progress Option 2'));
    expect(detected.headerRowIndex).toBe(0);
    expect(detected.headers[detected.mapping.trophiesIndex as number]).toBe('Trophy Count');
    expect(detected.headers[detected.mapping.arenaIndex as number]).toBe('Arena');
    expect(detected.mapping.rewardSlots.map((slot) => [slot.nameIndex, slot.amountIndex])).toEqual([
      [5, 6],
      [7, 8],
      [9, 10],
    ]);
    expect(detected.uncertain).toEqual([]);
  });

  it('builds both lookup tables with the exact stored ids', () => {
    const arenas = buildLookup(sheetNamed(workbook, 'Arenas'), 'arena');
    const rewards = buildLookup(sheetNamed(workbook, 'Rewards'), 'reward');

    expect(arenas.issues).toEqual([]);
    expect(rewards.issues).toEqual([]);
    expect(arenas.table.byNormalizedName.get('lost oasis')).toBe('arena.lostoasis');
    expect(arenas.table.byNormalizedName.get('sakura cliffs')).toBe('arena.sakuracliffs');
    expect(rewards.table.byNormalizedName.get('upgrade_cards')).toBe('reward.currency.cards');
    expect(rewards.table.byNormalizedName.get('hero_glint')).toBe('reward.hero.glint');
    expect(rewards.table.entries).toHaveLength(11);
  });

  it('generates a valid config end to end with no errors', () => {
    const progression = sheetNamed(workbook, 'Arena Progress Option 2');
    const detected = detectColumns(progression);
    const result = transform({
      progression,
      headerRowIndex: detected.headerRowIndex,
      mapping: detected.mapping,
      arenas: buildLookup(sheetNamed(workbook, 'Arenas'), 'arena').table,
      rewards: buildLookup(sheetNamed(workbook, 'Rewards'), 'reward').table,
    });

    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(validateConfig(result.config)).toEqual([]);
    expect(result.stats).toEqual({
      milestones: 26,
      arenas: 3,
      arenaUnlockMilestones: 2,
      rewardMilestones: 23,
      errors: 0,
      warnings: 0,
    });

    const milestones = result.config.Milestones;
    expect(milestones[0]).toEqual({ Trophies: 0, ArenaID: 'arena.lostoasis' });
    expect(milestones[1]).toEqual({ Trophies: 10, RewardID: 'reward.currency.coins', Amount: 50 });
    expect(milestones[2]).toEqual({ Trophies: 25, RewardID: 'reward.currency.cards', Amount: 5 });
    expect(milestones[6]).toEqual({
      Trophies: 250,
      ArenaID: 'arena.mysticforest',
      Unlocks: [{ RewardID: 'reward.arena.mysticforest' }, { RewardID: 'reward.hero.glint' }],
    });
    expect(milestones[13]).toEqual({
      Trophies: 1500,
      ArenaID: 'arena.sakuracliffs',
      Unlocks: [{ RewardID: 'reward.arena.sakuracliffs' }, { RewardID: 'reward.hero.cinder' }],
    });
    expect(milestones[milestones.length - 1]).toEqual({
      Trophies: 3500,
      RewardID: 'reward.currency.cards',
      Amount: 100,
    });

    // Every milestone is one of the two allowed shapes, with nothing extra.
    for (const milestone of milestones) {
      const keys = Object.keys(milestone);
      expect(['Trophies,RewardID,Amount', 'Trophies,ArenaID', 'Trophies,ArenaID,Unlocks']).toContain(keys.join(','));
    }

    expect(serializeConfig(result.config).split('\n')[0]).toBe('{');
  });
});
