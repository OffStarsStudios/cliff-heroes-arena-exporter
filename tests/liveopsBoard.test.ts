import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module shared with the production server.
import { checkEntry, windowFor } from '../server/schedule.mjs';
import battlePassJson from '../config/battlePass.json';
import rollingOfferJson from '../config/rollingOffer.json';
import { boardEvents, isEvergreen, isInGame, isLingering, layOutBars, type LiveOpsEntry } from '../src/lib/liveops';

/**
 * The calendar shows every event ConfigCat is serving, not only the ones it
 * booked - and the scheduler lets offers run side by side.
 *
 * Both were wrong before: a season published from its page, or an evergreen
 * offer, never appeared on the calendar at all, and two rolling offers could
 * not be booked for the same week because the scheduler treated the whole
 * setting as one slot.
 */

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-10T12:00:00.000Z');
const ENV = 'env-test';

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function booking(overrides: Partial<LiveOpsEntry> = {}, liveops: Record<string, unknown> = {}): LiveOpsEntry {
  return {
    id: 'sch_a',
    domain: 'rollingOffer',
    settingKey: 'rollingOfferSettings',
    environmentId: ENV,
    environmentName: 'Test',
    label: 'Roll one',
    note: null,
    payloadHash: 'h',
    payloadBytes: 10,
    startsAt: iso(DAY),
    endsAt: iso(3 * DAY),
    state: 'scheduled',
    createdAt: iso(-DAY),
    createdBy: 'test',
    activatedAt: null,
    attempts: 0,
    history: [],
    phase: null,
    startsInMs: DAY,
    endsInMs: 3 * DAY,
    ...overrides,
    liveops: { category: 'monetization', opensAt: overrides.startsAt ?? iso(DAY), subjectId: 'offer.roll.1', ...liveops },
  } as LiveOpsEntry;
}

const live = { battlePass: battlePassJson, rollingOffer: rollingOfferJson };

