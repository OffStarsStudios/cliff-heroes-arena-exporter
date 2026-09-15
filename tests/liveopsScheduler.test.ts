import { beforeEach, describe, expect, it, vi } from 'vitest';
import rollingOfferJson from '../config/rollingOffer.json';
import battlePassJson from '../config/battlePass.json';
import offJson from '../config/off/battlePass.json';

/**
 * The scheduler's live ops paths, end to end, with ConfigCat and GitHub
 * replaced by an in-memory stand-in.
 *
 * These are the paths that publish without a person reading a diff: ending an
 * event from the calendar, putting a booked offer live, and taking one down at
 * its end. Each is checked for what it actually writes into the setting.
 */

const ENV = 'env-test';
const OFFERS_KEY = 'rollingOfferSettings';
const PASS_KEY = 'battlePassSettings';

const state = {
  live: {} as Record<string, string>,
  store: { version: 1, updatedAt: null, entries: [] as Record<string, unknown>[] } as Record<string, unknown>,
  off: { battlePass: offJson } as Record<string, unknown>,
  published: [] as { settingKey: string; payload: Record<string, unknown>; baselineHash?: string }[],
};

vi.mock('../server/configcat.mjs', () => ({
  ConfigCatError: class extends Error {},
  getValues: async () => ({
    unreadable: null,
    settings: Object.entries(state.live).map(([key, value]) => ({ key, value, json: JSON.parse(value) })),
  }),
}));

vi.mock('../server/git.mjs', () => ({
  CONFIG_TARGET: { branch: 'config-history' },
  branchName: () => 'schedules',
  repoName: () => 'test/repo',
  gitAvailable: () => true,
  readJson: async (path: string, fallback: unknown) => {
    if (path === 'schedules/schedules.json') return { value: structuredClone(state.store), sha: 'sha', existed: true };
    const off = /^config\/off\/(.+)\.json$/.exec(path);
    if (off !== null && state.off[off[1]] !== undefined) return { value: state.off[off[1]], sha: 'x', existed: true };
    return { value: fallback, sha: null, existed: false };
  },
  commitJson: async ({ path, value }: { path: string; value: Record<string, unknown> }) => {
    if (path === 'schedules/schedules.json') state.store = structuredClone(value);
    return { committed: true };
  },
}));

vi.mock('../server/publish.mjs', async () => {
  const { createHash } = await import('crypto');
  const hashValue = (text: string | null) => createHash('sha256').update(text ?? '', 'utf8').digest('hex').slice(0, 16);
  return {
    hashValue,
    toStoredValue: (payload: unknown) => JSON.stringify(payload),
    applyPublish: async ({ entries }: { entries: { settingKey: string; payload: Record<string, unknown>; baselineHash?: string }[] }) => {
      const results = entries.map((entry) => {
        if (entry.baselineHash !== undefined && entry.baselineHash !== hashValue(state.live[entry.settingKey] ?? null)) {
          return { settingKey: entry.settingKey, status: 'conflict', message: 'moved' };
        }
        state.published.push(entry);
        state.live[entry.settingKey] = JSON.stringify(entry.payload);
        return { settingKey: entry.settingKey, status: 'written' };
      });
      return { results };
    },
  };
});

// @ts-expect-error - plain .mjs module shared with the production server.
const scheduler = await import('../server/schedule.mjs');
const { fromClientUtc } = await import('../server/liveopsFeatures.mjs');

type Offer = { OfferID: string; DisplayName?: string; IsTimed?: boolean; StartUtc?: string; DurationHours?: number };
const liveOffers = () => JSON.parse(state.live[OFFERS_KEY]) as { Offers: Offer[] };
const offer = (id: string) => liveOffers().Offers.find((candidate) => candidate.OfferID === id) as Offer;

beforeEach(() => {
  state.live = { [OFFERS_KEY]: JSON.stringify(rollingOfferJson), [PASS_KEY]: JSON.stringify(battlePassJson) };
  state.store = { version: 1, updatedAt: null, entries: [] };
  state.published = [];
});

