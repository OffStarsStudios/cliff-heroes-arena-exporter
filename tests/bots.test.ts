import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import botsJson from '../config/bots.json';
import { runAnalysis } from '../src/exporters/analysis';
import { BOTS_EXPORTER } from '../src/exporters/bots';
import { transformBots } from '../src/lib/bots';
import { autoSelectBotsSheets, detectDataset } from '../src/lib/sheetSelect';
import { serializeBotsConfig, validateBotsConfig } from '../src/lib/validateBots';
import { readWorkbookBytes } from '../src/lib/workbook';
import type { BotsConfig, BotsTransformResult, RawCell } from '../src/lib/types';
import { sheet } from './helpers';

const FIXTURE = fileURLToPath(new URL('../fixtures/bots-settings.xlsx', import.meta.url));
const OTHER_FIXTURES = [
  '../fixtures/arena-progression.xlsx',
  '../fixtures/hero-stats.xlsx',
  '../fixtures/arenas-settings.xlsx',
  '../fixtures/match-trophy-settings.xlsx',
];

const HEADER: RawCell[] = [
  'Level',
  'Min Jump Interval',
  'Max Jump Interval',
  'Min Dodge Chance',
  'Max Dodge Chance',
  'Raycast Distance',
  'Raycast Interval',
  'Min Fire Interval',
  'Max Fire Interval',
];

const LIVE_ROWS: RawCell[][] = [
  HEADER,
  [0, 4, 6, 0.1, 0.2, 8, 0.3, 2, 4],
  [1, 3, 5, 0.2, 0.3, 8, 0.3, 1, 3],
  [2, 2, 4, 0.3, 0.5, 8, 0.3, 1, 2],
  [3, 2, 4, 0.6, 0.8, 10, 0.2, 0.7, 1.4],
  [4, 2, 4, 0.9, 1, 10, 0.2, 0.1, 0.5],
];

function run(rows: RawCell[][]): BotsTransformResult {
  return transformBots({ bots: sheet('Bots', rows) });
}

function codes(result: BotsTransformResult): string[] {
  return result.issues.map((issue) => issue.code);
}

function errors(result: BotsTransformResult): string[] {
  return result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
}

function row(level: number, patch: Partial<Record<number, RawCell>> = {}): RawCell[] {
  const base = LIVE_ROWS[level + 1].slice();
  for (const [index, value] of Object.entries(patch)) base[Number(index)] = value as RawCell;
  return base;
}

describe('the live bots payload', () => {
  it('is reproduced exactly from the sheet rows', () => {
    const result = run(LIVE_ROWS);
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual(botsJson);
    expect(validateBotsConfig(result.config)).toEqual([]);
    expect(result.stats).toEqual({ levels: 5, errors: 0, warnings: 0 });
  });

  it('emits keys in the order the client reads', () => {
    const result = run(LIVE_ROWS);
    expect(Object.keys(result.config)).toEqual(['BotLevel', 'Bots']);
    expect(Object.keys(result.config.Bots[0])).toEqual([
      'Level',
      'MinJumpInterval',
      'MaxJumpInterval',
      'MinDodgeChance',
      'MaxDodgeChance',
      'RaycastDistance',
      'RaycastInterval',
      'MinFireInterval',
      'MaxFireInterval',
    ]);
  });

  it('serialises to the git-tracked baseline', () => {
    const baseline = readFileSync(fileURLToPath(new URL('../config/bots.json', import.meta.url)), 'utf8');
    expect(serializeBotsConfig(run(LIVE_ROWS).config) + '\n').toBe(baseline.replace(/\r\n/g, '\n'));
  });

  it('derives BotLevel from the highest level', () => {
    const result = run(LIVE_ROWS.slice(0, 4));
    expect(result.config.BotLevel).toBe(2);
  });
});

describe('the real Bots Settings workbook', () => {
  const workbook = readWorkbookBytes(readFileSync(FIXTURE), 'bots-settings.xlsx');

  it('auto-selects the bots tab and is detected as a bots workbook', () => {
    expect(autoSelectBotsSheets(workbook)).toEqual({ bots: 'Bots' });
    expect(detectDataset(workbook)).toBe('bots');
  });

  it('exports the live payload through the exporter definition', () => {
    const analysis = runAnalysis(BOTS_EXPORTER, workbook, BOTS_EXPORTER.autoSelect(workbook));
    expect(analysis.issues).toEqual([]);
    expect(analysis.result?.config).toEqual(botsJson);
  });

  it('is not mistaken for any other workbook, nor they for it', () => {
    for (const path of OTHER_FIXTURES) {
      const other = readWorkbookBytes(readFileSync(fileURLToPath(new URL(path, import.meta.url))), path);
      expect(autoSelectBotsSheets(other).bots).toBeNull();
      expect(detectDataset(other)).not.toBe('bots');
    }
  });
});

