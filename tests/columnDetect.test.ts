import { describe, expect, it } from 'vitest';
import {
  columnLetter,
  detectColumns,
  detectRewardSlots,
  isRewardNameHeader,
  scoreArenaHeader,
  scoreTrophyHeader,
} from '../src/lib/columnDetect';
import { normalizeHeader, parseNumber } from '../src/lib/normalize';
import { sheet } from './helpers';

describe('header normalization', () => {
  it('lowercases, trims and strips trivial punctuation', () => {
    expect(normalizeHeader('  Reward-Amount: ')).toBe('reward amount');
    expect(normalizeHeader('Reward_Amount')).toBe('reward amount');
  });

  it('splits camelCase and PascalCase headers', () => {
    expect(normalizeHeader('RewardName')).toBe('reward name');
    expect(normalizeHeader('ArenaID')).toBe('arena id');
  });
});

describe('trophy column scoring', () => {
  it('accepts the documented variants', () => {
    for (const header of ['Trophies', 'Trophy', 'Trophy Requirement', 'Required Trophies', 'Trophy Count']) {
      expect(scoreTrophyHeader(header)).toBeGreaterThan(0);
    }
  });

  it('rejects range bounds and unrelated metrics', () => {
    for (const header of ['min trophies', 'max trophies', 'Trophy range', 'Cumulative Trophies', 'Trophies per match']) {
      expect(scoreTrophyHeader(header)).toBe(-1);
    }
  });

  it('prefers the milestone column over the range bounds', () => {
    const detected = detectColumns(
      sheet('P', [['Arena', 'min trophies', 'max trophies', 'Trophy Count', 'Reward', 'Reward Amount']]),
    );
    expect(detected.mapping.trophiesIndex).toBe(3);
  });
});

describe('arena column scoring', () => {
  it('accepts the arena name column but not its id or reward variants', () => {
    expect(scoreArenaHeader('Arena')).toBe(100);
    expect(scoreArenaHeader('Arena Name')).toBe(100);
    expect(scoreArenaHeader('ArenaID')).toBe(-1);
    expect(scoreArenaHeader('Arena Unlock Reward')).toBe(-1);
  });
});

describe('reward slot pairing', () => {
  it('treats amount headers as amounts, not reward names', () => {
    expect(isRewardNameHeader('Reward')).toBe(true);
    expect(isRewardNameHeader('Reward Amount')).toBe(false);
    expect(isRewardNameHeader('Unlock Reward')).toBe(true);
    expect(isRewardNameHeader('Hero Unlock')).toBe(true);
    expect(isRewardNameHeader('Matches Required')).toBe(false);
  });

  it('pairs each reward column with the amount that follows it', () => {
    const slots = detectRewardSlots([
      'Arena',
      'Trophy Count',
      'Reward',
      'Reward Amount',
      'Reward',
      'Reward Amount',
      'Reward',
      'Reward Amount',
      'Matches Required',
    ]);
    expect(slots.map((slot) => [slot.nameIndex, slot.amountIndex])).toEqual([
      [2, 3],
      [4, 5],
      [6, 7],
    ]);
    expect(slots.map((slot) => slot.label)).toEqual(['Reward 1', 'Reward 2', 'Reward 3']);
  });

  it('leaves a slot without an amount column unpaired', () => {
    const slots = detectRewardSlots(['Trophies', 'Reward', 'Unlock Reward']);
    expect(slots.map((slot) => [slot.nameIndex, slot.amountIndex])).toEqual([
      [1, null],
      [2, null],
    ]);
  });
});

describe('header row detection', () => {
  it('skips a title row above the headers', () => {
    const detected = detectColumns(
      sheet('P', [
        ['Arena Progress Option 2', null, null, null],
        ['Arena', 'Trophy Count', 'Reward', 'Reward Amount'],
        ['Lost Oasis', 0, null, null],
      ]),
    );
    expect(detected.headerRowIndex).toBe(1);
    expect(detected.mapping.trophiesIndex).toBe(1);
    expect(detected.mapping.arenaIndex).toBe(0);
  });

  it('does not mistake dotted id rows for headers', () => {
    const detected = detectColumns(
      sheet('Rewards', [
        ['RewardName', 'RewardID'],
        ['Coins', 'reward.currency.coins'],
      ]),
    );
    expect(detected.headerRowIndex).toBe(0);
  });
});

describe('numeric parsing', () => {
  it('accepts numbers and numeric strings', () => {
    expect(parseNumber(50)).toEqual({ ok: true, value: 50 });
    expect(parseNumber('50')).toEqual({ ok: true, value: 50 });
    expect(parseNumber(' 1,500 ')).toEqual({ ok: true, value: 1500 });
  });

  it('rejects blanks and non-numeric text', () => {
    expect(parseNumber(null).ok).toBe(false);
    expect(parseNumber('').ok).toBe(false);
    expect(parseNumber('lots').ok).toBe(false);
    expect(parseNumber('50 coins').ok).toBe(false);
  });
});

describe('column letters', () => {
  it('maps indexes to spreadsheet letters', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
  });
});
