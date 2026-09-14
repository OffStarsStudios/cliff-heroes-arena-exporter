import { findColumn, sheetHeaders } from './columns';
import { CURRENCY_NAMES, SHOP_SOLD_IN, isCurrencySoldIn, resolveSoldIn } from './currencies';
import { resolveLookup } from './lookups';
import { cellText, isBlank, isBlankRow, parseNumber } from './normalize';
import { PRICE_TIERS, isPriceTier, nearestPriceTiers } from './priceTiers';
import type {
  Issue,
  LookupTable,
  RawCell,
  RawSheet,
  RollingOffer,
  RollingOfferConfig,
  RollingOfferPreviewRow,
  RollingOfferReward,
  RollingOfferStep,
  RollingOfferTransformResult,
} from './types';

/**
 * Turns one offer's workbook into `rollingOfferSettings`.
 *
 * **One sheet is one offer, but the payload is the whole schedule.** The client
 * takes the offer list whole rather than merging it: an offer that stops
 * appearing is retired, and every player's progress under that ID is dropped on
 * the next launch. Publishing one sheet on its own would therefore retire every
 * other offer that is running. So the sheet's offer is merged into the live
 * schedule by `OfferID`, replacing an offer of that name or appending a new one,
 * and what gets published is the whole list.
 *
 * That merge is why `RollingOfferSchedule` carries the rest of the live payload:
 * the transformer is pure, so the schedule it merges into has to be handed to
 * it rather than fetched.
 *
 * **The window is not in the sheet.** Whether an offer is timed, when it opens
 * and how long it runs come from the live ops event that books it, for the same
 * reason the battle pass season header does - one answer rather than two that
 * have to be kept agreeing.
 */

/* ------------------------------------------------------------- settings -- */

/**
 * What the console knows that the sheet does not: this offer's window, and the
 * schedule it is being merged into.
 */
export interface RollingOfferSchedule {
  /** False for an evergreen offer: always on the menu, no clock. */
  isTimed: boolean;
  /** `YYYY-MM-DD HH:mm` UTC. Ignored when not timed. */
  startUtc: string;
  durationHours: number;
  /** The art every offer that names none of its own falls back to. */
  defaultBackgroundArt: string;
  defaultTopBarArt: string;
  defaultRewardArt: string;
  defaultButtonArt: string;
  /**
   * Every other offer currently live, in order. This one is merged into them by
   * ID; they are carried through untouched.
   */
  others: RollingOffer[];
}

export const EMPTY_SCHEDULE: RollingOfferSchedule = {
  isTimed: true,
  startUtc: '',
  durationHours: 336,
  defaultBackgroundArt: '',
  defaultTopBarArt: '',
  defaultRewardArt: '',
  defaultButtonArt: '',
  others: [],
};

/** `2026-09-01 00:00`, the only spelling the client parses. */
const START_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

export function validateSchedule(schedule: RollingOfferSchedule): Issue[] {
  const issues: Issue[] = [];
  if (!schedule.isTimed) return issues;

  if (schedule.startUtc.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'rollingoffer-start-missing',
      message: 'A timed offer needs a start. Book it on the live ops calendar, or make it evergreen.',
    });
  } else if (!START_PATTERN.test(schedule.startUtc.trim())) {
    issues.push({
      severity: 'error',
      code: 'rollingoffer-start-invalid',
      message: `"${schedule.startUtc}" is not a start the client can read. It wants YYYY-MM-DD HH:mm, in UTC.`,
    });
  }
  if (!(schedule.durationHours > 0)) {
    issues.push({
      severity: 'error',
      code: 'rollingoffer-duration-invalid',
      message: `A timed offer runs for a positive number of hours, not ${schedule.durationHours}.`,
    });
  }
  return issues;
}

/* ------------------------------------------------------------ the offer -- */

/** The Offer tab's rows, by the label in its first column. */
const OFFER_FIELDS = [
  'Offer ID',
  'Display Name',
  'Subtitle',
  'Completion Reward',
  'Completion Amount',
  'Completion Text',
  'Background Art',
  'Top Bar Art',
  'Reward Art',
  'Button Art',
] as const;

type OfferField = (typeof OFFER_FIELDS)[number];

/** IDs the client reads verbatim; the convention is `offer.<name>`. */
const ID_PATTERN = /^offer\.[a-z0-9]+(\.[a-z0-9]+)+$/;

/**
 * Reads the key/value Offer tab.
 *
 * Matched on the label in column A rather than on row position, so inserting a
 * row or reordering the tab does not silently shift every field by one.
 */
