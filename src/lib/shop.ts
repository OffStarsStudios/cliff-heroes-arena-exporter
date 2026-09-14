import { findColumn, resolveColumns, sheetHeaders, type ColumnSpec } from './columns';
import { CURRENCY_NAMES, SHOP_SOLD_IN, isCurrencySoldIn, resolveSoldIn } from './currencies';
import { resolveLookup } from './lookups';
import { cellText, headerTokens, isBlank, isBlankRow, parseNumber } from './normalize';
import { PRICE_TIERS, isPriceTier, nearestPriceTiers } from './priceTiers';
import type {
  Issue,
  LookupTable,
  RawCell,
  RawSheet,
  ShopConfig,
  ShopContent,
  ShopPreviewRow,
  ShopProduct,
  ShopSoldIn,
  ShopTransformResult,
} from './types';

/**
 * Turns the Products tab into `shopSettings`.
 *
 * One row per product: its ID, how it is sold, what it costs, whether it is
 * enabled and listed, the presentation and limit fields, and repeating
 * `Reward N` / `Amount N` pairs for what it grants. Reward names are resolved
 * through the Rewards lookup tab; IDs are never constructed from names.
 *
 * **What a product costs is authored here, real money included.** A dollar
 * price travels as `Price Tier`: the tier is the dollar figure and also the
 * store SKU, since one consumable product per price point is registered on the
 * stores and everything costing five dollars charges the same `tier5`. Nothing
 * about a price lives on the store dashboard, so a real-money product exported
 * without a tier is one the client cannot charge for and refuses outright.
 *
 * The client applies each field on its own and only when present, so a product
 * may carry both a dollar tier and a currency price - that is how it is moved
 * between the two without re-sending it. What it may not do is name a way of
 * paying with no price behind it, and those two pairings are all this checks.
 */

export { SHOP_SOLD_IN };

/** Product key order, exactly as the live config carries it. Optional keys are omitted, not nulled. */
const PRODUCT_KEYS = [
  'ID',
  'SoldIn',
  'PriceTier',
  'IsEnabled',
  'IsListed',
  'PriceInCurrency',
  'BadgeLabel',
  'OfferDurationHours',
  'CooldownHours',
  'DailyLimit',
  'SortOverride',
  'Contents',
] as const;

/** IDs the game reads verbatim; the convention is `shop.<kind>.<name>[.<variant>]`. */
const ID_PATTERN = /^shop\.[a-z0-9]+(\.[a-z0-9]+)+$/;

/* -------------------------------------------------------------- columns -- */

const COLUMN_LABELS = {
  productId: ['product id', 'id', 'product', 'shop id'],
  soldIn: ['sold in', 'sold', 'payment', 'currency', 'purchase type'],
  enabled: ['enabled', 'is enabled', 'active'],
  listed: ['listed', 'is listed', 'visible', 'shown'],
  price: ['price', 'price in currency', 'price in gems', 'gems price', 'gem price'],
  priceTier: ['price tier', 'tier', 'dollars', 'usd', 'price usd', 'dollar price'],
  badge: ['badge label', 'badge'],
  offerHours: ['offer duration hours', 'offer duration', 'offer hours', 'duration hours'],
  cooldownHours: ['cooldown hours', 'cooldown'],
  dailyLimit: ['daily limit', 'limit per day', 'per day'],
  sortOverride: ['sort override', 'sort', 'sort order', 'order'],
} as const;

type FieldName = keyof typeof COLUMN_LABELS;

const TITLES: Record<FieldName, string> = {
  productId: 'Product ID',
  soldIn: 'Sold In',
  enabled: 'Enabled',
  listed: 'Listed',
  price: 'Price',
  priceTier: 'Price Tier',
  badge: 'Badge Label',
  offerHours: 'Offer Duration Hours',
  cooldownHours: 'Cooldown Hours',
  dailyLimit: 'Daily Limit',
  sortOverride: 'Sort Override',
};

