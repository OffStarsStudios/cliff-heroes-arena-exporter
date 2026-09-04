import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import arenasJson from '../config/arenas.json';
import { findBotColumns, transformArenas } from '../src/lib/arenas';
import { buildLookup } from '../src/lib/lookups';
import { autoSelectArenaSheets, autoSelectSheets, detectDataset } from '../src/lib/sheetSelect';
import { serializeArenasConfig, validateArenasConfig } from '../src/lib/validateArenas';
import { readWorkbookBytes } from '../src/lib/workbook';
import type { ArenasTransformResult, RawCell, RawSheet } from '../src/lib/types';
import { ARENAS_SHEET, sheet, workbookFromGrids } from './helpers';

const FIXTURE = fileURLToPath(new URL('../fixtures/arenas-settings.xlsx', import.meta.url));
const TROPHY_ROAD_FIXTURE = fileURLToPath(new URL('../fixtures/arena-progression.xlsx', import.meta.url));
const HERO_FIXTURE = fileURLToPath(new URL('../fixtures/hero-stats.xlsx', import.meta.url));

const HEADER: RawCell[] = ['Arena Name', 'Track Count', 'Bot 1 Level', 'Bot 2 Level', 'Bot 3 Level'];

const LIVE_ROWS: RawCell[][] = [
  HEADER,
  ['Lost Oasis', 15, 'Easy', 'Medium', 'Medium'],
  ['Mystic Forest', 20, 'Medium', 'Medium', 'Hard'],
  ['Sakura Cliffs', 25, 'Hard', 'Hard', 'VeryHard'],
];

function run(rows: RawCell[][], lookup: RawSheet = ARENAS_SHEET): ArenasTransformResult {
  const arenas = buildLookup(lookup, 'arena');
  const result = transformArenas({ settings: sheet('Arena Settings', rows), arenas: arenas.table });
  return { ...result, issues: [...arenas.issues, ...result.issues] };
}

function codes(result: ArenasTransformResult): string[] {
  return result.issues.map((issue) => issue.code);
}

function errors(result: ArenasTransformResult): string[] {
  return result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
}

describe('the live arenas payload', () => {
  it('is reproduced exactly from the sheet rows', () => {
    const result = run(LIVE_ROWS);
    expect(errors(result)).toEqual([]);
    expect(result.config).toEqual(arenasJson);
    expect(validateArenasConfig(result.config)).toEqual([]);
  });

  it('emits keys in the order ID, TrackCount, BotLevels', () => {
    const result = run(LIVE_ROWS);
    for (const arena of result.config.Arenas) {
      expect(Object.keys(arena)).toEqual(['ID', 'TrackCount', 'BotLevels']);
    }
    expect(Object.keys(result.config)).toEqual(['Arenas']);
  });

  it('serialises to the git-tracked baseline byte for byte', () => {
    const baseline = readFileSync(fileURLToPath(new URL('../config/arenas.json', import.meta.url)), 'utf8');
    expect(serializeArenasConfig(run(LIVE_ROWS).config) + '\n').toBe(baseline.replace(/\r\n/g, '\n'));
  });

  it('counts arenas and bots', () => {
    const result = run(LIVE_ROWS);
    expect(result.stats).toEqual({ arenas: 3, bots: 9, errors: 0, warnings: 0 });
    expect(result.preview.map((row) => row.id)).toEqual([
      'arena.lostoasis',
      'arena.mysticforest',
      'arena.sakuracliffs',
    ]);
  });
});