function readOffer(sheet: RawSheet, issues: Issue[]): Partial<Record<OfferField, string>> {
  const found: Partial<Record<OfferField, string>> = {};
  const seen = new Set<string>();

  for (let r = 0; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    if (isBlankRow(row)) continue;
    const label = cellText(row[0] ?? null);
    if (label === null) continue;

    const field = OFFER_FIELDS.find((candidate) => candidate.toLowerCase() === label.toLowerCase());
    if (field === undefined) continue;
    if (seen.has(field)) {
      issues.push({
        severity: 'error',
        code: 'rollingoffer-field-duplicate',
        message: `"${field}" appears twice on the "${sheet.name}" tab. Each setting is given once.`,
        sheetRow: r + 1,
      });
      continue;
    }
    seen.add(field);
    const value = cellText(row[1] ?? null);
    if (value !== null) found[field] = value;
  }

  for (const field of OFFER_FIELDS) {
    if (!seen.has(field)) {
      issues.push({
        severity: 'error',
        code: 'rollingoffer-field-missing',
        message: `The "${sheet.name}" tab has no "${field}" row.`,
      });
    }
  }
  return found;
}

/* ------------------------------------------------------------ the steps -- */

const STEP_COLUMNS = {
  soldIn: ['sold in', 'sold', 'payment', 'purchase type'],
  price: ['price', 'price in currency', 'currency price'],
  priceTier: ['price tier', 'tier', 'dollars', 'usd'],
  adPlacement: ['ad placement', 'placement'],
} as const;

interface RewardSlot {
  nameIndex: number;
  amountIndex: number;
  label: string;
}

/** The `Reward N` / `Amount N` pairs, in numeric order. */
function findRewardSlots(headers: string[]): RewardSlot[] {
  const slots: RewardSlot[] = [];
  for (let n = 1; n <= 12; n += 1) {
    const nameIndex = findColumn(headers, [`reward ${n}`]);
    const amountIndex = findColumn(headers, [`amount ${n}`]);
    if (nameIndex === -1 || amountIndex === -1) continue;
    slots.push({ nameIndex, amountIndex, label: `Reward ${n}` });
  }
  return slots;
}

const wholeAtLeastOne = (value: number) =>
  Number.isInteger(value) && value >= 1 ? null : `must be a whole number of 1 or more, not ${value}.`;

/* ------------------------------------------------------------ transform -- */

export interface RollingOfferTransformInput {
  /** The Offer key/value tab. */
  offer: RawSheet;
  /** The Steps tab: one row per rung. */
  steps: RawSheet;
  /** Reward name -> reward ID, built from the Rewards lookup tab. */
  rewards: LookupTable;
  schedule: RollingOfferSchedule;
}

