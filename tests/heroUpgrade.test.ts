import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import heroUpgradeJson from '../config/heroUpgrade.json';
import { runAnalysis } from '../src/exporters/analysis';
import { HERO_UPGRADE_EXPORTER } from '../src/exporters/heroUpgrade';
import { transformHeroUpgrade } from '../src/lib/heroUpgrade';
import { autoSelectHeroUpgradeSheets, detectDataset } from '../src/lib/sheetSelect';
import { serializeHeroUpgradeConfig, validateHeroUpgradeConfig } from '../src/lib/validateHeroUpgrade';
import { readWorkbookBytes } from '../src/lib/workbook';
import type { HeroUpgradeConfig, HeroUpgradeTransformResult, RawCell } from '../src/lib/types';
import { sheet } from './helpers';

const FIXTURE = fileURLToPath(new URL('../fixtures/hero-upgrade-settings.xlsx', import.meta.url));
const OTHER_FIXTURES = [
  '../fixtures/arena-progression.xlsx',
  '../fixtures/hero-stats.xlsx',
  '../fixtures/arenas-settings.xlsx',
  '../fixtures/match-trophy-settings.xlsx',
  '../fixtures/bots-settings.xlsx',
];

const GROWTH: RawCell[][] = [
  ['Setting', 'Value'],
  ['Coins Growth', 1.42],
  ['Cards Growth', 1.3],
  ['Coins Rounding', 10],
  ['Cards Rounding', 1],
  ['Reference Rarity', 'Common'],
  ['Cards Payout Modifier', 2],
];

const COST_HEADER: RawCell[] = ['Rarity', 'Coins Base', 'Cards Base', 'Cost Modifier', 'Growth Modifier'];
const COSTS: RawCell[][] = [
  COST_HEADER,
  ['Common', 250, 20, 1, 1],
  ['Uncommon', 350, 22, 1, 1],
  ['Rare', 450, 26, 1, 1],
  ['Epic', 600, 34, 1, 1],
  ['Legendary', 800, 40, 1, 1],
  ['Mythic', 1100, 50, 1, 1],
];

function run(growth: RawCell[][] = GROWTH, costs: RawCell[][] = COSTS): HeroUpgradeTransformResult {
  return transformHeroUpgrade({ growth: sheet('Growth', growth), costs: sheet('Costs', costs) });
}

function codes(result: HeroUpgradeTransformResult): string[] {
  return result.issues.map((issue) => issue.code);
}

function errors(result: HeroUpgradeTransformResult): string[] {
  return result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
}

function growthWith(patch: Record<string, RawCell>, drop: string[] = []): RawCell[][] {
  return GROWTH.filter((row) => !drop.includes(String(row[0]))).map((row) =>
    row[0] !== null && patch[String(row[0])] !== undefined ? [row[0], patch[String(row[0])]] : row,
  );
}

describe('the live hero upgrade payload', () => {
  it('is reproduced exactly from the sheet rows', () => {
    const result = run();
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual(heroUpgradeJson);
    expect(validateHeroUpgradeConfig(result.config)).toEqual([]);
    expect(result.stats).toEqual({ rarities: 6, errors: 0, warnings: 0 });
  });

  it('emits keys in the order the client reads', () => {
    const result = run();
    expect(Object.keys(result.config)).toEqual([
      'CoinsGrowth',
      'CardsGrowth',
      'CoinsRounding',
      'CardsRounding',
      'ReferenceRarity',
      'CardsPayoutModifier',
      'Costs',
    ]);
    expect(Object.keys(result.config.Costs[0])).toEqual(['Rarity', 'CoinsBase', 'CardsBase', 'CostModifier', 'GrowthModifier']);
  });

  it('serialises to the git-tracked baseline', () => {
    const baseline = readFileSync(fileURLToPath(new URL('../config/heroUpgrade.json', import.meta.url)), 'utf8');
    expect(serializeHeroUpgradeConfig(run().config) + '\n').toBe(baseline.replace(/\r\n/g, '\n'));
  });
});

