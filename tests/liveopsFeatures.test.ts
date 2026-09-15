import { describe, expect, it } from 'vitest';
import {
  LIVEOPS_DOMAINS,
  LIVEOPS_FEATURES,
  baseOf,
  checkPresentation,
  emptyPresentation,
  fromClientUtc,
  hasRunKey,
  mintRunId,
  phaseOfWindow,
  runIdFor,
  toClientUtc,
} from '../server/liveopsFeatures.mjs';
import battlePassJson from '../config/battlePass.json';
import offJson from '../config/off/battlePass.json';
import rollingOfferJson from '../config/rollingOffer.json';

/**
 * The live ops standard: the six questions every live ops feature answers
 * about its payload, tested against the payloads ConfigCat actually serves.
 *
 * The stakes are why these are tested rather than trusted. The calendar reads
 * `eventsIn` to show what is running; End now publishes `endedNow`; the
 * heartbeat publishes `withPart` and `withoutPart` with nobody watching. An
 * offer's ID is what every player's progress is filed under, and a season ID
 * is what rolls it - so the wrong answer here drops or resets real progress.
 */

const HOUR = 3600000;
const DAY = 24 * HOUR;
const pass = LIVEOPS_FEATURES.battlePass;
const offers = LIVEOPS_FEATURES.rollingOffer;
const liveOffers = JSON.stringify(rollingOfferJson);

type Offer = { OfferID: string; IsTimed?: boolean; StartUtc?: string; DurationHours?: number };
const offerIds = (payload: Record<string, unknown> | null) =>
  ((payload?.Offers ?? []) as Offer[]).map((offer) => offer.OfferID);
const offerOf = (payload: Record<string, unknown> | null, id: string) =>
  ((payload?.Offers ?? []) as Offer[]).find((offer) => offer.OfferID === id) as Offer;

/** The client's own test: is this offer on the menu at `now`? */
function onTheMenu(offer: Offer, now: number): boolean {
  const start = fromClientUtc(offer.StartUtc);
  const hours = offer.DurationHours ?? 0;
  if (offer.IsTimed === false || Number.isNaN(start) || !(hours > 0)) return true;
  return now >= start && now < start + hours * HOUR;
}

describe('the registry', () => {
  it('lists every feature once, with the setting it publishes', () => {
    expect(LIVEOPS_DOMAINS).toEqual(['battlePass', 'rollingOffer']);
    expect(pass.settingKey).toBe('battlePassSettings');
    expect(offers.settingKey).toBe('rollingOfferSettings');
  });

  it('tells a payload that is one event from one that is a list of them', () => {
    expect(pass.unit).toBe('whole');
    expect(offers.unit).toBe('list');
    // Only an offer can run for good.
    expect(pass.evergreen).toBe(false);
    expect(offers.evergreen).toBe(true);
  });
});

describe('the client time stamp', () => {
  it('writes and reads the one spelling the client is fed, in UTC', () => {
    expect(toClientUtc('2026-10-01T09:30:00.000Z')).toBe('2026-10-01 09:30');
    expect(fromClientUtc('2026-10-01 09:30')).toBe(Date.parse('2026-10-01T09:30:00.000Z'));
  });

  it('reads nothing into a stamp that is not one', () => {
    expect(fromClientUtc('')).toBeNaN();
    expect(fromClientUtc('next tuesday')).toBeNaN();
    expect(fromClientUtc(undefined)).toBeNaN();
  });
});

/* ---------------------------------------------------------- what is live -- */

