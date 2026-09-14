import { makeNameResolver, squash, type NameResolution } from './nameResolve';

/**
 * The currencies the game holds, as the ID it keeps each one under and the name
 * it shows the player.
 *
 * Transcribed from the game's `CurrencySettings` asset. A product's `SoldIn`
 * resolves through `CurrencySettings.ResolveID`, which matches either spelling
 * case-insensitively, so both are accepted in a sheet - `hardCurrency` and
 * `Gems` are the same currency. A name that resolves to neither leaves the
 * product exactly as authored rather than being guessed at, which is why the
 * list is checked here instead of being passed through.
 */
export const CURRENCIES = [
  { id: 'coins', displayName: 'Coins' },
  { id: 'upgradeCards', displayName: 'Upgrade Cards' },
  { id: 'trophies', displayName: 'Trophies' },
  { id: 'hardCurrency', displayName: 'Gems' },
  { id: 'passTokens', displayName: 'Pass Tokens' },
] as const;

export type CurrencyId = (typeof CURRENCIES)[number]['id'];
export type CurrencyName = (typeof CURRENCIES)[number]['displayName'];

/**
 * The display name is what gets exported. Either spelling reaches the same
 * currency in the client, and the name is the readable half of the pair - it is
 * what the live `shopSettings` already carries.
 */
export const CURRENCY_NAMES = CURRENCIES.map((currency) => currency.displayName) as readonly CurrencyName[];

/**
 * How a product is paid for, where it is not paid for in a currency. `Ad` and
 * `RewardedAd` are the same thing to the client; `Ad` is what gets exported.
 */
export const SHOP_KINDS = ['RealMoney', 'Free', 'Ad'] as const;

export type ShopKind = (typeof SHOP_KINDS)[number];

/** Every `SoldIn` value a sheet may use, canonical spellings only. */
export const SHOP_SOLD_IN = [...SHOP_KINDS, ...CURRENCY_NAMES] as const;

export type ShopSoldIn = ShopKind | CurrencyName;

/**
 * Every spelling accepted, mapped to the one that gets exported.
 *
 * `RewardedAd` is the client's own second name for `Ad`, and a currency's ID is
 * its second name for itself. Both resolve, and both are folded onto one
 * spelling on the way out so the published config reads the same however the
 * sheet was written. Keyed by comparison key, so the case and spacing variants
 * come for free.
 */
const CANONICAL = new Map<string, ShopSoldIn>([
  ...SHOP_SOLD_IN.map((name) => [squash(name), name] as const),
  [squash('RewardedAd'), 'Ad' as const],
  ...CURRENCIES.map((currency) => [squash(currency.id), currency.displayName] as const),
]);

export type SoldInResolution = NameResolution<ShopSoldIn>;

const SUGGESTER = makeNameResolver(SHOP_SOLD_IN);

/**
 * Resolves a `Sold In` cell to what gets exported. An accepted second spelling
 * resolves as `corrected`, since what is published differs from what was typed
 * even though the typing was not wrong.
 */
export function resolveSoldIn(raw: string): SoldInResolution {
  const canonical = CANONICAL.get(squash(raw));
  if (canonical === undefined) return { status: 'unknown', suggestion: SUGGESTER.suggest(raw) };
  return canonical === raw ? { status: 'exact', name: canonical } : { status: 'corrected', name: canonical };
}

/** Whether this is paid for in one of the player's currencies rather than money, an ad or nothing. */
export function isCurrencySoldIn(soldIn: ShopSoldIn): soldIn is CurrencyName {
  return (CURRENCY_NAMES as readonly string[]).includes(soldIn);
}

export function isShopSoldIn(value: unknown): value is ShopSoldIn {
  return typeof value === 'string' && (SHOP_SOLD_IN as readonly string[]).includes(value);
}
