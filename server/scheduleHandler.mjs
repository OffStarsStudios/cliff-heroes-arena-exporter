/**
 * The scheduling routes.
 *
 * Separate from `publishHandler.mjs` for the same reason that file is separate
 * from the read-only ConfigCat routes: the heartbeat can change what the game
 * serves without anybody watching, so it should not sit one typo away from a
 * route that cannot.
 */

import { ConfigCatError } from './configcat.mjs';
import { LIVEOPS_DOMAINS, OFF_MEANS, OFF_SEEDS, loadOff, saveOff } from './liveops.mjs';
import { gitStatus } from './git.mjs';
import {
  DOMAINS,
  cancelEntry,
  createEntry,
  updateEntry,
  describeSchedule,
  loadDefault,
  previewEntry,
  saveDefault,
  tick,
} from './schedule.mjs';

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

function fail(res, error) {
  if (error instanceof ConfigCatError) {
    sendError(res, error.status ?? 502, error.message, error.detail ?? undefined);
    return;
  }
  sendError(res, 400, error?.message ?? String(error));
}

/* ----------------------------------------------------------------- auth -- */

/**
 * The heartbeat is guarded when `CRON_SECRET` is set, and open when it is not.
 *
 * Open is defensible here, and only here: a tick applies a window only once
 * its start time has passed, so calling it early does nothing and calling it
 * repeatedly does nothing twice. It cannot be used to publish anything that
 * was not already going to be published. Setting the secret is still the right
 * thing to do, and the dashboard says so when it is missing.
 */
function cronAuthorised(req) {
  const secret = process.env.CRON_SECRET;
  if (typeof secret !== 'string' || secret === '') return { ok: true, guarded: false, why: null };

  const header = req.headers?.authorization ?? '';
  const alternative = req.headers?.['x-cron-key'] ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : alternative;

  if (presented === secret) return { ok: true, guarded: true, why: null };

  // A bare "401 Unauthorized" cost this project a day of scheduled changes
  // silently not happening: a pinger sent a template placeholder instead of the
  // token, every execution failed identically, and the response said nothing
  // that distinguished a wrong token from a missing one.
  //
  // These say enough to fix it and nothing that helps an attacker: whether a
  // header arrived at all, which scheme it used, and how long the value was.
  // The token itself is never echoed, and a length is not a meaningful oracle
  // for a random 64-character secret.
  const why =
    header === '' && alternative === ''
      ? 'No Authorization header arrived at all. If this is cron-job.org, the header is under Advanced -> Headers, and the job has to be SAVED - a Test run uses the form you are looking at, while scheduled executions use the last saved version.'
      : header !== '' && !header.startsWith('Bearer ')
        ? `The Authorization header did not start with "Bearer ". It began "${header.slice(0, 8)}...". The value has to be the word Bearer, one space, then the secret.`
        : `A bearer token arrived but did not match CRON_SECRET. It was ${presented.length} characters; the configured secret is ${secret.length}. A placeholder such as %cjo:unixtime% left in the header, a stale value after the secret was rotated, or a trailing newline from a copy-paste all look like this.`;

  return { ok: false, guarded: true, why };
}

/* --------------------------------------------------------------- routes -- */

/** `GET /api/schedule` - every window, the defaults, and the heartbeat's health. */
async function serveList(req, res) {
  try {
    sendJson(res, 200, await describeSchedule());
  } catch (error) {
    fail(res, error);
  }
}

/** `POST /api/schedule` - book a window. Refused if any guardrail fails. */
async function serveCreate(req, res) {
  try {
    const body = await readJsonBody(req);
    const result = await createEntry({
      domain: body.domain,
      environmentId: body.environmentId,
      environmentName: body.environmentName,
      label: body.label,
      note: body.note,
      payload: body.payload,
      startsAt: body.startsAt,
      endsAt: body.endsAt ?? null,
      createdBy: body.createdBy,
      liveops: body.liveops ?? null,
    });
    if (!result.ok) {
      sendJson(res, 422, { error: 'This window was not scheduled.', problems: result.problems });
      return;
    }
    sendJson(res, 201, { entry: { ...result.entry, payload: undefined } });
  } catch (error) {
    fail(res, error);
  }
}

/**
 * `POST /api/schedule/update` - edit a window that has not finished.
 *
 * Only the fields present in the body change, so the form can send what
 * somebody touched and leave the config it already booked alone.
 */
async function serveUpdate(req, res) {
  try {
    const body = await readJsonBody(req);
    if (typeof body.id !== 'string' || body.id === '') throw new Error('"id" is required.');
    const result = await updateEntry({
      id: body.id,
      label: body.label,
      note: body.note,
      environmentName: body.environmentName,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      payload: body.payload,
      liveops: body.liveops ?? undefined,
    });
    if (!result.ok) {
      sendJson(res, 422, { error: 'This window was not changed.', problems: result.problems });
      return;
    }
    sendJson(res, 200, { entry: { ...result.entry, payload: undefined } });
  } catch (error) {
    fail(res, error);
  }
}

