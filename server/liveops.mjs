/**
 * Live ops: the features that are not always there.
 *
 * The eight configs the console already publishes describe a game that is
 * always running - heroes have stats, arenas have thresholds, the shop has
 * products. A live ops feature is different in one way that changes
 * everything downstream: when its event is over the feature is *gone*, not
 * reverted to a previous version of itself. There is no "last season's battle
 * pass" to fall back to; there is simply no pass.
 *
 * That is why this module exists rather than a `category` field on a schedule
 * entry. The scheduler's central guardrail is that a window which ends must
 * have somewhere to go back to, and for the core configs that place is
 * `config/defaults/<domain>.json` - the last known-good version. For a live
 * ops feature the same guardrail needs a different answer: `config/off/`,
 * the payload that means "this feature is not running". Restoring a default
 * battle pass when a season ends would start last season again.
 *
 * Everything else is reused deliberately. An event is a scheduling window with
 * a few more fields on it, stored in the same `schedules/schedules.json`,
 * applied by the same heartbeat, guarded by the same overlap and drift checks.
 * A second store with its own tick would be a second thing to get wrong.
 */

import { readJson, commitJson } from './git.mjs';

/**
 * Domains that are scheduled as events rather than configured permanently.
 *
 * Deliberately short. Trophy road, hero stats, arenas, match trophies, bots,
 * hero upgrades and the shop are core: they are always live, they are edited
 * on their own pages, and they have no business on a calendar.
 */
export const LIVEOPS_DOMAINS = ['battlePass'];

export function isLiveOpsDomain(domain) {
  return LIVEOPS_DOMAINS.includes(domain);
}

/** True for a schedule entry that was booked as a live ops event. */
export function isLiveOpsEntry(entry) {
  return entry?.liveops !== undefined && entry?.liveops !== null;
}

/**
 * What "not running" looks like for each live ops feature.
 *
 * Shaped like the real payload rather than `{}` on purpose: a typed client
 * that deserialises `battlePassSettings` into a struct would throw on an empty
 * object, whereas it reads this happily and finds no season and no tiers. The
 * emptiness is the signal - an empty `SeasonID` and an empty `Tiers` is how
 * the client is expected to know there is no pass.
 *
 * These are seeds. The file in `config/off/` is the truth once it exists, so
 * the shape can be corrected from the back office without a deploy if the
 * client wants a different sentinel.
 */
export const OFF_SEEDS = {
  battlePass: {
    SeasonID: '',
    SeasonName: '',
    StartUtc: '',
    DurationDays: 0,
    TokensPerTier: 0,
    PremiumProductID: '',
    SkipTierCost: 0,
    SkipCurrencyID: '',
    FinalRewardArt: '',
    Tiers: [],
  },
};

/** How each feature's off payload says "not running", in one sentence. */
export const OFF_MEANS = {
  battlePass: 'An empty Season ID and no tiers. The client shows no pass.',
};

export function offPath(domain) {
  return `config/off/${domain}.json`;
}

/** The off payload for a feature, or null when none has been recorded. */
export async function loadOff(domain) {
  const { value, existed } = await readJson(offPath(domain), null);
  return existed ? value : null;
}

export async function saveOff(domain, payload, note) {
  const result = await commitJson({
    path: offPath(domain),
    value: payload,
    message: `Set the off state for ${domain}\n\n${
      note ?? 'What the game receives when no event of this feature is running.'
    }`,
  });
  if (!result.committed) {
    throw new Error(`The off state could not be saved: ${result.reason}`);
  }
  return result;
}

/* ------------------------------------------------------------ the model -- */

/**
 * Why an event is running. Only used for grouping and colour, but it is the
 * question a live ops calendar is read to answer - "what monetisation is up
 * this week" - so it is a field rather than a note somebody has to parse.
 */
export const EVENT_CATEGORIES = ['monetization', 'engagement', 'seasonal', 'test'];

/**
 * How long before it opens the config is published, by default.
 *
 * Publishing early is what lets the client advertise a pass before it starts:
 * the payload carries its own start time, so the game can show a countdown
 * while treating the season as not yet begun. Zero is also valid - it just
 * means the event appears the moment it opens.
 */
export const DEFAULT_PREVIEW_HOURS = 0;

/** Inside this much of the end, an event is "ending soon" rather than merely active. */
export const ENDING_SOON_HOURS = 24;

const HOUR_MS = 3600 * 1000;

/**
 * The phase an event is in, which is not the same as the schedule state.
 *
 * The state answers "has the scheduler done its job" - scheduled, active,
 * completed, failed. The phase answers "what does a player see", and those
 * come apart exactly where it matters: an active window is in `preview` until
 * the event opens, and `ending` in its last day.
 */
export function phaseOf(entry, now = Date.now()) {
  if (entry.state === 'cancelled' || entry.state === 'missed' || entry.state === 'superseded') {
    return 'off';
  }
  const opens = Date.parse(entry.liveops?.opensAt ?? entry.startsAt);
  const ends = entry.endsAt === null ? Infinity : Date.parse(entry.endsAt);

  if (now >= ends) return 'ended';
  if (now < Date.parse(entry.startsAt)) return 'scheduled';
  if (now < opens) return 'preview';
  if (ends !== Infinity && ends - now <= ENDING_SOON_HOURS * HOUR_MS) return 'ending';
  return 'active';
}

/**
 * Everything a window needs to be a live ops event, checked before it is
 * booked. Returned as a list, like the scheduler's own guardrails, so the form
 * can show every problem at once.
 *
 * The missing off state is deliberately not checked here: it is the same
 * guardrail the scheduler already applies to every ending window, so it is
 * answered once, in `checkEntry`, with the right sentence for the kind of
 * window it is.
 */
export function checkEvent(liveops, { startsAt, endsAt }) {
  const problems = [];

  if (!EVENT_CATEGORIES.includes(liveops?.category)) {
    problems.push(`"${liveops?.category}" is not a category. Pick one of ${EVENT_CATEGORIES.join(', ')}.`);
  }

  const opens = Date.parse(liveops?.opensAt ?? '');
  if (Number.isNaN(opens)) {
    problems.push('The time the event opens is not a valid date.');
  }

  const hours = liveops?.previewHours;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 14 * 24) {
    problems.push('Preview hours must be a number between 0 and 336 (two weeks).');
  }

  // An event that never ends is not an event, it is a feature. The whole
  // premise here is that the thing goes away again.
  if (endsAt === null || endsAt === undefined) {
    problems.push(
      'A live ops event needs an end time. A window with no end never comes down, and a feature that never comes down belongs on its own page rather than the calendar.',
    );
  } else if (!Number.isNaN(opens) && Date.parse(endsAt) <= opens) {
    problems.push('The event ends before it opens.');
  }

  if (!Number.isNaN(opens) && startsAt !== undefined && Date.parse(startsAt) > opens) {
    problems.push('The config would be published after the event opens. Preview hours cannot be negative.');
  }

  return problems;
}

/**
 * The window a live ops event occupies: published `previewHours` before it
 * opens, taken down when it ends.
 */
export function windowForEvent(liveops, endsAt) {
  const opens = Date.parse(liveops.opensAt);
  const startsAt = new Date(opens - (liveops.previewHours ?? 0) * HOUR_MS).toISOString();
  return { startsAt, endsAt };
}
