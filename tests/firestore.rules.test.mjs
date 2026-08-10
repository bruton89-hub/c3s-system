import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'c3s-preview-rules-test';
let environment;
const users = {
  operator: { name: 'Operator One', role: 'operator', department: 'thermal', active: true },
  operator2: { name: 'Operator Two', role: 'operator', department: 'thermal', active: true },
  qa: { name: 'QA Reviewer', role: 'qa', department: 'qa', active: true },
  supervisor: { name: 'Supervisor', role: 'supervisor', department: 'thermal', active: true },
  packaging: { name: 'Packaging', role: 'packaging', department: 'packaging', active: true },
  inactive: { name: 'Inactive', role: 'admin', department: 'thermal', active: false },
  admin: { name: 'Admin User', role: 'admin', department: 'thermal', active: true },
};

before(async () => { environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
after(async () => { await environment?.cleanup(); });
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    for (const [uid, profile] of Object.entries(users)) await setDoc(doc(context.firestore(), 'users', uid), { ...profile, createdAt: new Date() });
  });
});

function db(uid) { return environment.authenticatedContext(uid).firestore(); }
function alertPayload() { return { alertId: 'item-1__thermal-check-overdue', itemId: 'item-1', batchId: 'B-1', conditionKey: 'thermal-check-overdue', category: 'thermal', stage: 'thermal', title: 'Required check overdue', message: 'Record check', severity: 'critical', status: 'open', createdAt: serverTimestamp(), firstDetectedAt: serverTimestamp(), lastDetectedAt: serverTimestamp(), acknowledgedAt: null, acknowledgedBy: null, acknowledgedByName: null, resolvedAt: null, resolvedBy: null, resolvedByName: null, resolutionReason: null, occurrence: 1 }; }

test('alert identity/timestamps are protected and concurrent acknowledgement yields one winner', async () => {
  const ref = doc(db('operator'), 'alerts', 'item-1__thermal-check-overdue');
  await assertSucceeds(setDoc(ref, alertPayload()));
  await assertFails(setDoc(doc(db('operator'), 'alerts', 'wrong-id'), alertPayload()));
  const ack1 = updateDoc(doc(db('operator'), 'alerts', ref.id), { status: 'acknowledged', acknowledgedAt: serverTimestamp(), acknowledgedBy: 'operator', acknowledgedByName: 'Operator One' });
  const ack2 = updateDoc(doc(db('operator2'), 'alerts', ref.id), { status: 'acknowledged', acknowledgedAt: serverTimestamp(), acknowledgedBy: 'operator2', acknowledgedByName: 'Operator Two' });
  const results = await Promise.allSettled([ack1, ack2]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
});

test('alert and hold audit events are append-only with actor binding', async () => {
  const event = doc(db('operator'), 'alert_events', 'event-1');
  await assertSucceeds(setDoc(event, { alertId: 'a', itemId: 'item-1', action: 'created', actorId: 'operator', actorName: 'Operator One', at: serverTimestamp() }));
  await assertFails(updateDoc(event, { actorName: 'Changed' }));
  await assertFails(setDoc(doc(db('operator'), 'hold_events', 'hold-bad'), { itemId: 'item-1', action: 'placed', actorId: 'qa', actorName: 'Fake', at: serverTimestamp() }));
});

test('formal holds are server-owned and direct role escalation is rejected', async () => {
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'operational_items', 'held-item'), { stage: 'thermal', status: 'cooking', transitions: [], createdAt: new Date(), updatedAt: new Date() }));
  const held = doc(db('operator'), 'operational_items', 'held-item');
  await assertFails(updateDoc(held, { status: 'hold', updatedAt: serverTimestamp(), transitions: [{ from: { stage: 'thermal', status: 'cooking' }, to: { stage: 'thermal', status: 'hold' }, by: 'operator', at: new Date() }], activeHold: { reasonKey: 'qa_review', reasonLabel: 'QA Review', notes: null, placedBy: 'operator', placedByName: 'Operator One', placedAt: serverTimestamp(), previousStage: 'thermal', previousStatus: 'cooking' } }));
  await assertFails(updateDoc(doc(db('operator'), 'operational_items', 'held-item'), { stage: 'thermal', status: 'cooking', updatedAt: serverTimestamp(), transitions: [], activeHold: null }));
  await assertFails(updateDoc(doc(db('qa'), 'operational_items', 'held-item'), { stage: 'thermal', status: 'cooking', updatedAt: serverTimestamp(), transitions: [], activeHold: null }));
  await assertFails(updateDoc(doc(db('operator'), 'users', 'operator'), { role: 'admin' }));
});

