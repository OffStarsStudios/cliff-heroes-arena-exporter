import { RollingOfferPreviewTable } from '../components/RollingOfferPreviewTable';
import { OfferWindowPanel } from '../components/OfferWindowPanel';
import { PRESENTATION_FIELDS, emptyPresentation, type Presentation } from '../lib/liveops';
import { buildLookup } from '../lib/lookups';
import {
  EMPTY_SCHEDULE,
  transformRollingOffer,
  validateSchedule,
  type RollingOfferSchedule,
} from '../lib/rollingOffer';
import { autoSelectRollingOfferSheets, type RollingOfferSheetSelection } from '../lib/sheetSelect';
import { serializeRollingOfferConfig, validateRollingOfferConfig } from '../lib/validateRollingOffer';
import type { RollingOffer, RollingOfferConfig, RollingOfferPreviewRow } from '../lib/types';
import { rewardRegistryFromLookup } from '../workspace/registry';
import type { ExporterDefinition } from './types';

/** A stored panel's text and art, field by field, with anything missing left blank. */
function revivePresentation(stored: unknown): Presentation {
  const presentation = emptyPresentation();
  if (stored === null || typeof stored !== 'object') return presentation;
  for (const field of PRESENTATION_FIELDS) {
    const value = (stored as Record<string, unknown>)[field];
    if (typeof value === 'string') presentation[field] = value;
  }
  return presentation;
}

/**
 * Reads the schedule out of anything shaped like a published
 * `rollingOfferSettings`.
 *
 * Two jobs at once, which is why it is one function. It seeds the window from
 * whichever offer the sheet is about, **and** it captures every other offer so
 * the transformer can merge into them - the client takes the offer list whole,
 * so publishing without the others would retire them.
 *
 * The offer this sheet describes cannot be known here: the payload is read
 * before any workbook is loaded. So every offer is kept as "other", and the
 * transformer drops the one whose ID matches before inserting its own. That
 * ordering is what makes re-publishing an existing offer an update rather than
 * a duplicate.
 */
function scheduleFrom(payload: unknown): RollingOfferSchedule | null {
  if (payload === null || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  const offers = Array.isArray(record.Offers) ? (record.Offers as RollingOffer[]) : null;
  if (offers === null) return null;

  const text = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string) : '');

  // A stored panel value comes back with the same shape, so one reader serves
  // both and they cannot drift apart.
  const stored = record as unknown as Partial<RollingOfferSchedule>;
  const isTimed = typeof stored.isTimed === 'boolean' ? stored.isTimed : true;

  return {
    isTimed,
    startUtc: typeof stored.startUtc === 'string' ? stored.startUtc : '',
    durationHours: typeof stored.durationHours === 'number' ? stored.durationHours : 336,
    defaultBackgroundArt: text('DefaultBackgroundArt'),
    defaultTopBarArt: text('DefaultTopBarArt'),
    defaultRewardArt: text('DefaultRewardArt'),
    defaultButtonArt: text('DefaultButtonArt'),
    presentation: revivePresentation(stored.presentation),
    others: offers,
  };
}

/**
 * A stored panel value: the window and the art, never the offer list.
 *
 * The list is what the offer is merged into, and it has to be the one live now.
 * It used to be revived from here, which meant a browser that last opened the
 * page before an offer went live would publish a list without it - retiring it,
 * and dropping its players' progress. `followLive` fills it in instead.
 */
function reviveSchedule(stored: unknown): RollingOfferSchedule | null {
  if (stored === null || typeof stored !== 'object') return null;
  const record = stored as Partial<RollingOfferSchedule>;
  if (typeof record.isTimed !== 'boolean') return null;
  return {
    isTimed: record.isTimed,
    startUtc: typeof record.startUtc === 'string' ? record.startUtc : '',
    durationHours: typeof record.durationHours === 'number' ? record.durationHours : 336,
    defaultBackgroundArt: record.defaultBackgroundArt ?? '',
    defaultTopBarArt: record.defaultTopBarArt ?? '',
    defaultRewardArt: record.defaultRewardArt ?? '',
    defaultButtonArt: record.defaultButtonArt ?? '',
    presentation: revivePresentation(record.presentation),
    others: null,
  };
}

/** The live offer list and the list-level art, onto whatever the panel holds. */
function followLiveSchedule(value: RollingOfferSchedule, live: { payload: unknown } | null): RollingOfferSchedule {
  if (live === null) return { ...value, others: null };
  // A setting that holds nothing yet is a schedule with no offers, which is an
  // answer - unlike a read that failed.
  const fromLive = live.payload === null ? null : scheduleFrom(live.payload);
  if (fromLive === null) return { ...value, others: [] };
  return {
    ...value,
    defaultBackgroundArt: fromLive.defaultBackgroundArt,
    defaultTopBarArt: fromLive.defaultTopBarArt,
    defaultRewardArt: fromLive.defaultRewardArt,
    defaultButtonArt: fromLive.defaultButtonArt,
    others: fromLive.others,
  };
}

