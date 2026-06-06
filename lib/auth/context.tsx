/**
 * Auth context — wraps Firebase Auth with:
 *   1. Automatic anonymous sign-in on first load (zero-friction demo mode).
 *   2. Email/password sign-in as fallback (if anonymous is disabled in console).
 *   3. Explicit sign-out that suppresses the auto-anon retry.
 *
 * Usage:
 *   wrap the app with <AuthProvider>
 *   consume with const { status, user, signInWithEmail, signOutUser } = useAuth();
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';

import { auth, firebaseConfigError, firebaseInitError, firebaseInitialized, firebaseReady } from '@/lib/firebase/config';

// ─────────────────────────────────────────────────────────────────────────────

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out' | 'startup-error';

export type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  isAnonymous: boolean;
  startupError: string | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  status: 'loading',
  user: null,
  isAnonymous: false,
  startupError: null,
  signInWithEmail: async () => {},
  signOutUser: async () => {},
});

// ─────────────────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);

  // Prevent auto-anon re-trigger after an explicit sign-out.
  const suppressAutoAnon = useRef(false);
  // Prevent concurrent anon sign-in attempts while one is in flight.
  const tryingAnon = useRef(false);

  useEffect(() => {
    // Guard 1 — env vars missing.
    if (!firebaseReady) {
      setStatus('startup-error');
      setStartupError(firebaseConfigError ?? 'C3S startup error: Firebase configuration missing.');
      // eslint-disable-next-line no-console
      console.error('[C3S_STARTUP_ERROR] env vars missing:', firebaseConfigError);
      return () => {};
    }
    // Guard 2 — env vars present but Firebase.initializeApp() threw (e.g. SDK incompatibility).
    if (!firebaseInitialized || !auth) {
      setStatus('startup-error');
      setStartupError(
        firebaseInitError ?? 'C3S startup error: Firebase initialization failed (auth is null).',
      );
      // eslint-disable-next-line no-console
      console.error('[C3S_STARTUP_ERROR] Firebase init failed:', firebaseInitError);
      return () => {};
    }
    // eslint-disable-next-line no-console
    console.log('[BOOT_5] Registering onAuthStateChanged');
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        setStatus('signed-in');
        tryingAnon.current = false;

        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[BOOT_6][Auth] signed in:', {
            uid: firebaseUser.uid,
            anonymous: firebaseUser.isAnonymous,
            email: firebaseUser.email ?? 'none',
          });
        }
        return;
      }

      // No user — attempt automatic anonymous sign-in on first load.
      if (!suppressAutoAnon.current && !tryingAnon.current) {
        tryingAnon.current = true;
        try {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log('[Auth] No user found — attempting anonymous sign-in...');
          }
          await signInAnonymously(auth);
          // onAuthStateChanged will fire again with the anonymous user; don't
          // call setState here — let the next callback handle it.
        } catch (err) {
          // Anonymous sign-in disabled or failed — fall through to sign-in screen.
          tryingAnon.current = false;
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.warn('[Auth] Anonymous sign-in failed — showing sign-in screen:', err);
          }
          setUser(null);
          setStatus('signed-out');
        }
      } else {
        // Explicit sign-out path — stay on sign-in screen.
        setUser(null);
        setStatus('signed-out');
      }
    });

    return unsubscribe;
  }, []);

  const signInWithEmail = async (email: string, password: string): Promise<void> => {
    if (!firebaseReady || !firebaseInitialized || !auth) {
      throw new Error(
        firebaseConfigError ?? firebaseInitError ?? 'Firebase is not configured.',
      );
    }
    suppressAutoAnon.current = false;
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged fires next and sets status = 'signed-in'.
  };

  const signOutUser = async (): Promise<void> => {
    if (!firebaseReady || !firebaseInitialized || !auth) return;
    suppressAutoAnon.current = true;
    await signOut(auth);
    setUser(null);
    setStatus('signed-out');
  };

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        isAnonymous: user?.isAnonymous ?? false,
        startupError,
        signInWithEmail,
        signOutUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
