import { findColumn, resolveColumns, sheetHeaders, type ColumnSpec } from './columns';
import { resolveLookup } from './lookups';
import { makeNameResolver } from './nameResolve';
import { cellText, headerTokens, isBlank, isBlankRow, parseNumber } from './normalize';
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
 * One row per product: its ID, how it is sold, whether it is enabled and
 * listed, the fields that only some kinds of product carry (price, badge,
 * offer duration, cooldown, daily limit), and repeating `Reward N` /
 * `Amount N` pairs for what it grants. Reward names are resolved through the
 * Rewards lookup tab; IDs are never constructed from names.
 *
 * Which optional fields a product may carry follows from how it is sold:
 * gem-priced products need a price, real-money products are priced by the
 * store and must not carry one, free products need a cooldown, and ad
 * products need a daily limit. Those rules are the shape of the live config.
 */

export const SHOP_SOLD_IN = ['RealMoney', 'Gems', 'Free', 'Ad'] as const;

const SOLD_IN_RESOLVER = makeNameResolver(SHOP_SOLD_IN);

/** Product key order, exactly as the client reads it. Optional keys are omitted, not nulled. */
const PRODUCT_KEYS = [
  'ID',
  'SoldIn',
  'IsEnabled',
  'IsListed',
  'PriceInCurrency',
  'BadgeLabel',
  'OfferDurationHours',
  'CooldownHours',
  'DailyLimit',
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
  badge: ['badge label', 'badge'],
  offerHours: ['offer duration hours', 'offer duration', 'offer hours', 'duration hours'],
  cooldownHours: ['cooldown hours', 'cooldown'],
  dailyLimit: ['daily limit', 'limit per day', 'per day'],
} as const;

type FieldName = keyof typeof COLUMN_LABELS;

const TITLES: Record<FieldName, string> = {
  productId: 'Product ID',
  soldIn: 'Sold In',
  enabled: 'Enabled',
  listed: 'Listed',
  price: 'Price',
  badge: 'Badge Label',
  offerHours: 'Offer Duration Hours',
  cooldownHours: 'Cooldown Hours',
  dailyLimit: 'Daily Limit',
};

const REQUIRED_FIELDS: FieldName[] = ['productId', 'soldIn', 'enabled'];
const OPTIONAL_FIELDS: FieldName[] = ['listed', 'price', 'badge', 'offerHours', 'cooldownHours', 'dailyLimit'];

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
      const resolved = SOLD_IN_RESOLVER.resolve(soldInText);
      if (resolved.status === 'unknown') {
        const hint = resolved.suggestion === null ? `The options are ${SHOP_SOLD_IN.join(', ')}.` : `Did you mean "${resolved.suggestion}"?`;
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
    if (price.invalid || offerHours.invalid || cooldown.invalid || dailyLimit.invalid) valid = false;
    const badge = cellText(cellOf('badge'));

    if (soldIn !== null) {
      if (soldIn === 'Gems' && price.value === null && !price.invalid) {
        fail('shop-price-missing', 'Price is empty, but a product sold for gems needs one.');
      }
      if (soldIn !== 'Gems' && price.value !== null) {
        fail(
          'shop-price-unexpected',
          soldIn === 'RealMoney'
            ? 'Price is set, but real-money products are priced by the app store. Leave it empty.'
            : `Price is set, but a ${soldIn === 'Free' ? 'free' : 'rewarded-ad'} product has no price. Leave it empty.`,
        );
      }
      if (soldIn === 'Free' && cooldown.value === null && !cooldown.invalid) {
        fail('shop-cooldown-missing', 'Cooldown Hours is empty, but a free product needs one.');
      }
      if (soldIn !== 'Free' && cooldown.value !== null) {
        fail('shop-cooldown-unexpected', 'Cooldown Hours is set, but only free products have a cooldown. Leave it empty.');
      }
      if (soldIn === 'Ad' && dailyLimit.value === null && !dailyLimit.invalid) {
        fail('shop-daily-limit-missing', 'Daily Limit is empty, but a rewarded-ad product needs one.');
      }
      if (soldIn !== 'Ad' && dailyLimit.value !== null) {
        fail('shop-daily-limit-unexpected', 'Daily Limit is set, but only rewarded-ad products have one. Leave it empty.');
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

    const product: ShopProduct = { ID: id, SoldIn: soldIn, IsEnabled: enabled, Contents: contents };
    // Insert optional keys in schema order; `Contents` is re-added last.
    delete (product as Partial<ShopProduct>).Contents;
    if (listed === false) product.IsListed = false;
    if (price.value !== null) product.PriceInCurrency = price.value;
    if (badge !== null) product.BadgeLabel = badge;
    if (offerHours.value !== null) product.OfferDurationHours = offerHours.value;
    if (cooldown.value !== null) product.CooldownHours = cooldown.value;
    if (dailyLimit.value !== null) product.DailyLimit = dailyLimit.value;
    product.Contents = contents;

    products.push(product);
    preview.push({
      id,
      soldIn,
      enabled,
      listed: listed !== false,
      price: price.value,
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
