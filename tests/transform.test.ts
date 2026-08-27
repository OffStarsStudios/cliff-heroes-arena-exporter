import { describe, expect, it } from 'vitest';
import { ARENAS_SHEET, REWARDS_SHEET, errorMessages, run, sheet } from './helpers';
import { serializeConfig, validateConfig } from '../src/lib/validate';

const HEADERS = ['Arena', 'min trophies', 'max trophies', 'Level', 'Trophy Count', 'Reward', 'Reward Amount', 'Reward', 'Reward Amount'];

function progression(rows: (string | number | null)[][]) {
  return sheet('Arena Progress Option 2', [HEADERS, ...rows]);
}

describe('normal reward', () => {
  it('emits Trophies / RewardID / Amount in that order', () => {
    const result = run({
      progression: progression([['Lost Oasis', null, null, null, 0, null, null, null, null], ['Lost Oasis', 10, 100, 1, 20, 'Coins', 50, null, null]]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toEqual([]);
    expect(result.config.Milestones[1]).toEqual({
      Trophies: 20,
      RewardID: 'reward.currency.coins',
      Amount: 50,
    });
    expect(Object.keys(result.config.Milestones[1])).toEqual(['Trophies', 'RewardID', 'Amount']);
  });

  it('keeps trophies and amounts numeric, never strings', () => {
    const result = run({
      progression: progression([['Lost Oasis', null, null, null, '0', null, null, null, null], ['Lost Oasis', null, null, null, '20', 'Coins', '50', null, null]]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toEqual([]);
    const milestone = result.config.Milestones[1] as { Trophies: number; Amount: number };
    expect(typeof milestone.Trophies).toBe('number');
    expect(typeof milestone.Amount).toBe('number');
    expect(serializeConfig(result.config)).toContain('"Amount": 50');
  });
});

describe('initial arena', () => {
  it('emits an arena milestone with no Unlocks key', () => {
    const result = run({
      progression: progression([['Lost Oasis', null, null, null, 0, null, null, null, null]]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toEqual([]);
    expect(result.config.Milestones).toEqual([{ Trophies: 0, ArenaID: 'arena.lostoasis' }]);
    expect(Object.keys(result.config.Milestones[0])).toEqual(['Trophies', 'ArenaID']);
    expect(serializeConfig(result.config)).not.toContain('Unlocks');
  });
});

describe('arena + hero unlock', () => {
  it('emits every unlock reward as a RewardID-only entry', () => {
    const result = run({
      progression: progression([
        ['Lost Oasis', null, null, null, 0, null, null, null, null],
        ['Mystic Forest', 250, 750, 2, 250, 'Arena_Mystic_Forest', null, 'Hero_Glint', null],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toEqual([]);
    expect(result.config.Milestones[1]).toEqual({
      Trophies: 250,
      ArenaID: 'arena.mysticforest',
      Unlocks: [{ RewardID: 'reward.arena.mysticforest' }, { RewardID: 'reward.hero.glint' }],
    });
    expect(Object.keys(result.config.Milestones[1])).toEqual(['Trophies', 'ArenaID', 'Unlocks']);
  });

  it('is not limited to two unlocks', () => {
    const headers = [...HEADERS, 'Reward', 'Reward Amount'];
    const rewards = sheet('Rewards', [
      ['RewardName', 'RewardID'],
      ['Arena_Mystic_Forest', 'reward.arena.mysticforest'],
      ['Hero_Glint', 'reward.hero.glint'],
      ['Hero_Cinder', 'reward.hero.cinder'],
    ]);
    const result = run({
      progression: sheet('Arena Progress Option 2', [
        headers,
        ['Mystic Forest', 250, 750, 2, 250, 'Arena_Mystic_Forest', null, 'Hero_Glint', null, 'Hero_Cinder', null],
      ]),
      arenas: ARENAS_SHEET,
      rewards,
    });

    expect(errorMessages(result)).toEqual([]);
    expect(result.config.Milestones[0]).toEqual({
      Trophies: 250,
      ArenaID: 'arena.mysticforest',
      Unlocks: [
        { RewardID: 'reward.arena.mysticforest' },
        { RewardID: 'reward.hero.glint' },
        { RewardID: 'reward.hero.cinder' },
      ],
    });
  });
});

describe('failed lookup', () => {
  it('reports the exact reward name and produces no milestone for it', () => {
    const result = run({
      progression: progression([
        ['Lost Oasis', null, null, null, 0, null, null, null, null],
        ['Lost Oasis', null, null, null, 20, 'Some Unknown Reward', 50, null, null],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toContain(
      'Reward "Some Unknown Reward" could not be found in the Rewards lookup table. It is used on row 3.',
    );
    expect(result.config.Milestones).toEqual([{ Trophies: 0, ArenaID: 'arena.lostoasis' }]);
    expect(result.stats.errors).toBeGreaterThan(0);
  });

  it('reports an unmatched arena name', () => {
    const result = run({
      progression: progression([['Frozen Peak', null, null, null, 0, null, null, null, null]]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toContain(
      'Arena "Frozen Peak" could not be found in the Arenas lookup table. It is used on row 2.',
    );
  });

  it('reports an unmatched arena unlock reward', () => {
    const result = run({
      progression: progression([
        ['Mystic Forest', null, null, null, 250, 'Arena_Mystic_Forest', null, 'Hero_Nobody', null],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toContain(
      'Reward "Hero_Nobody" could not be found in the Rewards lookup table. It is an arena unlock on row 2.',
    );
  });
});

describe('name matching', () => {
  it('is case-insensitive and ignores surrounding whitespace', () => {
    const result = run({
      progression: progression([
        ['  lost OASIS ', null, null, null, 0, null, null, null, null],
        ['  lost OASIS ', null, null, null, 20, '  coins  ', 50, null, null],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toEqual([]);
    expect(result.config.Milestones).toEqual([
      { Trophies: 0, ArenaID: 'arena.lostoasis' },
      { Trophies: 20, RewardID: 'reward.currency.coins', Amount: 50 },
    ]);
  });

  it('refuses to guess between duplicate lookup names', () => {
    const rewards = sheet('Rewards', [
      ['RewardName', 'RewardID'],
      ['Coins', 'reward.currency.coins'],
      ['coins', 'reward.currency.coins.v2'],
    ]);
    const result = run({
      progression: progression([['Lost Oasis', null, null, null, 20, 'Coins', 50, null, null]]),
      arenas: ARENAS_SHEET,
      rewards,
    });

    const messages = errorMessages(result);
    expect(messages.some((message) => message.includes('appears more than once'))).toBe(true);
    expect(result.config.Milestones.filter((m) => 'RewardID' in m)).toEqual([]);
  });
});

describe('row-level validation', () => {
  it('flags a missing trophy value', () => {
    const result = run({
      progression: progression([['Lost Oasis', null, null, null, null, 'Coins', 50, null, null]]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });
    expect(errorMessages(result)).toContain('Row 2 has no trophy value.');
  });

  it('flags a non-numeric trophy value', () => {
    const result = run({
      progression: progression([['Lost Oasis', null, null, null, 'soon', 'Coins', 50, null, null]]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });
    expect(errorMessages(result)).toContain('Row 2 has a non-numeric trophy value ("soon").');
  });

  it('flags a missing amount on a regular reward', () => {
    const result = run({
      progression: progression([
        ['Lost Oasis', null, null, null, 0, null, null, null, null],
        ['Lost Oasis', null, null, null, 20, 'Coins', null, null, null],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });
    expect(errorMessages(result)).toContain('Reward "Coins" on row 3 has no amount.');
  });

  it('flags a non-numeric amount', () => {
    const result = run({
      progression: progression([
        ['Lost Oasis', null, null, null, 0, null, null, null, null],
        ['Lost Oasis', null, null, null, 20, 'Coins', 'lots', null, null],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });
    expect(errorMessages(result)).toContain('Reward "Coins" on row 3 has a non-numeric amount ("lots").');
  });

  it('flags an empty progression table', () => {
    const result = run({
      progression: sheet('Arena Progress Option 2', [HEADERS]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });
    expect(errorMessages(result).some((message) => message.includes('no data rows'))).toBe(true);
  });

  it('flags a progression sheet that yields no milestones', () => {
    const result = run({
      progression: progression([['Nowhere', null, null, null, 5, 'Nothing', 1, null, null]]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });
    expect(errorMessages(result)).toContain('No valid milestones could be produced from the progression sheet.');
  });
});

describe('sheet shape tolerance', () => {
  it('forward-fills a blank arena column', () => {
    const result = run({
      progression: progression([
        ['Lost Oasis', null, null, null, 0, null, null, null, null],
        [null, null, null, null, 10, 'Coins', 50, null, null],
        [null, null, null, null, 25, 'Upgrade_Cards', 5, null, null],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toEqual([]);
    expect(result.stats.arenas).toBe(1);
    expect(result.config.Milestones).toHaveLength(3);
  });

  it('ignores blank padding rows below the data', () => {
    const result = run({
      progression: progression([
        ['Lost Oasis', null, null, null, 0, null, null, null, null],
        [null, null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null, null],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toEqual([]);
    expect(result.config.Milestones).toHaveLength(1);
  });

  it('emits one milestone per reward slot on a multi-reward row', () => {
    const result = run({
      progression: progression([
        ['Lost Oasis', null, null, null, 0, null, null, null, null],
        ['Lost Oasis', null, null, null, 20, 'Coins', 50, 'Upgrade_Cards', 5],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(errorMessages(result)).toEqual([]);
    expect(result.config.Milestones).toEqual([
      { Trophies: 0, ArenaID: 'arena.lostoasis' },
      { Trophies: 20, RewardID: 'reward.currency.coins', Amount: 50 },
      { Trophies: 20, RewardID: 'reward.currency.cards', Amount: 5 },
    ]);
  });
});

describe('generated config', () => {
  it('passes independent schema validation and pretty-prints with 2 spaces', () => {
    const result = run({
      progression: progression([
        ['Lost Oasis', null, null, null, 0, null, null, null, null],
        ['Lost Oasis', null, null, null, 10, 'Coins', 50, null, null],
        ['Mystic Forest', null, null, null, 250, 'Arena_Mystic_Forest', null, 'Hero_Glint', null],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(validateConfig(result.config)).toEqual([]);
    expect(serializeConfig(result.config)).toBe(
      [
        '{',
        '  "Milestones": [',
        '    {',
        '      "Trophies": 0,',
        '      "ArenaID": "arena.lostoasis"',
        '    },',
        '    {',
        '      "Trophies": 10,',
        '      "RewardID": "reward.currency.coins",',
        '      "Amount": 50',
        '    },',
        '    {',
        '      "Trophies": 250,',
        '      "ArenaID": "arena.mysticforest",',
        '      "Unlocks": [',
        '        {',
        '          "RewardID": "reward.arena.mysticforest"',
        '        },',
        '        {',
        '          "RewardID": "reward.hero.glint"',
        '        }',
        '      ]',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    );
  });

  it('builds a preview row per emitted milestone', () => {
    const result = run({
      progression: progression([
        ['Lost Oasis', null, null, null, 0, null, null, null, null],
        ['Lost Oasis', null, null, null, 10, 'Coins', 50, null, null],
        ['Mystic Forest', null, null, null, 250, 'Arena_Mystic_Forest', null, 'Hero_Glint', null],
      ]),
      arenas: ARENAS_SHEET,
      rewards: REWARDS_SHEET,
    });

    expect(result.preview).toEqual([
      { trophies: 0, type: 'Arena', label: 'Lost Oasis', amount: null, sheetRow: 2 },
      { trophies: 10, type: 'Reward', label: 'Coins', amount: 50, sheetRow: 3 },
      {
        trophies: 250,
        type: 'Arena Unlock',
        label: 'Mystic Forest + Arena_Mystic_Forest + Hero_Glint',
        amount: null,
        sheetRow: 4,
      },
    ]);
  });
});
