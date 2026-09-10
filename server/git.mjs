/**
 * The GitHub side of the console: reading and writing files in this repo
 * through the Contents API.
 *
 * The API rather than a clone, because a serverless function has no working
 * tree and no persistent disk.
 *
 * Two very different callers depend on this module.
 *
 * Publishing uses it as bookkeeping. Writing to ConfigCat is the operation
 * that reaches players; recording it in `config/` on `CONFIG_TARGET` is what
 * makes the change reviewable afterwards. If the token is missing or refused,
 * the publish still happens and the result says the history was not written,
 * rather than failing a live change over a commit.
 *
 * The scheduler uses it as its database. Schedules and per-domain default
 * configs live in the repo, so a token problem there is a real failure and is
 * reported as one.
 */

const API = 'https://api.github.com';

const REPO = process.env.GITHUB_REPO ?? 'OffStarsStudios/cliff-heroes-arena-exporter';
const BRANCH = process.env.GITHUB_BRANCH ?? 'main';

/**
 * Where the back office's own records live: what was published, the defaults,
 * the off payloads. Everything under `config/`.
 *
 * Not the deployed branch, and for the same reason the schedule is not - see
 * `SCHEDULE_TARGET` in `schedule.mjs`. These files are a record of what went
 * to ConfigCat; nothing in the build reads them. Writing them to `main` made
 * every publish queue a Vercel deployment, which is a deployment spent on a
 * build whose output cannot differ.
 */
export const CONFIG_TARGET = {
  repo: process.env.GITHUB_CONFIG_REPO ?? undefined,
  branch: process.env.GITHUB_CONFIG_BRANCH ?? 'config-history',
};

/**
 * Where a read or write lands.
 *
 * The default is the deployed branch, and by now almost nothing wants it: the
 * schedule passes `SCHEDULE_TARGET` and the config records pass
 * `CONFIG_TARGET`, both for the same Vercel reason. It stays the default
 * because a caller that means the deployed branch means the branch the code
 * is on, and should not have to name it.
 */
function targetOf(target) {
  return { repo: target?.repo ?? REPO, branch: target?.branch ?? BRANCH };
}

export function repoName(target) {
  return targetOf(target).repo;
}

export function branchName(target) {
  return targetOf(target).branch;
}

export function gitAvailable() {
  return typeof process.env.GITHUB_TOKEN === 'string' && process.env.GITHUB_TOKEN !== '';
}

/**
 * Paths are encoded segment by segment.
 *
 * `encodeURIComponent('config/heroes.json')` turns the separator into `%2F`,
 * which GitHub reads as a single file literally named `config/heroes.json` at
 * the repository root. Encoding the segments keeps the separators intact while
 * still escaping anything unusual inside a name.
 */
export function encodePath(path) {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map(encodeURIComponent)
    .join('/');
}

async function github(path, { method = 'GET', body } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cliff-heroes-back-office',
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

  return {
    ok: response.ok,
    status: response.status,
    data: parsed,
    // The scope headers are the only place GitHub says what a token can do,
    // and they are what turns an opaque 403 into a fixable sentence.
    scopes: response.headers.get('x-oauth-scopes'),
    acceptedScopes: response.headers.get('x-accepted-oauth-scopes'),
  };
}

/** GitHub's own message, which nearly always names the actual problem. */
function upstreamMessage(response) {
  const data = response.data;
  if (data === null || data === undefined) return null;
  if (typeof data === 'string') return data.slice(0, 300);
  if (typeof data.message === 'string') return data.message;
  return JSON.stringify(data).slice(0, 300);
}

/**
 * A 403 from the Contents API has four common causes and the raw status
 * distinguishes none of them. This turns the response into the sentence that
 * says which one it is, because "GitHub returned HTTP 403" is not something
 * anybody can act on.
 */
