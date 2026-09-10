import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module shared with the production server.
import { checkEntry, isTerminal, windowFor } from '../server/schedule.mjs';

/**
 * The scheduler runs unattended, which makes its two pure functions the only
 * things standing between "the shop goes up on Friday" and a config nobody
 * meant to publish.
 *
 * `checkEntry` decides what may be booked at all. `windowFor` decides what
 * should be live at an instant, and the tick does nothing except act on its
 * answer - so these tests are the specification of the whole feature.
 */

const HOUR = 3600000;
const NOW = Date.parse('2026-09-07T12:00:00.000Z');

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sch_a',
    domain: 'shop',
    environmentId: 'env-test',
    payload: { Products: [] },
    startsAt: iso(HOUR),
    endsAt: iso(3 * HOUR),
    state: 'scheduled',
    label: 'Weekend shop',
    ...overrides,
  };
}

function check(candidate: Record<string, unknown>, options: Record<string, unknown> = {}) {
  return checkEntry(candidate, { entries: [], hasDefault: true, now: NOW, ...options }) as string[];
}

describe('booking a window', () => {
  it('accepts a well-formed window', () => {
    expect(check(entry())).toEqual([]);
  });

  it('accepts an open-ended window with no default recorded', () => {
    // Nothing has to be restored, so the fallback is irrelevant here.
    expect(check(entry({ endsAt: null }), { hasDefault: false })).toEqual([]);
  });

  it('refuses an ending window when the config has no default to fall back to', () => {
    const problems = check(entry(), { hasDefault: false });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/no default recorded/i);
  });

  it('refuses a start in the past', () => {
    expect(check(entry({ startsAt: iso(-2 * HOUR) })).join(' ')).toMatch(/in the past/i);
  });

  it('allows a start a few minutes late, so a slow form submit is not rejected', () => {
    expect(check(entry({ startsAt: iso(-60000) }))).toEqual([]);
  });

  it('refuses an end before the start', () => {
    expect(check(entry({ endsAt: iso(0) })).join(' ')).toMatch(/not after the start/i);
  });

  it('refuses a window longer than half a year, which is nearly always a mistyped year', () => {
    expect(check(entry({ endsAt: iso(365 * 24 * HOUR) })).join(' ')).toMatch(/longer than 180 days/i);
  });

  it('refuses unparseable dates rather than treating them as now', () => {
    expect(check(entry({ startsAt: 'next friday' })).join(' ')).toMatch(/not a valid date/i);
  });

  it('refuses a window with no payload', () => {
    expect(check(entry({ payload: null })).join(' ')).toMatch(/needs the config/i);
  });

  it('refuses an unknown config', () => {
    expect(check(entry({ domain: 'weapons' })).join(' ')).toMatch(/not a config this console publishes/i);
  });

  it('refuses a window that overlaps an existing one for the same config and environment', () => {
    const existing = entry({ id: 'sch_existing', startsAt: iso(2 * HOUR), endsAt: iso(4 * HOUR) });
    const problems = check(entry({ id: 'sch_new' }), { entries: [existing] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/overlaps/i);
  });

  it('allows two windows that merely touch at their boundary', () => {
    const existing = entry({ id: 'sch_existing', startsAt: iso(3 * HOUR), endsAt: iso(5 * HOUR) });
    expect(check(entry({ id: 'sch_new' }), { entries: [existing] })).toEqual([]);
  });

  it('allows the same span in a different environment', () => {
    const existing = entry({ id: 'sch_existing', environmentId: 'env-prod' });
    expect(check(entry({ id: 'sch_new' }), { entries: [existing] })).toEqual([]);
  });

  it('allows the same span for a different config', () => {
    const existing = entry({ id: 'sch_existing', domain: 'bots' });
    expect(check(entry({ id: 'sch_new' }), { entries: [existing] })).toEqual([]);
  });

  it('ignores finished windows when checking for overlap', () => {
    const finished = entry({ id: 'sch_old', state: 'completed' });
    expect(check(entry({ id: 'sch_new' }), { entries: [finished] })).toEqual([]);
  });

  it('does not treat a window as overlapping itself when it is edited', () => {
    const existing = entry({ id: 'sch_a' });
    expect(check(entry({ id: 'sch_a' }), { entries: [existing] })).toEqual([]);
  });

  it('reports every problem at once rather than one at a time', () => {
    const problems = check(entry({ startsAt: iso(-5 * HOUR), endsAt: iso(-6 * HOUR) }), {
      hasDefault: false,
    });
    expect(problems.length).toBeGreaterThan(2);
  });
});

