/**
 * Read-only ConfigCat routes.
 *
 * Path-agnostic handlers so the same implementation backs the Vite dev
 * middleware, the local production server and the Vercel serverless functions,
 * exactly as `gsheetHandler.mjs` already does for Google Sheets.
 *
 * Nothing here writes. The write path lands in a later phase behind a
 * plan/apply split, and putting it in a separate module keeps it impossible to
 * reach one of these routes and mutate the live game by accident.
 */

import { ConfigCatError, getTree, getValues, probe } from './configcat.mjs';
import { describeChange, diffJson, summarizeDiff } from './diff.mjs';

/** Cap on changes reported per setting, so one rewrite cannot blow up a response. */
const MAX_CHANGES_PER_SETTING = 50;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, detail) {
  sendJson(res, status, detail === undefined ? { error: message } : { error: message, detail });
}

/** Turns any thrown value into a response that says what actually went wrong. */
function fail(res, error) {
  if (error instanceof ConfigCatError) {
    sendError(res, error.status ?? 502, error.message, error.detail ?? undefined);
    return;
  }
  sendError(res, 502, `Could not reach ConfigCat: ${error?.message ?? String(error)}`);
}

function requireGet(req, res) {
  if (req.method === undefined || req.method === 'GET' || req.method === 'HEAD') return true;
  res.setHeader('Allow', 'GET');
  sendError(res, 405, 'This endpoint only accepts GET.');
  return false;
}

function query(req) {
  return new URL(req.url ?? '/', 'http://localhost').searchParams;
}

/** `GET /api/configcat/tree` - products, configs, environments and settings. */
export async function serveTree(req, res) {
  if (!requireGet(req, res)) return true;
  try {
    sendJson(res, 200, await getTree());
  } catch (error) {
    fail(res, error);
  }
  return true;
}

/** `GET /api/configcat/values?configId=&environmentId=` - live values. */
export async function serveValues(req, res) {
  if (!requireGet(req, res)) return true;
  const params = query(req);
  const configId = params.get('configId');
  const environmentId = params.get('environmentId');
  if (!configId || !environmentId) {
    sendError(res, 400, 'Both "configId" and "environmentId" are required.');
    return true;
  }
  try {
    sendJson(res, 200, await getValues(configId, environmentId));
  } catch (error) {
    fail(res, error);
  }
  return true;
}

/** `GET /api/configcat/probe?productId=` - what this account and plan allow. */
export async function serveProbe(req, res) {
  if (!requireGet(req, res)) return true;
  const productId = query(req).get('productId');
  if (!productId) {
    sendError(res, 400, 'A "productId" is required. Get one from /api/configcat/tree.');
    return true;
  }
  try {
    sendJson(res, 200, await probe(productId));
  } catch (error) {
    fail(res, error);
  }
  return true;
}

/**
 * `GET /api/drift?configId=&from=&to=` - which settings differ between two
 * environments, and how.
 *
 * The stated intent is for Production to come to mirror Test, so this is the
 * report that says how far apart they currently are. Comparison is structural,
 * because the two environments may hold the same config formatted differently.
 */
export async function serveDrift(req, res) {
  if (!requireGet(req, res)) return true;
  const params = query(req);
  const configId = params.get('configId');
  const from = params.get('from');
  const to = params.get('to');
  if (!configId || !from || !to) {
    sendError(res, 400, 'Query parameters "configId", "from" and "to" are all required.');
    return true;
  }

  try {
    const [left, right] = await Promise.all([getValues(configId, from), getValues(configId, to)]);
    const byKey = new Map();
    for (const setting of left.settings) byKey.set(setting.key, { key: setting.key, name: setting.name, left: setting });
    for (const setting of right.settings) {
      const entry = byKey.get(setting.key) ?? { key: setting.key, name: setting.name, left: null };
      entry.right = setting;
      byKey.set(setting.key, entry);
    }

    const settings = [...byKey.values()].map((entry) => {
      const leftSetting = entry.left ?? null;
      const rightSetting = entry.right ?? null;

      if (leftSetting === null) return { key: entry.key, name: entry.name, status: 'only-in-to' };
      if (rightSetting === null) return { key: entry.key, name: entry.name, status: 'only-in-from' };

      // Compare parsed JSON where both sides parsed; fall back to raw values,
      // which is also correct for the non-JSON settings.
      const comparable =
        leftSetting.parseError === null &&
        rightSetting.parseError === null &&
        leftSetting.json !== null &&
        rightSetting.json !== null;

      const changes = comparable
        ? diffJson(leftSetting.json, rightSetting.json)
        : diffJson(leftSetting.value, rightSetting.value);

      return {
        key: entry.key,
        name: entry.name,
        status: changes.length === 0 ? 'same' : 'different',
        comparedAs: comparable ? 'json' : 'raw',
        bytes: { from: leftSetting.bytes, to: rightSetting.bytes },
        summary: summarizeDiff(changes),
        changes: changes.slice(0, MAX_CHANGES_PER_SETTING).map((change) => ({
          ...change,
          description: describeChange(change),
        })),
        truncated: Math.max(0, changes.length - MAX_CHANGES_PER_SETTING),
      };
    });

    sendJson(res, 200, {
      configId,
      from,
      to,
      settings,
      differing: settings.filter((setting) => setting.status !== 'same').length,
    });
  } catch (error) {
    fail(res, error);
  }
  return true;
}

const ROUTES = {
  '/api/configcat/tree': serveTree,
  '/api/configcat/values': serveValues,
  '/api/configcat/probe': serveProbe,
  '/api/drift': serveDrift,
};

/**
 * Path-matching wrapper for the local http server and the Vite dev middleware.
 * Returns `true` when the request was handled.
 */
export async function handleConfigCatRequest(req, res) {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const route = ROUTES[pathname];
  if (route === undefined) return false;
  return route(req, res);
}
