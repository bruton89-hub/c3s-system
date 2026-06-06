import Constants from 'expo-constants';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

// ── Two-source config loading ────────────────────────────────────────────────
//
// SOURCE 1 — Constants.expoConfig.extra.firebase  (PRIMARY, most reliable)
//   app.config.js runs in Node.js during `eas build` and maps all
//   EXPO_PUBLIC_FIREBASE_* shell env vars into extra.firebase.  expo-constants
//   then embeds that block into the native binary at build time.
//   This path is completely independent of Babel transforms.
//
// SOURCE 2 — process.env.EXPO_PUBLIC_FIREBASE_*   (FALLBACK for local dev)
//   babel-preset-expo inlines these as string literals at Metro bundle time.
//   CRITICAL: each key MUST be a static string literal here — dynamic bracket
//   access like process.env[variable] is NOT substituted in native bundles
//   and will always return undefined at runtime.
//
// Both sources are checked; whichever has a non-empty value for a given key
// wins. In EAS production builds the Constants path is populated. In local
// Expo Go / dev-client builds the process.env path is the primary source.

type FirebaseExtra = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

function getFirebaseConfigFromEnv(): {
  config: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
  };
  missingKeys: string[];
  presentKeys: string[];
  source: 'constants' | 'process.env' | 'mixed' | 'none';
} {
  // Source 1: Constants.expoConfig.extra.firebase (set by app.config.js)
  const extra = (Constants.expoConfig?.extra as Record<string, unknown> | null | undefined)
    ?.firebase as FirebaseExtra | null | undefined;

  // Source 2: process.env.EXPO_PUBLIC_* — static literals only (see note above)
  const envApiKey           = (process.env.EXPO_PUBLIC_FIREBASE_API_KEY             ?? '').trim();
  const envAuthDomain       = (process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN         ?? '').trim();
  const envProjectId        = (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID          ?? '').trim();
  const envStorageBucket    = (process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET      ?? '').trim();
  const envMessagingSenderId = (process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '').trim();
  const envAppId            = (process.env.EXPO_PUBLIC_FIREBASE_APP_ID              ?? '').trim();

  // Merge: Constants wins if non-empty, else fall back to process.env
  const apiKey            = (extra?.apiKey             ?? '').trim() || envApiKey;
  const authDomain        = (extra?.authDomain         ?? '').trim() || envAuthDomain;
  const projectId         = (extra?.projectId          ?? '').trim() || envProjectId;
  const storageBucket     = (extra?.storageBucket      ?? '').trim() || envStorageBucket;
  const messagingSenderId = (extra?.messagingSenderId  ?? '').trim() || envMessagingSenderId;
  const appId             = (extra?.appId              ?? '').trim() || envAppId;

  const entries: [string, string][] = [
    ['apiKey',            apiKey],
    ['authDomain',        authDomain],
    ['projectId',         projectId],
    ['storageBucket',     storageBucket],
    ['messagingSenderId', messagingSenderId],
    ['appId',             appId],
  ];

  const missingKeys = entries.filter(([, v]) => !v).map(([k]) => k);
  const presentKeys = entries.filter(([, v]) => !!v).map(([k]) => k);

  // Determine which source provided the values (for diagnostics)
  const fromConstants = !!(extra?.apiKey ?? '').trim();
  const fromEnv       = !!envApiKey;
  const source =
    fromConstants && fromEnv ? 'mixed' :
    fromConstants            ? 'constants' :
    fromEnv                  ? 'process.env' :
                               'none';

  return {
    config: { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId },
    missingKeys,
    presentKeys,
    source,
  };
}

// ── Boot log 1: module loaded ──────────────────────────────────────────────
// eslint-disable-next-line no-console
console.log('[BOOT_1] Firebase config module loading');

const { config, missingKeys, presentKeys, source } = getFirebaseConfigFromEnv();

// Safe: logs which keys are present/missing and which source provided them.
// Never logs values.
// eslint-disable-next-line no-console
console.log('[BOOT_2] Firebase env check', {
  source,
  missingCount: missingKeys.length,
  missingKeys:  missingKeys.length > 0 ? missingKeys : 'none',
  presentKeys:  presentKeys.length > 0 ? presentKeys : 'none',
  projectId:    config.projectId ? '(set)' : '(empty)',
});

export const firebaseReady = missingKeys.length === 0;
export const firebaseConfigError = firebaseReady
  ? null
  : `C3S startup error: Firebase configuration missing. Missing keys: ${missingKeys.join(', ')}`;

let firebaseApp = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;
// Tracks whether Firebase actually initialized — not just whether env vars were present.
let _firebaseInitialized = false;
let _firebaseInitError: string | null = null;

if (firebaseReady) {
  try {
    // eslint-disable-next-line no-console
    console.log('[BOOT_3] Initializing Firebase app');
    firebaseApp = getApps().length > 0 ? getApp() : initializeApp(config);
    dbInstance = getFirestore(firebaseApp);
    authInstance = getAuth(firebaseApp);
    _firebaseInitialized = true;
    // eslint-disable-next-line no-console
    console.log('[BOOT_4] Firebase initialized OK', { projectId: config.projectId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    _firebaseInitError = `C3S startup error: Firebase initialization failed. ${msg}`;
    // eslint-disable-next-line no-console
    console.error('[C3S_STARTUP_ERROR] Firebase init threw:', msg);
  }
} else {
  // eslint-disable-next-line no-console
  console.error('[C3S_STARTUP_ERROR]', firebaseConfigError);
}

// True ONLY when env vars were present AND init actually succeeded.
export const firebaseInitialized = _firebaseInitialized;
export const firebaseInitError = _firebaseInitError;

export const db = dbInstance as unknown as Firestore;
export const auth = authInstance as unknown as Auth;
