import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module shared with the production server.
import * as serverLiveOps from '../server/liveops.mjs';
// @ts-expect-error - plain .mjs module shared with the production server.
import { checkEntry } from '../server/schedule.mjs';
import { BATTLE_PASS_EXPORTER } from '../src/exporters/battlePass';
import { EMPTY_SEASON } from '../src/lib/battlePass';
import {
  EVENT_CATEGORIES,
  LIVEOPS_DOMAINS,
  durationLabel,
  eventDuration,
  layOutBars,
  phaseOf,
  ticksFor,
  type LiveOpsEntry,
} from '../src/lib/liveops';

/**
 * A live ops event differs from a scheduled config change in one way that
 * matters: when it is over the feature leaves the game. Everything tested here
 * is downstream of that - the guardrail that refuses an event with no end, the
 * one that refuses a feature with no off state, and the phases that tell a
 * designer which of those two things is currently true.
 *
 * The layout functions are tested for the same reason the scheduler's
 * `windowFor` is: an off-by-one in either draws a promotion in the wrong week,
 * and a calendar that lies is worse than no calendar.
 */

const {
  EVENT_CATEGORIES: SERVER_CATEGORIES,
  LIVEOPS_DOMAINS: SERVER_DOMAINS,
  OFF_SEEDS,
  checkEvent,
  phaseOf: serverPhaseOf,
  windowForEvent,
} = serverLiveOps;

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-08T12:00:00.000Z');

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function event(overrides: Partial<LiveOpsEntry> = {}, liveops: Record<string, unknown> = {}): LiveOpsEntry {
  return {
    id: 'sch_evt',
    domain: 'battlePass',
    settingKey: 'battlePassSettings',
    environmentId: 'env-test',
    environmentName: 'Test',
    label: 'Season 1',
    note: null,
    payloadHash: 'hash',
    payloadBytes: 100,
    startsAt: iso(DAY),
    endsAt: iso(31 * DAY),
    state: 'scheduled',
    createdAt: iso(-DAY),
    createdBy: 'test',
    activatedAt: null,
    attempts: 0,
    history: [],
    phase: null,
    startsInMs: DAY,
    endsInMs: 31 * DAY,
    ...overrides,
    liveops: { category: 'monetization', opensAt: iso(DAY), previewHours: 0, ...liveops },
  } as LiveOpsEntry;
}

/* ------------------------------------------------------- the two vocabularies -- */

describe('the server and the client agree', () => {
  // The server has no build step and cannot import the TypeScript, so the two
  // lists are written twice. This is the only thing keeping them honest.
  it('schedules the same features', () => {
    expect([...LIVEOPS_DOMAINS]).toEqual([...SERVER_DOMAINS]);
  });

  it('offers the same categories', () => {
    expect([...EVENT_CATEGORIES]).toEqual([...SERVER_CATEGORIES]);
  });

  it('agrees on the phase of an event', () => {
    const live = event({ state: 'active', startsAt: iso(-DAY), endsAt: iso(DAY * 5) }, { opensAt: iso(-DAY) });
    expect(phaseOf(live, NOW)).toBe(serverPhaseOf(live, NOW));
  });
});

/* ------------------------------------------------------------------ phases -- */

describe('where an event is in its life', () => {
  it('is scheduled before its config is published', () => {
    expect(phaseOf(event(), NOW)).toBe('scheduled');
  });

  it('is in preview once the config is live but before players see it', () => {
    // Published two days early, opens tomorrow.
    const previewing = event({ startsAt: iso(-DAY), endsAt: iso(30 * DAY) }, { opensAt: iso(DAY), previewHours: 48 });
    expect(phaseOf(previewing, NOW)).toBe('preview');
  });

  it('is live once it opens', () => {
    const running = event({ startsAt: iso(-2 * DAY), endsAt: iso(10 * DAY) }, { opensAt: iso(-DAY) });
    expect(phaseOf(running, NOW)).toBe('active');
  });

  it('is ending soon inside its last day', () => {
    const closing = event({ startsAt: iso(-10 * DAY), endsAt: iso(6 * HOUR) }, { opensAt: iso(-10 * DAY) });
    expect(phaseOf(closing, NOW)).toBe('ending');
  });

  it('is ended once its end time has passed', () => {
    const over = event({ state: 'completed', startsAt: iso(-30 * DAY), endsAt: iso(-DAY) }, { opensAt: iso(-30 * DAY) });
    expect(phaseOf(over, NOW)).toBe('ended');
  });

  it('separates an event that never ran from one that finished', () => {
    const cancelled = event({ state: 'cancelled' });
    expect(phaseOf(cancelled, NOW)).toBe('off');
  });
});

