import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import battlePassJson from '../config/battlePass.json';
import shopJson from '../config/shop.json';
import { runAnalysis } from '../src/exporters/analysis';
import { BATTLE_PASS_EXPORTER } from '../src/exporters/battlePass';
import {
  CONFIRMED_SKIP_CURRENCY,
  nextSeasonId,
  parseStartUtc,
  seasonEndUtc,
  transformBattlePass,
  validateSeason,
  type BattlePassSeason,
} from '../src/lib/battlePass';
import { buildLookup } from '../src/lib/lookups';
import { autoSelectBattlePassSheets, detectDataset } from '../src/lib/sheetSelect';
import { serializeBattlePassConfig, validateBattlePassConfig } from '../src/lib/validateBattlePass';
import { readWorkbookBytes } from '../src/lib/workbook';
import { validateGraph } from '../src/workspace/graph';
import type {
  BattlePassConfig,
  BattlePassTransformResult,
  RawCell,
  RawSheet,
  ShopConfig,
} from '../src/lib/types';
import { sheet } from './helpers';

const FIXTURE = fileURLToPath(new URL('../fixtures/battle-pass-settings.xlsx', import.meta.url));
const OTHER_FIXTURES = [
  '../fixtures/arena-progression.xlsx',
  '../fixtures/hero-stats.xlsx',
  '../fixtures/arenas-settings.xlsx',
  '../fixtures/match-trophy-settings.xlsx',
  '../fixtures/bots-settings.xlsx',
  '../fixtures/hero-upgrade-settings.xlsx',
  '../fixtures/shop-settings.xlsx',
];

const REWARDS: RawSheet = sheet('Rewards', [
  ['Reward Name', 'Reward ID'],
  ['Coins', 'reward.currency.coins'],
  ['Upgrade_Cards', 'reward.currency.cards'],
  ['Gems', 'reward.currency.gems'],
  ['Lootbox_Common', 'reward.lootbox.common'],
  ['Skin_Tank_Flower', 'reward.skin.tank.flower'],
  ['Skin_Cliff_Halloween', 'reward.skin.cliff.halloween'],
]);

/**
 * The live season header, as the console holds it.
 *
 * None of this comes from the sheet any more: the whole header is set on the
 * battle pass page or in the live ops booking form, which is what lets the
 * product and the currency be picked from what the game actually has.
 */
const SEASON: BattlePassSeason = {
  seasonId: 'pass.season1',
  seasonName: 'SEASON 1',
  startUtc: '2026-09-01 00:00',
  durationDays: 30,
  tokensPerTier: 100,
  premiumProductId: 'shop.pass.season1.premium',
  skipTierCost: 75,
  skipCurrencyId: 'hardCurrency',
  finalRewardArt: '',
};

const TIER_HEADER: RawCell[] = ['Tier', 'Free Reward', 'Free Amount', 'Premium Reward', 'Premium Amount'];

// The live ladder, row for row. `_` marks a tier with no reward on that track.
const _ = null;
const TIER_ROWS: RawCell[][] = [
  TIER_HEADER,
  [1, 'Coins', 200, 'Gems', 25],
  [2, _, _, 'Coins', 300],
  [3, 'Upgrade_Cards', 5, 'Gems', 25],
  [4, 'Coins', 250, 'Lootbox_Common', 1],
  [5, 'Lootbox_Common', 1, 'Gems', 50],
  [6, _, _, 'Coins', 400],
  [7, 'Upgrade_Cards', 8, 'Upgrade_Cards', 12],
  [8, 'Coins', 300, 'Gems', 30],
  [9, _, _, 'Lootbox_Common', 1],
  [10, 'Lootbox_Common', 1, 'Gems', 75],
  [11, 'Upgrade_Cards', 10, 'Coins', 500],
  [12, 'Coins', 350, 'Upgrade_Cards', 15],
  [13, _, _, 'Gems', 40],
  [14, 'Upgrade_Cards', 12, 'Lootbox_Common', 2],
  [15, 'Coins', 400, 'Skin_Tank_Flower', 1],
  [16, _, _, 'Gems', 50],
  [17, 'Upgrade_Cards', 14, 'Coins', 600],
  [18, 'Coins', 450, 'Lootbox_Common', 1],
  [19, _, _, 'Gems', 50],
  [20, 'Lootbox_Common', 1, 'Upgrade_Cards', 20],
  [21, 'Upgrade_Cards', 15, 'Gems', 60],
  [22, 'Coins', 500, 'Coins', 700],
  [23, _, _, 'Lootbox_Common', 2],
  [24, 'Upgrade_Cards', 18, 'Gems', 75],
  [25, 'Coins', 550, 'Upgrade_Cards', 25],
  [26, _, _, 'Coins', 800],
  [27, 'Upgrade_Cards', 20, 'Gems', 80],
  [28, 'Coins', 600, 'Lootbox_Common', 2],
  [29, _, _, 'Gems', 100],
  [30, 'Lootbox_Common', 2, 'Skin_Cliff_Halloween', 1],
];

