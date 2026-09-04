import { describe, expect, it } from 'vitest';
import {
  ARENA_BOT_DIFFICULTIES,
  isArenaBotDifficulty,
  resolveDifficulty,
} from '../src/lib/arenaDifficulties';

describe('bot difficulty names', () => {
  it('covers every difficulty the live arenas config uses', () => {
    for (const name of ['Easy', 'Medium', 'Hard', 'VeryHard']) {
      expect(ARENA_BOT_DIFFICULTIES).toContain(name);
    }
  });

  it('accepts exact spellings', () => {
    for (const name of ARENA_BOT_DIFFICULTIES) {
      expect(resolveDifficulty(name)).toEqual({ status: 'exact', name });
    }
  });

  it('accepts case, spacing and punctuation variants, emitting the canonical name', () => {
    const variants = [
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