describe('what the calendar shows', () => {
  it('shows everything live, booked or not', () => {
    const events = boardEvents({ entries: [], live, environmentId: ENV, now: NOW });
    expect(events.map((event) => `${event.domain}:${event.subjectId}`).sort()).toEqual([
      'battlePass:pass.season1',
      'rollingOffer:offer.roll.1',
      'rollingOffer:offer.roll.2',
    ]);
    // Nobody booked these, so none has a category - and each is in the game.
    expect(events.every((event) => event.category === null && event.entry === null)).toBe(true);
    expect(events.every(isInGame)).toBe(true);
  });

  it('draws an evergreen offer as always on', () => {
    const evergreen = boardEvents({ entries: [], live, environmentId: ENV, now: NOW }).find(
      (event) => event.subjectId === 'offer.roll.2',
    );
    expect(evergreen !== undefined && isEvergreen(evergreen)).toBe(true);
    const [bar] = layOutBars([evergreen!], NOW - 10 * DAY, NOW + 10 * DAY);
    expect(bar).toMatchObject({ left: 0, width: 1, clippedStart: true, clippedEnd: true });
  });

  it('joins a running booking to the live event it put there, once', () => {
    const running = booking({ id: 'sch_run', state: 'active', startsAt: iso(-9 * DAY), endsAt: iso(4 * DAY), label: 'Flick ghost roll' });
    const events = boardEvents({ entries: [running], live, environmentId: ENV, now: NOW });
    const rows = events.filter((event) => event.subjectId === 'offer.roll.1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'sch_run', name: 'Flick ghost roll', category: 'monetization' });
    // The dates are what the client is actually running, not what was booked.
    expect(rows[0].startsAt).toBe('2026-09-01T00:00:00.000Z');
    expect(rows[0].live).not.toBeNull();
  });

  it('shows a booking still to come beside what is live', () => {
    const next = booking({ id: 'sch_next', startsAt: iso(10 * DAY), endsAt: iso(14 * DAY) }, { subjectId: 'offer.roll.3' });
    const events = boardEvents({ entries: [next], live, environmentId: ENV, now: NOW });
    const row = events.find((event) => event.key === 'sch_next');
    expect(row).toMatchObject({ phase: 'scheduled', live: null, missingLive: false });
  });

  it('flags a running booking whose event somebody took out of ConfigCat', () => {
    const gone = booking({ id: 'sch_gone', state: 'active', startsAt: iso(-DAY) }, { subjectId: 'offer.gone' });
    const row = boardEvents({ entries: [gone], live, environmentId: ENV, now: NOW }).find(
      (event) => event.key === 'sch_gone',
    );
    expect(row?.missingLive).toBe(true);
  });

  it('never calls a booking missing on the strength of a read that failed', () => {
    const running = booking({ id: 'sch_run', state: 'active', startsAt: iso(-DAY) });
    const [row] = boardEvents({ entries: [running], live: {}, environmentId: ENV, now: NOW });
    expect(row.missingLive).toBe(false);
  });

  it('shows an offer that has run its course but is still listed', () => {
    const later = NOW + 10 * DAY;
    const row = boardEvents({ entries: [], live, environmentId: ENV, now: later }).find(
      (event) => event.subjectId === 'offer.roll.1',
    );
    expect(row !== undefined && isLingering(row)).toBe(true);
  });

  it('keeps one environment out of another', () => {
    const elsewhere = booking({ id: 'sch_prod', environmentId: 'env-prod' });
    expect(boardEvents({ entries: [elsewhere], live: {}, environmentId: ENV, now: NOW })).toEqual([]);
  });
});

/* ------------------------------------------------------------ the slots -- */

function serverBooking(overrides: Record<string, unknown>, subjectId: string | null) {
  return {
    id: 'sch_a',
    domain: 'rollingOffer',
    environmentId: ENV,
    payload: { Offers: [] },
    startsAt: iso(DAY),
    endsAt: iso(3 * DAY),
    state: 'scheduled',
    label: 'An offer',
    liveops: { category: 'monetization', opensAt: iso(DAY), subjectId },
    ...overrides,
  };
}

function check(candidate: Record<string, unknown>, entries: unknown[]) {
  return checkEntry(candidate, { entries, hasDefault: true, hasOff: true, now: NOW }) as string[];
}

describe('booking events side by side', () => {
  it('lets two different offers run in the same week', () => {
    const one = serverBooking({ id: 'sch_one' }, 'offer.one');
    const two = serverBooking({ id: 'sch_two' }, 'offer.two');
    expect(check(two, [one])).toEqual([]);
  });

  it('refuses two bookings of the same offer at once', () => {
    const one = serverBooking({ id: 'sch_one' }, 'offer.one');
    const again = serverBooking({ id: 'sch_again' }, 'offer.one');
    expect(check(again, [one]).join(' ')).toMatch(/overlaps/);
  });

  it('refuses two seasons at once, because the pass is one event', () => {
    const season = (id: string, seasonId: string) =>
      serverBooking({ id, domain: 'battlePass', payload: { SeasonID: seasonId, Tiers: [{}] } }, null);
    expect(check(season('sch_s3', 'pass.season3'), [season('sch_s2', 'pass.season2')]).join(' ')).toMatch(/overlaps/);
  });

  it('refuses an offer booking that does not say which offer it is', () => {
    expect(check(serverBooking({}, null), []).join(' ')).toMatch(/does not record which offer/);
  });

  it('answers what is live per offer when asked for one', () => {
    const one = serverBooking({ id: 'sch_one', startsAt: iso(-HOUR), endsAt: iso(HOUR) }, 'offer.one');
    const two = serverBooking({ id: 'sch_two', startsAt: iso(-2 * HOUR), endsAt: iso(HOUR) }, 'offer.two');
    // Asked about offer.one, offer.two is not a rival to supersede.
    const { winner, losers } = windowFor([one, two], 'rollingOffer', ENV, NOW, 'offer.one');
    expect(winner.id).toBe('sch_one');
    expect(losers).toEqual([]);
  });
});