describe('ending a live event by hand', () => {
  it('closes an offer nobody booked, and leaves the other offer alone', async () => {
    const now = Date.parse('2026-09-10T12:00:00.000Z');
    const result = await scheduler.endLiveEvent({ domain: 'rollingOffer', environmentId: ENV, subjectId: 'offer.roll.1', now });
    expect(result.ok).toBe(true);
    const ended = offer('offer.roll.1');
    expect(fromClientUtc(ended.StartUtc) + (ended.DurationHours as number) * 3600000).toBeLessThanOrEqual(now);
    expect(offer('offer.roll.2')).toEqual(rollingOfferJson.Offers[1]);
    // Checked against the value it read, so nothing written in between is lost.
    expect(state.published[0].baselineHash).toBeDefined();
  });

  it('cancels the booking that was running it, so the heartbeat does not end it twice', async () => {
    state.store.entries = [
      {
        id: 'sch_run',
        domain: 'rollingOffer',
        settingKey: OFFERS_KEY,
        environmentId: ENV,
        state: 'active',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-15T00:00:00.000Z',
        payload: rollingOfferJson,
        liveops: { category: 'monetization', opensAt: '2026-09-01T00:00:00.000Z', subjectId: 'offer.roll.1' },
        history: [],
      },
    ];
    const result = await scheduler.endLiveEvent({
      domain: 'rollingOffer',
      environmentId: ENV,
      subjectId: 'offer.roll.1',
      now: Date.parse('2026-09-10T12:00:00.000Z'),
    });
    expect(result.cancelled.map((entry: { id: string }) => entry.id)).toEqual(['sch_run']);
    expect((state.store.entries as { state: string }[])[0].state).toBe('cancelled');
  });

  it('refuses to end an event that changed after it was looked at', async () => {
    const result = await scheduler.endLiveEvent({
      domain: 'rollingOffer',
      environmentId: ENV,
      subjectId: 'offer.roll.1',
      expected: { ...rollingOfferJson.Offers[0], DisplayName: 'what the page showed' },
    });
    expect(result.ok).toBe(false);
    expect(state.published).toEqual([]);
  });

  it('ends a season by publishing the off state', async () => {
    const result = await scheduler.endLiveEvent({ domain: 'battlePass', environmentId: ENV, subjectId: 'pass.season1' });
    expect(result.ok).toBe(true);
    expect(JSON.parse(state.live[PASS_KEY])).toEqual(offJson);
  });

  it('removes an offer for good only when asked to', async () => {
    await scheduler.endLiveEvent({ domain: 'rollingOffer', environmentId: ENV, subjectId: 'offer.roll.1', mode: 'remove' });
    expect(liveOffers().Offers.map((candidate) => candidate.OfferID)).toEqual(['offer.roll.2']);
  });
});

describe('changing a live event by hand', () => {
  it('moves an offer window without touching its steps or its neighbour', async () => {
    const result = await scheduler.publishLiveEvent({
      domain: 'rollingOffer',
      environmentId: ENV,
      subjectId: 'offer.roll.1',
      window: { startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-20T00:00:00.000Z' },
    });
    expect(result.ok).toBe(true);
    expect(offer('offer.roll.1')).toMatchObject({ StartUtc: '2026-09-01 00:00', DurationHours: 456 });
    expect(offer('offer.roll.1')).toHaveProperty('Steps', rollingOfferJson.Offers[0].Steps);
    expect(offer('offer.roll.2')).toEqual(rollingOfferJson.Offers[1]);
  });
});

describe('putting a booked offer live', () => {
  it('merges it into the offers live now, not the list it was booked with', async () => {
    // Booked from a sheet when only roll.1 existed; roll.2 is live today.
    const booked = { ...rollingOfferJson, Offers: [{ ...rollingOfferJson.Offers[0], OfferID: 'offer.roll.3', DisplayName: 'NEW' }] };
    const result = await scheduler.createEntry({
      domain: 'rollingOffer',
      environmentId: ENV,
      label: 'Roll three',
      payload: booked,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      startNow: true,
      liveops: { category: 'monetization', opensAt: new Date().toISOString(), subjectId: 'offer.roll.3' },
    });
    expect(result.ok).toBe(true);
    expect(result.started.ok).toBe(true);
    expect(liveOffers().Offers.map((candidate) => candidate.OfferID)).toEqual(['offer.roll.1', 'offer.roll.2', 'offer.roll.3']);
    // Its window is the booking's, written into the offer.
    // Within a minute: the start is floored to the minute it was booked in.
    expect(offer('offer.roll.3').DurationHours).toBeCloseTo(72, 1);
    expect((state.store.entries as { state: string }[])[0].state).toBe('active');
  });
});

describe('the heartbeat taking an offer down at its end', () => {
  it('still recognises its own offer when a neighbour changed meanwhile', async () => {
    const mine = { ...rollingOfferJson.Offers[0], StartUtc: '2026-09-01 00:00', DurationHours: 24 };
    state.live[OFFERS_KEY] = JSON.stringify({ ...rollingOfferJson, Offers: [mine, { ...rollingOfferJson.Offers[1], DisplayName: 'EDITED' }] });
    state.store.entries = [
      {
        id: 'sch_end',
        domain: 'rollingOffer',
        settingKey: OFFERS_KEY,
        gitPath: 'config/rollingOffer.json',
        environmentId: ENV,
        state: 'active',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-02T00:00:00.000Z',
        payload: { ...rollingOfferJson, Offers: [mine, rollingOfferJson.Offers[1]] },
        liveops: { category: 'monetization', opensAt: '2026-09-01T00:00:00.000Z', subjectId: 'offer.roll.1' },
        history: [],
      },
    ];
    const result = await scheduler.tick({ now: Date.parse('2026-09-03T00:00:00.000Z') });
    expect(result.actions).toContainEqual(expect.objectContaining({ id: 'sch_end', action: 'end', ok: true }));
    // Retired, and the neighbour's edit is kept rather than reverted.
    expect(liveOffers().Offers.map((candidate) => candidate.OfferID)).toEqual(['offer.roll.2']);
    expect(offer('offer.roll.2').DisplayName).toBe('EDITED');
  });
});
