import { makeNameResolver, type NameResolution } from './nameResolve';

/**
 * Every bot difficulty name an arena's `BotLevels` may contain.
 *
 * Transcribed from the live ConfigCat arenas config. The mapping from these
 * names to `botsSettings` levels lives only in the Unity client, so this list
 * is the strongest check available: a name the client does not know would
 * silently fall back to some default bot.
 *
 * When the game gains a difficulty, add it here. The sheet's dropdown should
 * be updated to match, but the exporter is the authority.
 */
export const ARENA_BOT_DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'VeryHard'] as const;

export type ArenaBotDifficulty = (typeof ARENA_BOT_DIFFICULTIES)[number];

export type DifficultyResolution = NameResolution<ArenaBotDifficulty>;

const RESOLVER = makeNameResolver(ARENA_BOT_DIFFICULTIES);

/** Resolves a difficulty typed in the sheet to its canonical spelling. */
export function resolveDifficulty(raw: string): DifficultyResolution {
  return RESOLVER.resolve(raw);
}

export function isArenaBotDifficulty(value: unknown): value is ArenaBotDifficulty {
  return typeof value === 'string' && (ARENA_BOT_DIFFICULTIES as readonly string[]).includes(value);
}
