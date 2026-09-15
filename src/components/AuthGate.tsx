import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchSession, signInHref, signOut, takeSignInNotice, type Session } from '../lib/auth';
import { Icon } from './Icon';
import { PixelHeart } from './PixelHeart';

const SessionContext = createContext<Session | null>(null);

/**
 * Taken once when the module loads rather than in a state initialiser, which
 * StrictMode runs twice - the second run would find the address bar already
 * cleaned and lose the message.
 */
const NOTICE = takeSignInNotice();

/** The signed-in session, for the shell. Null outside the gate. */
export function useSession(): Session | null {
  return useContext(SessionContext);
}

type GateState =
  | { phase: 'checking' }
  | { phase: 'ready'; session: Session }
  | { phase: 'unreachable'; message: string };

/**
 * Nothing in the app renders until the server says who is signed in.
 *
 * This is not the security boundary - every API route checks the session
 * itself, and the page is public code - but without it a signed-out visitor
 * would see a console full of errors instead of a way in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ phase: 'checking' });

  const check = useCallback(async (quiet: boolean) => {
    try {
      const session = await fetchSession();
      setState((current) =>
        // A quiet re-check only matters when it changes who is signed in.
        quiet && current.phase === 'ready' && current.session.user?.email === session.user?.email
          ? current
          : { phase: 'ready', session },
      );
    } catch (error) {
      if (!quiet) setState({ phase: 'unreachable', message: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    void check(false);
    // A tab left open past the end of a session should show the way back in
    // when somebody returns to it, not the first failed request.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [check]);

  if (state.phase === 'checking') return <div className="signin" aria-busy="true" />;

  if (state.phase === 'unreachable') {
    return (
      <SignInCard>
        <p className="signin__notice signin__notice--danger" role="alert">
          {state.message}
        </p>
        <button type="button" className="btn btn--primary signin__button" onClick={() => void check(false)}>
          <Icon name="refresh" size={15} />
          Try again
        </button>
      </SignInCard>
    );
  }

  const { session } = state;
  if (session.required && session.user === null) {
    const problem = session.problem ?? NOTICE;
    return (
      <SignInCard>
        <p className="signin__lead">
          The back office changes what the live game serves, so it is limited to the team.
        </p>
        {problem !== null && (
          <p className="signin__notice signin__notice--danger" role="alert">
            {problem}
          </p>
        )}
        <a className="btn btn--primary signin__button" href={signInHref()}>
          <GoogleMark />
          Sign in with Google
        </a>
      </SignInCard>
    );
  }

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

function SignInCard({ children }: { children: ReactNode }) {
  return (
    <div className="signin">
      <main className="signin__card">
        <div className="signin__brand">
          <span className="signin__mark">
            <PixelHeart size={22} />
          </span>
          <span>
            <span className="signin__name">Cliff Heroes</span>
            <span className="signin__sub">Back office</span>
          </span>
        </div>
        <h1 className="signin__title">Sign in</h1>
        {children}
      </main>
    </div>
  );
}

/** The signed-in person and the way out, for the top bar. */
export function AccountMenu() {
  const session = useSession();
  const [leaving, setLeaving] = useState(false);

  if (session === null) return null;
  if (!session.required) {
    return (
      <span className="chip chip--warn" title="No GOOGLE_CLIENT_ID and friends in .env.local, so this local server lets everyone in.">
        Sign-in off locally
      </span>
    );
  }
  if (session.user === null) return null;

  const leave = async () => {
    setLeaving(true);
    try {
      await signOut();
    } finally {
      window.location.reload();
    }
  };

  return (
    <span className="account">
      <span className="account__who" title={session.user.email}>
        {session.user.name ?? session.user.email}
      </span>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => void leave()} disabled={leaving}>
        Sign out
      </button>
    </span>
  );
}

/** Google's "G", in its own colours, as its sign-in branding asks. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" className="signin__google">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
