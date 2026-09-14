import { describe, expect, it } from 'vitest';
import liveJson from '../config/rollingOffer.json';
import { buildLookup } from '../src/lib/lookups';
import { REWARDS } from '../src/lib/rewards';
import { EMPTY_SCHEDULE, transformRollingOffer, type RollingOfferSchedule } from '../src/lib/rollingOffer';
import { autoSelectRollingOfferSheets, detectDataset } from '../src/lib/sheetSelect';
import { validateRollingOfferConfig } from '../src/lib/validateRollingOffer';
import type { RawCell, RollingOffer, RollingOfferConfig } from '../src/lib/types';
import { sheet } from './helpers';

/** The canonical Rewards tab every config sheet now carries. */
const REWARDS_SHEET = sheet('Rewards', [
  ['Reward Name', 'Reward ID'],
  ...REWARDS.map((reward) => [reward.name, reward.id]),
]);

const OFFER_ROWS: RawCell[][] = [
  ['Setting', 'Value', 'What it is'],
  ['Offer ID', 'offer.roll.autumn', ''],
  ['Display Name', 'AUTUMN ROLL', ''],
  ['Subtitle', 'Claim each step to unlock the next.', ''],
  ['Completion Reward', 'Skin - Flick Ghost', ''],
  ['Completion Amount', 1, ''],
  ['Completion Text', 'COMPLETE ALL STEPS TO UNLOCK {0}!', ''],
  ['Background Art', 'AutumnBG', ''],
  ['Top Bar Art', '', ''],
  ['Reward Art', '', ''],
  ['Button Art', 'AutumnButton', ''],
];

const STEP_HEADER: RawCell[] = [
  'Step',
  'Sold In',
  'Price',
  'Price Tier',
  'Ad Placement',
  'Reward 1',
  'Amount 1',
  'Reward 2',
  'Amount 2',
  'Check',
];

const _ = null;
const STEP_ROWS: RawCell[][] = [
  STEP_HEADER,
  [1, 'Free', _, _, _, 'Coins', 500, _, _, 'OK'],
  [2, 'Gems', 80, _, _, 'Upgrade Cards', 25, _, _, 'OK'],
  [3, 'RealMoney', _, 2, _, 'Upgrade Cards', 60, 'Coins', 2500, 'OK'],
  [4, 'Ad', _, _, 'offer_step4', 'Gems', 25, _, _, 'OK'],
];

function run(
  offer: RawCell[][] = OFFER_ROWS,
  steps: RawCell[][] = STEP_ROWS,
  schedule: Partial<RollingOfferSchedule> = {},
) {
  const rewards = buildLookup(REWARDS_SHEET, 'reward');
  const result = transformRollingOffer({
    offer: sheet('Offer', offer),
    steps: sheet('Steps', steps),
    rewards: rewards.table,
    schedule: { ...EMPTY_SCHEDULE, startUtc: '2026-10-01 09:00', durationHours: 336, ...schedule },
  });
  return { ...result, issues: [...rewards.issues, ...result.issues] };
}

const codes = (result: ReturnType<typeof run>) => result.issues.map((issue) => issue.code);
const errors = (result: ReturnType<typeof run>) =>
  result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);

describe('a rolling offer sheet', () => {
  it('reads the offer and its chain', () => {
    const result = run();
    expect(errors(result)).toEqual([]);
    const offer = result.config.Offers[0];
    expect(offer.OfferID).toBe('offer.roll.autumn');
    expect(offer.DisplayName).toBe('AUTUMN ROLL');
    expect(offer.IsTimed).toBe(true);
    expect(offer.StartUtc).toBe('2026-10-01 09:00');
    expect(offer.DurationHours).toBe(336);
    expect(offer.CompletionReward).toEqual({ RewardID: 'reward.skin.flick.ghost', Amount: 1 });
    expect(offer.Steps).toHaveLength(4);
    expect(validateRollingOfferConfig(result.config)).toEqual([]);
  });

  it('carries each step own price and what it pays', () => {
    const [free, gems, money, ad] = run().config.Offers[0].Steps;
    expect(free).toEqual({ SoldIn: 'Free', Rewards: [{ RewardID: 'reward.currency.coins', Amount: 500 }] });
    expect(gems.Price).toBe(80);
    expect(money.PriceTier).toBe(2);
    expect(money.Rewards).toHaveLength(2);
    expect(ad.AdPlacement).toBe('offer_step4');
  });

  it('omits the window entirely when the offer is evergreen', () => {
    const offer = run(OFFER_ROWS, STEP_ROWS, { isTimed: false }).config.Offers[0];
    expect(offer.IsTimed).toBe(false);
    expect('StartUtc' in offer).toBe(false);
    expect('DurationHours' in offer).toBe(false);
  });

  it('reads the Offer tab by label, not by row position', () => {
    // A row inserted at the top must not shift every field by one.
    const shuffled = [OFFER_ROWS[0], ['Notes', 'ignore me', ''], ...OFFER_ROWS.slice(1)];
    expect(run(shuffled).config.Offers[0].DisplayName).toBe('AUTUMN ROLL');
  });
});

