/**
 * Product Intelligence — Firestore repository.
 *
 * All reads/writes against the `product_profiles` collection live here.
 * Forecasting, capacity, and planning consume this repo via thin selectors.
 */
import {
  addDoc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { collectionRef, docRef } from '@/lib/firebase/collections';
import type { ProductProfileDoc } from '@/lib/firebase/models';

import type { NewProductProfileInput, ProductProfile } from './types';

function snap(snapshot: QueryDocumentSnapshot<ProductProfileDoc>): ProductProfile {
  return { id: snapshot.id, ...snapshot.data() };
}

function removeUndefinedFields<T>(value: T): T {
  const removed: string[] = [];
  function walk<V>(node: V, path: string): V {
    if (Array.isArray(node)) {
      return node
        .map((item, idx) => walk(item, `${path}[${idx}]`))
        .filter((item) => item !== undefined) as V;
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      Object.entries(node as Record<string, unknown>).forEach(([k, v]) => {
        const p = path ? `${path}.${k}` : k;
        if (v === undefined) {
          removed.push(p);
          return;
        }
        out[k] = walk(v, p);
      });
      return out as V;
    }
    return node;
  }
  const result = walk(value, '');
  if (__DEV__ && removed.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[sanitizer] Removed undefined fields: ${removed.join(', ')}`);
  }
  return result;
}

/** Fetch all ACTIVE product profiles, ordered by productName. */
export async function getActiveProductProfiles(): Promise<ProductProfile[]> {
  // ── TEMPORARY DIAGNOSTIC — remove after Firebase connectivity confirmed ───
  try {
    const snapshot = await getDocs(
      query(
        collectionRef('product_profiles'),
        where('active', '==', true),
      ),
    );
    // eslint-disable-next-line no-console
    console.log(`[product_profiles] query returned ${snapshot.docs.length} docs (active=true)`);
    return snapshot.docs
      .map(snap)
      .sort((a, b) => a.productName.localeCompare(b.productName));
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    const code = e?.code ?? 'unknown';
    const msg = e?.message ?? String(err);
    let diagnosis = 'UNKNOWN';
    if (code === 'permission-denied') {
      diagnosis = 'PERMISSION_DENIED — user is not authenticated or Firestore rules are blocking the read';
    } else if (code === 'unavailable' || code === 'failed-precondition') {
      diagnosis = 'FIRESTORE_UNAVAILABLE — possible network or initialization failure';
    } else if (msg.includes('CONFIGURATION_NOT_FOUND') || msg.includes('identitytoolkit')) {
      diagnosis = 'AUTH_CONFIGURATION_NOT_FOUND — Firebase Auth API not enabled for this project or API key is wrong';
    } else if (msg.includes('app/no-app') || msg.includes('Firebase App named')) {
      diagnosis = 'FIREBASE_NOT_INITIALIZED — initializeApp() did not run before Firestore access';
    } else if (code === 'not-found') {
      diagnosis = 'COLLECTION_NOT_FOUND — product_profiles collection does not exist in Firestore';
    }
    // eslint-disable-next-line no-console
    console.error('[product_profiles] query FAILED', { code, diagnosis, message: msg });
    throw err;
  }
  // ─────────────────────────────────────────────────────────────────────────
}

/** Fetch ALL product profiles including inactive ones. */
export async function getAllProductProfiles(): Promise<ProductProfile[]> {
  const snapshot = await getDocs(
    query(collectionRef('product_profiles'), orderBy('productName', 'asc')),
  );
  return snapshot.docs.map(snap);
}

export async function getProductProfile(id: string): Promise<ProductProfile | null> {
  const result = await getDoc(docRef('product_profiles', id));
  if (!result.exists()) return null;
  return { id: result.id, ...result.data() };
}

/** Find a profile by product code (most common lookup pattern from planning). */
export async function getProductProfileByCode(productCode: string): Promise<ProductProfile | null> {
  const snapshot = await getDocs(
    query(collectionRef('product_profiles'), where('productCode', '==', productCode)),
  );
  if (snapshot.empty) return null;
  return snap(snapshot.docs[0]);
}

export async function createProductProfile(input: NewProductProfileInput): Promise<string> {
  const payload: ProductProfileDoc = {
    ...input,
    active: input.active ?? true,
    createdAt: input.createdAt ?? Timestamp.now(),
  };
  const ref = await addDoc(collectionRef('product_profiles'), removeUndefinedFields(payload));
  return ref.id;
}

/**
 * Idempotent upsert at a stable document id. Used by the seed script and any
 * other "set a known profile to a known state" workflow.
 */
export async function upsertProductProfileAt(
  docId: string,
  input: NewProductProfileInput,
): Promise<void> {
  const payload: ProductProfileDoc = {
    ...input,
    active: input.active ?? true,
    createdAt: input.createdAt ?? Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
  await setDoc(docRef('product_profiles', docId), removeUndefinedFields(payload), { merge: true });
}

export async function updateProductProfile(
  id: string,
  updates: Partial<Omit<ProductProfileDoc, 'createdAt'>>,
): Promise<void> {
  await updateDoc(docRef('product_profiles', id), removeUndefinedFields({
    ...updates,
    updatedAt: Timestamp.now(),
  } as Record<string, unknown>));
}

export async function deactivateProductProfile(id: string): Promise<void> {
  await updateDoc(docRef('product_profiles', id), removeUndefinedFields({
    active: false,
    updatedAt: Timestamp.now(),
  }));
}

export async function reactivateProductProfile(id: string): Promise<void> {
  await updateDoc(docRef('product_profiles', id), removeUndefinedFields({
    active: true,
    updatedAt: Timestamp.now(),
  }));
}
