/**
 * Shared Firebase / Firestore error diagnostics.
 *
 * Each screen's catch block calls logFirebaseError() in __DEV__ builds.
 * Logged object always includes:
 *   - screen & collection that failed
 *   - Firebase error code
 *   - Current auth state (uid, anonymous, email)
 *   - Human-readable diagnosis string
 */

import { auth } from '@/lib/firebase/config';

// ─────────────────────────────────────────────────────────────────────────────

type FirebaseErrorLike = {
  code?: string;
  message?: string;
};

export function logFirebaseError(
  screen: string,
  collection: string,
  err: unknown,
): void {
  if (!__DEV__) return;

  const e = (err ?? {}) as FirebaseErrorLike;
  const code = e.code ?? 'unknown';
  const message = e.message ?? String(err);
  // auth may be null if Firebase failed to initialize — guard before access.
  const user = auth?.currentUser ?? null;

  let diagnosis = 'UNKNOWN_ERROR';

  if (code === 'permission-denied' || message.toLowerCase().includes('insufficient permissions')) {
    diagnosis = user
      ? `AUTH OK (uid=${user.uid}, anon=${user.isAnonymous}) — Firestore rules denied '${collection}'. Check rules.`
      : `NO AUTH — no signed-in user. '${collection}' requires signedIn(). Sign in first.`;
  } else if (code === 'unavailable' || code === 'failed-precondition') {
    diagnosis = 'FIRESTORE_UNAVAILABLE — network error or offline mode.';
  } else if (code === 'not-found') {
    diagnosis = `COLLECTION_NOT_FOUND — '${collection}' may be empty or path is wrong.`;
  } else if (
    message.includes('CONFIGURATION_NOT_FOUND') ||
    message.includes('identitytoolkit')
  ) {
    diagnosis = 'FIREBASE_AUTH_NOT_CONFIGURED — enable Firebase Auth in the console.';
  } else if (message.includes('app/no-app') || message.includes('Firebase App named')) {
    diagnosis = 'FIREBASE_NOT_INITIALIZED — initializeApp() did not run before Firestore.';
  } else if (code === 'unauthenticated') {
    diagnosis = 'UNAUTHENTICATED — token expired or missing. Re-authenticate.';
  }

  // eslint-disable-next-line no-console
  console.error(`[${screen}][${collection}] Firebase error`, {
    code,
    diagnosis,
    message,
    authUid: user?.uid ?? null,
    authAnonymous: user?.isAnonymous ?? null,
    authEmail: user?.email ?? null,
  });
}

/** Convert a Firebase error into a user-facing operator message. */
export function toOperatorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error) || !err.message) return fallback;
  const msg = err.message.toLowerCase();
  if (msg.includes('missing or insufficient permissions') || msg.includes('permission-denied')) {
    // auth may be null if Firebase failed to initialize — guard before access.
    return auth?.currentUser
      ? 'Action blocked by access rules. Contact your supervisor.'
      : 'Sign in required. Please sign in to access this screen.';
  }
  if (msg.includes('network') || msg.includes('unavailable') || msg.includes('offline')) {
    return 'Unable to reach the server. Check network and try again.';
  }
  if (msg.includes('not-found')) {
    return 'Data not found. The record may have been deleted.';
  }
  return fallback;
}