describe('the real Arenas Settings workbook', () => {
  const workbook = readWorkbookBytes(readFileSync(FIXTURE), 'arenas-settings.xlsx');

  it('has the two expected tabs', () => {
    expect(workbook.sheets.map((tab) => tab.name)).toEqual(['Arenas', 'Arena Settings']);
  });

  it('auto-selects the lookup and the settings tab', () => {
    expect(autoSelectArenaSheets(workbook)).toEqual({ arenas: 'Arenas', settings: 'Arena Settings' });
  });

  it('is detected as an arenas workbook', () => {
    expect(detectDataset(workbook)).toBe('arenas');
  });

  it('carries the ID formula results as plain values and exports the live payload', () => {
    const selection = autoSelectArenaSheets(workbook);
    const lookupSheet = workbook.sheets.find((tab) => tab.name === selection.arenas)!;
    const settingsSheet = workbook.sheets.find((tab) => tab.name === selection.settings)!;
    const lookup = buildLookup(lookupSheet, 'arena');
    expect(lookup.issues).toEqual([]);
    expect(lookup.table.entries.map((entry) => entry.id)).toEqual([
      'arena.lostoasis',
      'arena.mysticforest',
      'arena.sakuracliffs',
    ]);
    const result = transformArenas({ settings: settingsSheet, arenas: lookup.table });
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual(arenasJson);
  });
});

describe('dataset detection stays right for the other workbooks', () => {
  it('still reads the trophy road workbook as a trophy road, despite its Arenas tab', () => {
    const workbook = readWorkbookBytes(readFileSync(TROPHY_ROAD_FIXTURE), 'arena-progression.xlsx');
    expect(detectDataset(workbook)).toBe('arena');
    expect(autoSelectArenaSheets(workbook).settings).toBeNull();
  });

  it('still reads the hero workbook as heroes, despite its Power Settings tab', () => {
    const workbook = readWorkbookBytes(readFileSync(HERO_FIXTURE), 'hero-stats.xlsx');
    expect(detectDataset(workbook)).toBe('heroes');
    expect(autoSelectArenaSheets(workbook).settings).toBeNull();
  });

  it('does not let the settings tab pose as the trophy-road Arenas lookup', () => {
    const workbook = workbookFromGrids('arenas.xlsx', {
      Arenas: [
        ['Arena Name', 'Arena ID'],
        ['Lost Oasis', 'arena.lostoasis'],
      ],
      'Arena Settings': LIVE_ROWS,
    });
    expect(autoSelectArenaSheets(workbook)).toEqual({ arenas: 'Arenas', settings: 'Arena Settings' });
    // The trophy-road selector should also pick the lookup, never the settings tab.
    expect(autoSelectSheets(workbook).arenas).toBe('Arenas');
  });
});

describe('header variants', () => {
  it('accepts alternative spellings of the fixed columns', () => {
    const rows: RawCell[][] = [
      ['Arena', 'Tracks', 'Bot Level 1', 'Bot 2', 'Bot 3 Difficulty'],
      ['Lost Oasis', 15, 'Easy', 'Medium', 'Medium'],
    ];
    const result = run(rows);
    expect(errors(result)).toEqual([]);
    expect(result.config.Arenas[0]).toEqual({ ID: 'arena.lostoasis', TrackCount: 15, BotLevels: ['Easy', 'Medium', 'Medium'] });
  });

  it('reads bot columns in numeric order however the sheet orders them', () => {
    const rows: RawCell[][] = [
      ['Arena Name', 'Bot 3 Level', 'Track Count', 'Bot 1 Level', 'Bot 2 Level'],
      ['Lost Oasis', 'Hard', 15, 'Easy', 'Medium'],
    ];
    const result = run(rows);
    expect(errors(result)).toEqual([]);
    expect(result.config.Arenas[0].BotLevels).toEqual(['Easy', 'Medium', 'Hard']);
  });

  it('ignores unrelated columns that happen to mention bots or numbers', () => {
    const issues: never[] = [];
    const columns = findBotColumns(
      ['Arena Name', 'Track Count', 'Bot 1 Level', 'Bot 2 Level', 'Bot count', 'Match Duration 2', 'Notes'],
      issues,
    );
    expect(columns.map((column) => column.number)).toEqual([1, 2]);
  });

  it('warns when bot columns are numbered with a gap', () => {
    const rows: RawCell[][] = [
      ['Arena Name', 'Track Count', 'Bot 1 Level', 'Bot 3 Level'],
      ['Lost Oasis', 15, 'Easy', 'Medium'],
    ];
    const result = run(rows);
    expect(codes(result)).toContain('arenas-bot-column-numbering');
    expect(errors(result)).toEqual([]);
    expect(result.config.Arenas[0].BotLevels).toEqual(['Easy', 'Medium']);
  });

  it('reports a missing fixed column by name', () => {
    const rows: RawCell[][] = [
      ['Arena Name', 'Bot 1 Level'],
      ['Lost Oasis', 'Easy'],
    ];
    const result = run(rows);
    expect(codes(result)).toContain('arenas-missing-column');
    expect(errors(result).join(' ')).toContain('"Track Count"');
  });

  it('reports the absence of any bot column', () => {
    const rows: RawCell[][] = [
      ['Arena Name', 'Track Count'],
      ['Lost Oasis', 15],
    ];
    const result = run(rows);
    expect(errors(result).join(' ')).toContain('no bot level columns');
    expect(result.config.Arenas).toEqual([]);
  });
});

