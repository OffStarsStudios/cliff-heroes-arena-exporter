/**
 * The two write routes, kept in their own module.
 *
 * `configcatHandler.mjs` is read-only by construction, and separating the two
 * means a route that can change the live game is never one typo in a path
 * table away from a route that cannot.
 */

import { ConfigCatError } from './configcat.mjs';
import { applyPublish, planPublish } from './publish.mjs';

/** Refuse anything large enough to be a mistake rather than a config. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, detail) {
  sendJson(res, status, detail === undefined ? { error: message } : { error: message, detail });
}

function fail(res, error) {
  if (error instanceof ConfigCatError) {
    sendError(res, error.status ?? 502, error.message, error.detail ?? undefined);
    return;
  }
  sendError(res, 500, error?.message ?? String(error));
}

/**
 * Reads a JSON body.
 *
 * Vercel parses the body for its functions while the dev middleware does not,
 * so accept either an already-parsed `req.body` or a raw stream.
 */
async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('The request body is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : JSON.parse(text);
}

function requirePost(req, res) {
  if (req.method === 'POST') return true;
  res.setHeader('Allow', 'POST');
  sendError(res, 405, 'This endpoint only accepts POST.');
  return false;
}

/**
 * Validates the shape a caller sent, so a malformed request fails here with a
 * clear message rather than deep inside a write.
 */
function readRequest(body) {
  const { configId, environmentId, entries, productId } = body ?? {};
  if (typeof configId !== 'string' || configId === '') throw new Error('"configId" is required.');
  if (typeof environmentId !== 'string' || environmentId === '') {
    throw new Error('"environmentId" is required.');
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('"entries" must be a non-empty array.');
  }
  for (const entry of entries) {
    if (typeof entry?.settingKey !== 'string' || entry.settingKey === '') {
      throw new Error('Every entry needs a "settingKey".');
    }
    if (entry?.payload === undefined || entry.payload === null) {
      throw new Error(`Entry "${entry?.settingKey}" has no "payload".`);
    }
  }
  return { configId, environmentId, entries, productId };
}

/** `POST /api/publish/plan` - what would change. Writes nothing. */
export async function servePlan(req, res) {
  if (!requirePost(req, res)) return true;
  try {
    sendJson(res, 200, await planPublish(readRequest(await readJsonBody(req))));
  } catch (error) {
    if (error instanceof ConfigCatError) fail(res, error);
    else sendError(res, 400, error?.message ?? String(error));
  }
  return true;
}

/**
 * `POST /api/publish/apply` - performs the write.
 *
 * Every entry should carry the `baselineHash` its plan returned. Without one
 * the concurrency check cannot run, so the request is refused: publishing
 * without having looked at a diff is the habit this console replaces.
 */
export async function serveApply(req, res) {
  if (!requirePost(req, res)) return true;
  try {
    const request = readRequest(await readJsonBody(req));
    for (const entry of request.entries) {
      if (typeof entry.baselineHash !== 'string' || entry.baselineHash === '') {
        sendError(
          res,
          400,
          `Entry "${entry.settingKey}" has no baselineHash. Plan the change first - applying without a plan skips the check that stops one publish overwriting another.`,
        );
        return true;
      }
    }
    sendJson(res, 200, await applyPublish(request));
  } catch (error) {
    if (error instanceof ConfigCatError) fail(res, error);
    else sendError(res, 400, error?.message ?? String(error));
  }
  return true;
}

const ROUTES = {
  '/api/publish/plan': servePlan,
  '/api/publish/apply': serveApply,
};

export async function handlePublishRequest(req, res) {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const route = ROUTES[pathname];
  if (route === undefined) return false;
  return route(req, res);
}