describe('the real Hero Upgrade Settings workbook', () => {
  const workbook = readWorkbookBytes(readFileSync(FIXTURE), 'hero-upgrade-settings.xlsx');

  it('auto-selects both tabs and is detected as a hero upgrade workbook', () => {
    expect(autoSelectHeroUpgradeSheets(workbook)).toEqual({ growth: 'Growth', costs: 'Costs' });
    expect(detectDataset(workbook)).toBe('heroUpgrade');
  });

  it('exports the live payload through the exporter definition', () => {
    const analysis = runAnalysis(HERO_UPGRADE_EXPORTER, workbook, HERO_UPGRADE_EXPORTER.autoSelect(workbook));
    expect(analysis.issues).toEqual([]);
    expect(analysis.result?.config).toEqual(heroUpgradeJson);
  });

  it('is not mistaken for any other workbook, nor they for it', () => {
    for (const path of OTHER_FIXTURES) {
      const other = readWorkbookBytes(readFileSync(fileURLToPath(new URL(path, import.meta.url))), path);
      const selection = autoSelectHeroUpgradeSheets(other);
      expect(selection.growth === null || selection.costs === null).toBe(true);
      expect(detectDataset(other)).not.toBe('heroUpgrade');
    }
  });
});

describe('the growth tab', () => {
  it('accepts a tab with no header row and settings in any order', () => {
    const rows = GROWTH.slice(1).reverse();
    const result = run(rows);
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual(heroUpgradeJson);
  });

  it('matches setting names regardless of case and spacing', () => {
    const rows: RawCell[][] = [
      ['coinsgrowth', 1.42],
      ['CARDS_GROWTH', 1.3],
      ['Coins rounding', 10],
      ['cards-rounding', 1],
      ['ReferenceRarity', 'Common'],
      ['cards payout modifier', 2],
    ];
    expect(run(rows).issues).toEqual([]);
  });

  it('rejects an unknown setting and suggests the intended one', () => {
    const result = run([...GROWTH, ['Coins Groth', 1.5]]);
    expect(codes(result)).toContain('heroupgrade-setting-unknown');
    expect(errors(result)[0]).toContain('Did you mean "Coins Growth"?');
  });

  it('reports a missing setting by name', () => {
    const result = run(growthWith({}, ['Cards Rounding']));
    expect(codes(result)).toContain('heroupgrade-setting-missing');
    expect(errors(result)[0]).toContain('"Cards Rounding"');
    expect(result.stats.rarities).toBe(0);
  });

  it('rejects a duplicated setting', () => {
    expect(codes(run([...GROWTH, ['Coins Growth', 2]]))).toContain('heroupgrade-setting-duplicate');
  });

  it('rejects a blank or non-numeric scalar', () => {
    expect(codes(run(growthWith({ 'Coins Growth': null })))).toContain('heroupgrade-missing-value');
    expect(codes(run(growthWith({ 'Coins Growth': 'fast' })))).toContain('heroupgrade-non-numeric');
  });

  it('rejects a non-positive growth, a bad rounding and a negative payout modifier', () => {
    expect(codes(run(growthWith({ 'Coins Growth': 0 })))).toContain('heroupgrade-scalar-invalid');
    expect(codes(run(growthWith({ 'Coins Rounding': 0 })))).toContain('heroupgrade-scalar-invalid');
    expect(codes(run(growthWith({ 'Cards Rounding': 1.5 })))).toContain('heroupgrade-scalar-invalid');
    expect(codes(run(growthWith({ 'Cards Payout Modifier': -1 })))).toContain('heroupgrade-scalar-invalid');
  });

  it('warns about a growth factor below 1', () => {
    const result = run(growthWith({ 'Cards Growth': 0.9 }));
    expect(codes(result)).toContain('heroupgrade-growth-below-one');
    expect(errors(result)).toEqual([]);
    expect(result.config.CardsGrowth).toBe(0.9);
  });

  it('rejects a reference rarity that no Costs row prices', () => {
    const result = run(growthWith({ 'Reference Rarity': 'Ultra' }));
    expect(codes(result)).toContain('heroupgrade-reference-rarity-unpriced');
    expect(errors(result)[0]).toContain('Priced rarities: Common, Uncommon');
  });

  it('emits the reference rarity with the Costs spelling', () => {
    const result = run(growthWith({ 'Reference Rarity': 'common' }));
    expect(result.issues).toEqual([]);
    expect(result.config.ReferenceRarity).toBe('Common');
  });

  it('rejects a row with a value but no name', () => {
    expect(codes(run([...GROWTH, [null, 5]]))).toContain('heroupgrade-setting-unnamed');
  });
});

