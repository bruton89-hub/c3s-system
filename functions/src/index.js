'use strict';

const { initializeApp } = require('firebase-admin/app');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { ACTIVE_ROLES, HOLD_RESOLVERS, assertAuthenticated, assertRole, validateTransition, destinationStage, validateRequestId, receiptId, isStale, buildEquipmentAssignmentPlan } = require('./contracts');
const { executeProductionAction } = require('./production-actions');

initializeApp();
const db = getFirestore();

function failure(error, action, uid, itemId) {
  const category = error?.category || 'internal';
  logger.warn('c3s_secure_action', { uid, action, itemId, result: 'rejected', errorCategory: category });
  const details = { category };
  if (category === 'authentication') throw new HttpsError('unauthenticated', 'Sign in is required.', details);
  if (category === 'permission') throw new HttpsError('permission-denied', error.message, details);
  if (category === 'stale') throw new HttpsError('aborted', 'Production state changed. Refresh and try again.', details);
  if (category === 'invalid' || category === 'invalid-transition') throw new HttpsError('failed-precondition', error.message, details);
  if (category === 'validation') throw new HttpsError('invalid-argument', error.message, details);
  if (category === 'equipment-conflict') throw new HttpsError('already-exists', error.message, details);
  throw new HttpsError('internal', 'The secure production action could not be completed.', details);
}

async function actorFor(request, roles = ACTIVE_ROLES) {
  try { assertAuthenticated(request.auth); } catch { throw new HttpsError('unauthenticated', 'Sign in is required.'); }
  const profileSnap = await db.doc(`users/${request.auth.uid}`).get();
  const profile = profileSnap.exists ? profileSnap.data() : null;
  if (!profile || profile.active !== true) {
    logger.warn('c3s_secure_action', { uid: request.auth.uid, action: 'authorize', itemId: null, result: 'rejected', errorCategory: 'inactive-user' });
    throw new HttpsError('permission-denied', 'An active production profile is required.', { category: 'inactive-user' });
  }
  try { assertRole(profile, roles); } catch (error) { failure(error, 'authorize', request.auth.uid, null); }
  return { uid: request.auth.uid, role: profile.role, name: profile.name || profile.role };
}

function requireInput(data) {
  if (!data || typeof data.itemId !== 'string' || !data.itemId || !validateRequestId(data.requestId)) throw Object.assign(new Error('Valid item and request identity are required.'), { category: 'invalid' });
}

/**
 * Shared authoritative boundary for RTC, Thermal, Chill, QA, and Packaging.
 * The client submits intent and an expected canonical version; this service
 * owns validation, related-document writes, audit, and idempotency.
 */
exports.executeProductionAction = onCall(async (request) => {
  const actor = await actorFor(request);
  const data = request.data;
  try {
    const result = await executeProductionAction({ db, actor, input: data });
    logger.info('c3s_secure_action', { uid: actor.uid, action: data?.action, itemId: data?.itemId || null, result: 'success' });
    return result;
  } catch (error) {
    failure(error, data?.action || 'executeProductionAction', actor.uid, data?.itemId || null);
  }
});

