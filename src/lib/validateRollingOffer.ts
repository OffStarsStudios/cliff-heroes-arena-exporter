import { isCurrencySoldIn, isShopSoldIn, SHOP_SOLD_IN } from './currencies';
import { PRICE_TIERS, isPriceTier } from './priceTiers';
import { isRewardId } from './rewards';
import type { Issue, RollingOfferConfig } from './types';

/**
 * Final gate before export: re-checks the generated object against the exact
 * output schema. Deliberately independent of the transformer, so a regression
 * there cannot ship a malformed schedule.
 *
 * It judges the **whole merged schedule**, not just the offer that was edited.
 * That is the point: a sheet publishes the entire offer list, so an offer that
 * was already live and has quietly become invalid - a reward removed from the
 * build, say - has to be caught here rather than shipped because nobody touched
 * its sheet.
 */

const ROOT_KEYS = [
  'DefaultBackgroundArt',
  'DefaultTopBarArt',
  'DefaultRewardArt',
  'DefaultButtonArt',
  'Offers',
];

const OFFER_KEYS = [
  'OfferID',
  'DisplayName',
  'Subtitle',
  'IsTimed',
  'StartUtc',
  'DurationHours',
  'BackgroundArt',
  'TopBarArt',
  'RewardArt',
  'ButtonArt',
  'CompletionText',
  'CompletionReward',
  'Steps',
];

const STEP_KEYS = ['SoldIn', 'Price', 'PriceTier', 'AdPlacement', 'Rewards'];

const START_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
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

function checkReward(value: unknown, position: string, issues: Issue[]): void {
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record ?? {});
  if (!Array.isArray(keys) || keys.length !== 2 || keys[0] !== 'RewardID' || keys[1] !== 'Amount') {
    issues.push({
      severity: 'error',
      code: 'schema-reward-keys',
      message: `${position}: must contain exactly [RewardID, Amount] in that order (found: ${keys.join(', ')}).`,
    });
    return;
  }
  if (!isString(record.RewardID) || record.RewardID === '') {
    issues.push({
      severity: 'error',
      code: 'schema-reward-id',
      message: `${position}: "RewardID" must be a non-empty string.`,
    });
  } else if (!isRewardId(record.RewardID)) {
    // The client drops a step paying a reward it does not have, so a step that
    // pays only that reward is a rung the player never sees.
    issues.push({
      severity: 'error',
      code: 'schema-reward-unknown',
      message: `${position}: "${record.RewardID}" is not a reward the game registers.`,
    });
  }
  // Zero is the client's "pay what the reward is authored to pay".
  if (!isFiniteNumber(record.Amount) || !Number.isInteger(record.Amount) || record.Amount < 0) {
    issues.push({
      severity: 'error',
      code: 'schema-reward-amount',
      message: `${position}: "Amount" must be a whole number of 0 or more, not ${JSON.stringify(record.Amount)}.`,
    });
  }
}

