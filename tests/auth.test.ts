import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs module shared with the production server.
import { parseAllowlist, readAuthConfig, safeNext, signToken, verifyToken } from '../server/auth.mjs';
// @ts-expect-error - plain .mjs module shared with the production server.
import { gateRequest, handleAuthRequest } from '../server/authHandler.mjs';

/**
 * The back office writes to the live game, and these are the only things
 * between that and anyone who finds the URL. So they are pinned from the
 * outside: what a request with a given cookie gets back, not how the cookie
 * happens to be built.
 */

const NOW = Date.parse('2026-09-15T12:00:00.000Z');
const SECRET = 'x'.repeat(48);

const ENV = {
  GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'shh',
  AUTH_SECRET: SECRET,
  ALLOWED_EMAILS: 'Guy@Example.com, designer@example.com',
};

interface FakeRes {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
  setHeader(name: string, value: unknown): void;
  end(body?: string): void;
}

function fakeRes(): FakeRes {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body ?? '';
    },
  };
}

function fakeReq(url: string, { cookie, method = 'GET' }: { cookie?: string; method?: string } = {}) {
  return {
    url,
    method,
    headers: { host: 'backoffice.test', 'x-forwarded-proto': 'https', ...(cookie ? { cookie } : {}) },
  } as Record<string, unknown>;
}

function sessionCookie(email: string, expiresInSeconds = 3600) {
  const token = signToken(SECRET, 'session', { email, name: 'Guy', exp: Math.floor(NOW / 1000) + expiresInSeconds });
  return `chbo_session=${encodeURIComponent(token)}`;
}

const options = { env: ENV, now: () => NOW };

function cookiesOf(res: FakeRes): string[] {
  const value = res.headers['set-cookie'];
  return Array.isArray(value) ? value : value === undefined ? [] : [String(value)];
}

/** Pulls `name=value` out of a Set-Cookie list and returns it as a Cookie header entry. */
function cookieFrom(res: FakeRes, name: string): string {
  const header = cookiesOf(res).find((cookie) => cookie.startsWith(`${name}=`));
  if (header === undefined) throw new Error(`No ${name} cookie was set.`);
  return header.split(';')[0];
}

describe('signed tokens', () => {
  it('round-trips a payload until it expires', () => {
    const token = signToken(SECRET, 'session', { email: 'a@b.c', exp: NOW / 1000 + 60 });
    expect(verifyToken(SECRET, 'session', token, NOW)).toMatchObject({ email: 'a@b.c' });
    expect(verifyToken(SECRET, 'session', token, NOW + 61_000)).toBeNull();
  });

  it('refuses a token that was edited, signed with another secret, or minted for another purpose', () => {
    const token = signToken(SECRET, 'session', { email: 'a@b.c', exp: NOW / 1000 + 60 });
    const [body, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ email: 'boss@b.c', exp: NOW / 1000 + 60 })).toString('base64url');

    expect(verifyToken(SECRET, 'session', `${forged}.${mac}`, NOW)).toBeNull();
    expect(verifyToken('y'.repeat(48), 'session', token, NOW)).toBeNull();
    expect(verifyToken(SECRET, 'oauth', `${body}.${mac}`, NOW)).toBeNull();
    expect(verifyToken(SECRET, 'session', 'garbage', NOW)).toBeNull();
    expect(verifyToken(SECRET, 'session', undefined, NOW)).toBeNull();
  });
});

