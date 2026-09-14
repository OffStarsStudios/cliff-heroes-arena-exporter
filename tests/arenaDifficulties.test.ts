import { describe, expect, it } from 'vitest';
import {
  ARENA_BOT_DIFFICULTIES,
  botLevelName,
  isArenaBotDifficulty,
  resolveDifficulty,
} from '../src/lib/arenaDifficulties';

describe('bot difficulty names', () => {
  it("covers every member of the game's BotLevel enum, in its declared order", () => {
    expect([...ARENA_BOT_DIFFICULTIES]).toEqual(['VeryEasy', 'Easy', 'Medium', 'Hard', 'VeryHard']);
  });

  it('numbers each difficulty the way the enum does', () => {
    expect(botLevelName(0)).toBe('VeryEasy');
    expect(botLevelName(4)).toBe('VeryHard');
    expect(botLevelName(5)).toBeNull();
  });

  it('accepts exact spellings', () => {
    for (const name of ARENA_BOT_DIFFICULTIES) {
      expect(resolveDifficulty(name)).toEqual({ status: 'exact', name });
    }
  });

  it('accepts case, spacing and punctuation variants, emitting the canonical name', () => {
    const variants = [
      ['very easy', 'VeryEasy'],
      ['VERYEASY', 'VeryEasy'],
      ['very hard', 'VeryHard'],
      ['VERYHARD', 'VeryHard'],
      ['Very_Hard', 'VeryHard'],
      ['very-hard', 'VeryHard'],
      ['easy', 'Easy'],
      ['  Medium  ', 'Medium'],
    ] as const;
    for (const [raw, expected] of variants) {
      expect(resolveDifficulty(raw)).toEqual({ status: 'corrected', name: expected });
    }
  });

  it('rejects misspellings and suggests the intended difficulty', () => {
    expect(resolveDifficulty('Hardd')).toEqual({ status: 'unknown', suggestion: 'Hard' });
    expect(resolveDifficulty('Mediun')).toEqual({ status: 'unknown', suggestion: 'Medium' });
    expect(resolveDifficulty('VeryHrd')).toEqual({ status: 'unknown', suggestion: 'VeryHard' });
  });

  it('rejects unknown names with no suggestion when nothing is close', () => {
    expect(resolveDifficulty('Insane')).toEqual({ status: 'unknown', suggestion: null });
    expect(resolveDifficulty('')).toEqual({ status: 'unknown', suggestion: null });
  });

  it('type-guards canonical names only', () => {
    expect(isArenaBotDifficulty('Hard')).toBe(true);
    expect(isArenaBotDifficulty('hard')).toBe(false);
    expect(isArenaBotDifficulty(3)).toBe(false);
  });
});
