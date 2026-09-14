/**
 * The price ladder every real-money purchase is charged on.
 *
 * Transcribed from `StorePriceTiers` in the game. The tier *is* the dollar
 * figure - tier 15 is fifteen dollars - and it is also the store SKU: one
 * consumable product per price point is registered on Google Play and App Store
 * Connect, and anything costing five dollars charges `tier5` whatever it hands
 * over. That is what lets a fetched config move a product's price without a
 * build, and it is why the price belongs in `shopSettings` rather than on the
 * store dashboard.
 *
 * A figure the ladder does not stock has no SKU behind it, and the client then
 * reads the product as real money with nothing to charge against: it refuses
 * the product and leaves it exactly as authored. So a tier off the ladder is an
 * error here rather than a rounding matter.
 *
 * Adding a tier is only half of it - the product has to exist on both stores
 * before anything can be priced at it - so this list only grows alongside the
 * game's own.
 */
export const PRICE_TIERS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  15, 20, 25, 30, 35, 40, 45, 50,
  60, 70, 80, 90, 100,
] as const;

export type PriceTier = (typeof PRICE_TIERS)[number];

export function isPriceTier(value: unknown): value is PriceTier {
  return typeof value === 'number' && (PRICE_TIERS as readonly number[]).includes(value);
}

/** The stocked tiers either side of a figure, for a "did you mean" hint. */
export function nearestPriceTiers(value: number): PriceTier[] {
  const below = [...PRICE_TIERS].reverse().find((tier) => tier < value);
  const above = PRICE_TIERS.find((tier) => tier > value);
  return [below, above].filter((tier): tier is PriceTier => tier !== undefined);
}
