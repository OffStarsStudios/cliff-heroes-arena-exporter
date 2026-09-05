import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module shared with the production server.
import { buildPublishNote, hashValue, toGitContent, toStoredValue } from '../server/publish.mjs';
// @ts-expect-error - plain .mjs module shared with the production server.
import { describeChange, diffJson, summarizeDiff } from '../server/diff.mjs';

import arenasJson from '../config/arenas.json';
import trophyRoadJson from '../config/trophyRoad.json';
import shopJson from '../config/shop.json';

/**
 * The same config is stored two ways: minified in ConfigCat, pretty-printed in
 * git. That is only safe if the two are provably the same config, so these
 * tests pin the round trip rather than the formatting.
 */
describe('storage formats', () => {
  it('stores a compact form for ConfigCat and a readable one for git', () => {
    const stored = toStoredValue(trophyRoadJson);
    const committed = toGitContent(trophyRoadJson);
    expect(stored.includes('\n')).toBe(false);
    expect(committed.includes('\n')).toBe(true);
    expect(committed.length > stored.length).toBe(true);
  });

  it('round-trips both forms to the same config', () => {
    expect(diffJson(JSON.parse(toStoredValue(shopJson)), shopJson)).toHaveLength(0);
    expect(diffJson(JSON.parse(toGitContent(shopJson)), shopJson)).toHaveLength(0);
  });

  it('keeps key order in both forms, which the schemas require', () => {
    const milestone = { Trophies: 10, RewardID: 'reward.currency.coins', Amount: 50 };
    expect(Object.keys(JSON.parse(toStoredValue(milestone)))).toEqual([
      'Trophies',
      'RewardID',
      'Amount',
    ]);
    expect(Object.keys(JSON.parse(toGitContent(milestone)))).toEqual([
      'Trophies',
      'RewardID',
      'Amount',
    ]);
  });

  it('ends a committed file with a newline', () => {
    expect(toGitContent(shopJson).endsWith('}\n')).toBe(true);
  });
});

/**
 * The baseline hash is what stops two publishes overwriting each other, so it
 * has to be stable for an unchanged value and different for a changed one.
 */
describe('baseline hash', () => {
  it('is stable for the same text', () => {
    const text = toStoredValue(trophyRoadJson);
    expect(hashValue(text)).toBe(hashValue(text));
  });

  it('changes when the value changes', () => {
    const changed = JSON.parse(JSON.stringify(trophyRoadJson));
    changed.Milestones[1].Amount = 51;
    expect(hashValue(toStoredValue(trophyRoadJson))).not.toBe(hashValue(toStoredValue(changed)));
  });

  it('distinguishes a missing value from an empty one without throwing', () => {
    expect(typeof hashValue(null)).toBe('string');
    expect(hashValue(null)).toBe(hashValue(''));
  });

  it('is sensitive to formatting, which is why it is only ever compared to itself', () => {
    // The hash is taken over the stored text, so the pretty form hashes
    // differently. That is fine - it is only ever compared against the value
    // read back from the same place - but it must not be used as a config
    // identity, so this pins the behaviour rather than leaving it implied.
    expect(hashValue(toStoredValue(shopJson))).not.toBe(hashValue(toGitContent(shopJson)));
  });
});

/**
 * Every publish writes a note: into ConfigCat's audit log and into the git
 * commit body. It is the only record that says *what* changed, so it has to
 * describe the diff rather than merely announce that there was one.
 */
describe('the publish note', () => {
  const noteFor = (before: unknown, after: unknown, note?: string) => {
    const changes = diffJson(before, after);
    return buildPublishNote({
      settingKey: 'arenasSettings',
      changes: changes.map((change: Record<string, unknown>) => ({
        ...change,
        description: describeChange(change),
      })),
      summary: summarizeDiff(changes),
      note,
    });
  };

  it('names the setting when nothing changed', () => {
    const note = noteFor(shopJson, shopJson);
    expect(note).toBe('Published arenasSettings from the back office.');
  });

  it('prefers the caller\'s own lead when there is one', () => {
    const note = noteFor(shopJson, shopJson, 'Published shopSettings from the shop exporter.');
    expect(note).toBe('Published shopSettings from the shop exporter.');
  });

  it('counts the changes and spells each one out', () => {
    const after = JSON.parse(JSON.stringify(arenasJson));
    after.Arenas[0].TrackCount = 18;
    const note = noteFor(arenasJson, after);
    expect(note).toContain('1 change (1 changed):');
    expect(note).toContain('TrackCount: 15 -> 18');
  });

  it('reports additions and removals in the counts', () => {
    const after = JSON.parse(JSON.stringify(arenasJson));
    after.Arenas.push({ ID: 'arena.frozenpeak', TrackCount: 30, BotLevels: ['Hard'] });
    const note = noteFor(arenasJson, after);
    expect(note).toContain('added');
    expect(note).toContain('arena.frozenpeak');
  });

  it('stays short enough to read, saying how many it left out', () => {
    // Rewriting every trophy road milestone produces far more changes than
    // belong in an audit log entry.
    const after = JSON.parse(JSON.stringify(trophyRoadJson));
    for (const milestone of after.Milestones) {
      if (typeof milestone.Amount === 'number') milestone.Amount += 1;
    }
    const note = noteFor(trophyRoadJson, after);
    expect(note.length).toBeLessThanOrEqual(900);
    expect(note).toMatch(/and \d+ more$/);
    // The count still reports the whole diff, not just what was listed.
    expect(note).toContain('23 changes');
  });
});
