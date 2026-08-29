import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readWorkbookBytes } from '../src/lib/workbook';
import { autoSelectHeroSheets, detectDataset } from '../src/lib/sheetSelect';
import { buildLookup } from '../src/lib/lookups';
import { multiplyToOneDecimal, transformHeroes } from '../src/lib/heroes';
import { serializeHeroesConfig, validateHeroesConfig } from '../src/lib/validateHeroes';
import type { HeroTransformResult, RawSheet, RawWorkbook } from '../src/lib/types';
import { sheet } from './helpers';

const FIXTURE = fileURLToPath(new URL('../fixtures/hero-stats.xlsx', import.meta.url));

function load(): RawWorkbook {
  return readWorkbookBytes(readFileSync(FIXTURE), 'hero-stats.xlsx');
}

function sheetNamed(workbook: RawWorkbook, name: string | null): RawSheet {
  const found = workbook.sheets.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Sheet not found: ${name}`);
  return found;
}

function runWorkbook(workbook: RawWorkbook): HeroTransformResult {
  const selection = autoSelectHeroSheets(workbook);
  return transformHeroes({
    baseStats: sheetNamed(workbook, selection.baseStats),
    levelFactors: sheetNamed(workbook, selection.levelFactors),
    powerSettings: sheetNamed(workbook, selection.powerSettings),
    heroes: buildLookup(sheetNamed(workbook, selection.heroes), 'hero').table,
  });
}

function errors(result: HeroTransformResult): string[] {
  return result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
}

/* ------------------------------------------------------------- rounding -- */

describe('level stat rounding', () => {
  it('rounds to one decimal place', () => {
    expect(multiplyToOneDecimal(3.2, 1.1)).toBe(3.5);
    expect(multiplyToOneDecimal(10.1, 1.2)).toBe(12.1);
    expect(multiplyToOneDecimal(8.5, 1.3)).toBe(11.1);
  });

  it('rounds exact halves up, despite binary float representation', () => {
    // 9.7 * 1.5 evaluates to 14.549999999999999 as a float, but the decimal
    // answer is 14.55, which must round to 14.6.
    expect(9.7 * 1.5).not.toBe(14.55);
    expect(multiplyToOneDecimal(9.7, 1.5)).toBe(14.6);
    expect(multiplyToOneDecimal(8.5, 1.5)).toBe(12.8);
    expect(multiplyToOneDecimal(10.1, 1.5)).toBe(15.2);
  });

  it('leaves a level-1 multiplier of 1 untouched', () => {
    expect(multiplyToOneDecimal(6.8, 1)).toBe(6.8);
    expect(multiplyToOneDecimal(24.8, 1)).toBe(24.8);
  });
});

/* ------------------------------------------------------- the real sheet -- */

describe('the real Cliff Heroes hero workbook', () => {
  const workbook = load();

  it('lists every tab', () => {
    expect(workbook.sheets.map((s) => s.name)).toEqual([
      'Heroes',
      'Base Stats',
      'Stats Level Factors',
      'Power Settings',
    ]);
  });

  it('is recognised as a hero workbook and auto-selects its tabs', () => {
    expect(detectDataset(workbook)).toBe('heroes');
    expect(autoSelectHeroSheets(workbook)).toEqual({
      heroes: 'Heroes',
      baseStats: 'Base Stats',
      levelFactors: 'Stats Level Factors',
      powerSettings: 'Power Settings',
    });
  });

  it('generates a valid config end to end with no issues', () => {
    const result = runWorkbook(workbook);

    expect(result.issues).toEqual([]);
    expect(validateHeroesConfig(result.config)).toEqual([]);
    expect(result.stats).toEqual({
      heroes: 7,
      levels: 70,
      powerParams: 29,
      errors: 0,
      warnings: 0,
    });
  });

  it('orders heroes by the Base Stats tab and reads IDs from the Heroes tab', () => {
    const result = runWorkbook(workbook);
    expect(result.config.Heroes.map((hero) => hero.ID)).toEqual([
      'heroes.cliff',
      'heroes.flick',
      'heroes.guy',
      'heroes.pedro',
      'heroes.tank',
      'heroes.glint',
      'heroes.cinder',
    ]);
  });

  it('multiplies base stats by the level factors', () => {
    const cliff = runWorkbook(workbook).config.Heroes[0];
    expect(cliff.Levels).toHaveLength(10);
    expect(cliff.Levels[0]).toEqual({ Health: 3, Speed: 10, Grip: 6.8 });
    expect(cliff.Levels[1]).toEqual({ Health: 3.3, Speed: 11, Grip: 7.5 });
    expect(cliff.Levels[9]).toEqual({ Health: 6, Speed: 20, Grip: 13.6 });
  });

  it('emits each hero scalar from the Base Stats tab', () => {
    const tank = runWorkbook(workbook).config.Heroes[4];
    expect(tank.ID).toBe('heroes.tank');
    expect(tank.MaxSpeed).toBe(24.4);
    expect(tank.SpeedIncreasePerSecond).toBe(0.05);
    expect(tank.Rarity).toBe('Rare');
    expect(tank.PowerCooldown).toBe(5);
  });

  it('keeps each hero power block to its own parameters, in sheet order', () => {
    const byId = new Map(runWorkbook(workbook).config.Heroes.map((hero) => [hero.ID, hero.Power]));

    expect(byId.get('heroes.cliff')).toEqual({
      ActivationDelay: 0,
      Duration: 3,
      SpeedMultiplier: 1.5,
      EvasionExtension: 1.5,
      MaxDuration: 8,
      EvasionCheckDistance: 8,
      EndsOnObstacleHit: true,
    });
    // A hero with no special parameters gets exactly the two fixed ones.
    expect(byId.get('heroes.guy')).toEqual({ ActivationDelay: 0, Duration: 0 });
    expect(byId.get('heroes.pedro')).toEqual({
      ActivationDelay: 1,
      Duration: 6,
      DropDistance: 15,
      FloatDistance: 2,
      SlowdownDuration: 2,
      SlowdownStrength: 0.7,
      Damage: 0.5,
      DamageInterval: 2,
    });
  });

  it('keeps booleans as booleans', () => {
    const byId = new Map(runWorkbook(workbook).config.Heroes.map((hero) => [hero.ID, hero.Power]));
    expect(byId.get('heroes.cliff')?.EndsOnObstacleHit).toBe(true);
    expect(byId.get('heroes.flick')?.EndsOnObstacleHit).toBe(false);
  });

  it('emits keys in the exact schema order', () => {
    for (const hero of runWorkbook(workbook).config.Heroes) {
      expect(Object.keys(hero)).toEqual([
        'ID',
        'MaxSpeed',
        'SpeedIncreasePerSecond',
        'Rarity',
        'PowerCooldown',
        'Levels',
        'Power',
      ]);
      for (const level of hero.Levels) {
        expect(Object.keys(level)).toEqual(['Health', 'Speed', 'Grip']);
      }
      expect(Object.keys(hero.Power).slice(0, 2)).toEqual(['ActivationDelay', 'Duration']);
    }
  });

  it('never emits a level stat with more than one decimal place', () => {
    for (const hero of runWorkbook(workbook).config.Heroes) {
      for (const level of hero.Levels) {
        for (const value of [level.Health, level.Speed, level.Grip]) {
          expect(Math.round(value * 10)).toBe(value * 10);
        }
      }
    }
  });

  it('serializes to a stable document', () => {
    const json = serializeHeroesConfig(runWorkbook(workbook).config);
    expect(json.split('\n')[0]).toBe('{');
    expect(JSON.parse(json).Heroes).toHaveLength(7);
  });
});

/* -------------------------------------------------------- built sheets -- */

const HEROES_TAB = sheet('Heroes', [
  ['Hero Name', 'Hero ID'],
  ['Cliff', 'heroes.cliff'],
]);

const BASE_TAB = sheet('Base Stats', [
  ['Hero Name', 'Health', 'Speed', 'Grip', 'Max Speed', 'Speed Increase Per Second', 'Powerup Cooldown', 'Rarity'],
  ['Cliff', 3, 10, 6.8, 24.8, 0.05, 5, 'Rare'],
]);

const FACTORS_TAB = sheet('Stats Level Factors', [
  ['Hero Name', 'Level', 'Health Multiplier', 'Speed Multiplier', 'Grip Multiplier'],
  ['Cliff', 1, 1, 1, 1],
  ['Cliff', 2, 1.1, 1.1, 1.1],
]);

function powerTab(rows: (string | number | boolean | null)[][]): RawSheet {
  return sheet('Power Settings', [
    [
      'Hero Name',
      'Activation Delay',
      'Duration',
      'Special Param Name 1',
      'Special Param Inptut 1',
      'Special Param Name 2',
      'Special Param Inptut 2',
    ],
    ...rows,
  ]);
}

function runWith(power: RawSheet): HeroTransformResult {
  return transformHeroes({
    baseStats: BASE_TAB,
    levelFactors: FACTORS_TAB,
    powerSettings: power,
    heroes: buildLookup(HEROES_TAB, 'hero').table,
  });
}

describe('power parameter validation in the pipeline', () => {
  it('accepts a correctly spelled parameter', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, 'SpeedMultiplier', 1.5, null, null]]));
    expect(result.issues).toEqual([]);
    expect(result.config.Heroes[0].Power).toEqual({
      ActivationDelay: 0,
      Duration: 3,
      SpeedMultiplier: 1.5,
    });
  });

  it('blocks a misspelled parameter and names the likely fix', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, 'SpeedMultiplyer', 1.5, null, null]]));
    expect(errors(result)).toEqual([
      '"Cliff" on the Power Settings tab: "SpeedMultiplyer" is not a valid power parameter name. Did you mean "SpeedMultiplier"?',
    ]);
    // The bad parameter is dropped rather than guessed at. The error is what
    // blocks export; the UI never offers JSON while one is outstanding.
    expect(result.config.Heroes[0].Power).toEqual({ ActivationDelay: 0, Duration: 3 });
  });

  it('blocks an invented parameter', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, 'JumpHeight', 4, null, null]]));
    expect(errors(result)[0]).toContain('"JumpHeight" is not a valid power parameter name');
    expect(errors(result)[0]).toContain('not one of the power parameters the game reads');
  });

  it('accepts a differently cased name, warns, and emits the canonical spelling', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, 'speed multiplier', 1.5, null, null]]));
    expect(errors(result)).toEqual([]);
    expect(result.issues.map((issue) => issue.severity)).toEqual(['warning']);
    expect(Object.keys(result.config.Heroes[0].Power)).toEqual([
      'ActivationDelay',
      'Duration',
      'SpeedMultiplier',
    ]);
  });

  it('rejects a non-boolean value for EndsOnObstacleHit', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, 'EndsOnObstacleHit', 1, null, null]]));
    expect(errors(result)).toEqual([
      '"Cliff" on the Power Settings tab: "EndsOnObstacleHit" must be TRUE or FALSE, not 1.',
    ]);
  });

  it('accepts TRUE/FALSE written as text', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, 'EndsOnObstacleHit', 'FALSE', null, null]]));
    expect(errors(result)).toEqual([]);
    expect(result.config.Heroes[0].Power.EndsOnObstacleHit).toBe(false);
  });

  it('rejects a non-numeric value for a numeric parameter', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, 'DropDistance', 'far', null, null]]));
    expect(errors(result)).toEqual([
      '"Cliff" on the Power Settings tab: "DropDistance" must be a number, not "far".',
    ]);
  });

  it('rejects the same parameter set twice', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, 'Damage', 1, 'Damage', 2]]));
    expect(errors(result)).toEqual(['"Cliff" on the Power Settings tab: "Damage" is set more than once.']);
  });

  it('rejects a parameter that duplicates a fixed column', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, 'Duration', 9, null, null]]));
    expect(errors(result)).toEqual(['"Cliff" on the Power Settings tab: "Duration" is set more than once.']);
    expect(result.config.Heroes[0].Power.Duration).toBe(3);
  });

  it('rejects a name with no value', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, 'Damage', null, null, null]]));
    expect(errors(result)).toEqual(['"Cliff" on the Power Settings tab: "Damage" has no value.']);
  });

  it('rejects a value with no name', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, null, 7, null, null]]));
    expect(errors(result)[0]).toContain('holds the value 7 but has no parameter name beside it');
  });

  it('ignores a fully empty parameter slot', () => {
    const result = runWith(powerTab([['Cliff', 0, 3, null, null, null, null]]));
    expect(result.issues).toEqual([]);
    expect(result.config.Heroes[0].Power).toEqual({ ActivationDelay: 0, Duration: 3 });
  });
});

describe('hero sheet validation', () => {
  it('blocks a hero with no Heroes-tab entry rather than inventing an ID', () => {
    const result = transformHeroes({
      baseStats: BASE_TAB,
      levelFactors: FACTORS_TAB,
      powerSettings: powerTab([['Cliff', 0, 3, null, null, null, null]]),
      heroes: buildLookup(sheet('Heroes', [['Hero Name', 'Hero ID'], ['Flick', 'heroes.flick']]), 'hero').table,
    });
    expect(errors(result)).toEqual([
      '"Cliff" has no entry on the Heroes tab, so there is no Hero ID to export.',
    ]);
    expect(result.config.Heroes).toEqual([]);
  });

  it('blocks a gap in the level sequence', () => {
    const result = transformHeroes({
      baseStats: BASE_TAB,
      levelFactors: sheet('Stats Level Factors', [
        ['Hero Name', 'Level', 'Health Multiplier', 'Speed Multiplier', 'Grip Multiplier'],
        ['Cliff', 1, 1, 1, 1],
        ['Cliff', 3, 1.2, 1.2, 1.2],
      ]),
      powerSettings: powerTab([['Cliff', 0, 3, null, null, null, null]]),
      heroes: buildLookup(HEROES_TAB, 'hero').table,
    });
    expect(errors(result)[0]).toContain('expected level 2 but found 3');
  });

  it('reports a missing column instead of guessing', () => {
    const result = transformHeroes({
      baseStats: sheet('Base Stats', [
        ['Hero Name', 'Health', 'Speed', 'Max Speed', 'Speed Increase Per Second', 'Powerup Cooldown', 'Rarity'],
        ['Cliff', 3, 10, 24.8, 0.05, 5, 'Rare'],
      ]),
      levelFactors: FACTORS_TAB,
      powerSettings: powerTab([['Cliff', 0, 3, null, null, null, null]]),
      heroes: buildLookup(HEROES_TAB, 'hero').table,
    });
    expect(errors(result)).toContain('The "Base Stats" tab has no "Grip" column.');
  });

  it('warns about rows that never reach the output', () => {
    const result = transformHeroes({
      baseStats: BASE_TAB,
      levelFactors: sheet('Stats Level Factors', [
        ['Hero Name', 'Level', 'Health Multiplier', 'Speed Multiplier', 'Grip Multiplier'],
        ['Cliff', 1, 1, 1, 1],
        ['Cliff', 2, 1.1, 1.1, 1.1],
        ['Ghost', 1, 1, 1, 1],
      ]),
      powerSettings: powerTab([['Cliff', 0, 3, null, null, null, null]]),
      heroes: buildLookup(HEROES_TAB, 'hero').table,
    });
    expect(errors(result)).toEqual([]);
    expect(result.issues.map((issue) => issue.message)).toEqual([
      'The Stats Level Factors tab has rows for "ghost", which has no Base Stats row - they were ignored.',
    ]);
  });
});

describe('the independent schema check', () => {
  it('passes the real config', () => {
    expect(validateHeroesConfig(runWorkbook(load()).config)).toEqual([]);
  });

  it('catches a power parameter the transformer should never have emitted', () => {
    const config = runWorkbook(load()).config;
    (config.Heroes[0].Power as Record<string, unknown>).Wobble = 3;
    expect(validateHeroesConfig(config).map((issue) => issue.message)).toContain(
      'Hero 1 (heroes.cliff): "Wobble" is not a power parameter the game reads.',
    );
  });

  it('catches a level stat with too many decimals', () => {
    const config = runWorkbook(load()).config;
    config.Heroes[0].Levels[0].Health = 3.52;
    expect(validateHeroesConfig(config).map((issue) => issue.message)).toContain(
      'Hero 1 (heroes.cliff), level 1: "Health" is 3.52, which has more than one decimal place.',
    );
  });

  it('catches a duplicated hero ID', () => {
    const config = runWorkbook(load()).config;
    config.Heroes[1].ID = config.Heroes[0].ID;
    expect(validateHeroesConfig(config).map((issue) => issue.message)).toContain(
      'Hero 2 (heroes.cliff): the ID "heroes.cliff" is used by more than one hero.',
    );
  });

  it('catches out-of-order hero keys', () => {
    const config = runWorkbook(load()).config;
    const hero = config.Heroes[0] as unknown as Record<string, unknown>;
    // Same keys and values, rebuilt with Rarity first.
    const reordered = Object.fromEntries([
      ['Rarity', hero.Rarity],
      ...Object.entries(hero).filter(([key]) => key !== 'Rarity'),
    ]);
    config.Heroes[0] = reordered as unknown as (typeof config.Heroes)[number];
    expect(validateHeroesConfig(config)[0].message).toContain('must have exactly [ID, MaxSpeed');
  });
});
