import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import shopJson from '../config/shop.json';
import { runAnalysis } from '../src/exporters/analysis';
import { SHOP_EXPORTER } from '../src/exporters/shop';
import { buildLookup } from '../src/lib/lookups';
import { autoSelectShopSheets, detectDataset } from '../src/lib/sheetSelect';
import { findRewardSlots, transformShop } from '../src/lib/shop';
import { serializeShopConfig, validateShopConfig } from '../src/lib/validateShop';
import { readWorkbookBytes } from '../src/lib/workbook';
import type { RawCell, RawSheet, ShopConfig, ShopTransformResult } from '../src/lib/types';
import { sheet } from './helpers';

const FIXTURE = fileURLToPath(new URL('../fixtures/shop-settings.xlsx', import.meta.url));
const OTHER_FIXTURES = [
  '../fixtures/arena-progression.xlsx',
  '../fixtures/hero-stats.xlsx',
  '../fixtures/arenas-settings.xlsx',
  '../fixtures/match-trophy-settings.xlsx',
  '../fixtures/bots-settings.xlsx',
  '../fixtures/hero-upgrade-settings.xlsx',
];

const REWARDS: RawSheet = sheet('Rewards', [
  ['Reward Name', 'Reward ID'],
  ['Coins', 'reward.currency.coins'],
  ['Upgrade_Cards', 'reward.currency.cards'],
  ['Gems', 'reward.currency.gems'],
  ['Hero_Cinder', 'reward.hero.cinder'],
  ['Skin_Cliff_Halloween', 'reward.skin.cliff.halloween'],
  ['Skin_Tank_Flower', 'reward.skin.tank.flower'],
  ['Lootbox_Common', 'reward.lootbox.common'],
]);

const HEADER: RawCell[] = [
  'Product ID',
  'Sold In',
  'Enabled',
  'Listed',
  'Price',
  'Badge Label',
  'Offer Duration Hours',
  'Cooldown Hours',
  'Daily Limit',
  'Reward 1',
  'Amount 1',
  'Reward 2',
  'Amount 2',
];

// The live shop, row for row. `_` marks a blank cell.
const _ = null;
const LIVE_ROWS: RawCell[][] = [
  HEADER,
  ['shop.featured.cinder', 'RealMoney', true, true, _, 'SALE', 6, _, _, 'Hero_Cinder', 1, 'Coins', 3500],
  ['shop.featured.starter', 'RealMoney', true, true, _, 'LIMITED', 12, _, _, 'Coins', 8000, 'Upgrade_Cards', 320],
  ['shop.pass.season1.premium', 'Gems', true, false, 1100, 'SEASON 1', _, _, _, _, _, _, _],
  ['shop.skin.cliff.halloween', 'Gems', true, true, 500, _, _, _, _, 'Skin_Cliff_Halloween', 1, _, _],
  ['shop.skin.tank.flower', 'Gems', true, true, 500, _, _, _, _, 'Skin_Tank_Flower', 1, _, _],
  ['shop.gems.tier1', 'RealMoney', true, true, _, _, _, _, _, 'Gems', 80, _, _],
  ['shop.gems.tier2', 'RealMoney', true, true, _, _, _, _, _, 'Gems', 170, _, _],
  ['shop.gems.tier3', 'RealMoney', true, true, _, _, _, _, _, 'Gems', 500, _, _],
  ['shop.gems.tier4', 'RealMoney', true, true, _, _, _, _, _, 'Gems', 1100, _, _],
  ['shop.gems.tier5', 'RealMoney', true, true, _, _, _, _, _, 'Gems', 2400, _, _],
  ['shop.gems.tier6', 'RealMoney', true, true, _, _, _, _, _, 'Gems', 6500, _, _],
  ['shop.coins.tier1', 'Gems', true, true, 80, _, _, _, _, 'Coins', 500, _, _],
  ['shop.coins.tier2', 'Gems', true, true, 170, _, _, _, _, 'Coins', 1200, _, _],
  ['shop.coins.tier3', 'Gems', true, true, 500, _, _, _, _, 'Coins', 3750, _, _],
  ['shop.coins.tier4', 'Gems', true, true, 1100, _, _, _, _, 'Coins', 8800, _, _],
  ['shop.coins.tier5', 'Gems', true, true, 2400, _, _, _, _, 'Coins', 20400, _, _],
  ['shop.coins.tier6', 'Gems', true, true, 6500, _, _, _, _, 'Coins', 58500, _, _],
  ['shop.cards.tier1', 'RealMoney', true, true, _, _, _, _, _, 'Upgrade_Cards', 20, _, _],
  ['shop.cards.tier2', 'RealMoney', true, true, _, _, _, _, _, 'Upgrade_Cards', 50, _, _],
  ['shop.cards.tier3', 'RealMoney', true, true, _, _, _, _, _, 'Upgrade_Cards', 140, _, _],
  ['shop.cards.tier4', 'RealMoney', true, true, _, _, _, _, _, 'Upgrade_Cards', 320, _, _],
  ['shop.cards.tier5', 'RealMoney', true, true, _, _, _, _, _, 'Upgrade_Cards', 760, _, _],
  ['shop.cards.tier6', 'RealMoney', true, true, _, _, _, _, _, 'Upgrade_Cards', 2200, _, _],
  ['shop.free.coins', 'Free', true, true, _, _, _, 24, _, 'Coins', 100, _, _],
  ['shop.rv.lootbox.common', 'Ad', true, true, _, _, _, _, 2, 'Lootbox_Common', 1, _, _],
];