describe('row validation', () => {
  it('orders by level whatever the row order', () => {
    const result = run([HEADER, row(2), row(0), row(1)]);
    expect(result.issues).toEqual([]);
    expect(result.config.Bots.map((bot) => bot.Level)).toEqual([0, 1, 2]);
  });

  it('reports a missing column by name', () => {
    const result = run([HEADER.filter((h) => h !== 'Raycast Interval'), [0, 4, 6, 0.1, 0.2, 8, 2, 4]]);
    expect(codes(result)).toContain('bots-missing-column');
    expect(errors(result)[0]).toContain('"Raycast Interval"');
  });

  it('rejects a blank or non-numeric value, naming the column', () => {
    expect(codes(run([HEADER, row(0, { 3: null })]))).toContain('bots-missing-value');
    const result = run([HEADER, row(0, { 5: 'far' })]);
    expect(codes(result)).toContain('bots-non-numeric');
    expect(errors(result)[0]).toContain('Raycast Distance');
  });

  it('rejects a fractional or negative level', () => {
    expect(codes(run([HEADER, row(0, { 0: 0.5 })]))).toContain('bots-level-invalid');
    expect(codes(run([HEADER, row(0, { 0: -1 })]))).toContain('bots-level-invalid');
  });

  it('rejects a duplicated level', () => {
    const result = run([HEADER, row(0), row(1, { 0: 0 })]);
    expect(codes(result)).toContain('bots-level-duplicate');
  });

  it('rejects a gap in the level sequence and exports nothing', () => {
    const result = run([HEADER, row(0), row(2)]);
    expect(codes(result)).toContain('bots-level-gap');
    expect(errors(result)[0]).toContain('expected level 1 but found 2');
    expect(result.config).toEqual({ BotLevel: 0, Bots: [] });
  });

  it('rejects a sequence that does not start at level 0', () => {
    expect(codes(run([HEADER, row(1), row(2)]))).toContain('bots-level-gap');
  });

  it('rejects intervals and distances that are not positive', () => {
    expect(codes(run([HEADER, row(0, { 1: 0 })]))).toContain('bots-interval-not-positive');
    expect(codes(run([HEADER, row(0, { 6: -0.3 })]))).toContain('bots-interval-not-positive');
    expect(codes(run([HEADER, row(0, { 5: 0 })]))).toContain('bots-distance-not-positive');
  });

  it('rejects a dodge chance outside 0..1', () => {
    expect(codes(run([HEADER, row(0, { 4: 1.5 })]))).toContain('bots-chance-out-of-range');
    expect(codes(run([HEADER, row(0, { 3: -0.1 })]))).toContain('bots-chance-out-of-range');
    expect(run([HEADER, row(0, { 3: 0, 4: 1 })]).issues).toEqual([]);
  });

  it('rejects a minimum above its maximum', () => {
    const result = run([HEADER, row(0, { 1: 7 })]);
    expect(codes(result)).toContain('bots-min-above-max');
    expect(errors(result)[0]).toContain('jump interval');
    expect(codes(run([HEADER, row(0, { 7: 5 })]))).toContain('bots-min-above-max');
  });

  it('warns when a higher level is easier than the one below', () => {
    const result = run([HEADER, row(0), row(1, { 3: 0.05, 4: 0.1 })]);
    expect(codes(result)).toContain('bots-not-harder');
    expect(errors(result)).toEqual([]);
  });

  it('skips blank rows and reports an empty tab', () => {
    expect(run([HEADER, [null, null, null, null, null, null, null, null, null], row(0)]).issues).toEqual([]);
    expect(codes(run([HEADER]))).toContain('bots-empty');
  });
});

describe('the bots schema gate', () => {
  const gate = (config: unknown) => validateBotsConfig(config as BotsConfig).map((issue) => issue.code);

  it('pins root and bot key order, numeric values, the level run and BotLevel', () => {
    expect(gate({ Bots: [], BotLevel: 0 })).toContain('schema-root');
    expect(gate({ BotLevel: 0, Bots: [] })).toContain('no-bots');
    const bot = { ...botsJson.Bots[0] };
    expect(gate({ BotLevel: 0, Bots: [{ ...bot, Extra: 1 }] })).toContain('schema-bot-keys');
    expect(gate({ BotLevel: 0, Bots: [{ ...bot, MinJumpInterval: '4' }] })).toContain('schema-bot-value');
    expect(gate({ BotLevel: 1, Bots: [{ ...bot, Level: 1 }] })).toContain('schema-level-sequence');
    expect(gate({ BotLevel: 3, Bots: [bot] })).toContain('schema-botlevel');
    expect(gate(botsJson)).toEqual([]);
  });
});