describe('the costs tab', () => {
  it('keeps the sheet order of rarities', () => {
    const result = run(GROWTH, [COST_HEADER, ['Mythic', 1100, 50, 1, 1], ['Common', 250, 20, 1, 1]]);
    expect(result.issues).toEqual([]);
    expect(result.config.Costs.map((cost) => cost.Rarity)).toEqual(['Mythic', 'Common']);
  });

  it('reports a missing column by name', () => {
    const result = run(GROWTH, [['Rarity', 'Coins Base', 'Cards Base', 'Cost Modifier'], ['Common', 250, 20, 1]]);
    expect(codes(result)).toContain('heroupgrade-missing-column');
    expect(errors(result)[0]).toContain('"Growth Modifier"');
  });

  it('rejects a rarity priced twice', () => {
    const result = run(GROWTH, [COST_HEADER, ['Common', 250, 20, 1, 1], ['common', 300, 20, 1, 1]]);
    expect(codes(result)).toContain('heroupgrade-rarity-duplicate');
  });

  it('rejects a row with values but no rarity', () => {
    expect(codes(run(GROWTH, [COST_HEADER, ['Common', 250, 20, 1, 1], [null, 300, 20, 1, 1]]))).toContain('heroupgrade-rarity-missing');
  });

  it('rejects blank, non-numeric, fractional and negative bases', () => {
    expect(codes(run(GROWTH, [COST_HEADER, ['Common', null, 20, 1, 1]]))).toContain('heroupgrade-missing-value');
    expect(codes(run(GROWTH, [COST_HEADER, ['Common', 'lots', 20, 1, 1]]))).toContain('heroupgrade-non-numeric');
    expect(codes(run(GROWTH, [COST_HEADER, ['Common', 250.5, 20, 1, 1]]))).toContain('heroupgrade-base-invalid');
    expect(codes(run(GROWTH, [COST_HEADER, ['Common', 250, -1, 1, 1]]))).toContain('heroupgrade-base-invalid');
  });

  it('rejects a modifier that is not positive', () => {
    expect(codes(run(GROWTH, [COST_HEADER, ['Common', 250, 20, 0, 1]]))).toContain('heroupgrade-modifier-not-positive');
  });

  it('reports an empty costs tab', () => {
    const result = run(GROWTH, [COST_HEADER]);
    expect(codes(result)).toContain('heroupgrade-empty');
    expect(codes(result)).toContain('heroupgrade-reference-rarity-unpriced');
  });
});

describe('the hero upgrade schema gate', () => {
  const gate = (config: unknown) => validateHeroUpgradeConfig(config as HeroUpgradeConfig).map((issue) => issue.code);

  it('pins the root key order, the scalar types and the reference rarity', () => {
    const live = heroUpgradeJson as HeroUpgradeConfig;
    expect(gate(live)).toEqual([]);
    expect(gate({ ...live, Extra: 1 })).toContain('schema-root');
    expect(gate({ ...live, CoinsGrowth: '1.42' })).toContain('schema-scalar');
    expect(gate({ ...live, CoinsRounding: 0.5 })).toContain('schema-rounding');
    expect(gate({ ...live, ReferenceRarity: '' })).toContain('schema-reference-rarity');
    expect(gate({ ...live, ReferenceRarity: 'Ultra' })).toContain('schema-reference-rarity-unpriced');
    expect(gate({ ...live, Costs: [] })).toContain('no-costs');
    expect(gate({ ...live, Costs: [{ ...live.Costs[0], Extra: 1 }] })).toContain('schema-cost-keys');
    expect(gate({ ...live, Costs: [live.Costs[0], live.Costs[0]] })).toContain('schema-cost-rarity-duplicate');
    expect(gate({ ...live, Costs: [{ ...live.Costs[0], CardsBase: '20' }] })).toContain('schema-cost-value');
  });
});
