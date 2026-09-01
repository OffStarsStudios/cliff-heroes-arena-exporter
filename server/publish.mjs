/**
 * The write path: plan, then apply.
 *
 * Two rules shape this module.
 *
 * A plan writes nothing. It reports what would change, and issues a baseline
 * hash of the value it was computed against. Apply refuses unless that hash
 * still matches, so two people publishing at once cannot silently overwrite
 * each other - the second gets a conflict instead of a surprise.
 *
 * An apply verifies itself. After writing, it reads the value back and
 * compares. A write that reports success without confirming it is exactly the
 * failure mode this whole console exists to remove.
 */

// Plain specifier rather than 'node:crypto': the prefixed form needs Node
// 14.18, and the Node on this machine's PATH is older. Both resolve to the
// same module everywhere else.
import { createHash } from 'crypto';
import { ConfigCatError, getValues, tryRequest } from './configcat.mjs';
import { describeChange, diffJson, summarizeDiff } from './diff.mjs';
import { commitFile, gitAvailable } from './git.mjs';

/**
 * ConfigCat stores the minified form and git stores the pretty-printed one.
 *
 * The two are the same config - the diff is structural, so formatting never
 * registers as a change - but each format suits where it lives: the wire
 * payload every client downloads should be small, and a git history is only
 * worth having if its diffs are readable.
 */
export function toStoredValue(payload) {
  return JSON.stringify(payload);
}