describe('reading the events out of a live payload', () => {
  it('finds the season, with the window the client counts', () => {
    const [season] = pass.eventsIn(JSON.stringify(battlePassJson));
    expect(season.subjectId).toBe('pass.season1');
    expect(season.startsAt).toBe('2026-09-01T00:00:00.000Z');
    expect(Date.parse(season.endsAt as string) - Date.parse(season.startsAt as string)).toBe(30 * DAY);
  });

  it('finds no season in the off state', () => {
    expect(pass.eventsIn(offJson)).toEqual([]);
  });

  it('finds every offer, timed and evergreen', () => {
    const events = offers.eventsIn(liveOffers);
    expect(events.map((event) => event.subjectId)).toEqual(['offer.roll.1', 'offer.roll.2']);
    expect(events[0]).toMatchObject({ startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-15T00:00:00.000Z' });
    // An evergreen offer has no window at all - which is how it is drawn.
    expect(events[1]).toMatchObject({ startsAt: null, endsAt: null });
  });

  it('reads a timed offer with no usable dates as evergreen, the way the client does', () => {
    const half = { Offers: [{ OfferID: 'offer.half', IsTimed: true, StartUtc: '', DurationHours: 0 }] };
    expect(offers.eventsIn(half)[0]).toMatchObject({ startsAt: null, endsAt: null });
  });

  it('reads nothing out of something that is not a payload', () => {
    expect(offers.eventsIn('not json')).toEqual([]);
    expect(pass.eventsIn(null)).toEqual([]);
  });
});

describe('the phase of a window', () => {
  const now = Date.parse('2026-09-10T00:00:00.000Z');
  it('is open for good with no window', () => {
    expect(phaseOfWindow(null, null, now)).toBe('active');
  });
  it('is ending inside its last day, and ended after it', () => {
    expect(phaseOfWindow('2026-09-01T00:00:00.000Z', '2026-09-10T12:00:00.000Z', now)).toBe('ending');
    expect(phaseOfWindow('2026-09-01T00:00:00.000Z', '2026-09-09T00:00:00.000Z', now)).toBe('ended');
    expect(phaseOfWindow('2026-09-11T00:00:00.000Z', '2026-09-20T00:00:00.000Z', now)).toBe('scheduled');
  });
});

/* ------------------------------------------------------------ ending now -- */

describe('ending an offer now', () => {
  const now = Date.parse('2026-09-10T15:47:30.000Z');

  it('cuts a running offer short and keeps it listed, so progress survives', () => {
    const { payload, reason } = offers.endedNow(liveOffers, 'offer.roll.1', { now });
    expect(reason).toBe('ended');
    expect(offerIds(payload)).toEqual(['offer.roll.1', 'offer.roll.2']);
    const ended = offerOf(payload, 'offer.roll.1');
    expect(ended.StartUtc).toBe('2026-09-01 00:00');
    expect(onTheMenu(ended, now)).toBe(false);
    // Closed no earlier than a minute ago, so the record of when it ran is honest.
    expect(now - (fromClientUtc(ended.StartUtc) + (ended.DurationHours as number) * HOUR)).toBeLessThan(2 * 60000);
  });

  it('leaves every other offer exactly as it was', () => {
    const { payload } = offers.endedNow(liveOffers, 'offer.roll.1', { now });
    expect(offerOf(payload, 'offer.roll.2')).toEqual(rollingOfferJson.Offers[1]);
    expect(payload?.DefaultBackgroundArt).toBe(rollingOfferJson.DefaultBackgroundArt);
  });

  it('closes an evergreen offer by giving it a window that has already shut', () => {
    const { payload } = offers.endedNow(liveOffers, 'offer.roll.2', { now });
    const ended = offerOf(payload, 'offer.roll.2');
    expect(ended.IsTimed).toBe(true);
    expect(onTheMenu(rollingOfferJson.Offers[1] as Offer, now)).toBe(true);
    expect(onTheMenu(ended, now)).toBe(false);
  });

  it('writes the window it gives an evergreen offer in schema order', () => {
    // Appended after Steps, it went live and failed the exporter's schema check
    // on every publish of any offer from then on.
    const { payload } = offers.endedNow(liveOffers, 'offer.roll.2', { now });
    const keys = Object.keys(offerOf(payload, 'offer.roll.2'));
    expect(keys.indexOf('StartUtc')).toBe(keys.indexOf('IsTimed') + 1);
    expect(keys.indexOf('DurationHours')).toBe(keys.indexOf('IsTimed') + 2);
    expect(keys.at(-1)).toBe('Steps');
  });

  it('heals an offer that is already live out of order on the next write', () => {
    const shuffled = { ...rollingOfferJson.Offers[0], OfferID: 'offer.shuffled' } as Record<string, unknown>;
    const { StartUtc, DurationHours, ...rest } = shuffled;
    const live = { ...rollingOfferJson, Offers: [...rollingOfferJson.Offers, { ...rest, StartUtc, DurationHours }] };
    expect(Object.keys(live.Offers[2]).at(-1)).toBe('DurationHours');

    const { payload: ended } = offers.endedNow(live, 'offer.roll.1', { now });
    const { payload: removed } = offers.withoutPart(live, 'offer.roll.1');
    for (const payload of [ended, removed]) {
      // Same offer, same values - only the spelling moves.
      expect(offerOf(payload, 'offer.shuffled')).toEqual(live.Offers[2]);
      expect(Object.keys(offerOf(payload, 'offer.shuffled')).at(-1)).toBe('Steps');
    }
  });

  it('works on the last offer listed, which removing could not', () => {
    // The client ignores an empty list and keeps what it had, so taking the
    // only offer out would leave it running. Closing its window does not.
    const only = { ...rollingOfferJson, Offers: [rollingOfferJson.Offers[1]] };
    expect(offers.withoutPart(only, 'offer.roll.2').reason).toBe('would-empty');
    const { payload } = offers.endedNow(only, 'offer.roll.2', { now });
    expect(onTheMenu(offerOf(payload, 'offer.roll.2'), now)).toBe(false);
  });

  it('closes an offer that has not opened yet, too', () => {
    const future = { Offers: [{ OfferID: 'offer.soon', IsTimed: true, StartUtc: '2026-10-01 00:00', DurationHours: 48 }] };
    const { payload } = offers.endedNow(future, 'offer.soon', { now });
    const ended = offerOf(payload, 'offer.soon');
    expect(onTheMenu(ended, now)).toBe(false);
    expect(onTheMenu(ended, Date.parse('2026-10-01T12:00:00.000Z'))).toBe(false);
  });

  it('says so rather than publishing when there is nothing to end', () => {
    const over = { Offers: [{ OfferID: 'offer.over', IsTimed: true, StartUtc: '2026-09-01 00:00', DurationHours: 24 }] };
    expect(offers.endedNow(over, 'offer.over', { now })).toEqual({ payload: null, reason: 'already-ended' });
    expect(offers.endedNow(liveOffers, 'offer.missing', { now })).toEqual({ payload: null, reason: 'not-listed' });
    expect(offers.endedNow('not json', 'offer.roll.1', { now }).reason).toBe('unreadable');
  });
});

describe('ending a season now', () => {
  it('publishes the off state, which the client reads as no pass', () => {
    const { payload, reason } = pass.endedNow(battlePassJson, 'pass.season1', { now: Date.now(), off: offJson });
    expect(reason).toBe('removed');
    expect(payload).toEqual(offJson);
  });

  it('refuses without an off state recorded', () => {
    expect(pass.endedNow(battlePassJson, 'pass.season1', { now: Date.now(), off: null }).reason).toBe('no-off-state');
  });

  it('refuses to end a season that is not the one live', () => {
    // Somebody already replaced it: publishing the off state would end theirs.
    expect(pass.endedNow(battlePassJson, 'pass.season0', { now: Date.now(), off: offJson }).reason).toBe('not-listed');
  });
});

/* ---------------------------------------------------------- removing one -- */

describe('removing an offer from the list', () => {
  it('drops the one asked for and keeps the rest', () => {
    const { payload, reason } = offers.withoutPart(liveOffers, 'offer.roll.1');
    expect(reason).toBe('removed');
    expect(offerIds(payload)).toEqual(['offer.roll.2']);
    expect((payload?.Offers as unknown[])[0]).toEqual(rollingOfferJson.Offers[1]);
  });

  it('refuses rather than guesses when it has nothing safe to go on', () => {
    expect(offers.withoutPart(liveOffers, '').reason).toBe('unreadable');
    expect(offers.withoutPart('{"Offers":"not an array"}', 'offer.roll.1').reason).toBe('unreadable');
    expect(offers.withoutPart(liveOffers, 'offer.gone').reason).toBe('not-listed');
  });
});

/* ------------------------------------------------------------ putting in -- */

describe('merging a booked event into what is live', () => {
  const booked = {
    ...rollingOfferJson,
    Offers: [{ ...rollingOfferJson.Offers[0], DisplayName: 'RE-CUT' }],
  };

  it('replaces an offer of that ID in place', () => {
    const merged = offers.withPart(liveOffers, booked, 'offer.roll.1');
    expect(offerIds(merged)).toEqual(['offer.roll.1', 'offer.roll.2']);
    expect((offerOf(merged, 'offer.roll.1') as Offer & { DisplayName: string }).DisplayName).toBe('RE-CUT');
  });

  it('carries the offers live now, not the ones live when it was booked', () => {
    // Booked from a sheet that only knew about roll.1; roll.2 went live since.
    const merged = offers.withPart(liveOffers, booked, 'offer.roll.1');
    expect(offerOf(merged, 'offer.roll.2')).toEqual(rollingOfferJson.Offers[1]);
  });

  it('appends an offer that is new', () => {
    const fresh = { Offers: [{ OfferID: 'offer.new', IsTimed: false, Steps: [] }] };
    expect(offerIds(offers.withPart(liveOffers, fresh, 'offer.new'))).toEqual([
      'offer.roll.1',
      'offer.roll.2',
      'offer.new',
    ]);
  });

  it('refuses a booking that does not carry the offer it claims', () => {
    expect(offers.withPart(liveOffers, booked, 'offer.roll.9')).toBeNull();
  });

  it('replaces the whole season, and only with the season named', () => {
    const next = { ...battlePassJson, SeasonID: 'pass.season2' };
    expect(pass.withPart(battlePassJson, next, 'pass.season2')).toEqual(next);
    expect(pass.withPart(battlePassJson, next, 'pass.season1')).toBeNull();
  });
});

describe('writing an event window into its payload', () => {
  it('sets a season from the event, in the whole days the client counts', () => {
    const moved = pass.withWindow(battlePassJson, 'pass.season1', {
      startsAt: '2026-10-01T09:00:00.000Z',
      endsAt: '2026-10-29T20:00:00.000Z',
    });
    // 28 days and 11 hours rounds down; 28 days and 13 would round up.
    expect(moved).toMatchObject({ StartUtc: '2026-10-01 09:00', DurationDays: 28 });
    const short = pass.withWindow(battlePassJson, 'pass.season1', {
      startsAt: '2026-10-01T09:00:00.000Z',
      endsAt: '2026-10-01T15:00:00.000Z',
    });
    // Never rounded down to no season at all.
    expect(short).toMatchObject({ DurationDays: 1 });
  });

  it('times an offer from the event, and makes it evergreen with no window', () => {
    const timed = offers.withWindow(liveOffers, 'offer.roll.2', {
      startsAt: '2026-09-20T18:00:00.000Z',
      endsAt: '2026-09-22T06:30:00.000Z',
    });
    expect(offerOf(timed, 'offer.roll.2')).toMatchObject({ IsTimed: true, StartUtc: '2026-09-20 18:00', DurationHours: 36.5 });

    // roll.2 is evergreen in the fixture, so its window is new keys - which
    // belong after IsTimed, not after Steps.
    expect(Object.keys(offerOf(timed, 'offer.roll.2')).slice(3, 6)).toEqual(['IsTimed', 'StartUtc', 'DurationHours']);

    const evergreen = offers.withWindow(liveOffers, 'offer.roll.1', { startsAt: null, endsAt: null });
    const offer = offerOf(evergreen, 'offer.roll.1');
    expect(offer.IsTimed).toBe(false);
    expect(offer).not.toHaveProperty('StartUtc');
    // Only the one offer moves.
    expect(offerOf(evergreen, 'offer.roll.2')).toEqual(rollingOfferJson.Offers[1]);
  });
});

/* ----------------------------------------------------------------- runs -- */

describe('run IDs', () => {
  it('adds the UTC day a run opens to its base, and strips it back off', () => {
    expect(mintRunId('offer.spacebinge', '2026-09-17T23:30:00.000Z')).toBe('offer.spacebinge.r20260917');
    expect(baseOf('offer.spacebinge.r20260917')).toBe('offer.spacebinge');
    expect(baseOf('offer.spacebinge.r20260917b')).toBe('offer.spacebinge');
    // An ID from before run keys is its own base.
    expect(baseOf('offer.roll.1')).toBe('offer.roll.1');
    expect(hasRunKey('offer.roll.1')).toBe(false);
  });

  it('never mints an ID already used that day', () => {
    const taken = ['offer.x.r20260917', 'offer.x.r20260917b'];
    expect(mintRunId('offer.x', '2026-09-17T09:00:00.000Z', taken)).toBe('offer.x.r20260917c');
    // Minting from a run ID starts from its base, not a run key on a run key.
    expect(mintRunId('offer.x.r20260101', '2026-09-17T09:00:00.000Z')).toBe('offer.x.r20260917');
  });

  it('points a page publish at the run in the game, or at a new run when none is running', () => {
    const now = Date.parse('2026-09-10T00:00:00.000Z');
    const live = {
      Offers: [
        { OfferID: 'offer.x.r20260901', IsTimed: true, StartUtc: '2026-09-01 00:00', DurationHours: 480 },
        { OfferID: 'offer.y.r20260801', IsTimed: true, StartUtc: '2026-08-01 00:00', DurationHours: 24 },
      ],
    };
    expect(runIdFor(offers, { baseId: 'offer.x', live, now })).toEqual({ id: 'offer.x.r20260901', fresh: false });
    expect(runIdFor(offers, { baseId: 'offer.y', live, now })).toEqual({ id: 'offer.y.r20260910', fresh: true });
  });

  it('renames one offer, dropping a stale copy already listed under the new ID', () => {
    const page = { Offers: [{ OfferID: 'offer.x.r20260901', DisplayName: 'OLD' }, { OfferID: 'offer.x', DisplayName: 'NEW' }] };
    const renamed = offers.withSubjectId(page, 'offer.x', 'offer.x.r20260901');
    expect(renamed?.Offers).toEqual([{ OfferID: 'offer.x.r20260901', DisplayName: 'NEW' }]);
    expect(pass.withSubjectId(battlePassJson, 'pass.season1', 'pass.season1.r20260901')?.SeasonID).toBe('pass.season1.r20260901');
    expect(offers.withSubjectId(page, 'offer.missing', 'offer.z')).toBeNull();
  });
});

describe('an offer\'s text and art', () => {
  it('reads and writes the seven fields, leaving empty art out', () => {
    const presentation = { ...emptyPresentation(), DisplayName: 'NEW', BackgroundArt: 'GuySuperSpaceBG' };
    const written = offers.withPresentation!(liveOffers, 'offer.roll.1', presentation);
    const offer = offerOf(written, 'offer.roll.1') as Offer & Record<string, unknown>;
    expect(offer).toMatchObject({ DisplayName: 'NEW', Subtitle: '', BackgroundArt: 'GuySuperSpaceBG' });
    expect(offer).not.toHaveProperty('ButtonArt');
    expect(offers.presentationOf!(written, 'offer.roll.1')).toEqual(presentation);
    // Still in schema order, with the text where the exporter writes it.
    expect(Object.keys(offer).slice(0, 3)).toEqual(['OfferID', 'DisplayName', 'Subtitle']);
  });

  it('allows only {0} in the completion text, which is all string.Format survives', () => {
    const base = { ...emptyPresentation(), DisplayName: 'X' };
    expect(checkPresentation({ ...base, CompletionText: 'UNLOCK {0}!' })).toEqual([]);
    expect(checkPresentation({ ...base, CompletionText: 'A {{literal}} brace' })).toEqual([]);
    expect(checkPresentation({ ...base, CompletionText: 'UNLOCK {1}' })).toHaveLength(1);
    expect(checkPresentation({ ...base, CompletionText: 'broken {' })).toHaveLength(1);
    expect(checkPresentation(emptyPresentation())).toHaveLength(1);
  });
});
