/**
 * Commits published payloads to `config/` through the GitHub Contents API.
 *
 * The API rather than a clone, because a serverless function has no working
 * tree and no persistent disk.
 *
 * This is deliberately optional. Publishing to ConfigCat is the operation that
 * matters to players; recording it in git is what makes the change reviewable
 * afterwards. If the token is missing the publish still happens and the result
 * says the history was not written, rather than failing the publish over
 * bookkeeping.
 */

const API = 'https://api.github.com';

const REPO = process.env.GITHUB_REPO ?? 'OffStarsStudios/cliff-heroes-arena-exporter';
const BRANCH = process.env.GITHUB_BRANCH ?? 'main';

export function gitAvailable() {
  return typeof process.env.GITHUB_TOKEN === 'string' && process.env.GITHUB_TOKEN !== '';
}

async function github(path, { method = 'GET', body } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }

  return { ok: response.ok, status: response.status, data: parsed };
}

/** The blob sha of an existing file, or null when it does not exist yet. */
async function currentSha(path) {
  const response = await github(
    `/repos/${REPO}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(BRANCH)}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status} reading ${path}.`);
  }
  return response.data?.sha ?? null;
}

/**
 * Writes one file, creating or updating it.
 *
 * Returns a result rather than throwing, so one failed commit cannot lose the
 * record of the publishes that did succeed.
 */
export async function commitFile({ path, content, message }) {
  if (!gitAvailable()) {
    return {
      path,
      committed: false,
      reason: 'GITHUB_TOKEN is not set, so the change was published but not recorded in git.',
    };
  }

  try {
    const sha = await currentSha(path);
    const response = await github(`/repos/${REPO}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: {
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch: BRANCH,
        ...(sha === null ? {} : { sha }),
      },
    });

    if (!response.ok) {
      return {
        path,
        committed: false,
        reason: `GitHub returned HTTP ${response.status}: ${JSON.stringify(response.data)?.slice(0, 200)}`,
      };
    }

    return {
      path,
      committed: true,
      sha: response.data?.commit?.sha ?? null,
      url: response.data?.commit?.html_url ?? null,
    };
  } catch (error) {
    return { path, committed: false, reason: error?.message ?? String(error) };
  }
}