describe('row validation', () => {
  it('rejects an arena the lookup tab does not define', () => {
    const rows: RawCell[][] = [HEADER, ['Frozen Peak', 25, 'Hard', 'Hard', 'Hard']];
    const result = run(rows);
    expect(codes(result)).toContain('arenas-id-missing');
    expect(errors(result)[0]).toContain('"Frozen Peak" has no entry on the Arenas tab');
    expect(result.issues[0].sheetRow).toBe(2);
  });

  it('rejects an arena whose name maps to two IDs', () => {
    const lookup = sheet('Arenas', [
      ['Arena Name', 'ArenaID'],
      ['Lost Oasis', 'arena.lostoasis'],
      ['lost oasis', 'arena.oasis'],
    ]);
    const result = run([HEADER, ['Lost Oasis', 15, 'Easy', 'Medium', 'Medium']], lookup);
    expect(codes(result)).toContain('arenas-id-ambiguous');
  });

  it('rejects an arena configured twice', () => {
    const rows: RawCell[][] = [
      HEADER,
      ['Lost Oasis', 15, 'Easy', 'Medium', 'Medium'],
      ['lost oasis', 20, 'Easy', 'Medium', 'Medium'],
    ];
    const result = run(rows);
    expect(codes(result)).toContain('arenas-duplicate');
    expect(errors(result)[0]).toContain('rows 2 and 3');
    expect(result.config.Arenas).toHaveLength(1);
  });

  it('rejects two names that resolve to the same ID', () => {
    const lookup = sheet('Arenas', [
      ['Arena Name', 'ArenaID'],
      ['Lost Oasis', 'arena.lostoasis'],
      ['Oasis', 'arena.lostoasis'],
    ]);
    const result = run(
      [HEADER, ['Lost Oasis', 15, 'Easy', 'Medium', 'Medium'], ['Oasis', 20, 'Easy', 'Medium', 'Medium']],
      lookup,
    );
    expect(codes(result)).toContain('arenas-duplicate');
    expect(result.config.Arenas).toHaveLength(1);
  });

  it('warns about an ID that does not follow the arena.<name> pattern', () => {
    const lookup = sheet('Arenas', [
      ['Arena Name', 'ArenaID'],
      ['Lost Oasis', 'Arena.Lost Oasis'],
    ]);
    const result = run([HEADER, ['Lost Oasis', 15, 'Easy', 'Medium', 'Medium']], lookup);
    expect(codes(result)).toContain('arenas-id-format');
    expect(errors(result)).toEqual([]);
    expect(result.config.Arenas[0].ID).toBe('Arena.Lost Oasis');
  });

  it('rejects a blank track count', () => {
    const result = run([HEADER, ['Lost Oasis', null, 'Easy', 'Medium', 'Medium']]);
    expect(codes(result)).toContain('arenas-track-count-missing');
  });

  it('rejects a non-numeric, fractional or zero track count', () => {
    for (const bad of ['many', 25.5, 0, -3]) {
      const result = run([HEADER, ['Lost Oasis', bad, 'Easy', 'Medium', 'Medium']]);
      expect(codes(result)).toContain('arenas-track-count-invalid');
      expect(result.config.Arenas).toEqual([]);
    }
  });

  it('accepts a numeric-looking text track count', () => {
    const result = run([HEADER, ['Lost Oasis', '15', 'Easy', 'Medium', 'Medium']]);
    expect(errors(result)).toEqual([]);
    expect(result.config.Arenas[0].TrackCount).toBe(15);
  });

  it('rejects an arena with no bots at all', () => {
    const result = run([HEADER, ['Lost Oasis', 15, null, null, null]]);
    expect(codes(result)).toContain('arenas-no-bots');
  });

  it('allows trailing blank bot columns, so arenas can run fewer bots', () => {
    const result = run([HEADER, ['Lost Oasis', 15, 'Easy', 'Medium', null]]);
    expect(errors(result)).toEqual([]);
    expect(result.config.Arenas[0].BotLevels).toEqual(['Easy', 'Medium']);
  });

  it('rejects a gap between bot columns', () => {
    const result = run([HEADER, ['Lost Oasis', 15, 'Easy', null, 'Medium']]);
    expect(codes(result)).toContain('arenas-bot-level-gap');
    expect(errors(result)[0]).toContain('"Bot 2 Level" is empty but "Bot 3 Level" is set');
  });

  it('rejects an unknown difficulty and suggests the intended one', () => {
    const result = run([HEADER, ['Lost Oasis', 15, 'Easy', 'Hardd', 'Medium']]);
    expect(codes(result)).toContain('arenas-difficulty-unknown');
    expect(errors(result)[0]).toContain('Did you mean "Hard"?');
    expect(result.config.Arenas).toEqual([]);
  });

  it('lists the accepted names when nothing is close', () => {
    const result = run([HEADER, ['Lost Oasis', 15, 'Insane', 'Medium', 'Medium']]);
    expect(errors(result)[0]).toContain('Easy, Medium, Hard, VeryHard');
  });

  it('accepts a differently spelled difficulty with a warning, exporting the canonical name', () => {
    const result = run([HEADER, ['Lost Oasis', 15, 'easy', 'Very Hard', 'MEDIUM']]);
    expect(errors(result)).toEqual([]);
    expect(codes(result).filter((code) => code === 'arenas-difficulty-spelling')).toHaveLength(3);
    expect(result.config.Arenas[0].BotLevels).toEqual(['Easy', 'VeryHard', 'Medium']);
  });

  it('warns when arenas run different numbers of bots', () => {
    const result = run([
      HEADER,
      ['Lost Oasis', 15, 'Easy', 'Medium', 'Medium'],
      ['Mystic Forest', 20, 'Medium', 'Medium', null],
    ]);
    expect(codes(result)).toContain('arenas-bot-count-uneven');
    expect(errors(result)).toEqual([]);
  });

  it('warns about a lookup arena with no settings row', () => {
    const result = run([HEADER, ['Lost Oasis', 15, 'Easy', 'Medium', 'Medium']]);
    const unused = result.issues.filter((issue) => issue.code === 'arenas-unused-lookup');
    expect(unused.map((issue) => issue.message)).toEqual([
      expect.stringContaining('"Mystic Forest" (arena.mysticforest)'),
      expect.stringContaining('"Sakura Cliffs" (arena.sakuracliffs)'),
    ]);
    expect(errors(result)).toEqual([]);
  });

  it('rejects a row with values but no name', () => {
    const result = run([HEADER, [null, 15, 'Easy', 'Medium', 'Medium']]);
    expect(codes(result)).toContain('arenas-name-missing');
  });

  it('skips entirely blank rows silently', () => {
    const result = run([HEADER, [null, null, null, null, null], ['Lost Oasis', 15, 'Easy', 'Medium', 'Medium']]);
    expect(errors(result)).toEqual([]);
    expect(result.config.Arenas).toHaveLength(1);
  });

  it('reports an empty settings tab', () => {
    const result = run([HEADER]);
    expect(codes(result)).toContain('arenas-empty');
  });
});