function run(rows: RawCell[][], rewards: RawSheet = REWARDS): ShopTransformResult {
  const lookup = buildLookup(rewards, 'reward');
  const result = transformShop({ products: sheet('Products', rows), rewards: lookup.table });
  return { ...result, issues: [...lookup.issues, ...result.issues] };
}

function codes(result: ShopTransformResult): string[] {
  return result.issues.map((issue) => issue.code);
}

function errors(result: ShopTransformResult): string[] {
  return result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
}

/** A featured-style row with cells replaced by index. */
function featured(patch: Partial<Record<number, RawCell>> = {}): RawCell[] {
  const row = LIVE_ROWS[1].slice();
  for (const [index, value] of Object.entries(patch)) row[Number(index)] = value as RawCell;
  return row;
}

function gems(patch: Partial<Record<number, RawCell>> = {}): RawCell[] {
  const row = LIVE_ROWS[12].slice();
  for (const [index, value] of Object.entries(patch)) row[Number(index)] = value as RawCell;
  return row;
}

describe('the live shop payload', () => {
  it('is reproduced exactly from the sheet rows', () => {
    const result = run(LIVE_ROWS);
    expect(errors(result)).toEqual([]);
    expect(result.config).toEqual(shopJson);
    expect(validateShopConfig(result.config)).toEqual([]);
    expect(result.stats.products).toBe(25);
  });

  it('warns only about the pass, which grants nothing', () => {
    const result = run(LIVE_ROWS);
    expect(result.issues.map((issue) => issue.code)).toEqual(['shop-no-contents']);
    expect(result.issues[0].message).toContain('shop.pass.season1.premium');
  });

  it('serialises to the git-tracked baseline', () => {
    const baseline = readFileSync(fileURLToPath(new URL('../config/shop.json', import.meta.url)), 'utf8');
    expect(serializeShopConfig(run(LIVE_ROWS).config) + '\n').toBe(baseline.replace(/\r\n/g, '\n'));
  });

  it('emits optional keys in schema order and omits unused ones', () => {
    const result = run(LIVE_ROWS);
    const byId = new Map(result.config.Products.map((product) => [product.ID, Object.keys(product)]));
    expect(byId.get('shop.featured.cinder')).toEqual(['ID', 'SoldIn', 'IsEnabled', 'BadgeLabel', 'OfferDurationHours', 'Contents']);
    expect(byId.get('shop.pass.season1.premium')).toEqual(['ID', 'SoldIn', 'IsEnabled', 'IsListed', 'PriceInCurrency', 'BadgeLabel', 'Contents']);
    expect(byId.get('shop.gems.tier1')).toEqual(['ID', 'SoldIn', 'IsEnabled', 'Contents']);
    expect(byId.get('shop.free.coins')).toEqual(['ID', 'SoldIn', 'IsEnabled', 'CooldownHours', 'Contents']);
    expect(byId.get('shop.rv.lootbox.common')).toEqual(['ID', 'SoldIn', 'IsEnabled', 'DailyLimit', 'Contents']);
  });
});

