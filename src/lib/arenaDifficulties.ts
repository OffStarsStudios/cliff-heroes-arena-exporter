import { makeNameResolver, type NameResolution } from './nameResolve';

/**
 * Every bot difficulty name an arena's `BotLevels` may contain, in the order
 * the game declares them.
 *
 * These are the members of the game's `BotLevel` enum, and the order is what
 * gives each one its number: `VeryEasy` is 0 through `VeryHard` at 4. Both
 * `arenasSettings` (which names them) and `botsSettings` (which numbers them)
 * are read into that same enum, so this list is the one vocabulary behind both.
 *
 * The game parses it strictly: a name outside this list throws inside
 * Newtonsoft rather than falling back to a default bot, and a number outside
 * it matches no authored difficulty at all.
 *
 * When the game gains a difficulty, add it here in its enum position. The
 * sheet's dropdown should be updated to match, but the exporter is the
 * authority.
 */
export const ARENA_BOT_DIFFICULTIES = ['VeryEasy', 'Easy', 'Medium', 'Hard', 'VeryHard'] as const;

export type ArenaBotDifficulty = (typeof ARENA_BOT_DIFFICULTIES)[number];

/** The name the game's `BotLevel` enum gives this number, or null past its end. */
export function botLevelName(level: number): ArenaBotDifficulty | null {
  return ARENA_BOT_DIFFICULTIES[level] ?? null;
}

export type DifficultyResolution = NameResolution<ArenaBotDifficulty>;

const RESOLVER = makeNameResolver(ARENA_BOT_DIFFICULTIES);

/** Resolves a difficulty typed in the sheet to its canonical spelling. */
export function resolveDifficulty(raw: string): DifficultyResolution {
  return RESOLVER.resolve(raw);
}

export function isArenaBotDifficulty(value: unknown): value is ArenaBotDifficulty {
  return typeof value === 'string' && (ARENA_BOT_DIFFICULTIES as readonly string[]).includes(value);
}