describe('what the client would drop is refused instead', () => {
  it('refuses a real-money step with no price tier', () => {
    const rows = STEP_ROWS.map((row, i) => (i === 3 ? [...row.slice(0, 3), _, ...row.slice(4)] : row));
    expect(codes(run(OFFER_ROWS, rows))).toContain('rollingoffer-price-tier-missing');
  });

  it('refuses a price tier the stores do not stock', () => {
    const rows = STEP_ROWS.map((row, i) => (i === 3 ? [...row.slice(0, 3), 12, ...row.slice(4)] : row));
    expect(errors(run(OFFER_ROWS, rows))[0]).toContain('10 and');
  });

  it('refuses a currency step with no price, and a price on one not sold in a currency', () => {
    const noPrice = STEP_ROWS.map((row, i) => (i === 2 ? [...row.slice(0, 2), _, ...row.slice(3)] : row));
    expect(codes(run(OFFER_ROWS, noPrice))).toContain('rollingoffer-price-missing');

    const oddPrice = STEP_ROWS.map((row, i) => (i === 1 ? [...row.slice(0, 2), 99, ...row.slice(3)] : row));
    expect(codes(run(OFFER_ROWS, oddPrice))).toContain('rollingoffer-price-unexpected');
  });

  it('refuses a step that pays nothing', () => {
    const rows = [STEP_HEADER, [1, 'Free', _, _, _, _, _, _, _, '']];
    expect(codes(run(OFFER_ROWS, rows))).toContain('rollingoffer-step-pays-nothing');
  });

  it('refuses an offer with no readable steps at all', () => {
    expect(codes(run(OFFER_ROWS, [STEP_HEADER]))).toContain('rollingoffer-no-steps');
  });

  it('refuses a timed offer with no start', () => {
    expect(codes(run(OFFER_ROWS, STEP_ROWS, { startUtc: '' }))).toContain('rollingoffer-start-missing');
  });
});

describe('merging into the live schedule', () => {
  const live = liveJson as RollingOfferConfig;
  const others = live.Offers as RollingOffer[];

  it('appends an offer whose ID is new, keeping the others', () => {
    const result = run(OFFER_ROWS, STEP_ROWS, { others });
    expect(result.config.Offers.map((offer) => offer.OfferID)).toEqual([
      'offer.roll.1',
      'offer.roll.2',
      'offer.roll.autumn',
    ]);
    expect(result.stats.offers).toBe(3);
    expect(validateRollingOfferConfig(result.config)).toEqual([]);
  });

  it('replaces an offer of the same ID in place, rather than duplicating it', () => {
    // Order is the order the buttons are drawn, so an updated offer keeps its
    // place instead of jumping to the end of the row.
    const asFirst = OFFER_ROWS.map((row) => (row[0] === 'Offer ID' ? ['Offer ID', 'offer.roll.1', ''] : row));
    const result = run(asFirst, STEP_ROWS, { others });
    expect(result.config.Offers.map((offer) => offer.OfferID)).toEqual(['offer.roll.1', 'offer.roll.2']);
    expect(result.config.Offers[0].DisplayName).toBe('AUTUMN ROLL');
  });

  it('carries the schedule-level art through untouched', () => {
    const result = run(OFFER_ROWS, STEP_ROWS, { others, defaultBackgroundArt: 'SharedBG' });
    expect(result.config.DefaultBackgroundArt).toBe('SharedBG');
  });

  it('judges the offers it merges into, not just the one edited', () => {
    // An offer already live that has quietly become invalid must not ship just
    // because nobody touched its sheet.
    const broken = JSON.parse(JSON.stringify(others)) as RollingOffer[];
    broken[0].Steps[0].Rewards[0].RewardID = 'reward.currency.ghostcoins';
    const result = run(OFFER_ROWS, STEP_ROWS, { others: broken });
    expect(validateRollingOfferConfig(result.config).map((issue) => issue.code)).toContain(
      'schema-reward-unknown',
    );
  });
});

describe('the live rolling offer payload', () => {
  it('passes its own schema gate', () => {
    expect(validateRollingOfferConfig(liveJson as RollingOfferConfig)).toEqual([]);
  });
});

describe('the workbook the template builds', () => {
  /**
   * The three tabs exactly as `setUpRollingOfferSheet` lays them out, so the
   * auto-selection is tested against the sheet people will actually load rather
   * than against a shape invented here.
   */
  const workbook = {
    sourceName: 'Rolling Offer - Autumn.xlsx',
    sheets: [
      sheet('Offer', OFFER_ROWS),
      sheet('Rewards', [['Reward Name', 'Reward ID'], ...REWARDS.map((r) => [r.name, r.id])]),
      sheet('Steps', STEP_ROWS),
    ],
  };

  it('picks the right tab for each job', () => {
    expect(autoSelectRollingOfferSheets(workbook)).toEqual({
      offer: 'Offer',
      steps: 'Steps',
      rewards: 'Rewards',
    });
  });

  it('is recognised as a rolling offer rather than a shop', () => {
    // The Steps tab carries Sold In and reward columns too, so this is the one
    // that could plausibly be taken for a shop workbook.
    expect(detectDataset(workbook)).toBe('rollingOffer');
  });
});