function run(
  tiers: RawCell[][] = TIER_ROWS,
  rewards: RawSheet = REWARDS,
  season: BattlePassSeason = SEASON,
): BattlePassTransformResult {
  const lookup = buildLookup(rewards, 'reward');
  const result = transformBattlePass({
    tiers: sheet('Tiers', tiers),
    rewards: lookup.table,
    season,
  });
  return { ...result, issues: [...lookup.issues, ...result.issues] };
}

function codes(result: BattlePassTransformResult): string[] {
  return result.issues.map((issue) => issue.code);
}

function errors(result: BattlePassTransformResult): string[] {
  return result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
}

/** The live tier rows with one row's cells replaced by column index. */
function tiers(index: number, patch: Partial<Record<number, RawCell>>): RawCell[][] {
  const rows = TIER_ROWS.map((row) => row.slice());
  for (const [column, value] of Object.entries(patch)) rows[index][Number(column)] = value as RawCell;
  return rows;
}

describe('the live battle pass payload', () => {
  it('is reproduced exactly from the sheet rows', () => {
    const result = run();
    expect(errors(result)).toEqual([]);
    expect(result.config).toEqual(battlePassJson);
    expect(validateBattlePassConfig(result.config)).toEqual([]);
    expect(result.stats).toMatchObject({ tiers: 30, free: 21, premium: 30 });
  });

  it('parses cleanly, with nothing to warn about', () => {
    expect(codes(run())).toEqual([]);
  });

  it('serialises to the git-tracked baseline', () => {
    const baseline = readFileSync(
      fileURLToPath(new URL('../config/battlePass.json', import.meta.url)),
      'utf8',
    );
    expect(serializeBattlePassConfig(run().config) + '\n').toBe(baseline.replace(/\r\n/g, '\n'));
  });

  it('omits a track that grants nothing rather than nulling it', () => {
    const config = run().config;
    expect(Object.keys(config.Tiers[0])).toEqual(['Free', 'Premium']);
    expect(Object.keys(config.Tiers[1])).toEqual(['Premium']);
  });
});

/**
 * The fixture is a workbook of the shape the Battle Pass Settings sheet has:
 * the three tabs, the header spellings, the live values. Swap it for the real
 * Drive export once that sheet exists, the way the other exporters did - the
 * assertions do not change, but the export then also proves the sheet itself.
 */
describe('a Battle Pass Settings workbook', () => {
  const workbook = readWorkbookBytes(readFileSync(FIXTURE), 'battle-pass-settings.xlsx');

  it('auto-selects the two tabs it reads and is detected as a battle pass workbook', () => {
    // The workbook still has a Season tab, and is deliberately not asked about
    // it: the header is the console's now, so the tab is neither read nor
    // complained about.
    expect(autoSelectBattlePassSheets(workbook)).toEqual({ tiers: 'Tiers', rewards: 'Rewards' });
    expect(detectDataset(workbook)).toBe('battlePass');
  });

  it('exports the live payload through the exporter definition, with a reward registry', () => {
    const analysis = runAnalysis(
      BATTLE_PASS_EXPORTER,
      workbook,
      BATTLE_PASS_EXPORTER.autoSelect(workbook),
      SEASON,
    );
    expect(analysis.errors).toBe(0);
    expect(analysis.result?.config).toEqual(battlePassJson);
    expect(analysis.result?.registry?.rewards.has('reward.skin.cliff.halloween')).toBe(true);
    expect(analysis.result?.registry?.sources.rewards).toEqual(['Rewards lookup tab']);
    // The reward set covers this workbook's own config and no other.
    expect([...(analysis.result?.registry?.rewardScope ?? [])]).toEqual(['battlePass']);
  });

  /**
   * The fixture still carries a Season tab, because so do the sheets in Drive.
   * It must not reach the payload and must not be complained about: the header
   * comes from the console, and a tab nobody reads is not an error.
   */
  it('publishes the console header, whatever the old Season tab still says', () => {
    const analysis = runAnalysis(
      BATTLE_PASS_EXPORTER,
      workbook,
      BATTLE_PASS_EXPORTER.autoSelect(workbook),
      {
        ...SEASON,
        seasonId: 'pass.season2',
        seasonName: 'SEASON 2',
        startUtc: '2026-11-01 12:00',
        durationDays: 45,
        premiumProductId: 'shop.pass.season2.premium',
        finalRewardArt: 'art/season2_final',
      },
    );
    expect(analysis.errors).toBe(0);
    expect(analysis.issues).toEqual([]);
    expect(analysis.result?.config).toMatchObject({
      SeasonID: 'pass.season2',
      SeasonName: 'SEASON 2',
      StartUtc: '2026-11-01 12:00',
      DurationDays: 45,
      PremiumProductID: 'shop.pass.season2.premium',
      FinalRewardArt: 'art/season2_final',
    });
  });

  it('is not mistaken for any other workbook, nor they for it', () => {
    for (const path of OTHER_FIXTURES) {
      const other = readWorkbookBytes(readFileSync(fileURLToPath(new URL(path, import.meta.url))), path);
      expect(autoSelectBattlePassSheets(other).tiers).toBeNull();
      expect(detectDataset(other)).not.toBe('battlePass');
    }
  });
});

