/**
 * What one config actually is in the live game, right now.
 *
 * The distinction this route exists for: `config/<domain>.json` in git records
 * what the back office last published, and that is *not* the same thing as what
 * ConfigCat is serving. Anyone with dashboard access can edit a setting
 * directly, and when they do, the git file quietly becomes a lie. A console
 * that answered "what is live" from its own records would be confidently wrong
 * exactly when it matters most.
 *
 * So the live value is always read from ConfigCat. The git file is fetched too,
 * but only as the thing to compare against - and the difference between them is
 * the answer to a question nobody could ask before: has this config been
 * changed outside the back office?
 *
 * Read-only. Nothing here writes anywhere.
 */

import { ConfigCatError, getValues } from './configcat.mjs';
import { describeChange, diffJson, summarizeDiff } from './diff.mjs';
import { fileHistory, readFile } from './git.mjs';
import { GIT_PATHS, SETTING_KEYS } from './schedule.mjs';

const CONFIG_ID = process.env.CONFIGCAT_CONFIG_ID ?? '08dee35e-a4d3-4e5e-8157-f96d209ff503';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** How many drift entries are worth sending. A whole config would not be read. */
const CHANGE_LIMIT = 200;

/**
 * `GET /api/config/<domain>?environmentId=`
 *
 * The domain comes from the path rather than a query parameter so the route
 * reads as the resource it is, and so Vercel can serve all eight from one
 * dynamic function.
 */
export async function serveLiveConfig(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const domain = url.pathname.replace(/\/$/, '').split('/').pop();
  const environmentId = url.searchParams.get('environmentId');

  if (!Object.prototype.hasOwnProperty.call(SETTING_KEYS, domain)) {
    sendJson(res, 404, { error: `"${domain}" is not a config this console knows about.` });
    return true;
  }
  if (environmentId === null || environmentId === '') {
    sendJson(res, 400, { error: '"environmentId" is required.' });
    return true;
  }

  const settingKey = SETTING_KEYS[domain];
  const gitPath = GIT_PATHS[domain];

  try {
    const values = await getValues(CONFIG_ID, environmentId);
    if (values.unreadable !== null) {
      throw new ConfigCatError(
        `The live values could not be read. ${values.unreadable.reason}`,
        502,
        values.unreadable,
      );
    }

    const setting = values.settings.find((candidate) => candidate.key === settingKey) ?? null;

    // Git is read for comparison only, and its absence is never fatal: a
    // missing token means the drift check cannot run, not that the live value
    // is unknown.
    let baseline = { present: false, path: gitPath, json: null, error: null };
    try {
      const file = await readFile(gitPath);
      if (file.error) baseline.error = file.error;
      else if (file.exists) {
        try {
          baseline = { present: true, path: gitPath, json: JSON.parse(file.content), error: null };
        } catch (parseError) {
          baseline.error = `${gitPath} is not valid JSON: ${parseError?.message ?? String(parseError)}`;
        }
      }
    } catch (error) {
      baseline.error = error?.message ?? String(error);
    }

    let drift = { checked: false, inSync: null, summary: null, changes: [], truncated: 0, reason: null };
    if (setting === null) {
      drift.reason = `ConfigCat has no setting with the key "${settingKey}" in this config.`;
    } else if (setting.parseError !== null) {
      drift.reason = `The live value is not valid JSON, so it cannot be compared: ${setting.parseError}`;
    } else if (!baseline.present) {
      drift.reason =
        baseline.error ??
        `Nothing has been published to ${gitPath} yet, so there is no back-office record to compare the live value against.`;
    } else {
      // Direction matters: git is "what the back office last published" and
      // live is "what is there now", so the diff reads as what somebody else
      // did, not as what we would do.
      const changes = diffJson(baseline.json, setting.json);
      drift = {
        checked: true,
        inSync: changes.length === 0,
        summary: summarizeDiff(changes),
        changes: changes
          .slice(0, CHANGE_LIMIT)
          .map((change) => ({ ...change, description: describeChange(change) })),
        truncated: Math.max(0, changes.length - CHANGE_LIMIT),
        reason: null,
      };
    }

    const history = await fileHistory(gitPath, 8);

    sendJson(res, 200, {
      domain,
      settingKey,
      environmentId,
      apiVersion: values.apiVersion,
      live: {
        present: setting !== null,
        bytes: setting?.bytes ?? null,
        json: setting?.json ?? null,
        parseError: setting?.parseError ?? null,
        settingId: setting?.settingId ?? null,
        name: setting?.name ?? null,
      },
      baseline,
      drift,
      history: history.commits ?? [],
      historyError: history.error ?? null,
    });
  } catch (error) {
    if (error instanceof ConfigCatError) {
      sendJson(res, error.status ?? 502, { error: error.message, detail: error.detail ?? undefined });
    } else {
      sendJson(res, 500, { error: error?.message ?? String(error) });
    }
  }

  return true;
}

export async function handleLiveConfigRequest(req, res) {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!pathname.startsWith('/api/config/')) return false;
  return serveLiveConfig(req, res);
}
