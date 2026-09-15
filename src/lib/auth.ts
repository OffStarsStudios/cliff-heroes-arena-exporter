/**
 * Client side of the sign-in routes in `server/authHandler.mjs`.
 *
 * The session itself is an HttpOnly cookie the page never sees. All the page
 * can do is ask who it belongs to, send people to Google, and forget it.
 */

export interface SessionUser {
  email: string;
  name: string | null;
}

export interface Session {
  /** False only on a local dev server with sign-in switched off. */
  required: boolean;
  user: SessionUser | null;
  /** Why nobody can sign in here right now, when that is the case. */
  problem: string | null;
}

export async function fetchSession(): Promise<Session> {
  let response: Response;
  try {
    response = await fetch('/api/auth/me', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch (error) {
    throw new Error(`Could not reach the server: ${(error as Error).message}`);
  }
  if (!response.ok) throw new Error(`The server returned HTTP ${response.status} when asked who is signed in.`);
  return (await response.json()) as Session;
}

/** Where the sign-in button goes: Google, then back to this page. */
export function signInHref(): string {
  const next = `${window.location.pathname}${window.location.hash}`;
  return `/api/auth/login?next=${encodeURIComponent(next)}`;
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: { Accept: 'application/json' } });
}

/** What `?signin=<reason>` means, as the server sends it back after a sign-in that did not work. */
export const SIGNIN_NOTICES: Record<string, string> = {
  denied:
    'That Google account is not on the list for the back office. Choose a different account, or ask for yours to be added.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in took too long or was started in another tab. Try again.',
  failed: 'Google did not complete the sign-in. Try again; if it keeps happening, the server log says why.',
  unconfigured: 'Sign-in is not set up on this deployment yet.',
};

/** Reads `?signin=` once and takes it out of the address bar, so a reload does not repeat it. */
export function takeSignInNotice(): string | null {
  const url = new URL(window.location.href);
  const reason = url.searchParams.get('signin');
  if (reason === null) return null;
  url.searchParams.delete('signin');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return SIGNIN_NOTICES[reason] ?? SIGNIN_NOTICES.failed;
}
