import { describe, expect, it } from 'vitest';
import arenasJson from '../config/arenas.json';
import { runAnalysis } from '../src/exporters/analysis';
import { ARENAS_EXPORTER } from '../src/exporters/arenas';
import { workbookFromGrids } from './helpers';

const WORKBOOK = workbookFromGrids('arenas.xlsx', {
  Arenas: [
    ['Arena Name', 'Arena ID'],
    ['Lost Oasis', 'arena.lostoasis'],
    ['Mystic Forest', 'arena.mysticforest'],
    ['Sakura Cliffs', 'arena.sakuracliffs'],
  ],
  'Arena Settings': [
    ['Arena Name', 'Track Count', 'Bot 1 Level', 'Bot 2 Level', 'Bot 3 Level'],
    ['Lost Oasis', 15, 'Easy', 'Medium', 'Medium'],
    ['Mystic Forest', 20, 'Medium', 'Medium', 'Hard'],
    ['Sakura Cliffs', 25, 'Hard', 'Hard', 'VeryHard'],
  ],
});

describe('the generic exporter analysis', () => {
  it('reports nothing without a workbook', () => {
    expect(runAnalysis(ARENAS_EXPORTER, null, { arenas: null, settings: null })).toEqual({
      result: null,
      issues: [],
      errors: 0,
      warnings: 0,
    });
  });

  it('turns each missing tab into one error and runs nothing else', () => {
    const analysis = runAnalysis(ARENAS_EXPORTER, WORKBOOK, { arenas: 'Arenas', settings: null });
    expect(analysis.result).toBeNull();
    expect(analysis.errors).toBe(1);
    expect(analysis.issues).toEqual([
      { severity: 'error', code: 'missing-tab', message: 'Select the Arena settings tab in step 2 to continue.' },
    ]);
  });

  it('runs the definition once every tab is chosen', () => {
    const selection = ARENAS_EXPORTER.autoSelect(WORKBOOK);
    expect(selection).toEqual({ arenas: 'Arenas', settings: 'Arena Settings' });

    const analysis = runAnalysis(ARENAS_EXPORTER, WORKBOOK, selection);
    expect(analysis.errors).toBe(0);
    expect(analysis.warnings).toBe(0);
    expect(analysis.result?.config).toEqual(arenasJson);
    expect(analysis.result?.count).toBe(3);
    expect(analysis.result?.stats).toEqual([
      { label: 'Arenas', value: 3 },
      { label: 'Bots', value: 9 },
    ]);
    expect(ARENAS_EXPORTER.validate(analysis.result!.config)).toEqual([]);
  });

  it('counts lookup issues together with transform issues', () => {
    const broken = workbookFromGrids('arenas.xlsx', {
      Arenas: [
        ['Arena Name', 'Arena ID'],
        ['Lost Oasis', 'arena.lostoasis'],
        ['Lost Oasis', 'arena.oasis'],
      ],
      'Arena Settings': [
        ['Arena Name', 'Track Count', 'Bot 1 Level'],
        ['Lost Oasis', 15, 'Easy'],
      ],
    });
    const analysis = runAnalysis(ARENAS_EXPORTER, broken, ARENAS_EXPORTER.autoSelect(broken));
    expect(analysis.issues.map((issue) => issue.code)).toEqual(['lookup-ambiguous', 'arenas-id-ambiguous']);
    expect(analysis.errors).toBe(2);
    expect(analysis.result?.count).toBe(0);
  });
});