export function validateRollingOfferConfig(config: RollingOfferConfig): Issue[] {
  const issues: Issue[] = [];
  const record = config as unknown as Record<string, unknown>;

  if (!inSchemaOrder(Object.keys(record), ROOT_KEYS)) {
    issues.push({
      severity: 'error',
      code: 'schema-root',
      message: `The root object must follow the order [${ROOT_KEYS.join(', ')}] (found: ${Object.keys(record).join(', ')}).`,
    });
  }
  for (const key of ['DefaultBackgroundArt', 'DefaultTopBarArt', 'DefaultRewardArt', 'DefaultButtonArt']) {
    if (key in record && !isString(record[key])) {
      issues.push({
        severity: 'error',
        code: 'schema-default-art',
        message: `"${key}" must be a string when present, not ${JSON.stringify(record[key])}.`,
      });
    }
  }

  const offers = record.Offers;
  if (!Array.isArray(offers)) {
    issues.push({ severity: 'error', code: 'schema-offers', message: '"Offers" must be an array.' });
    return issues;
  }
  if (offers.length === 0) {
    // A schedule resolving no offers is refused by the client rather than
    // applied, since it would otherwise retire every offer at once.
    issues.push({
      severity: 'error',
      code: 'no-offers',
      message: 'The generated schedule lists no offers, which the client refuses rather than applying.',
    });
  }

  const seen = new Set<string>();
  offers.forEach((value, index) => {
    const offer = value as Record<string, unknown>;
    const position = `Offer ${index + 1}`;
    const keys = Object.keys(offer);

    if (!inSchemaOrder(keys, OFFER_KEYS)) {
      issues.push({
        severity: 'error',
        code: 'schema-offer-keys',
        message: `${position}: keys must follow the order [${OFFER_KEYS.join(', ')}] with unused ones omitted (found: ${keys.join(', ')}).`,
      });
    }

    if (!isString(offer.OfferID) || offer.OfferID === '') {
      issues.push({
        severity: 'error',
        code: 'schema-offer-id',
        message: `${position}: "OfferID" must be a non-empty string - it is what progress is filed under.`,
      });
    } else if (seen.has(offer.OfferID)) {
      issues.push({
        severity: 'error',
        code: 'schema-offer-id-duplicate',
        message: `${position}: "${offer.OfferID}" appears twice. Which one wins is undefined, and both share one progress record.`,
      });
    } else {
      seen.add(offer.OfferID);
    }

    if (typeof offer.IsTimed !== 'boolean') {
      issues.push({
        severity: 'error',
        code: 'schema-offer-timed',
        message: `${position}: "IsTimed" must be true or false.`,
      });
    }
    if (offer.IsTimed === true) {
      if (!isString(offer.StartUtc) || !START_PATTERN.test(offer.StartUtc)) {
        issues.push({
          severity: 'error',
          code: 'schema-offer-start',
          message: `${position}: a timed offer needs "StartUtc" as YYYY-MM-DD HH:mm, not ${JSON.stringify(offer.StartUtc)}.`,
        });
      }
      if (!isFiniteNumber(offer.DurationHours) || offer.DurationHours <= 0) {
        issues.push({
          severity: 'error',
          code: 'schema-offer-duration',
          message: `${position}: a timed offer needs a positive "DurationHours", not ${JSON.stringify(offer.DurationHours)}.`,
        });
      }
    }
    if ('CompletionReward' in offer) checkReward(offer.CompletionReward, `${position}, completion reward`, issues);

    const steps = offer.Steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      issues.push({
        severity: 'error',
        code: 'schema-offer-steps',
        message: `${position}: "Steps" must be a non-empty array - an offer with no steps is dropped whole.`,
      });
      return;
    }

    steps.forEach((value, stepIndex) => {
      const step = value as Record<string, unknown>;
      const at = `${position}, step ${stepIndex + 1}`;
      if (!inSchemaOrder(Object.keys(step), STEP_KEYS)) {
        issues.push({
          severity: 'error',
          code: 'schema-step-keys',
          message: `${at}: keys must follow the order [${STEP_KEYS.join(', ')}] (found: ${Object.keys(step).join(', ')}).`,
        });
      }

      if (!isShopSoldIn(step.SoldIn)) {
        issues.push({
          severity: 'error',
          code: 'schema-step-sold-in',
          message: `${at}: "SoldIn" must be one of ${SHOP_SOLD_IN.join(', ')}, not ${JSON.stringify(step.SoldIn)}.`,
        });
      } else if (step.SoldIn === 'RealMoney' && !isPriceTier(step.PriceTier)) {
        issues.push({
          severity: 'error',
          code: 'schema-step-price-tier',
          message: `${at}: sold for real money, so "PriceTier" must be one of ${PRICE_TIERS.join(', ')}, not ${JSON.stringify(step.PriceTier)}.`,
        });
      } else if (isCurrencySoldIn(step.SoldIn) && !isFiniteNumber(step.Price)) {
        issues.push({
          severity: 'error',
          code: 'schema-step-price',
          message: `${at}: sold for ${step.SoldIn}, so "Price" must be a number, not ${JSON.stringify(step.Price)}.`,
        });
      }
      if ('AdPlacement' in step && !isString(step.AdPlacement)) {
        issues.push({
          severity: 'error',
          code: 'schema-step-placement',
          message: `${at}: "AdPlacement" must be a string when present.`,
        });
      }

      const rewards = step.Rewards;
      if (!Array.isArray(rewards) || rewards.length === 0) {
        issues.push({
          severity: 'error',
          code: 'schema-step-rewards',
          message: `${at}: "Rewards" must be a non-empty array - a step paying nothing is dropped.`,
        });
        return;
      }
      rewards.forEach((reward, rewardIndex) => {
        checkReward(reward, `${at}, reward ${rewardIndex + 1}`, issues);
      });
    });
  });

  return issues;
}

/** Pretty-prints the config exactly as it should be written to disk. */
export function serializeRollingOfferConfig(config: RollingOfferConfig): string {
  return JSON.stringify(config, null, 2);
}
