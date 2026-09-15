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
    // The whole publish response comes back, so a page can show it like any other publish.
    expect(result.response.results[0].status).toBe('written');
    expect(offer('offer.roll.1')).toMatchObject({ StartUtc: '2026-09-01 00:00', DurationHours: 456 });
    expect(offer('offer.roll.1')).toHaveProperty('Steps', rollingOfferJson.Offers[0].Steps);
    expect(offer('offer.roll.2')).toEqual(rollingOfferJson.Offers[1]);
  });
});

describe('publishing one offer from its page', () => {
  it('keeps an offer that went live after the page read the list', async () => {
    // The page built its payload from a list with only roll.1 and roll.2;
    // ro.test.1 went live afterwards.
    const pageBuilt = { ...rollingOfferJson, Offers: [{ ...rollingOfferJson.Offers[1], DisplayName: 'SPACE RUN II' }, rollingOfferJson.Offers[0]] };
    const since = { OfferID: 'ro.test.1', DisplayName: 'SPACE BINGE', IsTimed: false, Steps: [] };
    state.live[OFFERS_KEY] = JSON.stringify({ ...rollingOfferJson, Offers: [...rollingOfferJson.Offers, since] });

    const result = await scheduler.publishLiveEvent({
      domain: 'rollingOffer',
      environmentId: ENV,
      subjectId: 'offer.roll.2',
      payload: pageBuilt,
    });
    expect(result.ok).toBe(true);
    expect(liveOffers().Offers.map((candidate) => candidate.OfferID)).toEqual(['offer.roll.1', 'offer.roll.2', 'ro.test.1']);
    expect(offer('offer.roll.2').DisplayName).toBe('SPACE RUN II');
    // Only the offer this page is about comes from the page.
    expect(offer('offer.roll.1')).toEqual(rollingOfferJson.Offers[0]);
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
    const run = `offer.roll.3.r${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
    expect(liveOffers().Offers.map((candidate) => candidate.OfferID)).toEqual(['offer.roll.1', 'offer.roll.2', run]);
    // Its window is the booking's, written into the offer.
    // Within a minute: the start is floored to the minute it was booked in.
    expect(offer(run).DurationHours).toBeCloseTo(72, 1);
    expect((state.store.entries as { state: string }[])[0].state).toBe('active');
  });
});

/* ------------------------------------------------------------------ runs -- */

const OPENS = '2099-03-10T09:00:00.000Z';
const ENDS = '2099-03-12T09:00:00.000Z';
const sheetOffer = { ...rollingOfferJson.Offers[0], OfferID: 'offer.spacebinge', DisplayName: 'SPACE BINGE' };
const book = (overrides: Record<string, unknown> = {}) =>
  scheduler.createEntry({
    domain: 'rollingOffer',
    environmentId: ENV,
    label: 'Space binge',
    payload: { ...rollingOfferJson, Offers: [sheetOffer] },
    startsAt: OPENS,
    endsAt: ENDS,
    liveops: { category: 'monetization', opensAt: OPENS, subjectId: 'offer.spacebinge' },
    ...overrides,
  });

describe('every run of an event is a new ID', () => {
  it('books the base the sheet names as a run keyed by the day it opens', async () => {
    const result = await book();
    expect(result.ok).toBe(true);
    expect(result.entry.liveops).toMatchObject({ subjectId: 'offer.spacebinge.r20990310', baseId: 'offer.spacebinge' });
    expect(result.entry.payload.Offers[0].OfferID).toBe('offer.spacebinge.r20990310');
  });

  it('gives a second run on the same day a letter, never the first run\'s ID', async () => {
    await book({ endsAt: '2099-03-10T10:00:00.000Z' });
    const second = await book({
      startsAt: '2099-03-10T12:00:00.000Z',
      endsAt: '2099-03-10T13:00:00.000Z',
      liveops: { category: 'monetization', opensAt: '2099-03-10T12:00:00.000Z', subjectId: 'offer.spacebinge' },
    });
    expect(second.ok).toBe(true);
    expect(second.entry.liveops.subjectId).toBe('offer.spacebinge.r20990310b');
  });

  it('refuses two runs of one offer at once, whatever their IDs', async () => {
    await book();
    const clash = await book({
      startsAt: '2099-03-11T09:00:00.000Z',
      liveops: { category: 'monetization', opensAt: '2099-03-11T09:00:00.000Z', subjectId: 'offer.spacebinge' },
    });
    expect(clash.ok).toBe(false);
    expect(clash.problems.join(' ')).toContain('overlaps');
  });

  it('keeps the run when its dates move or its sheet is reloaded, so players keep their place', async () => {
    const { entry } = await book();
    const moved = await scheduler.updateEntry({
      id: entry.id,
      endsAt: '2099-03-20T09:00:00.000Z',
      liveops: { opensAt: '2099-03-15T09:00:00.000Z', subjectId: 'offer.spacebinge' },
      payload: { ...rollingOfferJson, Offers: [{ ...sheetOffer, Subtitle: 'fixed' }] },
    });
    expect(moved.ok).toBe(true);
    expect(moved.entry.liveops.subjectId).toBe('offer.spacebinge.r20990310');
    expect(moved.entry.payload.Offers[0]).toMatchObject({ OfferID: 'offer.spacebinge.r20990310', Subtitle: 'fixed' });
  });

  it('refuses a reloaded sheet that is a different offer', async () => {
    const { entry } = await book();
    const other = await scheduler.updateEntry({
      id: entry.id,
      payload: { ...rollingOfferJson, Offers: [{ ...sheetOffer, OfferID: 'offer.other' }] },
    });
    expect(other.ok).toBe(false);
  });
});

describe('publishing from a feature page, which names only the base', () => {
  const now = Date.parse('2026-09-10T12:00:00.000Z');

  it('changes the run of that offer that is in the game', async () => {
    const running = { ...rollingOfferJson.Offers[0], OfferID: 'offer.roll.1.r20260901' };
    state.live[OFFERS_KEY] = JSON.stringify({ ...rollingOfferJson, Offers: [running, rollingOfferJson.Offers[1]] });
    const page = { ...rollingOfferJson, Offers: [running, { ...rollingOfferJson.Offers[0], DisplayName: 'RE-CUT' }] };
    page.Offers[1] = { ...page.Offers[1], OfferID: 'offer.roll.1' };

    const result = await scheduler.publishLiveEvent({
      domain: 'rollingOffer',
      environmentId: ENV,
      subjectId: 'offer.roll.1',
      payload: page,
      resolveRun: true,
      now,
    });
    expect(result.ok).toBe(true);
    expect(result.subjectId).toBe('offer.roll.1.r20260901');
    expect(liveOffers().Offers.map((candidate) => candidate.OfferID)).toEqual(['offer.roll.1.r20260901', 'offer.roll.2']);
    expect(offer('offer.roll.1.r20260901').DisplayName).toBe('RE-CUT');
  });

  it('starts a new run when the last one has ended, even though it is still listed', async () => {
    const ended = { ...rollingOfferJson.Offers[0], OfferID: 'offer.roll.1.r20260801', StartUtc: '2026-08-01 00:00', DurationHours: 24 };
    state.live[OFFERS_KEY] = JSON.stringify({ ...rollingOfferJson, Offers: [ended, rollingOfferJson.Offers[1]] });
    const page = { ...rollingOfferJson, Offers: [{ ...rollingOfferJson.Offers[0], OfferID: 'offer.roll.1', IsTimed: false }] };
    delete (page.Offers[0] as Record<string, unknown>).StartUtc;
    delete (page.Offers[0] as Record<string, unknown>).DurationHours;

    const result = await scheduler.publishLiveEvent({
      domain: 'rollingOffer',
      environmentId: ENV,
      subjectId: 'offer.roll.1',
      payload: page,
      resolveRun: true,
      now,
    });
    expect(result.ok).toBe(true);
    expect(result.subjectId).toBe('offer.roll.1.r20260910');
    // The ended run is left for the sweep; its players' progress is not reused.
    expect(liveOffers().Offers.map((candidate) => candidate.OfferID)).toEqual([
      'offer.roll.1.r20260801',
      'offer.roll.2',
      'offer.roll.1.r20260910',
    ]);
  });

  it('gives two different offers opening on the same day their own IDs', async () => {
    const page = (id: string) => ({
      ...rollingOfferJson,
      Offers: [{ ...rollingOfferJson.Offers[0], OfferID: id, StartUtc: '2026-09-10 09:00', DurationHours: 48 }],
    });
    const testro = await scheduler.publishLiveEvent({ domain: 'rollingOffer', environmentId: ENV, subjectId: 'offer.testro', payload: page('offer.testro'), resolveRun: true, now });
    const other = await scheduler.publishLiveEvent({ domain: 'rollingOffer', environmentId: ENV, subjectId: 'offer.testro.1', payload: page('offer.testro.1'), resolveRun: true, now });
    expect([testro.subjectId, other.subjectId]).toEqual(['offer.testro.r20260910', 'offer.testro.1.r20260910']);
  });

  it('never mints the ID of a run that was published from its page and has since been retired', async () => {
    // Nothing booked it and ConfigCat no longer lists it - only the register remembers it, and the
    // game's server still holds its players' progress.
    const page = {
      ...rollingOfferJson,
      Offers: [{ ...rollingOfferJson.Offers[0], OfferID: 'offer.gone', StartUtc: '2026-09-10 09:00', DurationHours: 1 }],
    };
    const first = await scheduler.publishLiveEvent({ domain: 'rollingOffer', environmentId: ENV, subjectId: 'offer.gone', payload: page, resolveRun: true, now });
    expect(first.subjectId).toBe('offer.gone.r20260910');
    state.live[OFFERS_KEY] = JSON.stringify(rollingOfferJson);

    const again = await scheduler.publishLiveEvent({ domain: 'rollingOffer', environmentId: ENV, subjectId: 'offer.gone', payload: page, resolveRun: true, now });
    expect(again.subjectId).toBe('offer.gone.r20260910b');
    expect(state.store.mintedRunIds).toEqual(['offer.gone.r20260910', 'offer.gone.r20260910b']);
  });

  it('puts a season out as a run keyed by its own start', async () => {
    const next = { ...battlePassJson, SeasonID: 'pass.season2', StartUtc: '2026-10-01 00:00' };
    const result = await scheduler.publishLiveEvent({
      domain: 'battlePass',
      environmentId: ENV,
      subjectId: 'pass.season2',
      payload: next,
      resolveRun: true,
      now,
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(state.live[PASS_KEY]).SeasonID).toBe('pass.season2.r20261001');
  });
});

describe('an offer\'s text and art, set on the event', () => {
  it('republishes a live offer with new art, without its sheet', async () => {
    const presentation = {
      DisplayName: 'ROLL AGAIN',
      Subtitle: 'New subtitle',
      CompletionText: '',
      BackgroundArt: 'GuySuperSpaceBG',
      TopBarArt: '',
      RewardArt: '',
      ButtonArt: 'GuySuperSpaceButton',
    };
    const result = await scheduler.publishLiveEvent({ domain: 'rollingOffer', environmentId: ENV, subjectId: 'offer.roll.1', presentation });
    expect(result.ok).toBe(true);
    const changed = offer('offer.roll.1') as Offer & Record<string, unknown>;
    expect(changed).toMatchObject({ DisplayName: 'ROLL AGAIN', BackgroundArt: 'GuySuperSpaceBG', ButtonArt: 'GuySuperSpaceButton' });
    // Emptied fields are left out, so the client falls back rather than drawing nothing by name.
    expect(changed).not.toHaveProperty('TopBarArt');
    expect(changed).not.toHaveProperty('CompletionText');
    expect(changed.Steps).toEqual(rollingOfferJson.Offers[0].Steps);
  });

  it('refuses text the offer page could not draw', async () => {
    const result = await book({
      presentation: { DisplayName: '', Subtitle: '', CompletionText: 'WIN {1}', BackgroundArt: '', TopBarArt: '', RewardArt: '', ButtonArt: '' },
    });
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThanOrEqual(2);
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
    const result = await scheduler.tick({ now: Date.parse('2026-09-03T00:00:00.000Z'), environments: [ENV] });
    expect(result.actions).toContainEqual(expect.objectContaining({ id: 'sch_end', action: 'end', ok: true }));
    // Left listed with its window closed, and the neighbour's edit kept rather than reverted.
    expect(liveOffers().Offers.map((candidate) => candidate.OfferID)).toEqual(['offer.roll.1', 'offer.roll.2']);
    expect(offer('offer.roll.2').DisplayName).toBe('EDITED');
  });
});

describe('the heartbeat retiring ended runs', () => {
  const ended = (id: string, start: string) => ({ ...rollingOfferJson.Offers[0], OfferID: id, StartUtc: start, DurationHours: 24 });

  it('takes out an offer seven days after its window closed, and not before', async () => {
    state.live[OFFERS_KEY] = JSON.stringify({
      ...rollingOfferJson,
      Offers: [ended('offer.a.r20260901', '2026-09-01 00:00'), ended('offer.b.r20260905', '2026-09-05 00:00'), rollingOfferJson.Offers[1]],
    });
    // a closed 2 Sep, b closed 6 Sep: at 10 Sep only a is a week gone.
    const result = await scheduler.tick({ now: Date.parse('2026-09-10T00:00:00.000Z'), environments: [ENV] });
    expect(result.actions).toContainEqual(expect.objectContaining({ action: 'retire', ok: true, detail: 'offer.a.r20260901' }));
    expect(liveOffers().Offers.map((candidate) => candidate.OfferID)).toEqual(['offer.b.r20260905', 'offer.roll.2']);
  });

  it('keeps the last offer listed, because the client ignores an empty list', async () => {
    state.live[OFFERS_KEY] = JSON.stringify({ ...rollingOfferJson, Offers: [ended('offer.a.r20260801', '2026-08-01 00:00')] });
    await scheduler.tick({ now: Date.parse('2026-09-10T00:00:00.000Z'), environments: [ENV] });
    expect(liveOffers().Offers.map((candidate) => candidate.OfferID)).toEqual(['offer.a.r20260801']);
  });

  it('looks once an hour, not on every tick', async () => {
    const now = Date.parse('2026-09-10T00:00:00.000Z');
    await scheduler.tick({ now, environments: [ENV] });
    state.live[OFFERS_KEY] = JSON.stringify({
      ...rollingOfferJson,
      Offers: [ended('offer.a.r20260801', '2026-08-01 00:00'), rollingOfferJson.Offers[1]],
    });
    await scheduler.tick({ now: now + 5 * 60000, environments: [ENV] });
    expect(liveOffers().Offers).toHaveLength(2);
    await scheduler.tick({ now: now + 61 * 60000, environments: [ENV] });
    expect(liveOffers().Offers).toHaveLength(1);
  });
});

describe('deleting a booking from the calendar', () => {
  const booking = (state_: string, subjectId = 'offer.old.r20260901') => ({
    id: `sch_${state_}`,
    domain: 'rollingOffer',
    settingKey: OFFERS_KEY,
    environmentId: ENV,
    label: 'Old offer',
    state: state_,
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2026-09-03T00:00:00.000Z',
    payload: rollingOfferJson,
    liveops: { category: 'monetization', opensAt: '2026-09-01T00:00:00.000Z', subjectId },
    history: [],
  });

  it('erases a finished booking and keeps its run ID from ever being minted again', async () => {
    // Booked before the register existed, so only the booking remembered its ID.
    state.store.entries = [booking('completed')];
    const result = await scheduler.deleteEntry('sch_completed');
    expect(result.ok).toBe(true);
    expect(state.store.entries).toEqual([]);
    expect(state.store.mintedRunIds).toEqual(['offer.old.r20260901']);
    expect(state.published).toEqual([]);
  });

  it('erases a booking still to come without publishing anything', async () => {
    const { entry } = await book();
    const result = await scheduler.deleteEntry(entry.id);
    expect(result.ok).toBe(true);
    expect(state.store.entries).toEqual([]);
    expect(state.published).toEqual([]);

    const again = await book();
    expect(again.entry.liveops.subjectId).toBe('offer.spacebinge.r20990310b');
  });

  it('refuses a running booking, which has to be ended first', async () => {
    state.store.entries = [booking('active')];
    const result = await scheduler.deleteEntry('sch_active');
    expect(result.ok).toBe(false);
    expect(state.store.entries).toHaveLength(1);
  });

  it('refuses a core config window, which keeps its history', async () => {
    state.store.entries = [{ ...booking('completed'), liveops: null, domain: 'shop' }];
    const result = await scheduler.deleteEntry('sch_completed');
    expect(result.ok).toBe(false);
    expect(state.store.entries).toHaveLength(1);
  });
});
