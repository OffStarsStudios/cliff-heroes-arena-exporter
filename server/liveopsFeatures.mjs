/**
 * The live ops standard: what every live ops feature has to be able to answer.
 *
 * A live ops feature is one that is only sometimes in the game - a battle pass
 * season, a rolling offer, next a quest board. The console handles all of them
 * the same way, from two places (the feature's own page and the live ops
 * calendar), and that only works if each feature can answer the same six
 * questions about its payload:
 *
 *   eventsIn     What events does this payload hold, and when does each run?
 *                Read straight off ConfigCat, so the calendar shows what the
 *                game is actually serving - booked or not, timed or evergreen.
 *   partOf       Which part of the payload is one event?
 *   withPart     Put one event's part into what is live, leaving the rest.
 *   withWindow   Move one event's window inside the payload.
 *   endedNow     Take one event out of the game right now.
 *   withoutPart  Take one event out of the payload altogether.
 *
 * Adding a feature means adding one entry to `LIVEOPS_FEATURES` below. Nothing
 * else in the scheduler, the calendar or the pages branches on the domain.
 *
 * **Pure and browser-safe on purpose.** This file imports nothing, so the
 * server (which has no build step) and the React app import the very same
 * functions. The previous arrangement - a server copy and a client copy kept
 * agreeing by a test - is how rolling offers shipped half-registered.
 *
 * Two facts about the game client shape the answers, both read from
 * `CliffHeroes/Assets/Scripts`:
 *
 *   The battle pass runs while `SeasonID` is non-empty, there are tiers, and
 *   the season has time left. An empty `SeasonID` is ignored by `RollSeason`,
 *   so publishing the off state ends a season without rolling anyone's
 *   progress, and republishing the same season later picks it back up.
 *
 *   A rolling offer is on the menu while it is inside its window, or always if
 *   it has none. Dropping it from the list is what retires it - its progress is
 *   pruned on the next launch - and a list with no offers at all is ignored
 *   outright. So ending an offer *closes its window* and keeps it listed:
 *   that works for the last offer too, and loses nobody's progress.
 */

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

/* -------------------------------------------------------------- helpers -- */

