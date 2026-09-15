/**
 * The sign-in routes, and the gate every other API route sits behind.
 *
 *   GET  /api/auth/login?next=   start a Google sign-in
 *   GET  /api/auth/callback      where Google sends people back
 *   POST /api/auth/logout        forget the session
 *   GET  /api/auth/me            who is signed in, and whether anyone has to be
 *
 * On Vercel each API file wraps its handler in `withAuth`; the local servers
 * call `gateRequest` once in front of all of them. `tests/auth.test.ts` fails
 * if an API file skips the wrapper.
 *
 * A failed sign-in lands back on the page with `?signin=<reason>` rather than
 * an error page of its own, so the reason is shown where the button is. The
 * reason is a fixed word; the account that was refused is never put in a URL.
 */

import {
  OAUTH_COOKIE,
  OAUTH_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  authorise,
  createPkce,
  exchangeCode,
  googleAuthorizeUrl,
  isApiPath,
  isOpenPath,
  isSecureRequest,
  parseCookies,
  randomState,
  readAuthConfig,
  requestOrigin,
  safeNext,
  serializeCookie,
  signToken,
  verifyToken,
} from './auth.mjs';

function sendJson(res, status, payload, cookies) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (cookies !== undefined) res.setHeader('Set-Cookie', cookies);
  res.end(JSON.stringify(payload));
}

function redirect(res, location, cookies) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  if (cookies !== undefined) res.setHeader('Set-Cookie', cookies);
  res.end();
}

function context(req, options) {
  return {
    config: readAuthConfig(options.env ?? process.env),
    nowMs: options.now?.() ?? Date.now(),
    secure: isSecureRequest(req),
    url: new URL(req.url ?? '/', 'http://localhost'),
  };
}

function clearCookie(name, path, secure) {
  return serializeCookie(name, '', { maxAge: 0, path, secure });
}

/* --------------------------------------------------------------- routes -- */

function serveLogin(req, res, ctx) {
  const { config, nowMs, secure, url } = ctx;
  if (!config.configured) {
    redirect(res, '/?signin=unconfigured');
    return;
  }

  const next = safeNext(url.searchParams.get('next'));
  const state = randomState();
  const { verifier, challenge } = createPkce();
  const redirectUri = `${requestOrigin(req, config)}/api/auth/callback`;
  const pending = signToken(config.secret, 'oauth', {
    state,
    verifier,
    next,
    exp: Math.floor(nowMs / 1000) + OAUTH_TTL_SECONDS,
  });

  redirect(
    res,
    googleAuthorizeUrl({ clientId: config.clientId, redirectUri, state, challenge }),
    [serializeCookie(OAUTH_COOKIE, pending, { maxAge: OAUTH_TTL_SECONDS, path: '/api/auth', secure })],
  );
}

async function serveCallback(req, res, ctx, options) {
  const { config, nowMs, secure, url } = ctx;
  const cleared = [clearCookie(OAUTH_COOKIE, '/api/auth', secure)];
  if (!config.configured) {
    redirect(res, '/?signin=unconfigured', cleared);
    return;
  }

  // Google's own error, most often "access_denied" from pressing Cancel.
  if (url.searchParams.has('error')) {
    redirect(res, '/?signin=cancelled', cleared);
    return;
  }

  const pending = verifyToken(config.secret, 'oauth', parseCookies(req.headers?.cookie)[OAUTH_COOKIE], nowMs);
  const state = url.searchParams.get('state');
  if (pending === null || typeof state !== 'string' || pending.state !== state) {
    redirect(res, '/?signin=expired', cleared);
    return;
  }

  const code = url.searchParams.get('code');
  if (code === null || code === '') {
    redirect(res, '/?signin=failed', cleared);
    return;
  }

  let person;
  try {
    person = await exchangeCode({
      code,
      verifier: pending.verifier,
      redirectUri: `${requestOrigin(req, config)}/api/auth/callback`,
      config,
      fetchImpl: options.fetch ?? fetch,
      nowMs,
    });
  } catch (error) {
    console.error(`[auth] Sign-in failed: ${error?.message ?? String(error)}`);
    redirect(res, '/?signin=failed', cleared);
    return;
  }

  if (!config.allowed.has(person.email)) {
    // Logged so a refused teammate can be told exactly which account they used.
    console.warn(`[auth] Refused sign-in for ${person.email}: not on ALLOWED_EMAILS.`);
    redirect(res, '/?signin=denied', cleared);
    return;
  }

  const session = signToken(config.secret, 'session', {
    email: person.email,
    name: person.name,
    exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS,
  });
  console.log(`[auth] Signed in ${person.email}.`);
  redirect(res, safeNext(pending.next), [
    ...cleared,
    serializeCookie(SESSION_COOKIE, session, { maxAge: SESSION_TTL_SECONDS, path: '/', secure }),
  ]);
}

/** POST only, so another site cannot sign somebody out with an image tag. */
function serveLogout(req, res, ctx) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Sign out with a POST.' });
    return;
  }
  sendJson(res, 200, { ok: true }, [clearCookie(SESSION_COOKIE, '/', ctx.secure)]);
}

/**
 * Always 200, so the page can tell "sign in" from "cannot sign in here".
 * `required` false means this is a local server with sign-in switched off.
 */
function serveMe(req, res, ctx, options) {
  const verdict = authorise(req, ctx.config, { nowMs: ctx.nowMs, allowUnconfigured: options.allowUnconfigured });
  if (verdict.ok) {
    sendJson(res, 200, { required: verdict.enforced, user: verdict.user, problem: null });
    return;
  }
  sendJson(
    res,
    200,
    { required: true, user: null, problem: verdict.status === 401 ? null : verdict.error },
    verdict.revoked ? [clearCookie(SESSION_COOKIE, '/', ctx.secure)] : undefined,
  );
}

const ROUTES = {
  '/api/auth/login': serveLogin,
  '/api/auth/callback': serveCallback,
  '/api/auth/logout': serveLogout,
  '/api/auth/me': serveMe,
};

/**
 * Serves `/api/auth/*`. Returns false for any other path.
 *
 * `options.allowUnconfigured` is for the local Vite server only - see
 * `authorise`. `env`, `now` and `fetch` exist for the tests.
 */
export async function handleAuthRequest(req, res, options = {}) {
  const ctx = context(req, options);
  const route = ROUTES[ctx.url.pathname.replace(/\/+$/, '')];
  if (route === undefined) return false;
  await route(req, res, ctx, options);
  return true;
}

/**
 * Lets a request through when it needs no session or has a valid one, and
 * answers it with the reason otherwise. Returns whether it may proceed. The
 * signed-in person, when there is one, is left on `req.user`.
 */
export async function gateRequest(req, res, options = {}) {
  const ctx = context(req, options);
  const { pathname } = ctx.url;
  if (!isApiPath(pathname) || isOpenPath(pathname)) return true;

  const verdict = authorise(req, ctx.config, { nowMs: ctx.nowMs, allowUnconfigured: options.allowUnconfigured });
  if (verdict.ok) {
    req.user = verdict.user;
    return true;
  }
  sendJson(res, verdict.status, { error: verdict.error, signin: true });
  return false;
}

/** Wraps a Vercel API function so it runs only for a request `gateRequest` admits. */
export function withAuth(handler) {
  return async function authorisedHandler(req, res) {
    if (!(await gateRequest(req, res))) return;
    return handler(req, res);
  };
}
