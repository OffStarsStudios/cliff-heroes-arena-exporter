import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import matchTrophyJson from '../config/matchTrophy.json';
import { runAnalysis } from '../src/exporters/analysis';
import { MATCH_TROPHY_EXPORTER } from '../src/exporters/matchTrophy';
import { transformMatchTrophy } from '../src/lib/matchTrophy';
import { autoSelectMatchTrophySheets, detectDataset } from '../src/lib/sheetSelect';
import { serializeMatchTrophyConfig, validateMatchTrophyConfig } from '../src/lib/validateMatchTrophy';
import { readWorkbookBytes } from '../src/lib/workbook';
import type { MatchTrophyTransformResult, RawCell } from '../src/lib/types';
import { sheet } from './helpers';

const FIXTURE = fileURLToPath(new URL('../fixtures/match-trophy-settings.xlsx', import.meta.url));
const OTHER_FIXTURES = ['../fixtures/arena-progression.xlsx', '../fixtures/hero-stats.xlsx', '../fixtures/arenas-settings.xlsx'];

const HEADER: RawCell[] = ['Place', 'Trophies'];
const LIVE_ROWS: RawCell[][] = [HEADER, [1, 60], [2, 35], [3, 0], [4, -15]];

function run(rows: RawCell[][]): MatchTrophyTransformResult {
  return transformMatchTrophy({ places: sheet('Trophies By Place', rows) });
}

function codes(result: MatchTrophyTransformResult): string[] {
  return result.issues.map((issue) => issue.code);
}

function errors(result: MatchTrophyTransformResult): string[] {
  return result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
}

describe('the live match trophy payload', () => {
  it('is reproduced exactly from the sheet rows', () => {
    const result = run(LIVE_ROWS);
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual(matchTrophyJson);
    expect(validateMatchTrophyConfig(result.config)).toEqual([]);
    expect(result.stats).toEqual({ places: 4, errors: 0, warnings: 0 });
  });

  it('serialises to the git-tracked baseline', () => {
    const baseline = readFileSync(fileURLToPath(new URL('../config/matchTrophy.json', import.meta.url)), 'utf8');
    expect(serializeMatchTrophyConfig(run(LIVE_ROWS).config) + '\n').toBe(baseline.replace(/\r\n/g, '\n'));
  });
});

describe('the real Match Trophy Settings workbook', () => {
  const workbook = readWorkbookBytes(readFileSync(FIXTURE), 'match-trophy-settings.xlsx');

  it('auto-selects the places tab and is detected as a match-trophy workbook', () => {
    expect(autoSelectMatchTrophySheets(workbook)).toEqual({ places: 'Trophies By Place' });
    expect(detectDataset(workbook)).toBe('matchTrophy');
  });

  it('exports the live payload through the exporter definition', () => {
    const analysis = runAnalysis(MATCH_TROPHY_EXPORTER, workbook, MATCH_TROPHY_EXPORTER.autoSelect(workbook));
    expect(analysis.issues).toEqual([]);
    expect(analysis.result?.config).toEqual(matchTrophyJson);
    expect(analysis.result?.count).toBe(4);
  });

  it('is not mistaken for any other workbook, nor they for it', () => {
    for (const path of OTHER_FIXTURES) {
      const other = readWorkbookBytes(readFileSync(fileURLToPath(new URL(path, import.meta.url))), path);
      expect(autoSelectMatchTrophySheets(other).places).toBeNull();
      expect(detectDataset(other)).not.toBe('matchTrophy');
    }
  });
});

describe('header variants and ordering', () => {
  it('accepts alternative column names', () => {
    const result = run([['Position', 'Trophy delta'], [1, 60], [2, 35], [3, 0], [4, -15]]);
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual(matchTrophyJson);
  });

  it('orders by place whatever the row order', () => {
    const result = run([HEADER, [4, -15], [2, 35], [1, 60], [3, 0]]);
    expect(result.issues).toEqual([]);
    expect(result.config.TrophiesByPlace).toEqual([60, 35, 0, -15]);
  });

  it('reports a missing column by name', () => {
    const result = run([['Place', 'Points'], [1, 60]]);
    expect(codes(result)).toContain('matchtrophy-missing-column');
    expect(errors(result)[0]).toContain('"Trophies"');
  });
});