export function transformRollingOffer(input: RollingOfferTransformInput): RollingOfferTransformResult {
  const issues: Issue[] = [];
  const { schedule } = input;
  issues.push(...validateSchedule(schedule));

  const fields = readOffer(input.offer, issues);
  const offerId = fields['Offer ID'] ?? '';
  const where = offerId === '' ? `the "${input.offer.name}" tab` : `"${offerId}"`;

  if (offerId === '') {
    issues.push({
      severity: 'error',
      code: 'rollingoffer-id-missing',
      message: 'The offer has no ID. It is what a player’s progress is filed under, so it cannot be blank.',
    });
  } else if (!ID_PATTERN.test(offerId)) {
    issues.push({
      severity: 'warning',
      code: 'rollingoffer-id-format',
      message: `${where} does not follow the offer.<name> pattern (lowercase letters and digits). Progress is filed under the exact ID.`,
    });
  }

  /** The completion reward, which an offer may finish without. */
  let completion: RollingOfferReward | undefined;
  const completionName = fields['Completion Reward'];
  if (completionName !== undefined && completionName !== '') {
    const resolved = resolveLookup(input.rewards, completionName);
    if (!resolved.ok) {
      issues.push({
        severity: 'error',
        code: 'rollingoffer-reward-unknown',
        message: `"${completionName}" is the completion reward of ${where}, but the Rewards tab has no entry for it.`,
      });
    } else {
      const raw = fields['Completion Amount'];
      // Zero is the client's own "pay what the reward is authored to pay", so a
      // blank amount is expressed that way rather than refused.
      let amount = 0;
      if (raw !== undefined && raw !== '') {
        const parsed = parseNumber(raw as RawCell);
        const problem = parsed.ok ? wholeAtLeastOne(parsed.value) : `must be a number, not ${JSON.stringify(raw)}.`;
        if (problem !== null) {
          issues.push({
            severity: 'error',
            code: 'rollingoffer-amount-invalid',
            message: `The completion amount of ${where} ${problem}`,
          });
        } else {
          amount = parsed.value;
        }
      }
      completion = { RewardID: resolved.id, Amount: amount };
    }
  }

  const headers = sheetHeaders(input.steps);
  const index = {
    soldIn: findColumn(headers, [...STEP_COLUMNS.soldIn]),
    price: findColumn(headers, [...STEP_COLUMNS.price]),
    priceTier: findColumn(headers, [...STEP_COLUMNS.priceTier]),
    adPlacement: findColumn(headers, [...STEP_COLUMNS.adPlacement]),
  };
  if (index.soldIn === -1) {
    issues.push({
      severity: 'error',
      code: 'rollingoffer-missing-column',
      message: `The "${input.steps.name}" tab has no "Sold In" column.`,
    });
  }
  const slots = findRewardSlots(headers);
  if (slots.length === 0) {
    issues.push({
      severity: 'error',
      code: 'rollingoffer-missing-column',
      message: `The "${input.steps.name}" tab has no reward columns. Expected headers such as "Reward 1" and "Amount 1".`,
    });
  }

  const steps: RollingOfferStep[] = [];
  const preview: RollingOfferPreviewRow[] = [];

  for (let r = 1; r < input.steps.rows.length; r += 1) {
    const row = input.steps.rows[r];
    const sheetRow = r + 1;
    // The step number is written by the sheet, so a row holding only that is
    // an empty row rather than a step that says nothing.
    const body = row.filter((cell, column) => column !== 0 && !isBlank(cell));
    if (body.length === 0) continue;

    const position = steps.length + 1;
    const at = `step ${position} of ${where}`;
    let valid = true;
    const fail = (code: string, message: string) => {
      issues.push({ severity: 'error', code, message: `${at}: ${message}`, sheetRow });
      valid = false;
    };

    const soldInText = index.soldIn === -1 ? null : cellText(row[index.soldIn] ?? null);
    let soldIn: RollingOfferStep['SoldIn'] | null = null;
    if (soldInText === null) {
      fail('rollingoffer-sold-in-missing', 'Sold In is empty, so the client would drop the step.');
    } else {
      const resolved = resolveSoldIn(soldInText);
      if (resolved.status === 'unknown') {
        const hint =
          resolved.suggestion === null
            ? `The options are ${SHOP_SOLD_IN.join(', ')}.`
            : `Did you mean "${resolved.suggestion}"?`;
        fail('rollingoffer-sold-in-unknown', `"${soldInText}" is not a way a step is paid for. ${hint}`);
      } else {
        soldIn = resolved.name;
        if (resolved.status === 'corrected') {
          issues.push({
            severity: 'warning',
            code: 'rollingoffer-sold-in-spelling',
            message: `${at}: "${soldInText}" is exported as "${resolved.name}".`,
            sheetRow,
          });
        }
      }
    }

    const numberAt = (column: number, label: string, code: string): number | null => {
      if (column === -1) return null;
      const cell = row[column] ?? null;
      if (isBlank(cell)) return null;
      const parsed = parseNumber(cell);
      if (!parsed.ok) {
        fail(code, `${label} must be a number, not ${JSON.stringify(cell)}.`);
        return null;
      }
      return parsed.value;
    };

    const price = numberAt(index.price, 'Price', 'rollingoffer-price-invalid');
    const priceTier = numberAt(index.priceTier, 'Price Tier', 'rollingoffer-price-tier-invalid');
    const adPlacement = index.adPlacement === -1 ? null : cellText(row[index.adPlacement] ?? null);

    if (soldIn !== null) {
      if (soldIn === 'RealMoney') {
        if (priceTier === null) {
          fail(
            'rollingoffer-price-tier-missing',
            'sold for real money but has no Price Tier. The tier is both the dollar price and the store SKU, and without one the client drops the step.',
          );
        } else if (!isPriceTier(priceTier)) {
          const near = nearestPriceTiers(priceTier);
          fail(
            'rollingoffer-price-tier-invalid',
            `Price Tier must be one of the dollar prices the stores stock (${PRICE_TIERS.join(', ')}), not ${priceTier}.` +
              (near.length > 0 ? ` The nearest stocked prices are $${near.join(' and $')}.` : ''),
          );
        }
      }
      if (isCurrencySoldIn(soldIn) && price === null) {
        fail('rollingoffer-price-missing', `sold for ${soldIn} but has no Price.`);
      }
      if (!isCurrencySoldIn(soldIn) && price !== null) {
        fail(
          'rollingoffer-price-unexpected',
          `has a Price, but "${soldIn}" is not one of the currencies the player holds (${CURRENCY_NAMES.join(', ')}). Use Price Tier for a dollar price.`,
        );
      }
    }

    const rewards: RollingOfferReward[] = [];
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const slot of slots) {
      const name = cellText(row[slot.nameIndex] ?? null);
      const amountCell = row[slot.amountIndex] ?? null;
      if (name === null) {
        if (!isBlank(amountCell)) {
          fail(
            'rollingoffer-reward-orphan-amount',
            `"${slot.label}" is empty but its amount is ${JSON.stringify(amountCell)}.`,
          );
        }
        continue;
      }
      const resolved = resolveLookup(input.rewards, name);
      if (!resolved.ok) {
        fail(
          resolved.reason === 'ambiguous' ? 'rollingoffer-reward-ambiguous' : 'rollingoffer-reward-unknown',
          resolved.reason === 'ambiguous'
            ? `"${name}" appears more than once on the Rewards tab with different IDs.`
            : `"${name}" in "${slot.label}" has no entry on the Rewards tab.`,
        );
        continue;
      }
      if (seen.has(resolved.id)) {
        fail('rollingoffer-reward-duplicate', `pays "${name}" twice. Add the amounts together instead.`);
        continue;
      }
      let amount = 0;
      if (!isBlank(amountCell)) {
        const parsed = parseNumber(amountCell);
        const problem = parsed.ok ? wholeAtLeastOne(parsed.value) : `must be a number, not ${JSON.stringify(amountCell)}.`;
        if (problem !== null) {
          fail('rollingoffer-amount-invalid', `the amount of "${name}" ${problem}`);
          continue;
        }
        amount = parsed.value;
      }
      seen.add(resolved.id);
      rewards.push({ RewardID: resolved.id, Amount: amount });
      labels.push(amount === 0 ? name : `${name} x${amount}`);
    }

    // A step that hands nothing over is not a step - it is a price with nothing
    // behind it, and the client drops it.
    if (rewards.length === 0 && valid) {
      fail('rollingoffer-step-pays-nothing', 'pays nothing, so the client would drop it.');
    }
    if (!valid || soldIn === null) continue;

    const step: RollingOfferStep = { SoldIn: soldIn } as RollingOfferStep;
    if (price !== null) step.Price = price;
    if (priceTier !== null) step.PriceTier = priceTier;
    if (adPlacement !== null) step.AdPlacement = adPlacement;
    step.Rewards = rewards;
    steps.push(step);

    preview.push({
      step: position,
      soldIn,
      price:
        soldIn === 'RealMoney' && priceTier !== null
          ? `$${priceTier}`
          : price !== null
            ? `${price.toLocaleString()} ${soldIn}`
            : soldIn === 'Ad'
              ? 'Rewarded ad'
              : 'Free',
      rewards: labels,
      sheetRow,
    });
  }

  if (steps.length === 0) {
    issues.push({
      severity: 'error',
      code: 'rollingoffer-no-steps',
      message: `${where} has no steps the client could read, so it would be dropped whole.`,
    });
  }

  /* ---------------------------------------------------------- the merge -- */

  const offer: RollingOffer = {
    OfferID: offerId,
    DisplayName: fields['Display Name'] ?? '',
    Subtitle: fields.Subtitle ?? '',
    IsTimed: schedule.isTimed,
  } as RollingOffer;
  if (schedule.isTimed) {
    offer.StartUtc = schedule.startUtc.trim();
    offer.DurationHours = schedule.durationHours;
  }
  for (const [key, field] of [
    ['BackgroundArt', 'Background Art'],
    ['TopBarArt', 'Top Bar Art'],
    ['RewardArt', 'Reward Art'],
    ['ButtonArt', 'Button Art'],
  ] as const) {
    const value = fields[field];
    if (value !== undefined && value !== '') offer[key] = value;
  }
  // The live payload puts the text before the reward, and key order is what a
  // published diff is read against.
  const completionText = fields['Completion Text'];
  if (completionText !== undefined && completionText !== '') offer.CompletionText = completionText;
  if (completion !== undefined) offer.CompletionReward = completion;
  offer.Steps = steps;

  // Replace an offer of this ID, or append. Order is the order the buttons are
  // drawn in, so an offer being updated keeps its place rather than jumping to
  // the end of the row.
  const merged = schedule.others.filter((other) => other.OfferID !== offerId);
  const at = schedule.others.findIndex((other) => other.OfferID === offerId);
  if (at === -1) merged.push(offer);
  else merged.splice(at, 0, offer);

  const config: RollingOfferConfig = {} as RollingOfferConfig;
  for (const [key, value] of [
    ['DefaultBackgroundArt', schedule.defaultBackgroundArt],
    ['DefaultTopBarArt', schedule.defaultTopBarArt],
    ['DefaultRewardArt', schedule.defaultRewardArt],
    ['DefaultButtonArt', schedule.defaultButtonArt],
  ] as const) {
    config[key] = value;
  }
  config.Offers = merged;

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return {
    config,
    preview,
    issues,
    offerId,
    stats: {
      steps: steps.length,
      rewards: steps.reduce((sum, step) => sum + step.Rewards.length, 0),
      offers: merged.length,
      errors,
      warnings: issues.length - errors,
    },
  };
}
