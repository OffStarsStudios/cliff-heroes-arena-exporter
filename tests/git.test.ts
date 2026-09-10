import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module shared with the production server.
import { CONFIG_TARGET, branchName, encodePath, explainFailure, repoName } from '../server/git.mjs';

/**
 * Two things about the GitHub client are worth pinning.
 *
 * The path encoding, because getting it wrong is invisible: every config path
 * has a slash in it, and `encodeURIComponent` on the whole path turns that
 * slash into `%2F`, which GitHub reads as one oddly named file at the
 * repository root. Reads then 404 and writes create junk, and neither says why.
 *
 * The failure messages, because a bare 403 is the least actionable thing an
 * API can return and this console's whole job is to be actionable.
 */

describe('content paths', () => {
  it('keeps the separators, which is the whole point', () => {
    expect(encodePath('config/heroes.json')).toBe('config/heroes.json');
    expect(encodePath('config/defaults/shop.json')).toBe('config/defaults/shop.json');
    expect(encodePath('schedules/schedules.json')).toBe('schedules/schedules.json');
  });

  it('still escapes characters that are unsafe inside a segment', () => {
    expect(encodePath('config/a b.json')).toBe('config/a%20b.json');
    expect(encodePath('config/a#b.json')).toBe('config/a%23b.json');
    expect(encodePath('config/a?b.json')).toBe('config/a%3Fb.json');
  });

  it('tolerates leading, trailing and doubled separators', () => {
    expect(encodePath('/config/heroes.json')).toBe('config/heroes.json');
    expect(encodePath('config//heroes.json')).toBe('config/heroes.json');
  });
});

describe('failure messages', () => {
  const forbidden = { status: 403, data: { message: 'Resource not accessible by personal access token' } };

  it('names every likely cause of a 403 rather than reporting the number', () => {
    const message = explainFailure(forbidden, { path: 'config/shop.json' });
    expect(message).toContain('config/shop.json');
    expect(message).toContain('Resource not accessible by personal access token');
    // The four causes, in the order they are worth checking.
    expect(message).toMatch(/resource owner/i);
    expect(message).toMatch(/approve/i);
    expect(message).toMatch(/Contents: Read and write/);
    expect(message).toMatch(/fine-grained tokens/i);
  });

  it('mentions the classic-token scopes when the response carries them', () => {
    const message = explainFailure({ ...forbidden, scopes: 'public_repo' });
    expect(message).toContain('public_repo');
    expect(message).toMatch(/"repo" scope/);
  });

  it('says that a 401 needs a redeploy, because a changed env var alone does nothing', () => {
    const message = explainFailure({ status: 401, data: { message: 'Bad credentials' } });
    expect(message).toMatch(/redeploy/i);
  });

  it('warns that a 404 can still be a permissions problem on a private repository', () => {
    const message = explainFailure({ status: 404, data: null }, { path: 'config/shop.json' });
    expect(message).toMatch(/permissions problem/i);
  });

  it('explains a 422 as a sha that moved rather than a malformed request', () => {
    const message = explainFailure({ status: 422, data: { message: 'is at ...' } });
    expect(message).toMatch(/something else wrote to it first/i);
  });

  it('falls back to the status and the upstream message for anything else', () => {
    expect(explainFailure({ status: 500, data: { message: 'Server Error' } })).toContain('500');
    expect(explainFailure({ status: 500, data: { message: 'Server Error' } })).toContain('Server Error');
  });
});

/**
 * Neither the schedule nor the config records are stored on the deployed
 * branch, so reads and writes take a target. What matters here is that a
 * target says exactly what it means: one that quietly fell back to `main`
 * would put the console's own bookkeeping on the branch Vercel builds, which
 * is the deployment-per-publish this indirection exists to stop.
 */
describe('read and write targets', () => {
  it('defaults to the deployed repository and branch', () => {
    expect(repoName()).toBe('OffStarsStudios/cliff-heroes-arena-exporter');
    expect(branchName()).toBe('main');
    expect(repoName(undefined)).toBe(repoName());
    expect(branchName(undefined)).toBe(branchName());
  });

  it('takes a branch without taking a repository with it', () => {
    // How the scheduler asks for the schedules branch: same repo, other branch.
    expect(branchName({ branch: 'schedules' })).toBe('schedules');
    expect(repoName({ branch: 'schedules' })).toBe(repoName());
  });

  it('takes a repository too, for the day a branch is not enough', () => {
    expect(repoName({ repo: 'OffStarsStudios/schedules' })).toBe('OffStarsStudios/schedules');
    expect(branchName({ repo: 'OffStarsStudios/schedules' })).toBe('main');
  });

  it('keeps the config records off the deployed branch', () => {
    // Every publish, default and off payload is written through this target.
    // On `main` each one would queue a Vercel deployment for a build whose
    // output cannot differ - none of these files are read by the build.
    expect(CONFIG_TARGET.branch).toBe('config-history');
    expect(branchName(CONFIG_TARGET)).not.toBe(branchName());
    expect(repoName(CONFIG_TARGET)).toBe(repoName());
  });

  it('ignores an undefined field rather than treating it as a value', () => {
    // SCHEDULE_TARGET leaves `repo` undefined unless the env var is set.
    expect(repoName({ repo: undefined, branch: 'schedules' })).toBe(repoName());
  });
});
