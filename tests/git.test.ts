import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module shared with the production server.
import { encodePath, explainFailure } from '../server/git.mjs';

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