/** `POST /api/schedule/cancel` - stop a window, putting the config back if it is live. */
async function serveCancel(req, res) {
  try {
    const body = await readJsonBody(req);
    if (typeof body.id !== 'string' || body.id === '') throw new Error('"id" is required.');
    const result = await cancelEntry(body.id, body.reason);
    if (!result.ok) {
      sendJson(res, 422, { error: 'That window was not cancelled.', problems: result.problems });
      return;
    }
    sendJson(res, 200, { entry: { ...result.entry, payload: undefined }, revert: result.revert });
  } catch (error) {
    fail(res, error);
  }
}

/**
 * `GET|POST /api/schedule/default?domain=` - read or record the fallback.
 *
 * The fallback is what a config returns to when nothing is scheduled, so
 * recording one is the precondition for any window that ends.
 */
/**
 * The off state of a live ops feature: what the game receives when no event of
 * that feature is running.
 *
 * A GET on a feature that has never had one returns the seed rather than
 * nothing, so the page can show what would be recorded and ask for a look
 * before it is. What "not running" means is a contract with the client, and
 * the console should never guess it silently.
 */
async function serveOff(req, res) {
  try {
    if (req.method === 'GET') {
      const domain = new URL(req.url ?? '/', 'http://localhost').searchParams.get('domain');
      if (domain === null || !LIVEOPS_DOMAINS.includes(domain)) {
        throw new Error(`"${domain}" is not a live ops feature. The calendar schedules ${LIVEOPS_DOMAINS.join(', ')}.`);
      }
      const value = await loadOff(domain);
      sendJson(res, 200, {
        domain,
        present: value !== null,
        payload: value ?? OFF_SEEDS[domain] ?? null,
        suggested: value === null,
        means: OFF_MEANS[domain] ?? null,
      });
      return;
    }

    const body = await readJsonBody(req);
    if (!LIVEOPS_DOMAINS.includes(body.domain)) throw new Error('A known live ops feature is required.');
    if (body.payload === undefined || body.payload === null) throw new Error('"payload" is required.');
    const commit = await saveOff(body.domain, body.payload, body.note);
    sendJson(res, 200, { domain: body.domain, committed: true, commit });
  } catch (error) {
    fail(res, error);
  }
}

async function serveDefault(req, res) {
  try {
    if (req.method === 'GET') {
      const domain = new URL(req.url ?? '/', 'http://localhost').searchParams.get('domain');
      if (domain === null || !DOMAINS.includes(domain)) throw new Error('A known "domain" is required.');
      const value = await loadDefault(domain);
      sendJson(res, 200, { domain, present: value !== null, payload: value });
      return;
    }

    const body = await readJsonBody(req);
    if (!DOMAINS.includes(body.domain)) throw new Error('A known "domain" is required.');
    if (body.payload === undefined || body.payload === null) throw new Error('"payload" is required.');
    const commit = await saveDefault(body.domain, body.payload, body.note);
    sendJson(res, 200, { domain: body.domain, committed: true, commit });
  } catch (error) {
    fail(res, error);
  }
}

/** `GET /api/schedule/preview?id=` - what that window would change, right now. */
async function servePreview(req, res) {
  try {
    const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id');
    if (id === null) throw new Error('"id" is required.');
    const preview = await previewEntry(id);
    if (preview === null) {
      sendError(res, 404, `No schedule with id "${id}".`);
      return;
    }
    sendJson(res, 200, preview);
  } catch (error) {
    fail(res, error);
  }
}

/**
 * `GET|POST /api/schedule/tick` - the heartbeat.
 *
 * GET as well as POST because Vercel Cron issues a GET, and the operation is
 * idempotent, so answering both is honest rather than sloppy.
 */
async function serveTick(req, res) {
  const auth = cronAuthorised(req);
  if (!auth.ok) {
    sendError(
      res,
      401,
      `The heartbeat is guarded by CRON_SECRET and this request did not present it. ${auth.why}`,
    );
    return;
  }
  try {
    const result = await tick();
    sendJson(res, result.ok ? 200 : 503, { ...result, guarded: auth.guarded });
  } catch (error) {
    // A failed tick must be loud. Returning 500 is what makes an external
    // heartbeat's own failure alerting notice.
    sendJson(res, 500, { ok: false, ran: false, error: error?.message ?? String(error) });
  }
}

/** `GET /api/git/status` - whether the token can actually read and write the repo. */
async function serveGitStatus(req, res) {
  try {
    sendJson(res, 200, await gitStatus());
  } catch (error) {
    fail(res, error);
  }
}

const ROUTES = {
  '/api/schedule': (req, res) =>
    req.method === 'POST' ? serveCreate(req, res) : serveList(req, res),
  '/api/schedule/cancel': serveCancel,
  '/api/schedule/update': serveUpdate,
  '/api/schedule/default': serveDefault,
  '/api/schedule/off': serveOff,
  '/api/schedule/preview': servePreview,
  '/api/schedule/tick': serveTick,
  '/api/git/status': serveGitStatus,
};

export async function handleScheduleRequest(req, res) {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/$/, '');
  const route = ROUTES[pathname];
  if (route === undefined) return false;
  await route(req, res);
  return true;
}

export {
  serveCancel,
  serveCreate,
  serveDefault,
  serveGitStatus,
  serveList,
  serveOff,
  servePreview,
  serveTick,
  serveUpdate,
};