test('all direct canonical transitions are rejected, including otherwise valid stage moves', async () => {
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'operational_items', 'item-stage'), { stage: 'thermal', status: 'cooking', transitions: [], createdAt: new Date(), updatedAt: new Date() }));
  await assertFails(updateDoc(doc(db('operator'), 'operational_items', 'item-stage'), { stage: 'packaging', status: 'packaging_complete', transitions: [{ action: 'invalid' }] }));
  await assertFails(updateDoc(doc(db('operator'), 'operational_items', 'item-stage'), { stage: 'chill', status: 'awaiting_chill', transitions: [{ action: 'thermal-to-chill' }] }));
});

test('delay lifecycle binds actors/timestamps and prevents duplicate clear', async () => {
  const delayId = 'item-1__thermal__delay'; const delay = doc(db('operator'), 'delays', delayId);
  await assertSucceeds(setDoc(delay, { delayId, itemId: 'item-1', batchId: 'B-1', stage: 'thermal', reasonKey: 'equipment', reasonLabel: 'Equipment', notes: null, status: 'active', startedAt: serverTimestamp(), startedBy: 'operator', startedByName: 'Operator One', clearedAt: null, clearedBy: null, clearedByName: null, durationMinutes: null, occurrence: 1 }));
  await assertFails(updateDoc(doc(db('operator2'), 'delays', delayId), { startedBy: 'operator2' }));
  await assertSucceeds(updateDoc(delay, { status: 'cleared', clearedAt: serverTimestamp(), clearedBy: 'operator', clearedByName: 'Operator One', durationMinutes: 12 }));
  await assertFails(updateDoc(delay, { status: 'cleared', clearedAt: serverTimestamp(), clearedBy: 'operator', clearedByName: 'Operator One', durationMinutes: 13 }));
});

test('handoff notes are append-only and cannot forge the author', async () => {
  const note = doc(db('operator'), 'handoff_notes', 'note-1');
  await assertSucceeds(setDoc(note, { handoffId: '2026-08-10__night', shiftDate: '2026-08-10', note: 'Oven G unavailable; supervisor is reviewing.', authorId: 'operator', authorName: 'Operator One', createdAt: serverTimestamp(), itemIds: ['item-1'] }));
  await assertFails(updateDoc(note, { note: 'silently replaced' }));
  await assertFails(setDoc(doc(db('operator2'), 'handoff_notes', 'note-2'), { handoffId: 'x', shiftDate: '2026-08-10', note: 'forged', authorId: 'operator', authorName: 'Operator One', createdAt: serverTimestamp(), itemIds: [] }));
});

test('profile owners can change only their name, never role, active status, or authority', async () => {
  const self = doc(db('operator'), 'users', 'operator');
  await assertSucceeds(updateDoc(self, { name: 'Updated Operator' }));
  await assertFails(updateDoc(self, { active: false }));
  await assertFails(updateDoc(self, { role: 'qa' }));
  await assertFails(updateDoc(self, { admin: true }));
});

test('planning writes require active supervisor or admin and preserve creator audit fields', async () => {
  const payload = { productId: 'p', productName: 'Product', productCodeSnapshot: 'P', plannedDate: '2026-08-10', status: 'planned', createdBy: 'supervisor', createdAt: serverTimestamp() };
  await assertFails(setDoc(doc(db('operator'), 'weekly_plan', 'plan-1'), payload));
  await assertFails(setDoc(doc(db('inactive'), 'weekly_plan', 'plan-2'), payload));
  const plan = doc(db('supervisor'), 'weekly_plan', 'plan-3'); await assertSucceeds(setDoc(plan, payload));
  await assertFails(updateDoc(plan, { createdBy: 'rewritten' }));
});