describe('settings', () => {
  it('reads the allowlist case-insensitively and ignores anything that is not an email', () => {
    expect([...parseAllowlist(' A@x.com;b@y.com\nnot-an-email  c@z.com,,')]).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });

  it('names every missing setting, and treats a short secret as missing', () => {
    const config = readAuthConfig({ GOOGLE_CLIENT_ID: 'id', AUTH_SECRET: 'short' });
    expect(config.configured).toBe(false);
    expect(config.problems.join(' ')).toMatch(/GOOGLE_CLIENT_SECRET.*AUTH_SECRET is shorter.*ALLOWED_EMAILS/);
  });

  it('only ever sends people back to a path on this site', () => {
    expect(safeNext('/#/liveops')).toBe('/#/liveops');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('the API gate', () => {
  it('turns away a request with no session', async () => {
    const res = fakeRes();
    expect(await gateRequest(fakeReq('/api/configcat/values'), res, options)).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ signin: true });
  });

  it('turns away a forged or expired session', async () => {
    const forged = fakeRes();
    await gateRequest(fakeReq('/api/publish/apply', { cookie: 'chbo_session=eyJlbWFpbCI6Imd1eUBleGFtcGxlLmNvbSJ9.abc' }), forged, options);
    expect(forged.statusCode).toBe(401);

    const expired = fakeRes();
    await gateRequest(fakeReq('/api/publish/apply', { cookie: sessionCookie('guy@example.com', -1) }), expired, options);
    expect(expired.statusCode).toBe(401);
  });

  it('lets an allowed person through and says who they are', async () => {
    const req = fakeReq('/api/publish/apply', { cookie: sessionCookie('guy@example.com') });
    expect(await gateRequest(req, fakeRes(), options)).toBe(true);
    expect(req.user).toEqual({ email: 'guy@example.com', name: 'Guy' });
  });

  it('locks out somebody taken off the list, however long their cookie has left', async () => {
    const res = fakeRes();
    const env = { ...ENV, ALLOWED_EMAILS: 'designer@example.com' };
    expect(await gateRequest(fakeReq('/api/schedule', { cookie: sessionCookie('guy@example.com') }), res, { ...options, env })).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('leaves the heartbeat to CRON_SECRET and the sign-in routes open', async () => {
    for (const path of ['/api/schedule/tick', '/api/schedule/tick/', '/api/auth/login', '/api/auth/me']) {
      expect(await gateRequest(fakeReq(path), fakeRes(), options)).toBe(true);
    }
    // Only the exact heartbeat path: its neighbours are not open.
    expect(await gateRequest(fakeReq('/api/schedule/ticks'), fakeRes(), options)).toBe(false);
  });

  it('shuts the API when sign-in is not configured, unless this is the local dev server', async () => {
    const shut = fakeRes();
    expect(await gateRequest(fakeReq('/api/configcat/values'), shut, { now: () => NOW, env: {} })).toBe(false);
    expect(shut.statusCode).toBe(503);
    expect(JSON.parse(shut.body).error).toMatch(/GOOGLE_CLIENT_ID/);

    // Partly configured is still not configured: no silent fallback to open.
    const partial = fakeRes();
    const env = { ...ENV, ALLOWED_EMAILS: '' };
    expect(await gateRequest(fakeReq('/api/configcat/values'), partial, { now: () => NOW, env })).toBe(false);
    expect(partial.statusCode).toBe(503);

    expect(await gateRequest(fakeReq('/api/configcat/values'), fakeRes(), { now: () => NOW, env: {}, allowUnconfigured: true })).toBe(true);
  });

  it('does not stand in front of the page itself', async () => {
    expect(await gateRequest(fakeReq('/'), fakeRes(), options)).toBe(true);
  });
});

describe('signing in with Google', () => {
  function idToken(claims: Record<string, unknown>) {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
  }

  const goodClaims = {
    iss: 'https://accounts.google.com',
    aud: ENV.GOOGLE_CLIENT_ID,
    exp: NOW / 1000 + 3600,
    email: 'Designer@Example.com',
    email_verified: true,
    name: 'Dana',
  };

  function googleReturning(claims: Record<string, unknown>) {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return new Response(JSON.stringify({ id_token: idToken(claims) }), { status: 200 });
    };
    return { calls, fetchImpl };
  }

  async function startLogin(next = '/#/liveops') {
    const res = fakeRes();
    await handleAuthRequest(fakeReq(`/api/auth/login?next=${encodeURIComponent(next)}`), res, options);
    const location = new URL(String(res.headers.location));
    return { res, location, oauthCookie: cookieFrom(res, 'chbo_oauth') };
  }

  it('sends people to Google with PKCE, a state and this site as the way back', async () => {
    const { res, location } = await startLogin();
    expect(res.statusCode).toBe(302);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('client_id')).toBe(ENV.GOOGLE_CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe('https://backoffice.test/api/auth/callback');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(cookiesOf(res)[0]).toMatch(/HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
  });

  it('signs in an allowed account and lands back where it started', async () => {
    const { location, oauthCookie } = await startLogin();
    const google = googleReturning(goodClaims);
    const res = fakeRes();
    await handleAuthRequest(
      fakeReq(`/api/auth/callback?code=abc&state=${location.searchParams.get('state')}`, { cookie: oauthCookie }),
      res,
      { ...options, fetch: google.fetchImpl },
    );

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/#/liveops');
    expect(new URLSearchParams(google.calls[0].body).get('code_verifier')).toBeTruthy();

    // The new cookie is a working session for the API.
    const req = fakeReq('/api/schedule', { cookie: cookieFrom(res, 'chbo_session') });
    expect(await gateRequest(req, fakeRes(), options)).toBe(true);
    expect(req.user).toEqual({ email: 'designer@example.com', name: 'Dana' });
  });

  it('refuses an account that is not on the list, without naming it in the URL', async () => {
    const { location, oauthCookie } = await startLogin();
    const res = fakeRes();
    await handleAuthRequest(
      fakeReq(`/api/auth/callback?code=abc&state=${location.searchParams.get('state')}`, { cookie: oauthCookie }),
      res,
      { ...options, fetch: googleReturning({ ...goodClaims, email: 'stranger@gmail.com' }).fetchImpl },
    );
    expect(res.headers.location).toBe('/?signin=denied');
    expect(cookiesOf(res).some((cookie) => cookie.startsWith('chbo_session=') && !cookie.includes('Max-Age=0'))).toBe(false);
  });

  it('refuses a callback whose state does not match the browser that started it', async () => {
    const { oauthCookie } = await startLogin();
    const google = googleReturning(goodClaims);
    const res = fakeRes();
    await handleAuthRequest(fakeReq('/api/auth/callback?code=abc&state=someone-elses', { cookie: oauthCookie }), res, {
      ...options,
      fetch: google.fetchImpl,
    });
    expect(res.headers.location).toBe('/?signin=expired');
    expect(google.calls).toHaveLength(0);
  });

  it('refuses a token for another client, from another issuer, or with an unverified email', async () => {
    for (const claims of [
      { ...goodClaims, aud: 'someone-else' },
      { ...goodClaims, iss: 'https://evil.example' },
      { ...goodClaims, email_verified: false },
      { ...goodClaims, exp: NOW / 1000 - 1 },
    ]) {
      const { location, oauthCookie } = await startLogin();
      const res = fakeRes();
      await handleAuthRequest(
        fakeReq(`/api/auth/callback?code=abc&state=${location.searchParams.get('state')}`, { cookie: oauthCookie }),
        res,
        { ...options, fetch: googleReturning(claims).fetchImpl },
      );
      expect(res.headers.location).toBe('/?signin=failed');
    }
  });

  it('never redirects off the site after signing in', async () => {
    const { location, oauthCookie } = await startLogin('https://evil.example/');
    const res = fakeRes();
    await handleAuthRequest(
      fakeReq(`/api/auth/callback?code=abc&state=${location.searchParams.get('state')}`, { cookie: oauthCookie }),
      res,
      { ...options, fetch: googleReturning(goodClaims).fetchImpl },
    );
    expect(res.headers.location).toBe('/');
  });

  it('reports who is signed in, and signs out only on a POST', async () => {
    const me = fakeRes();
    await handleAuthRequest(fakeReq('/api/auth/me', { cookie: sessionCookie('guy@example.com') }), me, options);
    expect(JSON.parse(me.body)).toEqual({ required: true, user: { email: 'guy@example.com', name: 'Guy' }, problem: null });

    const get = fakeRes();
    await handleAuthRequest(fakeReq('/api/auth/logout'), get, options);
    expect(get.statusCode).toBe(405);

    const post = fakeRes();
    await handleAuthRequest(fakeReq('/api/auth/logout', { method: 'POST' }), post, options);
    expect(cookiesOf(post)[0]).toMatch(/^chbo_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/);
  });

  it('tells the page when nobody can sign in because the deployment is not set up', async () => {
    const res = fakeRes();
    await handleAuthRequest(fakeReq('/api/auth/me'), res, { now: () => NOW, env: { ...ENV, AUTH_SECRET: '' } });
    expect(JSON.parse(res.body)).toMatchObject({ required: true, user: null, problem: expect.stringMatching(/AUTH_SECRET/) });
  });
});

describe('every API function', () => {
  const root = join(__dirname, '..', 'api');

  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  }

  // Vercel serves each file in api/ as its own function, so one that forgets
  // the wrapper is a route open to the internet. This is the check for that.
  it.each(files(root).filter((file) => !relative(root, file).startsWith(`auth${sep}`)))('%s is behind withAuth', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toMatch(/export default withAuth\(/);
  });
});
