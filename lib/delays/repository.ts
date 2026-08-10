import { doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/config';
import { collectionRef, docRef } from '@/lib/firebase/collections';
import type { DelayDoc, DelayEventDoc } from '@/lib/firebase/models';
import { buildDelayId, delayDurationMinutes } from './core';
import { DELAY_PERSISTENCE_ENABLED } from './config';

function actor() { const user = auth?.currentUser; if (!user) throw new Error('Sign in is required for delay actions.'); return user; }
function eventRef() { return doc(collectionRef('delay_events')); }

export async function startDelay(input: { itemId: string; batchId?: string; stage: string; reasonKey: string; reasonLabel: string; notes?: string; actorName: string }) {
  if (!DELAY_PERSISTENCE_ENABLED) throw new Error('Delay persistence is disabled in this environment.');
  const user = actor(); const id = buildDelayId(input.itemId, input.stage); const ref = docRef('delays', id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref); const existing = snapshot.exists() ? snapshot.data() : null;
    if (existing?.status === 'active') throw new Error('This production stage already has an active delay.');
    const base = { delayId: id, itemId: input.itemId, batchId: input.batchId ?? null, stage: input.stage, reasonKey: input.reasonKey, reasonLabel: input.reasonLabel, notes: input.notes?.trim() || null, status: 'active', startedAt: serverTimestamp(), startedBy: user.uid, startedByName: input.actorName, clearedAt: null, clearedBy: null, clearedByName: null, durationMinutes: null, occurrence: (existing?.occurrence ?? 0) + 1 };
    if (existing) transaction.update(ref, base); else transaction.set(ref, base as unknown as DelayDoc);
    transaction.set(eventRef(), { delayId: id, itemId: input.itemId, action: existing ? 'reopened' : 'started', actorId: user.uid, actorName: input.actorName, at: serverTimestamp(), reasonKey: input.reasonKey, reasonLabel: input.reasonLabel, notes: input.notes?.trim() || null } as unknown as DelayEventDoc);
  });
  return id;
}

export async function clearDelay(delayId: string, actorName: string) {
  if (!DELAY_PERSISTENCE_ENABLED) throw new Error('Delay persistence is disabled in this environment.');
  const user = actor(); const ref = docRef('delays', delayId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref); if (!snapshot.exists()) throw new Error('Delay not found.'); const delay = snapshot.data();
    if (delay.status !== 'active') throw new Error('This delay has already been cleared.');
    const now = Date.now(); const durationMinutes = delayDurationMinutes(delay.startedAt?.toMillis?.() ?? now, now);
    transaction.update(ref, { status: 'cleared', clearedAt: serverTimestamp(), clearedBy: user.uid, clearedByName: actorName, durationMinutes });
    transaction.set(eventRef(), { delayId, itemId: delay.itemId, action: 'cleared', actorId: user.uid, actorName, at: serverTimestamp(), durationMinutes } as unknown as DelayEventDoc);
  });
}

export async function getDelaysForItem(itemId: string) { const result = await getDocs(query(collectionRef('delays'), where('itemId', '==', itemId))); return result.docs.map((entry) => ({ id: entry.id, ...entry.data() })); }