/** `2026-10-01T09:00:00.000Z` -> `2026-10-01 09:00`, the only spelling the client reads. */
function toClientUtc(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`
  );
}

export const ROLLING_OFFER_EXPORTER: ExporterDefinition<
  RollingOfferSheetSelection,
  RollingOfferConfig,
  RollingOfferPreviewRow,
  RollingOfferSchedule
> = {
  domain: 'rollingOffer',
  dataset: 'rollingOffer',
  view: 'rollingOffer',
  title: 'Rolling offers',
  lead: (
    <>
      One workbook per offer, under a base ID. Each run goes out as the base plus the day it opens, so a re-run
      starts every player fresh. It is merged into the live schedule and the whole list is published &mdash; the
      client takes it whole, so an offer left out is an offer retired.
    </>
  ),
  icon: 'zap',
  badge: 'shop',
  downloadFilename: 'rollingOfferSettings.json',
  tabsHint: 'Three tabs: the offer, its steps, and the rewards lookup.',
  tabs: [
    {
      key: 'offer',
      label: 'Offer',
      note: 'The key/value tab: the base ID and the completion reward.',
    },
    {
      key: 'steps',
      label: 'Steps',
      note: 'One row per rung: how it is paid for, what it costs, what it pays.',
    },
    {
      key: 'rewards',
      label: 'Rewards lookup',
      note: 'Maps each reward name to its reward ID.',
    },
  ],
  autoSelect: autoSelectRollingOfferSheets,
  controls: {
    title: 'Offer details and window',
    eventTitle: 'Window and live offers',
    hint: 'What players see, when it runs, and what it joins',
    note: (
      <>
        Set here, not on the sheet: an offer&rsquo;s title, art and dates are decisions about a live run. When
        it is booked on the calendar the event owns them outright.
      </>
    ),
    initial: EMPTY_SCHEDULE,
    fromLive: scheduleFrom,
    revive: reviveSchedule,
    followLive: followLiveSchedule,
    Panel: OfferWindowPanel,
    validate: validateSchedule,
    summary: (schedule) => {
      const name = schedule.presentation?.DisplayName.trim() ?? '';
      const titled = (text: string) => (name === '' ? text : `${name}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`);
      if (!schedule.isTimed) return titled('Evergreen');
      if (schedule.startUtc.trim() === '') return titled('No start set');
      const days = schedule.durationHours / 24;
      const length =
        days >= 1 && Number.isInteger(days) ? `${days} day${days === 1 ? '' : 's'}` : `${schedule.durationHours}h`;
      return titled(`${schedule.startUtc} for ${length}`);
    },
  },
  eventSettings(base, { opensAt, endsAt }) {
    // An offer published by an event runs for exactly as long as the event, so
    // the booking is the answer. An event with no end is an evergreen offer -
    // which is also how an offer with no window is drawn on the calendar.
    const hours = opensAt === null || endsAt === null ? NaN : (Date.parse(endsAt) - Date.parse(opensAt)) / 3600000;
    // The event form sets the text and art, and the server writes them in.
    if (opensAt === null || !Number.isFinite(hours) || hours <= 0) {
      return { ...base, presentation: null, isTimed: false, startUtc: '', durationHours: 0 };
    }
    return {
      ...base,
      presentation: null,
      isTimed: true,
      startUtc: toClientUtc(opensAt),
      // Hundredths of an hour, the same rounding the scheduler writes into the
      // offer, so the form never shows a different length from the one published.
      durationHours: Math.round(hours * 100) / 100,
    };
  },
  analyze(sheets, schedule) {
    const rewards = buildLookup(sheets.rewards, 'reward');
    const result = transformRollingOffer({
      offer: sheets.offer,
      steps: sheets.steps,
      rewards: rewards.table,
      schedule,
    });
    return {
      config: result.config,
      preview: result.preview,
      issues: [...rewards.issues, ...result.issues],
      stats: [
        { label: 'Steps', value: result.stats.steps },
        { label: 'Rewards', value: result.stats.rewards },
        { label: 'Offers published', value: result.stats.offers },
      ],
      count: result.stats.steps,
      registry: rewardRegistryFromLookup(rewards.table, 'rollingOffer'),
      // Which offer this workbook is. An event booking it records this so that
      // ending the event removes this offer from the schedule rather than
      // restoring a payload - there is no "off" version of a list.
      subject: result.offerId === '' ? undefined : result.offerId,
    };
  },
  validate: validateRollingOfferConfig,
  serialize: serializeRollingOfferConfig,
  PreviewTable: RollingOfferPreviewTable,
  noun: { singular: 'step', plural: 'steps' },
  errorContext: 'the offer is not exported while any step is unreadable',
};