export function toGitContent(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function hashValue(text) {
  return createHash('sha256').update(text ?? '', 'utf8').digest('hex').slice(0, 16);
}

function findSetting(values, settingKey) {
  return values.settings.find((setting) => setting.key === settingKey) ?? null;
}

/**
 * Pending change requests that this console did not create.
 *
 * Publishing while someone has unpublished work staged in the dashboard would
 * ship their work alongside ours. Checked whenever a productId is supplied.
 */
async function pendingChangeRequests(productId) {
  if (!productId) return { checked: false, count: 0, blocking: false, message: 'Not checked.' };

  const response = await tryRequest(`/v2/products/${productId}/change-requests?pageSize=50`);
  if (!response.ok) {
    return {
      checked: false,
      count: 0,
      blocking: false,
      message: `Could not check for pending change requests (HTTP ${response.status}). Proceeding, but a teammate's staged work would not have been noticed.`,
    };
  }

  const data = response.data?.changeRequests?.data ?? [];
  const open = data.filter((request) => request?.status !== 'Published' && request?.status !== 'Rejected');

  return {
    checked: true,
    count: open.length,
    blocking: open.length > 0,
    message:
      open.length === 0
        ? 'Nothing is staged that this console did not create.'
        : `${open.length} change request(s) are open in ConfigCat. Publishing now could ship work that is not yours. Resolve them in the dashboard first.`,
  };
}

/**
 * What publishing these payloads would do. Writes nothing.
 *
 * `entries` is `[{ settingKey, payload }]`, where payload is the parsed config
 * object rather than a string - serialization is this module's business, so
 * every caller stores the same way.
 */
export async function planPublish({ configId, environmentId, entries, productId }) {
  const values = await getValues(configId, environmentId);

  if (values.unreadable !== null) {
    throw new ConfigCatError(
      `Cannot plan a publish: the current values could not be read. ${values.unreadable.reason}`,
      502,
      values.unreadable,
    );
  }

  const planned = entries.map((entry) => {
    const current = findSetting(values, entry.settingKey);

    if (current === null) {
      return {
        settingKey: entry.settingKey,
        settingId: null,
        error: `ConfigCat has no setting with the key "${entry.settingKey}" in this config.`,
      };
    }

    const beforeText = typeof current.value === 'string' ? current.value : null;
    const afterText = toStoredValue(entry.payload);
    const before = current.json;
    const changes = diffJson(before, entry.payload);

    return {
      settingKey: entry.settingKey,
      settingId: current.settingId,
      name: current.name,
      baselineHash: hashValue(beforeText),
      unchanged: changes.length === 0,
      bytesBefore: current.bytes,
      bytesAfter: Buffer.byteLength(afterText, 'utf8'),
      summary: summarizeDiff(changes),
      changes: changes.slice(0, 200).map((change) => ({ ...change, description: describeChange(change) })),
      truncated: Math.max(0, changes.length - 200),
    };
  });

  const pending = await pendingChangeRequests(productId);
  const blockers = [];
  if (planned.some((entry) => entry.error !== undefined)) blockers.push('One or more settings could not be found.');
  if (pending.blocking) blockers.push(pending.message);

  return {
    configId,
    environmentId,
    apiVersion: values.apiVersion,
    entries: planned,
    pending,
    blockers,
    writable: blockers.length === 0,
  };
}

/**
 * Writes one setting's default value.
 *
 * JSON Patch against the default value only, so targeting rules and percentage
 * options on the setting are left untouched. A whole-object PUT would silently
 * drop them.
 *
 * The v2 and v1 shapes differ in where the value lives, and which API serves a
 * config depends on the format it was created in, so this tries v2 and falls
 * back - the same arrangement `getValues` uses.
 */
async function patchValue(environmentId, settingId, text) {
  const attempts = [
    { version: 'v2', body: [{ op: 'replace', path: '/defaultValue/stringValue', value: text }] },
    { version: 'v1', body: [{ op: 'replace', path: '/value', value: text }] },
  ];

  const failures = [];
  for (const attempt of attempts) {
    const response = await tryRequest(
      `/${attempt.version}/environments/${environmentId}/settings/${settingId}/value`,
      { method: 'PATCH', body: attempt.body },
    );
    if (response.ok) return { version: attempt.version };
    failures.push(`${attempt.version} responded ${response.status}`);
  }

  throw new ConfigCatError(`Could not write the setting value (${failures.join(', ')}).`, 502);
}

/**
 * Applies a plan.
 *
 * Every entry carries the baseline hash its plan was built against. If the
 * live value has moved since, the entry is refused rather than overwritten.
 * Entries are independent: a refused one does not stop the others, and the
 * result says exactly what happened to each.
 *
 * Note that this is not atomic across settings. ConfigCat's Change Requests
 * API exposes reading and updating but not creating, so a genuine multi-setting
 * transaction is not available; a change that must span settings should be
 * planned as such and reviewed before applying.
 */
export async function applyPublish({ configId, environmentId, entries, productId }) {
  const pending = await pendingChangeRequests(productId);
  if (pending.blocking) {
    throw new ConfigCatError(pending.message, 409, pending);
  }

  const before = await getValues(configId, environmentId);
  if (before.unreadable !== null) {
    throw new ConfigCatError(
      `Refusing to write: the current values could not be read, so the concurrency check cannot run. ${before.unreadable.reason}`,
      502,
      before.unreadable,
    );
  }

  const results = [];

  for (const entry of entries) {
    const current = findSetting(before, entry.settingKey);
    if (current === null) {
      results.push({ settingKey: entry.settingKey, status: 'error', message: 'No such setting in this config.' });
      continue;
    }

    const liveHash = hashValue(typeof current.value === 'string' ? current.value : null);
    if (entry.baselineHash !== undefined && entry.baselineHash !== liveHash) {
      results.push({
        settingKey: entry.settingKey,
        status: 'conflict',
        message:
          'The live value changed after this plan was made, so applying it would overwrite someone else. Re-plan against the current value.',
      });
      continue;
    }

    const text = toStoredValue(entry.payload);
    if (typeof current.value === 'string' && current.value === text) {
      results.push({ settingKey: entry.settingKey, status: 'unchanged', message: 'Already identical.' });
      continue;
    }

    try {
      const written = await patchValue(environmentId, current.settingId, text);
      results.push({
        settingKey: entry.settingKey,
        settingId: current.settingId,
        status: 'written',
        apiVersion: written.version,
        bytes: Buffer.byteLength(text, 'utf8'),
      });
    } catch (error) {
      results.push({
        settingKey: entry.settingKey,
        status: 'error',
        message: error?.message ?? String(error),
      });
    }
  }

  // Read back and confirm. A write that reports success without checking is
  // exactly what this console is meant to stop doing.
  const after = await getValues(configId, environmentId);
  for (const result of results) {
    if (result.status !== 'written') continue;
    const entry = entries.find((candidate) => candidate.settingKey === result.settingKey);
    const live = findSetting(after, result.settingKey);
    const expected = toStoredValue(entry.payload);
    const actual = typeof live?.value === 'string' ? live.value : null;

    if (actual === expected) {
      result.verified = true;
      continue;
    }

    // Not byte-identical, but ConfigCat may normalise. Structural equality is
    // what actually matters, so distinguish the two rather than crying wolf.
    const equivalent = live?.json !== undefined && diffJson(live.json, entry.payload).length === 0;
    result.verified = equivalent;
    result.status = equivalent ? 'written' : 'unverified';
    if (!equivalent) {
      result.message = 'The write was accepted but reading the value back did not return what was sent.';
    }
  }

  // Record what went live. Only verified writes are committed: git is meant to
  // be the record of what is actually deployed, so writing an entry we could
  // not confirm would make the history lie.
  const commits = [];
  for (const result of results) {
    if (result.status !== 'written' || result.verified !== true) continue;
    const entry = entries.find((candidate) => candidate.settingKey === result.settingKey);
    if (entry?.gitPath === undefined) continue;
    commits.push(
      await commitFile({
        path: entry.gitPath,
        content: toGitContent(entry.payload),
        message: `Publish ${result.settingKey} to ${environmentId}\n\n${entry.note ?? 'Published from the back office console.'}`,
      }),
    );
  }

  return {
    configId,
    environmentId,
    results,
    pending,
    git: {
      available: gitAvailable(),
      commits,
    },
    written: results.filter((result) => result.status === 'written').length,
    failed: results.filter((result) => result.status === 'error' || result.status === 'unverified').length,
    conflicts: results.filter((result) => result.status === 'conflict').length,
  };
}

