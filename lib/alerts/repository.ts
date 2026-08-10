import {
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { auth, db } from '@/lib/firebase/config';
import { collectionRef, docRef } from '@/lib/firebase/collections';
import type { AlertDoc, AlertEventDoc } from '@/lib/firebase/models';
import type { OItemItem } from '@/lib/operational-items';
import { getProductionAlerts, itemBatch, type ProductionAlert } from '@/lib/production/presentation';
import { buildAlertId } from './core';
import { ALERT_PERSISTENCE_ENABLED } from './config';

export type PersistentAlert = AlertDoc & { id: string };
export type PersistentAlertEvent = AlertEventDoc & { id: string };

function currentUser() {
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in is required for alert lifecycle actions.');
  return user;
}

function eventRef() {
  return doc(collectionRef('alert_events'));
}

function alertPayload(alert: ProductionAlert, item: OItemItem) {
  return {
    alertId: buildAlertId(item.id, alert.conditionKey),
    itemId: item.id,
    batchId: itemBatch(item),
    conditionKey: alert.conditionKey,
    category: alert.category,
    stage: item.stage,
    title: alert.title,
    message: alert.message,
    severity: alert.severity,
  };
}

async function detectAlert(alert: ProductionAlert, item: OItemItem, actorName: string): Promise<void> {
  const user = currentUser();
  const identity = buildAlertId(item.id, alert.conditionKey);
  const ref = docRef('alerts', identity);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const payload = alertPayload(alert, item);
    if (!snap.exists()) {
      transaction.set(ref, {
        ...payload,
        status: 'open',
        createdAt: serverTimestamp(),
        firstDetectedAt: serverTimestamp(),
        lastDetectedAt: serverTimestamp(),
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgedByName: null,
        resolvedAt: null,
        resolvedBy: null,
        resolvedByName: null,
        resolutionReason: null,
        occurrence: 1,
      } as unknown as AlertDoc);
      transaction.set(eventRef(), {
        alertId: identity, itemId: item.id, action: 'created', actorId: user.uid,
        actorName, at: serverTimestamp(), reason: 'Condition detected',
      } as unknown as AlertEventDoc);
      return;
    }

    const existing = snap.data();
    const reopened = existing.status === 'resolved';
    transaction.update(ref, {
      ...payload,
      status: reopened ? 'open' : existing.status,
      lastDetectedAt: serverTimestamp(),
      ...(reopened ? {
        firstDetectedAt: serverTimestamp(),
        acknowledgedAt: null, acknowledgedBy: null, acknowledgedByName: null,
        resolvedAt: null, resolvedBy: null, resolvedByName: null, resolutionReason: null,
        occurrence: (existing.occurrence || 1) + 1,
      } : {}),
    });
    if (reopened) {
      transaction.set(eventRef(), {
        alertId: identity, itemId: item.id, action: 'reopened', actorId: user.uid,
        actorName, at: serverTimestamp(), reason: 'Condition detected again after resolution',
      } as unknown as AlertEventDoc);
    }
  });
}

async function automaticallyResolveAlert(alert: PersistentAlert, actorName: string): Promise<void> {
  const user = currentUser();
  const ref = docRef('alerts', alert.id);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists() || snap.data().status === 'resolved') return;
    transaction.update(ref, {
      status: 'resolved', resolvedAt: serverTimestamp(), resolvedBy: user.uid,
      resolvedByName: actorName, resolutionReason: 'Underlying production condition cleared.',
    });
    transaction.set(eventRef(), {
      alertId: alert.id, itemId: alert.itemId, action: 'auto_resolved', actorId: user.uid,
      actorName, at: serverTimestamp(), reason: 'Underlying production condition cleared.',
    } as unknown as AlertEventDoc);
  });
}

export async function syncPersistentAlerts(items: OItemItem[], actorName: string, canAutoResolve = false): Promise<void> {
  if (!ALERT_PERSISTENCE_ENABLED) return;
  const detected = items.flatMap((item) => getProductionAlerts(item).map((alert) => ({ item, alert })));
  for (const { alert, item } of detected) await detectAlert(alert, item, actorName);

  const activeIds = new Set(detected.map(({ alert, item }) => buildAlertId(item.id, alert.conditionKey)));
  if (!canAutoResolve) return;
  const persisted = await getPersistentAlerts();
  for (const alert of persisted) {
    if (alert.status !== 'resolved' && !activeIds.has(alert.id)) {
      await automaticallyResolveAlert(alert, actorName);
    }
  }
}

export async function getPersistentAlerts(): Promise<PersistentAlert[]> {
  const snapshot = await getDocs(query(collectionRef('alerts'), orderBy('firstDetectedAt', 'asc')));
  return snapshot.docs.map((entry: QueryDocumentSnapshot<AlertDoc>) => ({ id: entry.id, ...entry.data() }));
}

export async function getPersistentAlertsForItem(itemId: string): Promise<PersistentAlert[]> {
  const snapshot = await getDocs(query(collectionRef('alerts'), where('itemId', '==', itemId)));
  return snapshot.docs.map((entry: QueryDocumentSnapshot<AlertDoc>) => ({ id: entry.id, ...entry.data() }));
}

export async function getAlertEvents(alertId: string): Promise<PersistentAlertEvent[]> {
  const snapshot = await getDocs(query(collectionRef('alert_events'), where('alertId', '==', alertId), orderBy('at', 'asc')));
  return snapshot.docs.map((entry: QueryDocumentSnapshot<AlertEventDoc>) => ({ id: entry.id, ...entry.data() }));
}

export async function acknowledgeAlert(alertId: string, actorName: string): Promise<void> {
  if (!ALERT_PERSISTENCE_ENABLED) throw new Error('Persistent alerts are not enabled for this environment.');
  const user = currentUser();
  const ref = docRef('alerts', alertId);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('Alert not found.');
    const alert = snap.data();
    if (alert.status !== 'open') throw new Error('Only an open alert can be acknowledged.');
    transaction.update(ref, {
      status: 'acknowledged', acknowledgedAt: serverTimestamp(), acknowledgedBy: user.uid,
      acknowledgedByName: actorName,
    });
    transaction.set(eventRef(), {
      alertId, itemId: alert.itemId, action: 'acknowledged', actorId: user.uid,
      actorName, at: serverTimestamp(), reason: 'Operator acknowledged the condition.',
    } as unknown as AlertEventDoc);
  });
}
