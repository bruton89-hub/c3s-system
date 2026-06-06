import {
  collection,
  CollectionReference,
  doc,
  DocumentData,
  DocumentReference,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/config';
import { C3SCollections } from '@/lib/firebase/models';

export const COLLECTIONS = {
  users: 'users',
  products: 'products',
  product_profiles: 'product_profiles',
  prep_queue: 'prep_queue',
  smokehouses: 'smokehouses',
  cook_logs: 'cook_logs',
  chillers: 'chillers',
  chill_logs: 'chill_logs',
  qa_checks: 'qa_checks',
  packaging_logs: 'packaging_logs',
  alerts: 'alerts',
  weekly_plan: 'weekly_plan',
  operational_events: 'operational_events',
  operational_items: 'operational_items',
} as const;

export type CollectionName = keyof typeof COLLECTIONS;

function createConverter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore(value: T): DocumentData {
      return value;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot<DocumentData>, options: SnapshotOptions): T {
      return snapshot.data(options) as T;
    },
  };
}

export function collectionRef<K extends CollectionName>(name: K): CollectionReference<C3SCollections[K]> {
  return collection(db, COLLECTIONS[name]).withConverter(createConverter<C3SCollections[K]>());
}

export function docRef<K extends CollectionName>(
  name: K,
  id: string,
): DocumentReference<C3SCollections[K]> {
  return doc(db, COLLECTIONS[name], id).withConverter(createConverter<C3SCollections[K]>());
}