export function explainFailure(response, { path } = {}) {
  const message = upstreamMessage(response);
  const where = path === undefined ? REPO : `${path} in ${REPO}`;

  if (response.status === 401) {
    return `GitHub rejected the token outright (401${message === null ? '' : `: ${message}`}). GITHUB_TOKEN is missing, mistyped, or expired. Set it again in the Vercel project's environment variables and redeploy - changing an environment variable does not affect the deployment that is already running.`;
  }

  if (response.status === 403) {
    const parts = [
      `GitHub refused the request for ${where} with 403${message === null ? '' : `: "${message}"`}.`,
      'For a fine-grained token this is almost always one of four things. ' +
        `(1) The token's resource owner is not the organisation that owns ${REPO}. A token created under a personal account cannot reach an organisation repository however its permissions are set - it has to be created with the organisation chosen as the resource owner. ` +
        '(2) The organisation has not approved it yet: an owner has to approve the request under the organisation\'s Settings -> Personal access tokens -> Pending requests. ' +
        `(3) The token does not grant Contents: Read and write on ${REPO}, or that repository is not in its repository selection. ` +
        '(4) The organisation has fine-grained tokens switched off under Settings -> Personal access tokens -> Settings.',
    ];
    if (response.scopes !== null && response.scopes !== undefined) {
      parts.push(
        `The token presented these classic scopes: "${response.scopes}". A classic token needs the full "repo" scope, and an organisation with SAML SSO also needs the token authorised for that organisation.`,
      );
    }
    return parts.join(' ');
  }

  if (response.status === 404) {
    return `GitHub returned 404 for ${where}. Either the file does not exist on branch ${BRANCH}, or the token cannot see the repository at all - a fine-grained token without access to a private repository is answered with 404 rather than 403, so this can still be a permissions problem.`;
  }

  if (response.status === 409) {
    return `GitHub returned 409 for ${where}: the file changed between reading its sha and writing it. Retry.`;
  }

  if (response.status === 422) {
    return `GitHub returned 422 for ${where}${message === null ? '' : `: ${message}`}. The sha sent with the update did not match the file's current sha, which means something else wrote to it first.`;
  }

  return `GitHub returned HTTP ${response.status} for ${where}${message === null ? '' : `: ${message}`}.`;
}

function missingTokenReason(path) {
  return `GITHUB_TOKEN is not set, so ${path} was not written in ${REPO}. Add a fine-grained personal access token whose resource owner is the organisation that owns this repository, with Contents: Read and write, to the deployment environment.`;
}

/* -------------------------------------------------------------- reading -- */

/**
 * Reads one file. A missing file comes back as `exists: false` rather than an
 * error, because "no schedule file yet" is the normal first-run state.
 */
export async function readFile(path, target) {
  if (!gitAvailable()) {
    return { exists: false, sha: null, content: null, error: missingTokenReason(path) };
  }

  const { repo, branch } = targetOf(target);
  const response = await github(
    `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
  );

  if (response.status === 404) return { exists: false, sha: null, content: null, error: null };
  if (!response.ok) {
    return { exists: false, sha: null, content: null, error: explainFailure(response, { path }) };
  }

  const encoded = response.data?.content;
  if (typeof encoded !== 'string') {
    return { exists: false, sha: null, content: null, error: `${path} is not a regular file.` };
  }

  return {
    exists: true,
    sha: response.data.sha ?? null,
    content: Buffer.from(encoded, 'base64').toString('utf8'),
    error: null,
  };
}

/** Reads and parses a JSON file, falling back to `fallback` when absent. */
export async function readJson(path, fallback, target) {
  const file = await readFile(path, target);
  if (file.error) throw new Error(file.error);
  if (!file.exists) return { value: fallback, sha: null, existed: false };
  try {
    return { value: JSON.parse(file.content), sha: file.sha, existed: true };
  } catch (error) {
    throw new Error(`${path} in ${REPO} is not valid JSON: ${error?.message ?? String(error)}`);
  }
}

/** The blob sha of an existing file, or null when it does not exist yet. */
async function currentSha(path, target) {
  const file = await readFile(path, target);
  if (file.error) throw new Error(file.error);
  return file.sha ?? null;
}

/**
 * Recent commits that touched one path, for the rollback list - where the
 * question is what a config looked like before, not what it is now.
 */
export async function fileHistory(path, limit = 20, target) {
  if (!gitAvailable()) return { available: false, commits: [], error: missingTokenReason(path) };

  const { repo, branch } = targetOf(target);
  const response = await github(
    `/repos/${repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch)}&per_page=${limit}`,
  );
  if (!response.ok) return { available: true, commits: [], error: explainFailure(response, { path }) };

  const commits = (Array.isArray(response.data) ? response.data : []).map((commit) => ({
    sha: commit.sha,
    message: commit.commit?.message ?? '',
    author: commit.commit?.author?.name ?? null,
    date: commit.commit?.author?.date ?? null,
    url: commit.html_url ?? null,
  }));

  return { available: true, commits, error: null };
}

/** One historical version of a file, by commit sha. */
export async function readFileAt(path, ref, target) {
  if (!gitAvailable()) return { ok: false, error: missingTokenReason(path) };

  const { repo } = targetOf(target);
  const response = await github(
    `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
  );
  if (!response.ok) return { ok: false, error: explainFailure(response, { path }) };

  const encoded = response.data?.content;
  if (typeof encoded !== 'string') return { ok: false, error: `${path} at ${ref} is not a regular file.` };
  return { ok: true, content: Buffer.from(encoded, 'base64').toString('utf8') };
}

/* -------------------------------------------------------------- writing -- */

/**
 * Writes one file, creating or updating it.
 *
 * Returns a result rather than throwing, so one failed commit cannot lose the
 * record of the publishes that did succeed. Callers that genuinely need the
 * write - the scheduler - check `committed` and escalate themselves.
 */