describe('the season header the console owns', () => {
  const withSeason = (patch: Partial<BattlePassSeason>) => run(TIER_ROWS, REWARDS, { ...SEASON, ...patch });
  const codesOf = (patch: Partial<BattlePassSeason>) =>
    validateSeason({ ...SEASON, ...patch }).map((issue) => issue.code);

  it('reaches the payload exactly as it was set', () => {
    const result = withSeason({
      seasonId: 'pass.season2',
      seasonName: 'SEASON 2',
      tokensPerTier: 120,
      skipTierCost: 0,
      finalRewardArt: 'art/season2_final',
    });
    expect(errors(result)).toEqual([]);
    expect(result.config).toMatchObject({
      SeasonID: 'pass.season2',
      SeasonName: 'SEASON 2',
      TokensPerTier: 120,
      SkipTierCost: 0,
      FinalRewardArt: 'art/season2_final',
    });
    expect(validateBattlePassConfig(result.config)).toEqual([]);
  });

  it('refuses a header with a field left unset', () => {
    expect(codesOf({ seasonId: '' })).toContain('battlepass-season-id-missing');
    expect(codesOf({ seasonName: '   ' })).toContain('battlepass-season-name-missing');
    expect(codesOf({ premiumProductId: '' })).toContain('battlepass-product-id-missing');
    expect(codesOf({ skipCurrencyId: '' })).toContain('battlepass-skip-currency-missing');
    // The transform carries them too, which is what actually blocks a publish.
    expect(codes(withSeason({ seasonId: '' }))).toContain('battlepass-season-id-missing');
  });

  it('states the range it wanted for each number', () => {
    // An empty box arrives as 0, and is not read back at the reader.
    const empty = validateSeason({ ...SEASON, durationDays: 0 });
    expect(empty.map((issue) => issue.code)).toEqual(['battlepass-season-duration-invalid']);
    expect(empty[0].message).not.toContain('0');
    expect(validateSeason({ ...SEASON, durationDays: 1.5 })[0].message).toContain('not 1.5');
    expect(codesOf({ tokensPerTier: 0 })).toContain('battlepass-season-tokens-invalid');
    // A free skip is a legitimate setting; a negative one is not.
    expect(codesOf({ skipTierCost: 0 })).toEqual([]);
    expect(codesOf({ skipTierCost: -1 })).toContain('battlepass-skip-cost-invalid');
  });

  it('warns about IDs that break the naming conventions without blocking them', () => {
    expect(codesOf({ seasonId: 'Season One' })).toContain('battlepass-season-id-format');
    expect(codesOf({ premiumProductId: 'season1premium' })).toContain('battlepass-product-id-format');
    // Warnings only - a convention is not a requirement of the client.
    expect(errors(withSeason({ seasonId: 'Season One' }))).toEqual([]);
  });

  /**
   * The dropdown offers the shop's own currencies beside `hardCurrency`, and
   * only `hardCurrency` is known to work in the client. Until somebody
   * confirms the rest, picking one is allowed and said out loud.
   */
  it('warns about a skip currency nobody has confirmed with the client', () => {
    expect(codesOf({ skipCurrencyId: CONFIRMED_SKIP_CURRENCY })).toEqual([]);
    const gems = validateSeason({ ...SEASON, skipCurrencyId: 'Gems' });
    expect(gems.map((issue) => issue.code)).toEqual(['battlepass-skip-currency-unconfirmed']);
    expect(gems[0].severity).toBe('warning');
    expect(errors(withSeason({ skipCurrencyId: 'Gems' }))).toEqual([]);
  });

  it('works out the season after this one, and admits when it cannot', () => {
    expect(nextSeasonId('pass.season1')).toBe('pass.season2');
    expect(nextSeasonId('pass.season9')).toBe('pass.season10');
    expect(nextSeasonId('pass.winter')).toBeNull();
  });

  it('canonicalises whatever shape the start arrives in', () => {
    expect(parseStartUtc('2026-09-01 00:00')).toBe('2026-09-01 00:00');
    expect(parseStartUtc('2026-09-01T00:00:00.000Z')).toBe('2026-09-01 00:00');
    expect(parseStartUtc('2026-09-01')).toBe('2026-09-01 00:00');
    expect(withSeason({ startUtc: '2026-09-01T06:30:00.000Z' }).config.StartUtc).toBe('2026-09-01 06:30');
  });

  it('rejects anything that is not a UTC timestamp, dates that do not exist included', () => {
    expect(parseStartUtc('01/09/2026')).toBeNull();
    expect(parseStartUtc('2026-02-30 00:00')).toBeNull();
    expect(parseStartUtc('2026-09-01 25:00')).toBeNull();
    const result = withSeason({ startUtc: 'next Tuesday' });
    expect(codes(result)).toContain('battlepass-season-start-invalid');
    expect(errors(result)[0]).toContain('YYYY-MM-DD HH:mm');
    expect(codesOf({ startUtc: '' })).toEqual(['battlepass-season-start-missing']);
  });

  it('computes the end of the window, month and year rollovers included', () => {
    expect(seasonEndUtc(SEASON)).toBe('2026-10-01 00:00');
    expect(seasonEndUtc({ ...SEASON, startUtc: '2026-12-20 18:30', durationDays: 30 })).toBe(
      '2027-01-19 18:30',
    );
    expect(seasonEndUtc({ ...SEASON, startUtc: '' })).toBeNull();
    expect(seasonEndUtc({ ...SEASON, durationDays: 0 })).toBeNull();
  });
});

