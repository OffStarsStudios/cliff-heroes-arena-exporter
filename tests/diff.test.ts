import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module shared with the production server.
import { diffJson, isEquivalent, summarizeDiff } from '../server/diff.mjs';

import trophyRoadJson from '../config/trophyRoad.json';
import shopJson from '../config/shop.json';
import botsJson from '../config/bots.json';

type Change = { kind: string; path: string; before?: unknown; after?: unknown };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function paths(changes: Change[]): string[] {
  return changes.map((change) => change.path);
}

describe('formatting is not a change', () => {
  it('treats a minified and a pretty-printed payload as equivalent', () => {
    const minified = JSON.parse(JSON.stringify(trophyRoadJson));
    const pretty = JSON.parse(JSON.stringify(trophyRoadJson, null, 2));
    expect(isEquivalent(minified, pretty)).toBe(true);
  });

  it('reports nothing at all for a payload compared with itself', () => {
    expect(diffJson(shopJson, clone(shopJson))).toHaveLength(0);
  });
});

describe('leaf changes', () => {
  it('reports a changed number with its full path', () => {
    const after = clone(botsJson);
    after.Bots[3].MinDodgeChance = 0.65;
    const changes = diffJson(botsJson, after) as Change[];
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('changed');
    expect(changes[0].path).toBe('Bots[Level=3].MinDodgeChance');
    expect(changes[0].before).toBe(0.6);
    expect(changes[0].after).toBe(0.65);
  });

  it('reports an added key', () => {
    const after = clone(botsJson);
    (after.Bots[0] as Record<string, unknown>).MinBrakeChance = 0.2;
    const changes = diffJson(botsJson, after) as Change[];
    expect(paths(changes)).toContain('Bots[Level=0].MinBrakeChance');
    expect(changes[0].kind).toBe('added');
  });

  it('reports a removed key', () => {
    const after = clone(botsJson);
    delete (after.Bots[0] as Record<string, unknown>).RaycastDistance;
    const changes = diffJson(botsJson, after) as Change[];
    expect(changes[0].kind).toBe('removed');
    expect(changes[0].path).toBe('Bots[Level=0].RaycastDistance');
  });
});

describe('key order', () => {
  it('reports a reordering, because these schemas mandate key order', () => {
    const before = { Trophies: 10, RewardID: 'reward.currency.coins', Amount: 50 };
    const after = { Trophies: 10, Amount: 50, RewardID: 'reward.currency.coins' };
    const changes = diffJson(before, after) as Change[];
    expect(changes.map((change) => change.kind)).toContain('reordered');
  });

  it('does not report a reordering when the order is unchanged', () => {
    const before = { Trophies: 10, RewardID: 'reward.currency.coins', Amount: 50 };
    expect(diffJson(before, clone(before))).toHaveLength(0);
  });
});

describe('arrays are matched by identity, not by index', () => {
  it('reports one insertion rather than a shifted tail', () => {
    const after = clone(trophyRoadJson);
    after.Milestones.splice(3, 0, {
      Trophies: 40,
      RewardID: 'reward.currency.coins',
      Amount: 60,
    } as never);
    const changes = diffJson(trophyRoadJson, after) as Change[];
    const added = changes.filter((change) => change.kind === 'added');
    expect(added).toHaveLength(1);
    expect(added[0].path).toBe('Milestones[Trophies=40]');
  });

  it('reports a removal by identity', () => {
    const after = clone(trophyRoadJson);
    after.Milestones = after.Milestones.filter((m) => (m as { Trophies: number }).Trophies !== 3500);
    const changes = diffJson(trophyRoadJson, after) as Change[];
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('removed');
    expect(changes[0].path).toBe('Milestones[Trophies=3500]');
  });

  it('names a changed field inside an identified element', () => {
    const after = clone(shopJson);
    after.Products[0].OfferDurationHours = 8;
    const changes = diffJson(shopJson, after) as Change[];
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe('Products[ID=shop.featured.cinder].OfferDurationHours');
  });

  it('reports a pure reordering of identified elements', () => {
    const after = clone(shopJson);
    const [first, second, ...rest] = after.Products;
    after.Products = [second, first, ...rest];
    const changes = diffJson(shopJson, after) as Change[];
    expect(changes.map((change) => change.kind)).toContain('reordered');
  });

  it('falls back to index comparison for arrays of primitives', () => {
    const changes = diffJson({ TrophiesByPlace: [60, 35, 0, -15] }, { TrophiesByPlace: [60, 30, 0, -15] }) as Change[];
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe('TrophiesByPlace[1]');
  });

  it('reports a lengthened primitive array', () => {
    const changes = diffJson({ TrophiesByPlace: [60, 35, 0, -15] }, { TrophiesByPlace: [60, 35, 0, -15, -30] }) as Change[];
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('added');
    expect(changes[0].path).toBe('TrophiesByPlace[4]');
  });
});

describe('summary', () => {
  it('counts changes by kind', () => {
    const after = clone(shopJson);
    after.Products[0].OfferDurationHours = 8;
    after.Products[1].BadgeLabel = 'NEW';
    const summary = summarizeDiff(diffJson(shopJson, after));
    expect(summary.total).toBe(2);
    expect(summary.changed).toBe(2);
  });
});