describe('the real Shop Settings workbook', () => {
  const workbook = readWorkbookBytes(readFileSync(FIXTURE), 'shop-settings.xlsx');

  it('auto-selects both tabs and is detected as a shop workbook', () => {
    expect(autoSelectShopSheets(workbook)).toEqual({ products: 'Products', rewards: 'Rewards' });
    expect(detectDataset(workbook)).toBe('shop');
  });

  it('exports the live payload through the exporter definition, with a reward registry', () => {
    const analysis = runAnalysis(SHOP_EXPORTER, workbook, SHOP_EXPORTER.autoSelect(workbook));
    expect(analysis.errors).toBe(0);
    expect(analysis.result?.config).toEqual(shopJson);
    expect(analysis.result?.registry?.rewards.has('reward.currency.gems')).toBe(true);
    expect(analysis.result?.registry?.sources.rewards).toEqual(['Rewards lookup tab']);
  });

  it('is not mistaken for any other workbook, nor they for it', () => {
    for (const path of OTHER_FIXTURES) {
      const other = readWorkbookBytes(readFileSync(fileURLToPath(new URL(path, import.meta.url))), path);
      expect(autoSelectShopSheets(other).products).toBeNull();
      expect(detectDataset(other)).not.toBe('shop');
    }
  });
});