exports.transitionProductionItem = onCall(async (request) => {
  const actor = await actorFor(request); const data = request.data;
  try { requireInput(data); } catch (error) { failure(error, 'transitionProductionItem', actor.uid, data?.itemId); }
  const itemRef = db.doc(`operational_items/${data.itemId}`); const receiptRef = db.doc(`mutation_receipts/${receiptId(actor.uid, data.requestId)}`);
  try {
    const result = await db.runTransaction(async (transaction) => {
      const [receipt, itemSnap] = await Promise.all([transaction.get(receiptRef), transaction.get(itemRef)]);
      if (receipt.exists) return receipt.data().result;
      if (!itemSnap.exists) throw Object.assign(new Error('Production item not found.'), { category: 'invalid' });
      const item = itemSnap.data(); if (isStale(item, data)) throw Object.assign(new Error('Stale state.'), { category: 'stale' });
      if (item.status === 'hold' || !validateTransition(item.status, data.toStatus)) throw Object.assign(new Error('This transition is not valid for the current production state.'), { category: 'invalid' });
      const nextStage = destinationStage(data.toStatus); const at = Timestamp.now();
      const transition = { from: { stage: item.stage, status: item.status }, to: { stage: nextStage, status: data.toStatus }, by: actor.uid, at, reason: 'Secure production transition' };
      const canonical = { id: data.itemId, stage: nextStage, status: data.toStatus, updatedAt: at };
      transaction.update(itemRef, { stage: nextStage, status: data.toStatus, updatedAt: at, version: (item.version || 0) + 1, transitions: FieldValue.arrayUnion(transition) });
      transaction.create(db.collection('operational_events').doc(), { department: nextStage, prepId: item.prepQueueId || null, type: 'other', severity: 'info', notes: `Production state changed to ${data.toStatus}.`, operator: actor.name, actorId: actor.uid, action: 'transitionProductionItem', createdAt: at, resolved: false });
      transaction.create(receiptRef, { uid: actor.uid, action: 'transitionProductionItem', itemId: data.itemId, requestId: data.requestId, createdAt: at, result: canonical });
      return canonical;
    });
    logger.info('c3s_secure_action', { uid: actor.uid, action: 'transitionProductionItem', itemId: data.itemId, result: 'success' }); return { item: result };
  } catch (error) { failure(error, 'transitionProductionItem', actor.uid, data.itemId); }
});

exports.placeFormalHold = onCall(async (request) => {
  const actor = await actorFor(request); const data = request.data;
  try { requireInput(data); if (typeof data.reasonKey !== 'string' || typeof data.reasonLabel !== 'string') throw Object.assign(new Error('A hold reason is required.'), { category: 'invalid' }); } catch (error) { failure(error, 'placeFormalHold', actor.uid, data?.itemId); }
  const itemRef = db.doc(`operational_items/${data.itemId}`); const receiptRef = db.doc(`mutation_receipts/${receiptId(actor.uid, data.requestId)}`);
  try {
    const result = await db.runTransaction(async (transaction) => {
      const [receipt, snap] = await Promise.all([transaction.get(receiptRef), transaction.get(itemRef)]); if (receipt.exists) return receipt.data().result;
      if (!snap.exists) throw Object.assign(new Error('Production item not found.'), { category: 'invalid' }); const item = snap.data(); if (item.status === 'hold') throw Object.assign(new Error('This item is already on hold.'), { category: 'invalid' });
      const at = Timestamp.now(); const hold = { reasonKey: data.reasonKey, reasonLabel: data.reasonLabel, notes: typeof data.notes === 'string' ? data.notes.trim().slice(0, 500) || null : null, placedBy: actor.uid, placedByName: actor.name, placedAt: at, previousStage: item.stage, previousStatus: item.status };
      transaction.update(itemRef, { status: 'hold', activeHold: hold, updatedAt: at, version: (item.version || 0) + 1 });
      if (item.prepQueueId) transaction.update(db.doc(`prep_queue/${item.prepQueueId}`), { status: 'hold', holdReason: data.reasonLabel });
      transaction.create(db.collection('hold_events').doc(), { itemId: data.itemId, action: 'placed', actorId: actor.uid, actorName: actor.name, at, reasonKey: data.reasonKey, reasonLabel: data.reasonLabel, notes: hold.notes });
      const result = { id: data.itemId, stage: item.stage, status: 'hold', updatedAt: at }; transaction.create(receiptRef, { uid: actor.uid, action: 'placeFormalHold', itemId: data.itemId, requestId: data.requestId, createdAt: at, result }); return result;
    }); return { item: result };
  } catch (error) { failure(error, 'placeFormalHold', actor.uid, data.itemId); }
});