describe('the tiers tab', () => {
  it('reports a missing column', () => {
    const rows = TIER_ROWS.map((row) => row.slice(0, 3));
    expect(errors(run(rows)).join(' ')).toContain('"Premium Reward" column');
  });

  it('rejects a row with values but no tier number, and an unusable one', () => {
    expect(codes(run(tiers(1, { 0: null })))).toContain('battlepass-tier-missing');
    expect(codes(run(tiers(1, { 0: 'one' })))).toContain('battlepass-tier-invalid');
    expect(codes(run(tiers(1, { 0: 0 })))).toContain('battlepass-tier-invalid');
    expect(codes(run(tiers(1, { 0: 1.5 })))).toContain('battlepass-tier-invalid');
  });

  it('rejects a duplicated tier and a gap in the ladder', () => {
    expect(codes(run(tiers(2, { 0: 1 })))).toContain('battlepass-tier-duplicate');
    const gap = run(tiers(3, { 0: 31 }));
    expect(codes(gap)).toContain('battlepass-tier-gap');
    expect(errors(gap)[0]).toContain('skips tier 3');
    // Nothing is exported from a ladder whose numbering cannot be trusted.
    expect(gap.config.Tiers).toEqual([]);
  });

  it('reads the tiers in tier order however the rows are sorted', () => {
    const shuffled = [TIER_ROWS[0], ...TIER_ROWS.slice(1).reverse()];
    const result = run(shuffled);
    expect(errors(result)).toEqual([]);
    expect(result.config.Tiers).toEqual(battlePassJson.Tiers);
    expect(result.preview[0].tier).toBe(1);
  });

  it('resolves rewards through the lookup and reports what it cannot', () => {
    expect(codes(run(tiers(1, { 1: 'Diamonds' })))).toContain('battlepass-reward-unknown');
    expect(codes(run(tiers(1, { 2: null })))).toContain('battlepass-reward-amount-missing');
    expect(codes(run(tiers(1, { 4: 'lots' })))).toContain('battlepass-reward-amount-invalid');
    expect(codes(run(tiers(1, { 4: 0 })))).toContain('battlepass-reward-amount-invalid');
    expect(codes(run(tiers(1, { 3: null })))).toContain('battlepass-reward-orphan-amount');
  });

  it('rejects an ambiguous reward name', () => {
    const rewards = sheet('Rewards', [
      ['Reward Name', 'Reward ID'],
      ['Coins', 'reward.currency.coins'],
      ['coins', 'reward.coins'],
    ]);
    expect(codes(run(TIER_ROWS, rewards))).toContain('battlepass-reward-ambiguous');
  });

  it('allows the same reward on both tracks of one tier', () => {
    // Tier 22 grants coins on both tracks, at different amounts.
    const result = run();
    expect(result.config.Tiers[21]).toEqual({
      Free: { RewardID: 'reward.currency.coins', Amount: 500 },
      Premium: { RewardID: 'reward.currency.coins', Amount: 700 },
    });
  });

  it('warns about a tier that grants nothing on either track', () => {
    const result = run(tiers(1, { 1: null, 2: null, 3: null, 4: null }));
    expect(codes(result)).toContain('battlepass-tier-empty');
    expect(errors(result)).toEqual([]);
    expect(result.config.Tiers[0]).toEqual({});
  });

  it('skips blank rows and reports an empty tab', () => {
    expect(errors(run([TIER_HEADER, TIER_HEADER.map(() => null), [1, 'Coins', 200, _, _]]))).toEqual([]);
    expect(codes(run([TIER_HEADER]))).toContain('battlepass-empty');
  });
});