/* -------------------------------------------------------------- guardrails -- */

describe('booking an event', () => {
  const window = { startsAt: iso(DAY), endsAt: iso(31 * DAY) };

  it('accepts a well-formed event', () => {
    expect(checkEvent({ category: 'monetization', opensAt: iso(DAY), previewHours: 0 }, window)).toEqual([]);
  });

  it('refuses an event with no end time', () => {
    const problems = checkEvent({ category: 'seasonal', opensAt: iso(DAY), previewHours: 0 }, {
      startsAt: iso(DAY),
      endsAt: null,
    }) as string[];
    // The premise of the whole page: the feature has to go away again.
    expect(problems.join(' ')).toMatch(/needs an end time/);
  });

  it('refuses an event that ends before it opens', () => {
    const problems = checkEvent({ category: 'seasonal', opensAt: iso(10 * DAY), previewHours: 0 }, {
      startsAt: iso(10 * DAY),
      endsAt: iso(2 * DAY),
    }) as string[];
    expect(problems.join(' ')).toMatch(/ends before it opens/);
  });

  it('refuses a category it does not know', () => {
    const problems = checkEvent({ category: 'vibes', opensAt: iso(DAY), previewHours: 0 }, window) as string[];
    expect(problems.join(' ')).toMatch(/is not a category/);
  });

  it('refuses a preview longer than two weeks', () => {
    const problems = checkEvent({ category: 'test', opensAt: iso(DAY), previewHours: 400 }, window) as string[];
    expect(problems.join(' ')).toMatch(/between 0 and 336/);
  });

  it('accepts an event with no preview at all', () => {
    // The form stopped asking: an event's config goes up when the event opens.
    // Older entries still carry the field, which is why it is only optional.
    expect(checkEvent({ category: 'monetization', opensAt: iso(DAY) }, window)).toEqual([]);
  });

  it('asks for the off state rather than the default', () => {
    // The distinction this whole feature turns on: a default battle pass is
    // last season, and restoring last season when this one ends is exactly the
    // bug the off state exists to prevent.
    const candidate = {
      domain: 'battlePass',
      environmentId: 'env-test',
      payload: {},
      startsAt: iso(DAY),
      endsAt: iso(31 * DAY),
      liveops: { category: 'monetization', opensAt: iso(DAY), previewHours: 0 },
    };
    const problems = checkEntry(candidate, {
      entries: [],
      hasDefault: true,
      hasOff: false,
      now: NOW,
    }) as string[];
    expect(problems.join(' ')).toMatch(/no off state recorded/);
    expect(checkEntry(candidate, { entries: [], hasDefault: false, hasOff: true, now: NOW })).toEqual([]);
  });

  it('still asks an ordinary window for its default', () => {
    const candidate = {
      domain: 'shop',
      environmentId: 'env-test',
      payload: {},
      startsAt: iso(DAY),
      endsAt: iso(2 * DAY),
    };
    const problems = checkEntry(candidate, { entries: [], hasDefault: false, hasOff: true, now: NOW }) as string[];
    expect(problems.join(' ')).toMatch(/no default recorded/);
  });
});

describe('the window an event occupies', () => {
  it('starts the preview hours before it opens', () => {
    const window = windowForEvent({ opensAt: iso(5 * DAY), previewHours: 48 }, iso(35 * DAY));
    expect(Date.parse(window.startsAt)).toBe(NOW + 3 * DAY);
    expect(window.endsAt).toBe(iso(35 * DAY));
  });

  it('starts when it opens if there is no preview', () => {
    const window = windowForEvent({ opensAt: iso(5 * DAY), previewHours: 0 }, iso(35 * DAY));
    expect(Date.parse(window.startsAt)).toBe(NOW + 5 * DAY);
  });
});

describe('the off state', () => {
  it('keeps the payload shape so a typed client can still read it', () => {
    // `{}` would be simpler and would throw in a client that deserialises this
    // into a struct. The emptiness has to be inside the shape, not instead of it.
    expect(OFF_SEEDS.battlePass).toMatchObject({ SeasonID: '', Tiers: [] });
    expect(Object.keys(OFF_SEEDS.battlePass)).toContain('DurationDays');
  });
});

/* ------------------------------------------------------------------ layout -- */