test('server-managed equipment occupancy rejects direct clients while safe admin configuration remains narrow', async () => {
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'smokehouses', 'G'), { name: 'G', status: 'idle', currentLoadId: null, lastCleanedAt: new Date() }));
  await assertFails(updateDoc(doc(db('qa'), 'smokehouses', 'G'), { status: 'cooking', currentLoadId: 'item-1' }));
  await assertFails(updateDoc(doc(db('operator'), 'smokehouses', 'G'), { status: 'cooking', currentLoadId: 'item-1' }));
  await assertSucceeds(updateDoc(doc(db('supervisor'), 'smokehouses', 'G'), { setupType: 'tree' }));
  await assertFails(updateDoc(doc(db('operator'), 'smokehouses', 'G'), { name: 'H' }));
  await assertFails(deleteDoc(doc(db('admin'), 'smokehouses', 'G')));
});

test('QA outcomes are server-owned even for QA clients', async () => {
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'qa_checks', 'qa-1'), { prepId: 'prep-1', type: 'chill', status: 'ready_for_qa', notes: '', reviewedBy: null, timestamp: new Date() }));
  await assertFails(updateDoc(doc(db('operator'), 'qa_checks', 'qa-1'), { status: 'ready_for_packaging', decision: 'approve_for_packaging', notes: 'Reviewed and approved.', reviewedBy: 'Operator', reviewedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('qa'), 'qa_checks', 'qa-1'), { status: 'ready_for_packaging', decision: 'approve_for_packaging', notes: 'Reviewed and approved.', reviewedBy: 'QA Reviewer', reviewedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('qa'), 'qa_checks', 'qa-1'), { prepId: 'other' }));
});

test('packaging lifecycle documents can only be created by the trusted server layer', async () => {
  const payload = { prepId: 'prep-1', qaCheckId: 'qa-1', productName: 'Product', casesProduced: null, unitsProduced: null, yieldPercent: null, packagingLine: null, packagedBy: null, status: 'running', startedAt: serverTimestamp(), completedAt: null, notes: '' };
  await assertFails(setDoc(doc(db('operator'), 'packaging_logs', 'pack-1'), payload));
  await assertFails(setDoc(doc(db('packaging'), 'packaging_logs', 'pack-2'), payload));
});

test('operational audit events are server-only and immutable', async () => {
  const event = doc(db('operator'), 'operational_events', 'op-event');
  await assertFails(setDoc(event, { department: 'thermal', type: 'other', severity: 'info', notes: 'Event', operator: 'Operator', actorId: 'qa', resolved: false, createdAt: serverTimestamp() }));
  await assertFails(setDoc(event, { department: 'thermal', type: 'other', severity: 'info', notes: 'Event', operator: 'Operator', actorId: 'operator', resolved: false, createdAt: serverTimestamp() }));
  await assertFails(updateDoc(event, { notes: 'Rewritten history' }));
  await assertFails(deleteDoc(event));
});

test('RTC, Thermal, Chill, QA, and Packaging direct client bypasses all fail', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'prep_queue', 'prep-1'), { stage: 'rtc', status: 'staged', productId: 'p' });
    await setDoc(doc(adminDb, 'chill_logs', 'chill-1'), { prepId: 'prep-1', status: 'waiting', createdAt: new Date() });
    await setDoc(doc(adminDb, 'qa_checks', 'qa-2'), { prepId: 'prep-1', status: 'ready_for_qa', timestamp: new Date() });
    await setDoc(doc(adminDb, 'packaging_logs', 'pack-3'), { prepId: 'prep-1', qaCheckId: 'qa-2', status: 'running', startedAt: new Date() });
  });
  await assertFails(updateDoc(doc(db('operator'), 'prep_queue', 'prep-1'), { stage: 'thermal', status: 'ready_for_thermal' }));
  await assertFails(updateDoc(doc(db('operator'), 'prep_queue', 'prep-1'), { stage: 'thermal', status: 'cooking' }));
  await assertFails(updateDoc(doc(db('operator'), 'chill_logs', 'chill-1'), { status: 'running', chillerId: 'C-1' }));
  await assertFails(updateDoc(doc(db('qa'), 'qa_checks', 'qa-2'), { status: 'ready_for_packaging' }));
  await assertFails(updateDoc(doc(db('packaging'), 'packaging_logs', 'pack-3'), { status: 'complete', completedAt: serverTimestamp() }));
});