const REQUIRED_FIELDS: FieldName[] = ['productId', 'soldIn', 'enabled'];
const OPTIONAL_FIELDS: FieldName[] = [
  'listed',
  'price',
  'priceTier',
  'badge',
  'offerHours',
  'cooldownHours',
  'dailyLimit',
  'sortOverride',
];

const COLUMN_SPEC: ColumnSpec<FieldName> = {
  labels: COLUMN_LABELS,
  titles: TITLES,
  missingCode: 'shop-missing-column',
};

export interface RewardSlotColumns {
  nameIndex: number;
  amountIndex: number | null;
  label: string;
}

/**
 * Finds the `Reward N` / `Amount N` pairs. Numbered headers pair by number;
 * unnumbered ones pair each reward column with the amount column after it.
 */
export function findRewardSlots(headers: string[]): RewardSlotColumns[] {
  const rewards: { index: number; number: number | null; header: string }[] = [];
  const amounts: { index: number; number: number | null }[] = [];
  headers.forEach((header, index) => {
    const tokens = headerTokens(header);
    if (tokens.length === 0) return;
    const words = tokens.filter((token) => !/^\d+$/.test(token));
    const numbers = tokens.filter((token) => /^\d+$/.test(token));
    if (numbers.length > 1) return;
    const number = numbers.length === 1 ? Number(numbers[0]) : null;
    if (words.length === 1 && (words[0] === 'reward' || words[0] === 'rewards')) {
      rewards.push({ index, number, header });
    } else if (
      (words.length === 1 && words[0] === 'amount') ||
      (words.length === 2 && words[0] === 'reward' && words[1] === 'amount')
    ) {
      amounts.push({ index, number });
    }
  });

  const used = new Set<number>();
  return rewards.map((reward) => {
    let amount = reward.number === null ? undefined : amounts.find((a) => a.number === reward.number && !used.has(a.index));
    if (amount === undefined) {
      amount = amounts.find((a) => a.index > reward.index && !used.has(a.index));
    }
    if (amount !== undefined) used.add(amount.index);
    return { nameIndex: reward.index, amountIndex: amount?.index ?? null, label: reward.header };
  });
}

/* ---------------------------------------------------------------- cells -- */

function parseBoolean(cell: RawCell): boolean | null {
  if (typeof cell === 'boolean') return cell;
  const text = cellText(cell);
  if (text === null) return null;
  const lowered = text.toLowerCase();
  if (['true', 'yes', 'y', 'on', '1'].includes(lowered)) return true;
  if (['false', 'no', 'n', 'off', '0'].includes(lowered)) return false;
  return null;
}

interface RowContext {
  where: string;
  sheetRow: number;
  issues: Issue[];
}

/** An optional number cell: null when blank, or the number, or `invalid`. */
function optionalNumber(
  cell: RawCell,
  what: string,
  check: (value: number) => string | null,
  code: string,
  context: RowContext,
): { value: number | null; invalid: boolean } {
  if (isBlank(cell)) return { value: null, invalid: false };
  const parsed = parseNumber(cell);
  const problem = parsed.ok ? check(parsed.value) : `must be a number, not ${JSON.stringify(cell)}.`;
  if (problem !== null) {
    context.issues.push({ severity: 'error', code, message: `${context.where}: ${what} ${problem}`, sheetRow: context.sheetRow });
    return { value: null, invalid: true };
  }
  return { value: parsed.value, invalid: false };
}

const positive = (value: number) => (value > 0 ? null : `must be greater than 0, not ${value}.`);
const wholeAtLeastOne = (value: number) =>
  Number.isInteger(value) && value >= 1 ? null : `must be a whole number of 1 or more, not ${value}.`;
const wholeAtLeastZero = (value: number) =>
  Number.isInteger(value) && value >= 0 ? null : `must be a whole number of 0 or more, not ${value}.`;
const anyNumber = () => null;
/**
 * A tier off the ladder has no SKU registered behind it, and the client then
 * reads the product as real money with nothing to charge against and refuses
 * it - so an unstocked figure is worse than a merely wrong one.
 */
