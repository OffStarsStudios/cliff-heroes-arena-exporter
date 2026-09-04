import { describe, expect, it } from 'vitest';
import arenasJson from '../config/arenas.json';
import { serializeArenasConfig, validateArenasConfig } from '../src/lib/validateArenas';
import type { ArenasConfig } from '../src/lib/types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function codes(config: unknown): string[] {
  return validateArenasConfig(config as ArenasConfig).map((issue) => issue.code);
}

describe('the arenas schema gate', () => {
  it('passes the live payload', () => {
    expect(validateArenasConfig(arenasJson as ArenasConfig)).toEqual([]);
  });

  it('requires exactly the Arenas root property', () => {
    expect(codes({})).toContain('schema-root');
    expect(codes({ Arenas: [], Extra: 1 })).toContain('schema-root');
    expect(codes({ Arenas: 'nope' })).toContain('schema-root');
  });

  it('refuses an empty arena list', () => {
    expect(codes({ Arenas: [] })).toContain('no-arenas');
  });

  it('pins the key order of every arena', () => {
    const config = { Arenas: [{ TrackCount: 15, ID: 'arena.lostoasis', BotLevels: ['Easy'] }] };
    expect(codes(config)).toContain('schema-arena-keys');
  });

  it('rejects an extra key on an arena', () => {
    const config = clone(arenasJson) as ArenasConfig & { Arenas: Record<string, unknown>[] };
    config.Arenas[0].Name = 'Lost Oasis';
    expect(codes(config)).toContain('schema-arena-keys');
  });

  it('requires a non-empty string ID, unique across arenas', () => {
    expect(codes({ Arenas: [{ ID: '', TrackCount: 1, BotLevels: ['Easy'] }] })).toContain('schema-arena-id');
    const duplicated = clone(arenasJson) as ArenasConfig;
    duplicated.Arenas[1].ID = duplicated.Arenas[0].ID;
    expect(codes(duplicated)).toContain('schema-arena-id-duplicate');
  });

  it('requires a whole-number track count of at least 1', () => {
    for (const bad of [0, -1, 2.5, '15', null]) {
      expect(codes({ Arenas: [{ ID: 'arena.x', TrackCount: bad, BotLevels: ['Easy'] }] })).toContain(
        'schema-track-count',
      );
    }
  });

  it('requires a non-empty bot list of canonical difficulty names', () => {
    expect(codes({ Arenas: [{ ID: 'arena.x', TrackCount: 1, BotLevels: [] }] })).toContain('schema-bot-levels');
    expect(codes({ Arenas: [{ ID: 'arena.x', TrackCount: 1, BotLevels: ['easy'] }] })).toContain(
      'schema-bot-level-name',
    );
    expect(codes({ Arenas: [{ ID: 'arena.x', TrackCount: 1, BotLevels: ['Easy', 3] }] })).toContain(
      'schema-bot-level-name',
    );
  });

  it('serialises pretty-printed with two-space indentation', () => {
    const text = serializeArenasConfig({ Arenas: [{ ID: 'arena.x', TrackCount: 1, BotLevels: ['Easy'] }] });
    expect(text).toBe(
      '{\n  "Arenas": [\n    {\n      "ID": "arena.x",\n      "TrackCount": 1,\n      "BotLevels": [\n        "Easy"\n      ]\n    }\n  ]\n}',
    );
  });
});