exports.resolveFormalHold = onCall(async (request) => {
  const actor = await actorFor(request, HOLD_RESOLVERS); const data = request.data;
  try { requireInput(data); if (data.outcome !== 'released_to_production' || typeof data.explanation !== 'string' || !data.explanation.trim()) throw Object.assign(new Error('A supported outcome and explanation are required.'), { category: 'invalid' }); } catch (error) { failure(error, 'resolveFormalHold', actor.uid, data?.itemId); }
  const itemRef = db.doc(`operational_items/${data.itemId}`); const receiptRef = db.doc(`mutation_receipts/${receiptId(actor.uid, data.requestId)}`);
  try {
    const result = await db.runTransaction(async (transaction) => {
      const [receipt, snap] = await Promise.all([transaction.get(receiptRef), transaction.get(itemRef)]); if (receipt.exists) return receipt.data().result;
      if (!snap.exists) throw Object.assign(new Error('Production item not found.'), { category: 'invalid' }); const item = snap.data(); if (item.status !== 'hold' || !item.activeHold) throw Object.assign(new Error('This hold is no longer active.'), { category: 'stale' });
      const at = Timestamp.now(); const stage = item.activeHold.previousStage; const status = item.activeHold.previousStatus; const result = { id: data.itemId, stage, status, updatedAt: at };
      transaction.update(itemRef, { stage, status, activeHold: null, updatedAt: at, version: (item.version || 0) + 1 });
      if (item.prepQueueId) transaction.update(db.doc(`prep_queue/${item.prepQueueId}`), { stage, status, holdReason: '' });
      for (const action of ['reviewed', 'released']) transaction.create(db.collection('hold_events').doc(), { itemId: data.itemId, action, actorId: actor.uid, actorName: actor.name, at, notes: data.explanation.trim().slice(0, 500), outcome: data.outcome });
      transaction.create(receiptRef, { uid: actor.uid, action: 'resolveFormalHold', itemId: data.itemId, requestId: data.requestId, createdAt: at, result }); return result;
    }); return { item: result };
  } catch (error) { failure(error, 'resolveFormalHold', actor.uid, data.itemId); }
});

exports.assignEquipment = onCall(async (request) => {
  const actor = await actorFor(request, ['operator', 'supervisor', 'admin']); const data = request.data;
  try { requireInput(data); if (!['oven', 'chiller'].includes(data.equipmentKind) || typeof data.equipmentId !== 'string' || !data.equipmentId) throw Object.assign(new Error('Valid equipment is required.'), { category: 'invalid' }); } catch (error) { failure(error, 'assignEquipment', actor.uid, data?.itemId); }
  const itemRef=db.doc(`operational_items/${data.itemId}`); const collection=data.equipmentKind==='oven'?'smokehouses':'chillers'; const equipmentRef=db.doc(`${collection}/${data.equipmentId}`); const receiptRef=db.doc(`mutation_receipts/${receiptId(actor.uid,data.requestId)}`);
  try {
    const result=await db.runTransaction(async(transaction)=>{
      const [receipt,itemSnap,equipmentSnap]=await Promise.all([transaction.get(receiptRef),transaction.get(itemRef),transaction.get(equipmentRef)]); if(receipt.exists)return receipt.data().result;
      if(!itemSnap.exists||!equipmentSnap.exists)throw Object.assign(new Error('Production item or equipment not found.'),{category:'invalid'});
      const item=itemSnap.data(); const plan=buildEquipmentAssignmentPlan(item,equipmentSnap.data(),data,actor,Timestamp.now());
      transaction.update(itemRef,plan.item); transaction.update(equipmentRef,plan.equipment);
      if(data.equipmentKind==='oven'&&item.prepQueueId)transaction.update(db.doc(`prep_queue/${item.prepQueueId}`),{assignedSmokehouse:data.equipmentId,status:'assigned'});
      if(data.equipmentKind==='chiller'&&item.chillLogId)transaction.update(db.doc(`chill_logs/${item.chillLogId}`),{chillerId:data.equipmentId,status:'running'});
      transaction.create(db.collection('operational_events').doc(),{department:item.stage,prepId:item.prepQueueId||null,chillLogId:item.chillLogId||null,type:'other',severity:'info',notes:`Assigned ${data.equipmentKind} ${data.equipmentId}.`,operator:actor.name,actorId:actor.uid,action:'assignEquipment',createdAt:plan.item.updatedAt,resolved:false});
      const canonical={id:data.itemId,...plan.item}; transaction.create(receiptRef,{uid:actor.uid,action:'assignEquipment',itemId:data.itemId,requestId:data.requestId,createdAt:plan.item.updatedAt,result:canonical}); return canonical;
    }); return {item:result};
  }catch(error){failure(error,'assignEquipment',actor.uid,data.itemId);}
});