describe('reward columns', () => {
  it('pairs numbered reward and amount columns by number, in any order', () => {
    const slots = findRewardSlots(['Product ID', 'Amount 2', 'Reward 1', 'Amount 1', 'Reward 2']);
    expect(slots).toEqual([
      { nameIndex: 2, amountIndex: 3, label: 'Reward 1' },
      { nameIndex: 4, amountIndex: 1, label: 'Reward 2' },
    ]);
  });

  it('pairs unnumbered columns with the amount that follows', () => {
    const slots = findRewardSlots(['ID', 'Reward', 'Reward Amount', 'Reward', 'Amount']);
    expect(slots.map((slot) => [slot.nameIndex, slot.amountIndex])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('reports a reward column with no amount', () => {
    const result = run([['Product ID', 'Sold In', 'Enabled', 'Reward 1'], ['shop.x.y', 'Gems', true, 'Coins']]);
    expect(errors(result).join(' ')).toContain('no matching amount column');
  });

  it('reports the absence of any reward column', () => {
    const result = run([['Product ID', 'Sold In', 'Enabled'], ['shop.x.y', 'RealMoney', true]]);
    expect(errors(result).join(' ')).toContain('no reward columns');
  });
});

describe('row validation', () => {
  it('rejects a row with values but no ID, and a duplicated ID', () => {
    expect(codes(run([HEADER, featured({ 0: null })]))).toContain('shop-id-missing');
    expect(codes(run([HEADER, featured(), featured()]))).toContain('shop-id-duplicate');
  });

  it('warns about an ID off the shop.<kind>.<name> pattern', () => {
    const result = run([HEADER, featured({ 0: 'Featured Cinder' })]);
    expect(codes(result)).toContain('shop-id-format');
    expect(errors(result)).toEqual([]);
  });

  it('rejects an unknown Sold In and suggests the intended one', () => {
    const result = run([HEADER, featured({ 1: 'RealMony' })]);
    expect(codes(result)).toContain('shop-sold-in-unknown');
    expect(errors(result)[0]).toContain('Did you mean "RealMoney"?');
    expect(codes(run([HEADER, featured({ 1: null })]))).toContain('shop-sold-in-missing');
  });

  it('accepts a differently spelled Sold In with a warning', () => {
    const result = run([HEADER, featured({ 1: 'real money' })]);
    expect(errors(result)).toEqual([]);
    expect(codes(result)).toContain('shop-sold-in-spelling');
    expect(result.config.Products[0].SoldIn).toBe('RealMoney');
  });

  it('reads booleans from checkboxes and text', () => {
    expect(run([HEADER, featured({ 2: 'yes' })]).config.Products[0].IsEnabled).toBe(true);
    expect(run([HEADER, featured({ 2: 'FALSE' })]).config.Products[0].IsEnabled).toBe(false);
    expect(codes(run([HEADER, featured({ 2: 'maybe' })]))).toContain('shop-enabled-invalid');
    expect(codes(run([HEADER, featured({ 2: null })]))).toContain('shop-enabled-invalid');
    expect(codes(run([HEADER, featured({ 3: 'maybe' })]))).toContain('shop-listed-invalid');
  });

  it('writes IsListed only when unlisted', () => {
    expect('IsListed' in run([HEADER, featured({ 3: true })]).config.Products[0]).toBe(false);
    expect('IsListed' in run([HEADER, featured({ 3: null })]).config.Products[0]).toBe(false);
    expect(run([HEADER, featured({ 3: false })]).config.Products[0].IsListed).toBe(false);
  });

  it('requires a price for gem products and refuses one elsewhere', () => {
    expect(codes(run([HEADER, gems({ 4: null })]))).toContain('shop-price-missing');
    expect(codes(run([HEADER, featured({ 4: 99 })]))).toContain('shop-price-unexpected');
    expect(codes(run([HEADER, gems({ 4: 'cheap' })]))).toContain('shop-price-invalid');
    expect(codes(run([HEADER, gems({ 4: 12.5 })]))).toContain('shop-price-invalid');
  });

  it('requires a cooldown for free products and a daily limit for ad products, and refuses them elsewhere', () => {
    const free = LIVE_ROWS[24].slice();
    const ad = LIVE_ROWS[25].slice();
    free[7] = null;
    ad[8] = null;
    expect(codes(run([HEADER, free]))).toContain('shop-cooldown-missing');
    expect(codes(run([HEADER, ad]))).toContain('shop-daily-limit-missing');
    expect(codes(run([HEADER, featured({ 7: 24 })]))).toContain('shop-cooldown-unexpected');
    expect(codes(run([HEADER, featured({ 8: 2 })]))).toContain('shop-daily-limit-unexpected');
    expect(codes(run([HEADER, featured({ 6: -1 })]))).toContain('shop-offer-hours-invalid');
  });

  it('resolves rewards through the lookup and rejects unknown, duplicated or unpriced ones', () => {
    expect(codes(run([HEADER, featured({ 9: 'Diamonds' })]))).toContain('shop-reward-unknown');
    expect(codes(run([HEADER, featured({ 11: 'Hero_Cinder' })]))).toContain('shop-reward-duplicate');
    expect(codes(run([HEADER, featured({ 10: null })]))).toContain('shop-reward-amount-missing');
    expect(codes(run([HEADER, featured({ 10: 0 })]))).toContain('shop-reward-amount-invalid');
    expect(codes(run([HEADER, featured({ 10: 1.5 })]))).toContain('shop-reward-amount-invalid');
    expect(codes(run([HEADER, featured({ 9: null })]))).toContain('shop-reward-orphan-amount');
  });

  it('rejects an ambiguous reward name', () => {
    const rewards = sheet('Rewards', [
      ['Reward Name', 'Reward ID'],
      ['Coins', 'reward.currency.coins'],
      ['coins', 'reward.coins'],
    ]);
    expect(codes(run([HEADER, gems()], rewards))).toContain('shop-reward-ambiguous');
  });

  it('warns about a product that grants nothing', () => {
    const result = run([HEADER, gems({ 9: null, 10: null })]);
    expect(codes(result)).toContain('shop-no-contents');
    expect(errors(result)).toEqual([]);
    expect(result.config.Products[0].Contents).toEqual([]);
  });

  it('skips blank rows and reports an empty tab', () => {
    expect(errors(run([HEADER, HEADER.map(() => null), gems()]))).toEqual([]);
    expect(codes(run([HEADER]))).toContain('shop-empty');
  });
});

describe('the shop schema gate', () => {
  const gate = (config: unknown) => validateShopConfig(config as ShopConfig).map((issue) => issue.code);
  const live = shopJson as ShopConfig;

  it('pins the root, key order, enums, booleans and contents', () => {
    expect(gate(live)).toEqual([]);
    expect(gate({})).toContain('schema-root');
    expect(gate({ Products: [] })).toContain('no-products');
    const [first] = live.Products;
    expect(gate({ Products: [{ ...first, SoldIn: 'Cash' }] })).toContain('schema-sold-in');
    expect(gate({ Products: [{ ...first, IsEnabled: 'yes' }] })).toContain('schema-enabled');
    expect(gate({ Products: [{ ...first, IsListed: true }] })).toContain('schema-listed');
    expect(gate({ Products: [{ ...first, Contents: [{ Amount: 1, RewardID: 'x' }] }] })).toContain('schema-content-keys');
    expect(gate({ Products: [{ ...first, Contents: [{ RewardID: 'x', Amount: 0 }] }] })).toContain('schema-content-amount');
    expect(gate({ Products: [first, first] })).toContain('schema-product-id-duplicate');
    const reordered = { Contents: first.Contents, ID: first.ID, SoldIn: first.SoldIn, IsEnabled: first.IsEnabled };
    expect(gate({ Products: [reordered] })).toContain('schema-product-keys');
  });
});