describe('editing a window that has already started', () => {
  /**
   * The same guardrails run on an edit as on a booking, with one exception:
   * a live window legitimately started in the past, and refusing it for that
   * would make an event impossible to extend once it was running.
   */
  it('keeps the past start it legitimately has', () => {
    const live = entry({ startsAt: iso(-2 * HOUR), endsAt: iso(5 * HOUR), state: 'active' });
    expect(check(live).join(' ')).toMatch(/in the past/i);
    expect(check(live, { started: true })).toEqual([]);
  });

  it('is still held to every other rule', () => {
    const backwards = entry({ startsAt: iso(-2 * HOUR), endsAt: iso(-3 * HOUR), state: 'active' });
    expect(check(backwards, { started: true }).join(' ')).toMatch(/not after the start/i);

    const clashing = entry({ startsAt: iso(-2 * HOUR), endsAt: iso(5 * HOUR), state: 'active' });
    const problems = check(clashing, {
      started: true,
      entries: [entry({ id: 'sch_b', startsAt: iso(HOUR), endsAt: iso(9 * HOUR) })],
    });
    expect(problems.join(' ')).toMatch(/overlaps/i);
  });
});

describe('what should be live at an instant', () => {
  const open = entry({ id: 'sch_open', startsAt: iso(-HOUR), endsAt: iso(HOUR) });
  const future = entry({ id: 'sch_future', startsAt: iso(HOUR), endsAt: iso(2 * HOUR) });
  const past = entry({ id: 'sch_past', startsAt: iso(-4 * HOUR), endsAt: iso(-2 * HOUR) });

  it('picks the window whose span contains now', () => {
    const { winner } = windowFor([past, open, future], 'shop', 'env-test', NOW);
    expect(winner.id).toBe('sch_open');
  });

  it('picks nothing when no window is open', () => {
    const { winner } = windowFor([past, future], 'shop', 'env-test', NOW);
    expect(winner).toBeNull();
  });

  it('treats an open-ended window as live for ever', () => {
    const forever = entry({ id: 'sch_forever', startsAt: iso(-HOUR), endsAt: null });
    const { winner } = windowFor([forever], 'shop', 'env-test', NOW + 365 * 24 * HOUR);
    expect(winner.id).toBe('sch_forever');
  });

  it('excludes the moment a window ends, so an end and the next start do not both apply', () => {
    const { winner } = windowFor([open], 'shop', 'env-test', Date.parse(open.endsAt as string));
    expect(winner).toBeNull();
  });

  it('includes the exact moment a window starts', () => {
    const { winner } = windowFor([future], 'shop', 'env-test', Date.parse(future.startsAt as string));
    expect(winner.id).toBe('sch_future');
  });

  it('gives the later start priority and reports the others as superseded', () => {
    // Overlap cannot be booked through the console, but a hand-edited schedule
    // file could still produce it, and silence would be the wrong answer.
    const earlier = entry({ id: 'sch_earlier', startsAt: iso(-3 * HOUR), endsAt: iso(3 * HOUR) });
    const later = entry({ id: 'sch_later', startsAt: iso(-HOUR), endsAt: iso(3 * HOUR) });
    const { winner, losers } = windowFor([earlier, later], 'shop', 'env-test', NOW);
    expect(winner.id).toBe('sch_later');
    expect(losers.map((loser: { id: string }) => loser.id)).toEqual(['sch_earlier']);
  });

  it('never resurrects a finished window', () => {
    const cancelled = entry({ id: 'sch_open', startsAt: iso(-HOUR), endsAt: iso(HOUR), state: 'cancelled' });
    const { winner } = windowFor([cancelled], 'shop', 'env-test', NOW);
    expect(winner).toBeNull();
  });

  it('keeps one config and environment from answering for another', () => {
    expect(windowFor([open], 'bots', 'env-test', NOW).winner).toBeNull();
    expect(windowFor([open], 'shop', 'env-prod', NOW).winner).toBeNull();
  });
});

describe('terminal states', () => {
  it('counts every state a window cannot come back from', () => {
    for (const state of ['completed', 'cancelled', 'missed', 'failed', 'superseded']) {
      expect(isTerminal({ state })).toBe(true);
    }
    for (const state of ['scheduled', 'active']) {
      expect(isTerminal({ state })).toBe(false);
    }
  });
});
