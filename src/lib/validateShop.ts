import { SHOP_PRODUCT_KEYS, SHOP_SOLD_IN } from './shop';
import type { Issue, ShopConfig } from './types';

const CONTENT_KEYS = ['RewardID', 'Amount'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** True when `keys` is `expected` with some entries left out, in the same order. */
function inSchemaOrder(keys: string[], expected: readonly string[]): boolean {
  let cursor = 0;
  for (const key of keys) {
    const at = expected.indexOf(key, cursor);
    if (at === -1) return false;
    cursor = at + 1;
  }
  return true;
}

/**
 * Final gate before export: re-checks the generated object against the exact
 * output schema, including property order. Deliberately independent of the
 * transformer so a regression there cannot ship a malformed config.
 */
export function validateShopConfig(config: ShopConfig): Issue[] {
  const issues: Issue[] = [];

  const rootKeys = Object.keys(config);
  if (rootKeys.length !== 1 || rootKeys[0] !== 'Products') {
    issues.push({
      severity: 'error',
      code: 'schema-root',
      message: `The root object must contain exactly one property, "Products" (found: ${rootKeys.join(', ') || 'none'}).`,
    });
    return issues;
  }

  const products = config.Products as unknown;
  if (!Array.isArray(products)) {
    issues.push({ severity: 'error', code: 'schema-root', message: '"Products" must be an array.' });
    return issues;
  }
  if (products.length === 0) {
    issues.push({ severity: 'error', code: 'no-products', message: 'The generated config lists no products.' });
  }

  const seen = new Set<string>();
  products.forEach((product, index) => {
    const position = `Product ${index + 1}`;
    const record = product as Record<string, unknown>;
    const keys = Object.keys(record);

    for (const required of ['ID', 'SoldIn', 'IsEnabled', 'Contents']) {
      if (!(required in record)) {
        issues.push({ severity: 'error', code: 'schema-product-keys', message: `${position}: "${required}" is missing.` });
      }
    }
    if (!inSchemaOrder(keys, SHOP_PRODUCT_KEYS)) {
      issues.push({
        severity: 'error',
        code: 'schema-product-keys',
        message: `${position}: keys must follow the order [${SHOP_PRODUCT_KEYS.join(', ')}] with unused ones omitted (found: ${keys.join(', ')}).`,
      });
    }

    if (!isNonEmptyString(record.ID)) {
      issues.push({ severity: 'error', code: 'schema-product-id', message: `${position}: "ID" must be a non-empty string.` });
    } else if (seen.has(record.ID)) {
      issues.push({ severity: 'error', code: 'schema-product-id-duplicate', message: `${position}: "${record.ID}" is listed more than once.` });
    } else {
      seen.add(record.ID);
    }

    if (!(SHOP_SOLD_IN as readonly unknown[]).includes(record.SoldIn)) {
      issues.push({
        severity: 'error',
        code: 'schema-sold-in',
        message: `${position}: "SoldIn" must be one of ${SHOP_SOLD_IN.join(', ')}, not ${JSON.stringify(record.SoldIn)}.`,
      });
    }
    if (typeof record.IsEnabled !== 'boolean') {
      issues.push({ severity: 'error', code: 'schema-enabled', message: `${position}: "IsEnabled" must be true or false.` });
    }
    if ('IsListed' in record && record.IsListed !== false) {
      issues.push({ severity: 'error', code: 'schema-listed', message: `${position}: "IsListed" is only written when false; omit it otherwise.` });
    }
    for (const key of ['PriceInCurrency', 'OfferDurationHours', 'CooldownHours', 'DailyLimit']) {
      if (key in record && !isFiniteNumber(record[key])) {
        issues.push({ severity: 'error', code: 'schema-product-number', message: `${position}: "${key}" must be a number, not ${JSON.stringify(record[key])}.` });
      }
    }
    if ('BadgeLabel' in record && !isNonEmptyString(record.BadgeLabel)) {
      issues.push({ severity: 'error', code: 'schema-badge', message: `${position}: "BadgeLabel" must be a non-empty string when present.` });
    }

    const contents = record.Contents;
    if (!Array.isArray(contents)) {
      issues.push({ severity: 'error', code: 'schema-contents', message: `${position}: "Contents" must be an array.` });
      return;
    }
    contents.forEach((content, contentIndex) => {
      const entry = content as Record<string, unknown>;
      const entryKeys = Object.keys(entry);
      if (entryKeys.length !== CONTENT_KEYS.length || entryKeys.some((key, i) => key !== CONTENT_KEYS[i])) {
        issues.push({
          severity: 'error',
          code: 'schema-content-keys',
          message: `${position}, content ${contentIndex + 1}: must contain exactly [${CONTENT_KEYS.join(', ')}] (found: ${entryKeys.join(', ')}).`,
        });
      }
      if (!isNonEmptyString(entry.RewardID)) {
        issues.push({ severity: 'error', code: 'schema-content-id', message: `${position}, content ${contentIndex + 1}: "RewardID" must be a non-empty string.` });
      }
      if (!(isFiniteNumber(entry.Amount) && Number.isInteger(entry.Amount) && entry.Amount >= 1)) {
        issues.push({
          severity: 'error',
          code: 'schema-content-amount',
          message: `${position}, content ${contentIndex + 1}: "Amount" must be a whole number of 1 or more, not ${JSON.stringify(entry.Amount)}.`,
        });
      }
    });
  });

  return issues;
}

/** Pretty-prints the config exactly as it should be written to disk. */
export function serializeShopConfig(config: ShopConfig): string {
  return JSON.stringify(config, null, 2);
}