export async function commitFile({ path, content, message, sha: knownSha, target }) {
  if (!gitAvailable()) {
    return { path, committed: false, reason: missingTokenReason(path) };
  }

  try {
    const { repo, branch } = targetOf(target);
    // A branch the console writes to but nobody has created yet is a setup
    // step, not a failure worth waking somebody for.
    const ready = await ensureBranch({ repo, branch });
    if (!ready.ok) return { path, committed: false, reason: ready.reason };

    const sha = knownSha === undefined ? await currentSha(path, { repo, branch }) : knownSha;
    const response = await github(`/repos/${repo}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: {
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        ...(sha === null ? {} : { sha }),
      },
    });

    if (!response.ok) {
      return { path, committed: false, status: response.status, reason: explainFailure(response, { path }) };
    }

    return {
      path,
      committed: true,
      sha: response.data?.commit?.sha ?? null,
      contentSha: response.data?.content?.sha ?? null,
      url: response.data?.commit?.html_url ?? null,
    };
  } catch (error) {
    return { path, committed: false, reason: error?.message ?? String(error) };
  }
}

/** Writes a JSON file, pretty-printed so the history stays readable. */
export function commitJson({ path, value, message, sha, target }) {
  return commitFile({ path, content: `${JSON.stringify(value, null, 2)}\n`, message, sha, target });
}

/**
 * Makes sure a branch exists, creating it from the deployed branch's head if
 * not. Called before every write rather than once at boot, because a
 * serverless function has no boot: every invocation is the first one.
 *
 * One cheap GET against a ref that almost always exists; the create only ever
 * happens once in the life of the repository.
 */
async function ensureBranch({ repo, branch }) {
  if (branch === BRANCH) return { ok: true };

  const ref = `heads/${branch}`;
  const existing = await github(`/repos/${repo}/git/ref/${ref}`);
  if (existing.ok) return { ok: true };
  if (existing.status !== 404) {
    return { ok: false, reason: explainFailure(existing, { path: `branch ${branch}` }) };
  }

  const base = await github(`/repos/${repo}/git/ref/heads/${BRANCH}`);
  if (!base.ok) {
    return { ok: false, reason: `Cannot create "${branch}": ${explainFailure(base, { path: BRANCH })}` };
  }

  const created = await github(`/repos/${repo}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/${ref}`, sha: base.data?.object?.sha },
  });
  // A 422 is almost always a race with another invocation that just created
  // it, which is a success as far as the caller is concerned.
  if (created.ok || created.status === 422) return { ok: true };
  return { ok: false, reason: `Cannot create "${branch}": ${explainFailure(created, { path: branch })}` };
}

/* ---------------------------------------------------------- diagnostics -- */

/**
 * What the token can actually do, in one call sequence.
 *
 * The console shows this on the dashboard, because the failure this replaces
 * is discovering a broken token at the moment of a publish - or worse,
 * discovering that a week of scheduled changes silently never fired.
 */
export async function gitStatus() {
  const base = { repo: REPO, branch: BRANCH, tokenPresent: gitAvailable() };

  if (!gitAvailable()) {
    return {
      ...base,
      ok: false,
      canRead: false,
      canWrite: false,
      identity: null,
      problem:
        'GITHUB_TOKEN is not set in this environment. Publishing still works, but nothing is recorded in git and the scheduler has nowhere to keep its schedules.',
    };
  }

  // Who the token is. Fine-grained tokens answer /user; a GitHub App
  // installation token does not, which is worth saying rather than reporting
  // as a failure.
  const who = await github('/user');
  const identity = who.ok ? { login: who.data?.login ?? null, type: who.data?.type ?? null } : null;

  const repo = await github(`/repos/${REPO}`);
  if (!repo.ok) {
    return {
      ...base,
      ok: false,
      canRead: false,
      canWrite: false,
      identity,
      status: repo.status,
      problem: explainFailure(repo),
    };
  }

  const permissions = repo.data?.permissions ?? {};
  const canWrite = permissions.push === true || permissions.admin === true || permissions.maintain === true;

  // Read a path the console actually uses, so a repository-level pass that
  // still fails on contents does not report as healthy.
  const probe = await github(
    `/repos/${REPO}/contents/${encodePath('config')}?ref=${encodeURIComponent(BRANCH)}`,
  );
  const canRead = probe.ok || probe.status === 404;

  return {
    ...base,
    ok: canRead && canWrite,
    canRead,
    canWrite,
    identity,
    private: repo.data?.private ?? null,
    permissions,
    problem: canRead
      ? canWrite
        ? null
        : `The token can read ${REPO} but not write to it. Grant Contents: Read and write on this repository, and check that the token's resource owner is the organisation rather than a personal account.`
      : explainFailure(probe, { path: 'config' }),
  };
}