describe('the battle pass schema gate', () => {
  const gate = (config: unknown) => validateBattlePassConfig(config as BattlePassConfig).map((i) => i.code);
  const live = battlePassJson as BattlePassConfig;

  it('pins the root key order, the season types and every reward', () => {
    expect(gate(live)).toEqual([]);
    expect(gate({})).toContain('schema-root');
    expect(gate({ ...live, Tiers: [] })).toContain('no-tiers');
    expect(gate({ ...live, SeasonID: '' })).toContain('schema-season-text');
    expect(gate({ ...live, FinalRewardArt: null })).toContain('schema-season-text');
    expect(gate({ ...live, StartUtc: '01/09/2026' })).toContain('schema-start-utc');
    expect(gate({ ...live, StartUtc: '2026-09-01T00:00:00Z' })).toContain('schema-start-utc');
    expect(gate({ ...live, DurationDays: 0 })).toContain('schema-duration');
    expect(gate({ ...live, TokensPerTier: 12.5 })).toContain('schema-tokens');
    expect(gate({ ...live, SkipTierCost: -1 })).toContain('schema-skip-cost');
  });

  it('pins the tier and reward shapes', () => {
    expect(gate({ ...live, Tiers: [{ Premium: live.Tiers[0].Premium, Free: live.Tiers[0].Free }] })).toContain(
      'schema-tier-keys',
    );
    expect(gate({ ...live, Tiers: [{ Bonus: { RewardID: 'x', Amount: 1 } }] })).toContain('schema-tier-keys');
    expect(gate({ ...live, Tiers: [{ Free: { Amount: 1, RewardID: 'x' } }] })).toContain('schema-reward-keys');
    expect(gate({ ...live, Tiers: [{ Free: { RewardID: '', Amount: 1 } }] })).toContain('schema-reward-id');
    expect(gate({ ...live, Tiers: [{ Free: { RewardID: 'x', Amount: 0 } }] })).toContain('schema-reward-amount');
    // An empty tier is a warning in the sheet, not a schema failure.
    expect(gate({ ...live, Tiers: [{}] })).toEqual([]);
  });
});

describe('the pass against the shop', () => {
  const shop = shopJson as ShopConfig;

  it('accepts the live pair', () => {
    const report = validateGraph({ battlePass: battlePassJson as BattlePassConfig, shop });
    expect(report.issues).toEqual([]);
  });

  it('reports a premium product the shop does not sell', () => {
    const report = validateGraph({
      battlePass: { ...(battlePassJson as BattlePassConfig), PremiumProductID: 'shop.pass.season2.premium' },
      shop,
    });
    expect(report.issues.map((issue) => issue.code)).toEqual(['graph-pass-product-undefined']);
  });

  it('warns when the product exists but is switched off', () => {
    const disabled: ShopConfig = {
      Products: shop.Products.map((product) =>
        product.ID === 'shop.pass.season1.premium' ? { ...product, IsEnabled: false } : product,
      ),
    };
    const report = validateGraph({ battlePass: battlePassJson as BattlePassConfig, shop: disabled });
    expect(report.issues.map((issue) => issue.code)).toEqual(['graph-pass-product-disabled']);
    expect(report.errors).toBe(0);
  });
});