/** A payload as it arrives: a JSON string from ConfigCat, or an object already. */
export function readPayload(value) {
  let payload = value;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

/** `2026-10-01T09:00:00.000Z` -> `2026-10-01 09:00`, the only spelling the client is fed. */
export function toClientUtc(isoOrMs) {
  const at = new Date(isoOrMs);
  if (Number.isNaN(at.getTime())) return '';
  return at.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * `2026-10-01 09:00` -> milliseconds, read as UTC the way the client reads it.
 * NaN for anything else, so a broken start is never mistaken for "now".
 */
export function fromClientUtc(text) {
  if (typeof text !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (match === null) return NaN;
  const [, y, mo, d, h, mi, s] = match;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
}

function isoOrNull(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/* ----------------------------------------------------------- battle pass -- */

/**
 * The battle pass: the whole payload is one season.
 *
 * Its "not running" is a recorded off state rather than something worked out
 * here, because it is a contract with the client and lives in
 * `config/off/battlePass.json` where it can be corrected without a deploy.
 * Every function that ends a season is therefore handed that payload.
 */
const battlePass = {
  domain: 'battlePass',
  settingKey: 'battlePassSettings',
  label: 'Battle pass',
  /** The payload is one event, so two events on this feature always collide. */
  unit: 'whole',
  /** A season always has a length. */
  evergreen: false,
  /** What an event of this feature is called in a sentence. */
  noun: 'season',

  eventsIn(value) {
    const payload = readPayload(value);
    if (payload === null) return [];
    const id = typeof payload.SeasonID === 'string' ? payload.SeasonID : '';
    const tiers = Array.isArray(payload.Tiers) ? payload.Tiers.length : 0;
    if (id === '' || tiers === 0) return [];

    const start = fromClientUtc(payload.StartUtc);
    const days = typeof payload.DurationDays === 'number' ? payload.DurationDays : 0;
    return [
      {
        subjectId: id,
        name: typeof payload.SeasonName === 'string' && payload.SeasonName !== '' ? payload.SeasonName : id,
        startsAt: isoOrNull(start),
        // The client treats a season with no usable length as never ending.
        endsAt: Number.isFinite(start) && days > 0 ? isoOrNull(start + days * DAY_MS) : null,
      },
    ];
  },

  partOf(value, subjectId) {
    const payload = readPayload(value);
    return payload !== null && payload.SeasonID === subjectId && subjectId !== '' ? payload : null;
  },

  /** A booked season replaces whatever season is live: there is only ever one. */
  withPart(_live, booked, subjectId) {
    const payload = readPayload(booked);
    return payload !== null && payload.SeasonID === subjectId ? payload : null;
  },

  withWindow(value, subjectId, { startsAt, endsAt }) {
    const payload = battlePass.partOf(value, subjectId);
    if (payload === null || endsAt === null) return null;
    const start = Date.parse(startsAt);
    const days = Math.round((Date.parse(endsAt) - start) / DAY_MS);
    if (!Number.isFinite(start) || !Number.isFinite(days)) return null;
    // Whole days is the client's unit; never round a season down to nothing.
    return { ...payload, StartUtc: toClientUtc(start), DurationDays: Math.max(1, days) };
  },

  endedNow(value, subjectId, { off } = {}) {
    return battlePass.withoutPart(value, subjectId, { off });
  },

  withoutPart(value, subjectId, { off } = {}) {
    const payload = readPayload(value);
    if (payload === null) return { payload: null, reason: 'unreadable' };
    if (payload.SeasonID !== subjectId || subjectId === '') return { payload: null, reason: 'not-listed' };
    if (off === null || off === undefined) return { payload: null, reason: 'no-off-state' };
    return { payload: off, reason: 'removed' };
  },

  /** Which season a booked payload carries. */
  subjectOf(value) {
    const payload = readPayload(value);
    return payload !== null && typeof payload.SeasonID === 'string' && payload.SeasonID !== '' ? payload.SeasonID : null;
  },
};

/* --------------------------------------------------------- rolling offer -- */

function offersOf(payload) {
  return payload !== null && Array.isArray(payload.Offers) ? payload.Offers : null;
}

/**
 * The order an offer's keys are written in: the client schema's, which the
 * exporter writes and its schema check holds every offer in the list to.
 *
 * The client does not care about the order; the check does, and it judges the
 * whole list. So an offer written out of order here - End now on an evergreen
 * offer used to tack its new window on at the end - blocks every later publish
 * of any offer until somebody notices.
 */
export const OFFER_KEY_ORDER = [
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

/** An offer with its keys in schema order. Anything the schema does not know keeps its place after them. */
export function offerInKeyOrder(offer) {
  if (offer === null || typeof offer !== 'object' || Array.isArray(offer)) return offer;
  const ordered = {};
  for (const key of OFFER_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(offer, key)) ordered[key] = offer[key];
  }
  for (const key of Object.keys(offer)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) ordered[key] = offer[key];
  }
  return ordered;
}

/**
 * A payload with this offer list. Every write goes through here, so whatever
 * is published is in schema order - including an offer that was already live
 * out of order, which is healed by the next write rather than carried forever.
 */
function withOffers(payload, offers) {
  return { ...payload, Offers: offers.map(offerInKeyOrder) };
}

/** The client's own test for whether an offer has a window at all. */
function windowOfOffer(offer) {
  const timed = offer.IsTimed !== false;
  const start = fromClientUtc(offer.StartUtc);
  const hours = typeof offer.DurationHours === 'number' ? offer.DurationHours : 0;
  if (!timed || !Number.isFinite(start) || !(hours > 0)) return null;
  return { start, end: start + hours * HOUR_MS };
}

/**
 * Rolling offers: the payload is every offer, and each offer is one event.
 *
 * Offers run side by side, so two events only collide when they are the same
 * offer. The list-level art defaults belong to the feature, not to any event,
 * and are always carried through from what is live.
 */
const rollingOffer = {
  domain: 'rollingOffer',
  settingKey: 'rollingOfferSettings',
  label: 'Rolling offers',
  unit: 'list',
  /** An offer with no window is on the menu for good. */
  evergreen: true,
  noun: 'offer',

  eventsIn(value) {
    const offers = offersOf(readPayload(value));
    if (offers === null) return [];
    return offers
      .filter((offer) => offer !== null && typeof offer === 'object' && typeof offer.OfferID === 'string' && offer.OfferID !== '')
      .map((offer) => {
        const window = windowOfOffer(offer);
        return {
          subjectId: offer.OfferID,
          name: typeof offer.DisplayName === 'string' && offer.DisplayName !== '' ? offer.DisplayName : offer.OfferID,
          startsAt: window === null ? null : isoOrNull(window.start),
          endsAt: window === null ? null : isoOrNull(window.end),
        };
      });
  },

  partOf(value, subjectId) {
    const offers = offersOf(readPayload(value));
    if (offers === null || typeof subjectId !== 'string' || subjectId === '') return null;
    return offers.find((offer) => offer?.OfferID === subjectId) ?? null;
  },

  /**
   * Merges one booked offer into what is live.
   *
   * Done at the moment it is published rather than when it was booked: the
   * booking snapshotted the whole list, and publishing that snapshot weeks
   * later would retire every offer added since and resurrect every one
   * removed. An offer already listed keeps its place, because the list order
   * is the order the buttons are drawn in.
   */
  withPart(live, booked, subjectId) {
    const offer = rollingOffer.partOf(booked, subjectId);
    if (offer === null) return null;
    const current = readPayload(live);
    const offers = offersOf(current);
    if (current === null || offers === null) {
      const whole = readPayload(booked);
      return withOffers(whole, offersOf(whole));
    }

    const at = offers.findIndex((candidate) => candidate?.OfferID === subjectId);
    const next = offers.slice();
    if (at === -1) next.push(offer);
    else next[at] = offer;
    return withOffers(current, next);
  },

  withWindow(value, subjectId, { startsAt, endsAt }) {
    const payload = readPayload(value);
    const offer = rollingOffer.partOf(payload, subjectId);
    if (offer === null) return null;

    let next;
    if (startsAt === null || endsAt === null) {
      // No window is an evergreen offer, and the client ignores dates on one
      // anyway - so they are dropped rather than left to mislead a reader.
      const { StartUtc: _start, DurationHours: _hours, ...rest } = offer;
      next = { ...rest, IsTimed: false };
    } else {
      const start = Date.parse(startsAt);
      const hours = Math.round(((Date.parse(endsAt) - start) / HOUR_MS) * 100) / 100;
      if (!Number.isFinite(start) || !(hours > 0)) return null;
      next = { ...offer, IsTimed: true, StartUtc: toClientUtc(start), DurationHours: hours };
    }
    return withOffers(
      payload,
      payload.Offers.map((candidate) => (candidate?.OfferID === subjectId ? next : candidate)),
    );
  },

  /**
   * Closes an offer's window so it is off the menu from now.
   *
   * The offer stays listed, so everybody's progress survives and the offer can
   * be put back by republishing it with a new window. An offer that has run
   * keeps its real start and is cut short; one that never had a window, or has
   * not opened yet, is given a closed window of its own - the last hour.
   */
  endedNow(value, subjectId, { now = Date.now() } = {}) {
    const payload = readPayload(value);
    const offer = rollingOffer.partOf(payload, subjectId);
    if (payload === null) return { payload: null, reason: 'unreadable' };
    if (offer === null) return { payload: null, reason: 'not-listed' };

    const end = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    const window = windowOfOffer(offer);
    if (window !== null && window.end <= now) return { payload: null, reason: 'already-ended' };

    let closed;
    // Floored to hundredths of an hour, so the closing time never lands after now.
    const hours = window === null ? 0 : Math.floor((end - window.start) / (HOUR_MS / 100)) / 100;
    if (window !== null && hours > 0) {
      closed = { ...offer, DurationHours: hours };
    } else {
      closed = { ...offer, IsTimed: true, StartUtc: toClientUtc(end - HOUR_MS), DurationHours: 1 };
    }
    return {
      payload: withOffers(
        payload,
        payload.Offers.map((candidate) => (candidate?.OfferID === subjectId ? closed : candidate)),
      ),
      reason: 'ended',
    };
  },

  /**
   * Takes an offer out of the list, which retires it: its progress goes on
   * the next launch. Refuses to empty the list, because the client ignores an
   * empty one and would keep the offer - end it instead.
   */
  withoutPart(value, subjectId) {
    const payload = readPayload(value);
    const offers = offersOf(payload);
    if (payload === null || offers === null) return { payload: null, reason: 'unreadable' };
    if (typeof subjectId !== 'string' || subjectId === '') return { payload: null, reason: 'unreadable' };

    const kept = offers.filter((offer) => offer === null || offer.OfferID !== subjectId);
    if (kept.length === offers.length) return { payload: null, reason: 'not-listed' };
    if (kept.length === 0) return { payload: null, reason: 'would-empty' };
    return { payload: withOffers(payload, kept), reason: 'removed' };
  },

  /** A booked rolling offer payload is the whole list, so the offer is recorded on the booking instead. */
  subjectOf() {
    return null;
  },
};

/* ------------------------------------------------------------- registry -- */

export const LIVEOPS_FEATURES = { battlePass, rollingOffer };

/** Features scheduled as events rather than configured permanently, in rail order. */
export const LIVEOPS_DOMAINS = Object.keys(LIVEOPS_FEATURES);

export function featureFor(domain) {
  return Object.prototype.hasOwnProperty.call(LIVEOPS_FEATURES, domain) ? LIVEOPS_FEATURES[domain] : null;
}

/** Why an event is running. Only grouping and colour, but it is what the calendar is read for. */
export const EVENT_CATEGORIES = ['monetization', 'engagement', 'seasonal', 'test'];

/** Inside this much of the end, an event is "ending soon" rather than merely active. */
export const ENDING_SOON_HOURS = 24;

/**
 * Where a window is at `now`: not open yet, open, in its last day, or over.
 * A window with no start is open already; one with no end never closes.
 */
export function phaseOfWindow(startsAt, endsAt, now) {
  const start = startsAt === null ? -Infinity : Date.parse(startsAt);
  const end = endsAt === null ? Infinity : Date.parse(endsAt);
  if (now >= end) return 'ended';
  if (now < start) return 'scheduled';
  if (end !== Infinity && end - now <= ENDING_SOON_HOURS * HOUR_MS) return 'ending';
  return 'active';
}

/** The sentence each refusal reason stands for, shared by the server's responses and the page. */
export const REASON_TEXT = {
  unreadable: 'The live value is not the shape this feature expects, so nothing was changed.',
  'not-listed': 'That event is not in the live config any more - somebody has already taken it out.',
  'no-off-state': 'This feature has no off state recorded, so there is nothing safe to publish in its place.',
  'would-empty':
    'It is the only one live, and the client ignores a list with nothing in it - so removing it would leave it running. End it instead: that closes its window and works for the last one too.',
  'already-ended': 'Its window has already closed, so it is not on the menu. Remove it from the config instead.',
};
