import { makeNameResolver, type NameResolution } from './nameResolve';

/**
 * Every rarity name the game knows, in the order its enum declares them.
 *
 * These are the members of `Rarity` in the game. Both a hero's `Rarity` and
 * the `ReferenceRarity` and per-row `Rarity` of the upgrade cost table are
 * read into that enum, which Newtonsoft parses strictly: an unrecognised
 * spelling throws rather than falling back.
 *
 * That throw is what makes this list matter more than the other name lists.
 * `heroesSettings` and `heroUpgradeSettings` are both required configs, so the
 * failed parse is a failed config, and a failed required config holds the game
 * on its loading screen. A rarity typed "Legendry" in a sheet is a launch that
 * never finishes, which is why a rarity is refused here rather than exported
 * and left for the client to choke on.
 *
 * The order is the enum's own, and it is also the progression - `Common` is
 * the weakest - so `CostModifier` curves that are compared across rarities can
 * rely on it.
 */
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'] as const;

export type Rarity = (typeof RARITIES)[number];

export type RarityResolution = NameResolution<Rarity>;

const RESOLVER = makeNameResolver(RARITIES);

/** Resolves a rarity typed in the sheet to its canonical spelling. */
export function resolveRarity(raw: string): RarityResolution {
  return RESOLVER.resolve(raw);
}

export function isRarity(value: unknown): value is Rarity {
  return typeof value === 'string' && (RARITIES as readonly string[]).includes(value);
}