describe('row validation', () => {
  it('rejects a blank, non-numeric, fractional or zero place', () => {
    expect(codes(run([HEADER, [null, 60]]))).toContain('matchtrophy-place-missing');
    expect(codes(run([HEADER, ['first', 60]]))).toContain('matchtrophy-place-invalid');
    expect(codes(run([HEADER, [1.5, 60]]))).toContain('matchtrophy-place-invalid');
    expect(codes(run([HEADER, [0, 60]]))).toContain('matchtrophy-place-invalid');
  });

  it('rejects a duplicated place', () => {
    const result = run([HEADER, [1, 60], [1, 50]]);
    expect(codes(result)).toContain('matchtrophy-place-duplicate');
    expect(errors(result)[0]).toContain('rows 2 and 3');
  });

  it('rejects a gap in the place sequence and exports nothing', () => {
    const result = run([HEADER, [1, 60], [2, 35], [4, -15]]);
    expect(codes(result)).toContain('matchtrophy-place-gap');
    expect(errors(result)[0]).toContain('expected place 3 but found 4');
    expect(result.config.TrophiesByPlace).toEqual([]);
  });

  it('rejects a sequence that does not start at first place', () => {
    const result = run([HEADER, [2, 35], [3, 0]]);
    expect(codes(result)).toContain('matchtrophy-place-gap');
  });

  it('rejects a blank, non-numeric or fractional trophy value', () => {
    expect(codes(run([HEADER, [1, null]]))).toContain('matchtrophy-trophies-missing');
    expect(codes(run([HEADER, [1, 'lots']]))).toContain('matchtrophy-trophies-invalid');
    expect(codes(run([HEADER, [1, 12.5]]))).toContain('matchtrophy-trophies-invalid');
  });

  it('accepts numeric-looking text', () => {
    const result = run([HEADER, ['1', '60'], ['2', '-15']]);
    expect(result.issues).toEqual([]);
    expect(result.config.TrophiesByPlace).toEqual([60, -15]);
  });

  it('warns when first place gains nothing', () => {
    const result = run([HEADER, [1, 0], [2, -10]]);
    expect(codes(result)).toContain('matchtrophy-first-place-nonpositive');
    expect(errors(result)).toEqual([]);
  });

  it('warns when a lower place awards more than the place above', () => {
    const result = run([HEADER, [1, 60], [2, 70], [3, 0]]);
    expect(codes(result)).toContain('matchtrophy-not-descending');
    expect(errors(result)).toEqual([]);
    expect(result.config.TrophiesByPlace).toEqual([60, 70, 0]);
  });

  it('skips blank rows and reports an empty tab', () => {
    expect(run([HEADER, [null, null], [1, 60]]).issues).toEqual([]);
    expect(codes(run([HEADER]))).toContain('matchtrophy-empty');
  });
});

describe('the match trophy schema gate', () => {
  it('pins the root shape and whole-number values', () => {
    const gate = (config: unknown) => validateMatchTrophyConfig(config as never).map((issue) => issue.code);
    expect(gate({})).toContain('schema-root');
    expect(gate({ TrophiesByPlace: 'x' })).toContain('schema-root');
    expect(gate({ TrophiesByPlace: [] })).toContain('no-places');
    expect(gate({ TrophiesByPlace: [60, 1.5] })).toContain('schema-trophies');
    expect(gate({ TrophiesByPlace: [60, '35'] })).toContain('schema-trophies');
    expect(gate({ TrophiesByPlace: [60, 35, 0, -15] })).toEqual([]);
  });
});
