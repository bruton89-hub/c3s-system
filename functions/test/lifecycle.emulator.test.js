'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { executeProductionAction } = require('../src/production-actions');

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const actor = { uid: 'operator-1', role: 'operator', name: 'Operator One' };
const qa = { uid: 'qa-1', role: 'qa', name: 'QA One' };
const packager = { uid: 'pack-1', role: 'packaging', name: 'Packaging One' };

function requestId(label) { return `${label}_${Math.random().toString(36).slice(2, 12)}`; }

test('authoritative lifecycle is atomic, idempotent, hold-aware, and concurrency-safe', { skip: !enabled }, async () => {
  if (!getApps().length) initializeApp({ projectId: 'c3s-preview-rules-test' });
  const db = getFirestore();
  for (const collection of await db.listCollections()) {
    const snapshot = await collection.get();
    await Promise.all(snapshot.docs.map((entry) => entry.ref.delete()));
  }
  await db.doc('weekly_plan/plan-1').set({ productId: 'product-1', productName: 'Lifecycle Product', productCodeSnapshot: 'LP', processOrder: 'B-7001', plannedDate: '2026-08-10', plannedRacks: 4, plannedPieces: 80, status: 'planned', createdBy: 'planner', targetTemp: 160 });
  await db.doc('smokehouses/oven-g').set({ name: 'Oven G', status: 'idle', currentLoadId: null });
  await db.doc('chillers/chiller-10').set({ name: 'Chiller 10', status: 'idle', currentLoadId: null, capacity: 10 });

  const sent = await executeProductionAction({ db, actor, input: { action: 'rtc_send_to_queue', planId: 'plan-1', requestId: requestId('send') } });
  const itemId = sent.oItemId; assert.ok(itemId); assert.ok(sent.prepId);

  async function state() { const snapshot = await db.doc(`operational_items/${itemId}`).get(); return snapshot.data(); }
  async function act(action, payload = {}, actionActor = actor, id = requestId(action)) {
    const current = await state();
    return executeProductionAction({ db, actor: actionActor, input: { action, itemId, expectedStage: current.stage, expectedStatus: current.status, expectedUpdatedAt: current.updatedAt.toMillis(), payload, requestId: id } });
  }

  await act('rtc_advance', { toStatus: 'prepping', stagingLocation: 'RTC Bay 2' });
  await act('rtc_advance', { toStatus: 'ready_for_thermal' });
  await act('assign_oven', { equipmentId: 'oven-g' });

  const assigned = await state();
  const base = { action: 'start_cook', itemId, expectedStage: assigned.stage, expectedStatus: assigned.status, expectedUpdatedAt: assigned.updatedAt.toMillis(), payload: { equipmentId: 'oven-g', startingTemp: 72 } };
  const startA = { ...base, requestId: requestId('start-a') }; const startB = { ...base, requestId: requestId('start-b') };
  const starts = await Promise.allSettled([executeProductionAction({ db, actor, input: startA }), executeProductionAction({ db, actor, input: startB })]);
  assert.equal(starts.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(starts.filter((entry) => entry.status === 'rejected').length, 1);
  const winner = starts.find((entry) => entry.status === 'fulfilled').value;
  const winningInput = starts[0].status === 'fulfilled' ? startA : startB;
  const replay = await executeProductionAction({ db, actor, input: winningInput });
  assert.equal(replay.item.status, winner.item.status); assert.equal(replay.idempotentReplay, true);

  const cooking = await state();
  await db.doc(`operational_items/${itemId}`).update({ status: 'hold', activeHold: { previousStage: cooking.stage, previousStatus: cooking.status }, version: cooking.version + 1, updatedAt: Timestamp.now() });
  await assert.rejects(executeProductionAction({ db, actor, input: { action: 'record_thermal_check', itemId, expectedStage: cooking.stage, expectedStatus: cooking.status, expectedUpdatedAt: cooking.updatedAt.toMillis(), payload: { kind: 'cut_50', observedTemp: 50 }, requestId: requestId('stale-before-hold') } }), (error) => error.category === 'stale');
  const held = await state();
  await db.doc(`operational_items/${itemId}`).update({ stage: held.activeHold.previousStage, status: held.activeHold.previousStatus, activeHold: null, version: held.version + 1, updatedAt: Timestamp.now() });
  await assert.rejects(executeProductionAction({ db, actor, input: { action: 'record_thermal_check', itemId, expectedStage: cooking.stage, expectedStatus: cooking.status, expectedUpdatedAt: cooking.updatedAt.toMillis(), payload: { kind: 'cut_50', observedTemp: 50 }, requestId: requestId('stale-after-release') } }), (error) => error.category === 'stale');

  await act('record_thermal_check', { kind: 'cut_50', observedTemp: 50 });
  await act('record_thermal_check', { kind: 'cut_130', observedTemp: 130 });
  await act('record_thermal_check', { kind: 'critical_temp', value: 165, probeTemps: [165, 166] });
  await act('record_thermal_check', { kind: 'duration', required: false });
  await act('finish_thermal', { method: 'dry_vac' });
  await act('assign_chiller', { equipmentId: 'chiller-10' });
  await act('record_chill_check', { timeTo50F: 70, timeTo40F: 300 });
  await act('complete_chill', { signedOutTemp: 38 });
  await act('qa_review', { decision: 'approve_for_packaging', notes: 'Checks reviewed.' }, qa);
  await act('start_packaging', {}, packager);
  await act('complete_packaging', { casesProduced: 20, unitsProduced: 200, yieldPercent: 98, packagingLine: 'Line 1', notes: 'Complete' }, packager);

  const completed = await state(); assert.equal(completed.stage, 'complete'); assert.equal(completed.status, 'complete');
  assert.equal((await db.doc('smokehouses/oven-g').get()).data().status, 'idle');
  assert.equal((await db.doc('chillers/chiller-10').get()).data().status, 'idle');
  const audits = await db.collection('operational_events').where('itemId', '==', itemId).get();
  assert.ok(audits.size >= 15); assert.ok(audits.docs.every((entry) => entry.data().actorUid && entry.data().serverTimestamp && entry.data().requestId));
  const startAudits = audits.docs.filter((entry) => entry.data().action === 'start_cook'); assert.equal(startAudits.length, 1);
});