const onThePriceLadder = (value: number) => {
  if (isPriceTier(value)) return null;
  const near = nearestPriceTiers(value);
  const hint = near.length > 0 ? ` The nearest stocked prices are $${near.join(' and $')}.` : '';
  return `must be one of the dollar prices the stores stock (${PRICE_TIERS.join(', ')}), not ${value}.${hint}`;
};

/* ------------------------------------------------------------- transform -- */

export interface ShopTransformInput {
  /** The Products tab. */
  products: RawSheet;
  /** Reward name -> reward ID, built from the Rewards lookup tab. */
  rewards: LookupTable;
}

/** Builds the shop config. Product order follows the sheet. */
export function transformShop(input: ShopTransformInput): ShopTransformResult {
  const issues: Issue[] = [];
  const sheet = input.products;
  const tab = `"${sheet.name}" tab`;

  const { index } = resolveColumns(sheet, REQUIRED_FIELDS, COLUMN_SPEC, issues);
  const headers = sheetHeaders(sheet);
  for (const field of OPTIONAL_FIELDS) {
    const found = findColumn(headers, COLUMN_LABELS[field]);
    if (found !== -1) index[field] = found;
  }
  const slots = findRewardSlots(headers);
  if (slots.length === 0) {
    issues.push({
      severity: 'error',
      code: 'shop-missing-column',
      message: `The ${tab} has no reward columns. Expected headers such as "Reward 1" and "Amount 1".`,
    });
  }
  for (const slot of slots) {
    if (slot.amountIndex === null) {
      issues.push({
        severity: 'error',
        code: 'shop-missing-column',
        message: `The ${tab} has a "${slot.label}" column with no matching amount column beside it.`,
      });
    }
  }

  const products: ShopProduct[] = [];
  const preview: ShopPreviewRow[] = [];
  const rowsById = new Map<string, number>();
  let dataRows = 0;

  for (let r = 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const sheetRow = r + 1;
    if (isBlankRow(row)) continue;
    dataRows += 1;

    const id = index.productId === undefined ? null : cellText(row[index.productId]);
    if (id === null) {
      if (index.productId !== undefined) {
        issues.push({
          severity: 'error',
          code: 'shop-id-missing',
          message: `Row ${sheetRow} of the ${tab} has values but no product ID.`,
          sheetRow,
        });
      }
      continue;
    }
    const where = `"${id}" on the ${tab}`;
    const context: RowContext = { where, sheetRow, issues };

    const earlier = rowsById.get(id);
    if (earlier !== undefined) {
      issues.push({
        severity: 'error',
        code: 'shop-id-duplicate',
        message: `${where} appears twice (rows ${earlier} and ${sheetRow}). Each product is listed once.`,
        sheetRow,
      });
      continue;
    }
    rowsById.set(id, sheetRow);
    if (!ID_PATTERN.test(id)) {
      issues.push({
        severity: 'warning',
        code: 'shop-id-format',
        message: `${where} does not follow the shop.<kind>.<name> pattern (lowercase letters and digits). The store and the pass look products up by exact ID.`,
        sheetRow,
      });
    }

    let valid = true;
    const fail = (code: string, message: string) => {
      issues.push({ severity: 'error', code, message: `${where}: ${message}`, sheetRow });
      valid = false;
    };

    // Sold in
    let soldIn: ShopSoldIn | null = null;
    const soldInText = index.soldIn === undefined ? null : cellText(row[index.soldIn]);
    if (soldInText === null) {
      if (index.soldIn !== undefined) fail('shop-sold-in-missing', 'Sold In is empty.');
    } else {
      const resolved = resolveSoldIn(soldInText);
      if (resolved.status === 'unknown') {
        const hint =
          resolved.suggestion === null
            ? `The options are ${SHOP_SOLD_IN.join(', ')} - either a way of paying or one of the player's currencies.`
            : `Did you mean "${resolved.suggestion}"?`;
        fail('shop-sold-in-unknown', `"${soldInText}" is not a way the store sells things. ${hint}`);
      } else {
        soldIn = resolved.name;
        if (resolved.status === 'corrected') {
          issues.push({
            severity: 'warning',
            code: 'shop-sold-in-spelling',
            message: `${where}: "${soldInText}" is spelled differently from the schema and is exported as "${resolved.name}".`,
            sheetRow,
          });
        }
      }
    }

    // Enabled / listed
    let enabled: boolean | null = null;
    if (index.enabled !== undefined) {
      const cell = row[index.enabled] ?? null;
      enabled = parseBoolean(cell);
      if (enabled === null) fail('shop-enabled-invalid', isBlank(cell) ? 'Enabled is empty. Use TRUE or FALSE.' : `Enabled must be TRUE or FALSE, not ${JSON.stringify(cell)}.`);
    }
    let listed: boolean | null = null;
    if (index.listed !== undefined) {
      const cell = row[index.listed] ?? null;
      if (!isBlank(cell)) {
        listed = parseBoolean(cell);
        if (listed === null) fail('shop-listed-invalid', `Listed must be TRUE or FALSE, not ${JSON.stringify(cell)}.`);
      }
    }

    // Numbers that only some kinds carry
    const cellOf = (field: FieldName): RawCell => (index[field] === undefined ? null : (row[index[field] as number] ?? null));
    const price = optionalNumber(cellOf('price'), 'Price', wholeAtLeastZero, 'shop-price-invalid', context);
    const offerHours = optionalNumber(cellOf('offerHours'), 'Offer Duration Hours', positive, 'shop-offer-hours-invalid', context);
    const cooldown = optionalNumber(cellOf('cooldownHours'), 'Cooldown Hours', positive, 'shop-cooldown-invalid', context);
    const dailyLimit = optionalNumber(cellOf('dailyLimit'), 'Daily Limit', wholeAtLeastOne, 'shop-daily-limit-invalid', context);
    const priceTier = optionalNumber(cellOf('priceTier'), 'Price Tier', onThePriceLadder, 'shop-price-tier-invalid', context);
    const sortOverride = optionalNumber(cellOf('sortOverride'), 'Sort Override', anyNumber, 'shop-sort-override-invalid', context);
    if (price.invalid || offerHours.invalid || cooldown.invalid || dailyLimit.invalid) valid = false;
    if (priceTier.invalid || sortOverride.invalid) valid = false;
    const badge = cellText(cellOf('badge'));

    // The only rule the client actually has: whatever a product is sold in must
    // have a price behind it, or there is nothing to charge and the product is
    // refused outright. Every other field is applied on its own, so a dollar
    // tier beside a gem price - the pass premium is exactly that - is allowed.
    if (soldIn !== null) {
      if (soldIn === 'RealMoney' && priceTier.value === null && !priceTier.invalid) {
        fail(
          'shop-price-tier-missing',
          'Price Tier is empty, but a product sold for real money is charged through the tier - it is both the dollar price and the store SKU. Without one the game cannot sell it.',
        );
      }
      if (isCurrencySoldIn(soldIn) && price.value === null && !price.invalid) {
        fail('shop-price-missing', `Price is empty, but a product sold for ${soldIn} needs one.`);
      }
      if (!isCurrencySoldIn(soldIn) && price.value !== null) {
        fail(
          'shop-price-unexpected',
          `Price is set, but "${soldIn}" is not one of the currencies the player holds (${CURRENCY_NAMES.join(', ')}), so there is nothing for the figure to be in. Set Price Tier for a dollar price, or leave Price empty.`,
        );
      }
      if (soldIn === 'Free' && cooldown.value === null && !cooldown.invalid) {
        issues.push({
          severity: 'warning',
          code: 'shop-cooldown-missing',
          message: `${where}: Cooldown Hours is empty, so nothing here caps how often a free product is claimed and the value compiled into the build stands.`,
          sheetRow,
        });
      }
      if (soldIn === 'Ad' && dailyLimit.value === null && !dailyLimit.invalid) {
        issues.push({
          severity: 'warning',
          code: 'shop-daily-limit-missing',
          message: `${where}: Daily Limit is empty, so a rewarded-ad product has no cap beyond what the build was compiled with.`,
          sheetRow,
        });
      }
    }

    // Contents
    const contents: ShopContent[] = [];
    const contentLabels: string[] = [];
    const seenRewards = new Set<string>();
    for (const slot of slots) {
      const name = cellText(row[slot.nameIndex] ?? null);
      const amountCell = slot.amountIndex === null ? null : (row[slot.amountIndex] ?? null);
      if (name === null) {
        if (!isBlank(amountCell)) {
          fail('shop-reward-orphan-amount', `"${slot.label}" is empty but its amount is ${JSON.stringify(amountCell)}. Name the reward or clear the amount.`);
        }
        continue;
      }
      const resolved = resolveLookup(input.rewards, name);
      if (!resolved.ok) {
        fail(
          resolved.reason === 'ambiguous' ? 'shop-reward-ambiguous' : 'shop-reward-unknown',
          resolved.reason === 'ambiguous'
            ? `"${name}" appears more than once on the Rewards tab with different IDs (${(resolved.candidates ?? []).join(', ')}).`
            : `"${name}" in "${slot.label}" has no entry on the Rewards tab, so there is no Reward ID to export.`,
        );
        continue;
      }
      if (seenRewards.has(resolved.id)) {
        fail('shop-reward-duplicate', `"${name}" is granted twice by the same product. Add the amounts together instead.`);
        continue;
      }
      if (isBlank(amountCell)) {
        fail('shop-reward-amount-missing', `"${slot.label}" names ${name} but its amount is empty.`);
        continue;
      }
      const parsed = parseNumber(amountCell);
      const problem = parsed.ok ? wholeAtLeastOne(parsed.value) : `must be a number, not ${JSON.stringify(amountCell)}.`;
      if (problem !== null) {
        fail('shop-reward-amount-invalid', `the amount of ${name} ${problem}`);
        continue;
      }
      seenRewards.add(resolved.id);
      contents.push({ RewardID: resolved.id, Amount: parsed.value });
      contentLabels.push(`${name} x${parsed.value}`);
    }
    if (contents.length === 0 && valid) {
      issues.push({
        severity: 'warning',
        code: 'shop-no-contents',
        message: `${where} grants nothing. That is fine for a pass or a placeholder, but a purchase would give the player nothing.`,
        sheetRow,
      });
    }

    if (!valid || soldIn === null || enabled === null) continue;

    // Built up in the order the live config carries, since `PriceTier` sits
    // between two of the always-present keys: what a product is sold in, then
    // what it costs, then whether it is on sale at all.
    const product: ShopProduct = { ID: id, SoldIn: soldIn } as ShopProduct;
    if (priceTier.value !== null) product.PriceTier = priceTier.value;
    product.IsEnabled = enabled;
    if (listed === false) product.IsListed = false;
    if (price.value !== null) product.PriceInCurrency = price.value;
    if (badge !== null) product.BadgeLabel = badge;
    if (offerHours.value !== null) product.OfferDurationHours = offerHours.value;
    if (cooldown.value !== null) product.CooldownHours = cooldown.value;
    if (dailyLimit.value !== null) product.DailyLimit = dailyLimit.value;
    if (sortOverride.value !== null) product.SortOverride = sortOverride.value;
    product.Contents = contents;

    products.push(product);
    preview.push({
      id,
      soldIn,
      enabled,
      listed: listed !== false,
      price: price.value,
      priceTier: priceTier.value,
      badge,
      contents: contentLabels,
      sheetRow,
    });
  }

  if (dataRows === 0) {
    issues.push({ severity: 'error', code: 'shop-empty', message: `The ${tab} contains no product rows.` });
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const config: ShopConfig = { Products: products };
  return {
    config,
    preview,
    issues,
    stats: {
      products: products.length,
      enabled: products.filter((product) => product.IsEnabled).length,
      contents: products.reduce((sum, product) => sum + product.Contents.length, 0),
      errors,
      warnings: issues.length - errors,
    },
  };
}

/** The product key order, exported for the schema gate. */
export const SHOP_PRODUCT_KEYS: readonly string[] = PRODUCT_KEYS;
