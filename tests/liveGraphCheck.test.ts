import { describe, expect, it } from 'vitest';
import arenasJson from '../config/arenas.json';
import botsJson from '../config/bots.json';
import matchTrophyJson from '../config/matchTrophy.json';
import trophyRoadJson from '../config/trophyRoad.json';
import type { ArenasConfig, BotsConfig, ConfigSet, MatchTrophyConfig } from '../src/domains/types';
import { compareGraphReports, withCandidate } from '../src/lib/liveConfig';
import type { ArenaProgressConfig } from '../src/lib/types';
import { validateGraph } from '../src/workspace/graph';
import { registryFromConfigs } from '../src/workspace/registry';

const live: ConfigSet = {
  arenas: arenasJson as ArenasConfig,
  bots: botsJson as BotsConfig,
  matchTrophy: matchTrophyJson as MatchTrophyConfig,
  trophyRoad: trophyRoadJson as unknown as ArenaProgressConfig,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function report(set: ConfigSet) {
  return validateGraph(set, registryFromConfigs(set));
}

describe('candidate substitution', () => {
  it('replaces only the target domain', () => {
    const candidate = { Arenas: [] };
    const set = withCandidate(live, 'arenas', candidate);
    expect(set.arenas).toBe(candidate);
    expect(set.bots).toBe(live.bots);
    expect(set.trophyRoad).toBe(live.trophyRoad);
  });

  it('adds a domain the live config does not have', () => {
    const set = withCandidate({}, 'arenas', arenasJson);
    expect(set).toEqual({ arenas: arenasJson });
  });
});

describe('report comparison', () => {
  it('classes the ever-present difficulty-mapping warning as pre-existing', () => {
    const comparison = compareGraphReports(report(live), report(withCandidate(live, 'arenas', clone(arenasJson))));
    expect(comparison.introduced).toEqual([]);
    expect(comparison.resolved).toEqual([]);
    expect(comparison.preexisting.map((issue) => issue.code)).toContain('graph-bot-difficulty-unmapped');
  });

  it('flags a fourth bot as an introduced places mismatch', () => {
    const candidate = clone(arenasJson) as ArenasConfig;
    candidate.Arenas[0].BotLevels.push('Medium');
    const comparison = compareGraphReports(report(live), report(withCandidate(live, 'arenas', candidate)));
    expect(comparison.introduced.map((issue) => issue.code)).toEqual(['graph-places-mismatch']);
    expect(comparison.introduced[0].severity).toBe('error');
  });

  it('flags a dropped arena that the trophy road still introduces', () => {
    const candidate = clone(arenasJson) as ArenasConfig;
    candidate.Arenas = candidate.Arenas.filter((arena) => arena.ID !== 'arena.sakuracliffs');
    const comparison = compareGraphReports(report(live), report(withCandidate(live, 'arenas', candidate)));
    expect(comparison.introduced.map((issue) => issue.code)).toContain('graph-arena-undefined');
  });

  it('reports a live issue the candidate fixes as resolved', () => {
    const brokenLive = clone(live) as ConfigSet;
    brokenLive.arenas!.Arenas[0].BotLevels.push('Medium'); // live has the mismatch
    const comparison = compareGraphReports(report(brokenLive), report(withCandidate(brokenLive, 'arenas', clone(arenasJson))));
    expect(comparison.resolved.map((issue) => issue.code)).toEqual(['graph-places-mismatch']);
    expect(comparison.introduced).toEqual([]);
  });
});