describe('laying events out on the calendar', () => {
  const from = NOW - 10 * DAY;
  const to = NOW + 10 * DAY;

  it('places a bar where its dates say', () => {
    const bar = layOutBars([event({ startsAt: iso(0), endsAt: iso(10 * DAY) }, { opensAt: iso(0) })], from, to, NOW)[0];
    expect(bar.left).toBeCloseTo(0.5, 5);
    expect(bar.width).toBeCloseTo(0.5, 5);
  });

  it('marks the preview slice as a fraction of the bar', () => {
    // Published on day 0, opens on day 5, ends on day 10: half the bar.
    const bar = layOutBars(
      [event({ startsAt: iso(0), endsAt: iso(10 * DAY) }, { opensAt: iso(5 * DAY), previewHours: 120 })],
      from,
      to,
      NOW,
    )[0];
    expect(bar.previewFraction).toBeCloseTo(0.5, 5);
  });

  it('clips a bar that runs past either edge and says so', () => {
    const bar = layOutBars(
      [event({ startsAt: iso(-40 * DAY), endsAt: iso(40 * DAY) }, { opensAt: iso(-40 * DAY) })],
      from,
      to,
      NOW,
    )[0];
    expect(bar.left).toBe(0);
    expect(bar.width).toBe(1);
    expect(bar.clippedStart).toBe(true);
    expect(bar.clippedEnd).toBe(true);
  });

  it('drops an event that is entirely outside the range', () => {
    expect(layOutBars([event({ startsAt: iso(40 * DAY), endsAt: iso(50 * DAY) })], from, to, NOW)).toEqual([]);
  });
});

describe('the time ruler', () => {
  it('ticks daily over a short range', () => {
    const ticks = ticksFor(NOW, NOW + 10 * DAY);
    expect(ticks.length).toBeGreaterThanOrEqual(10);
  });

  it('thins out over a long one rather than overlapping its labels', () => {
    const short = ticksFor(NOW, NOW + 14 * DAY);
    const long = ticksFor(NOW, NOW + 180 * DAY);
    expect(long.length).toBeLessThan(short.length * 3);
  });
});

describe('how long an event runs', () => {
  it('counts whole days', () => {
    expect(durationLabel(iso(0), iso(30 * DAY))).toBe('30 days');
  });

  it('spells out the hours left over rather than rounding them away', () => {
    // The form calculates this from two dates somebody typed, so a season that
    // is out by half a day has to look wrong rather than look like 30 days.
    expect(durationLabel(iso(0), iso(30 * DAY + 12 * HOUR))).toBe('30 days 12 hours');
    expect(durationLabel(iso(0), iso(36 * HOUR))).toBe('1 day 12 hours');
  });

  it('counts hours alone for a weekend-length event', () => {
    expect(durationLabel(iso(0), iso(6 * HOUR))).toBe('6 hours');
  });

  it('breaks the window into the two units it is booked in', () => {
    expect(eventDuration(iso(0), iso(30 * DAY + 6 * HOUR))).toMatchObject({ days: 30, hours: 6 });
    expect(eventDuration(iso(0), null)).toBeNull();
    // An end before the start is a typo, not a negative duration.
    expect(eventDuration(iso(0), iso(-DAY))).toBeNull();
  });

  it('says so when there is no end', () => {
    expect(durationLabel(iso(0), null)).toBe('no end');
  });
});

/* ----------------------------------------------------------- the config -- */

describe('the config an event carries', () => {
  it('takes the season window from the event rather than asking twice', () => {
    // The booking form has no season fields: a pass published by an event runs
    // for exactly as long as the event, so two answers that must agree would
    // only be two answers that can disagree.
    const season = BATTLE_PASS_EXPORTER.eventSettings?.(
      { ...EMPTY_SEASON, seasonId: 'pass.season2', finalRewardArt: 'art.season2' },
      { opensAt: '2026-10-01T09:00:00.000Z', endsAt: '2026-10-29T09:00:00.000Z' },
    );
    expect(season).toEqual({
      ...EMPTY_SEASON,
      startUtc: '2026-10-01 09:00',
      durationDays: 28,
      // Nothing in the window speaks to the rest of the header, so it survives.
      seasonId: 'pass.season2',
      finalRewardArt: 'art.season2',
    });
  });

  it('rounds a window that is not a whole number of days, because the client counts days', () => {
    const season = BATTLE_PASS_EXPORTER.eventSettings?.(EMPTY_SEASON, {
      opensAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-10-08T13:00:00.000Z',
    });
    expect(season?.durationDays).toBe(8);
  });

  it('never rounds an event down to no season at all', () => {
    const season = BATTLE_PASS_EXPORTER.eventSettings?.(EMPTY_SEASON, {
      opensAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-10-01T06:00:00.000Z',
    });
    expect(season?.durationDays).toBe(1);
  });
});
