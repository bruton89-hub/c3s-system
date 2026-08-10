'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { destinationStage, isStale, receiptId, validateRequestId } = require('./contracts');

const ACTION_ROLES = Object.freeze({
  rtc_send_to_queue: ['operator', 'supervisor', 'admin'],
  rtc_create_manual: ['operator', 'supervisor', 'admin'],
  rtc_advance: ['operator', 'supervisor', 'admin'],
  assign_oven: ['operator', 'supervisor', 'admin'],
  allocate_oven_load: ['operator', 'supervisor', 'admin'],
  verify_load: ['operator', 'supervisor', 'admin'],
  start_cook: ['operator', 'supervisor', 'admin'],
  record_thermal_check: ['operator', 'supervisor', 'qa', 'admin'],
  finish_thermal: ['operator', 'supervisor', 'admin'],
  assign_chiller: ['operator', 'supervisor', 'admin'],
  record_chill_check: ['operator', 'supervisor', 'qa', 'admin'],
  complete_chill: ['operator', 'supervisor', 'qa', 'admin'],
  qa_review: ['qa', 'supervisor', 'admin'],
  qa_resubmit: ['qa', 'supervisor', 'admin'],
  start_packaging: ['packaging', 'supervisor', 'admin'],
  complete_packaging: ['packaging', 'supervisor', 'admin'],
  complete_batch: ['packaging', 'supervisor', 'admin'],
});
const RESOLVED_ALERT_KEYS = Object.freeze({
  record_thermal_check: ['thermal-check-overdue', 'required-action-overdue'],
  finish_thermal: ['thermal-check-overdue', 'thermal-completion-overdue'],
  assign_chiller: ['waiting-for-chiller', 'no-chiller-capacity'],
  record_chill_check: ['chill-check-overdue'],
  complete_chill: ['chill-check-overdue', 'chill-overdue'],
  qa_review: ['qa-review-required'],
  complete_packaging: ['packaging-delay'],
});

function actionError(category, message) { throw Object.assign(new Error(message), { category }); }
function cleanString(value, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function requirePayload(condition, message) { if (!condition) actionError('validation', message); }
function assertExpected(item, input) { if (isStale(item, input)) actionError('stale', 'Production state changed. Refresh and try again.'); }
function assertStage(item, stage, statuses) {
  if (item.status === 'hold') actionError('invalid-transition', 'This production item is on hold. Resolve the hold before continuing.');
  if (item.stage !== stage || !statuses.includes(item.status)) actionError('invalid-transition', 'This action is not valid for the current production stage.');
}
function assertRole(actor, action) {
  const roles = ACTION_ROLES[action];
  if (!roles) actionError('validation', 'Unknown production action.');
  if (!roles.includes(actor.role)) actionError('permission', 'Your role cannot perform this action.');
}
function transition(item, status, actor, at, reason) {
  const stage = destinationStage(status) || item.stage;
  return {
    stage, status, updatedAt: at, version: (item.version || 0) + 1,
    transitions: FieldValue.arrayUnion({ from: { stage: item.stage, status: item.status }, to: { stage, status }, by: actor.uid, at, reason }),
  };
}
function audit(db, transaction, itemId, item, actor, action, previousState, resultingState, requestId, at) {
  transaction.create(db.collection('operational_events').doc(), {
    actorUid: actor.uid, actorRole: actor.role, actorId: actor.uid, operator: actor.name,
    action, itemId, batchId: item.processOrder || item.poNumber || null,
    previousState, resultingState, requestId, serverTimestamp: at, createdAt: at,
    department: resultingState.stage, prepId: item.prepQueueId || null,
    type: 'other', severity: 'info', notes: `${action.replaceAll('_', ' ')} completed.`, resolved: false,
  });
}
function resultFor(itemId, update) { return { id: itemId, stage: update.stage, status: update.status, updatedAt: update.updatedAt, version: update.version }; }
async function equipmentByIdOrName(db, transaction, collectionName, identity) {
  const directRef = db.doc(`${collectionName}/${identity}`); const direct = await transaction.get(directRef);
  if (direct.exists) return { ref: directRef, data: direct.data() };
  const matches = await transaction.get(db.collection(collectionName).where('name', '==', identity).limit(1));
  if (matches.empty) return null;
  return { ref: matches.docs[0].ref, data: matches.docs[0].data() };
}
function planPrep(plan, at, actor) {
  return {
    productId: plan.productId || '', productName: plan.productName || '', productNameSnapshot: plan.productName || '',
    productCodeSnapshot: plan.productCodeSnapshot || null, productCode: plan.productCodeSnapshot || null,
    processOrder: plan.processOrder || '', cases: plan.cases || 0, racks: plan.plannedRacks || 0, pieces: plan.plannedPieces || 0,
    poNumber: plan.processOrder || '', deliveryDate: plan.plannedDate || '', makeDate: plan.plannedDate || '', plannedDate: plan.plannedDate || '',
    department: plan.productionSection || 'process_meats', targetSmokehouseId: plan.assignedSmokehouse || null,
    targetChillerId: plan.assignedChiller || null, status: 'staged', stage: 'rtc', startTime: at,
    createdBy: actor.uid, assignedSmokehouse: plan.assignedSmokehouse || null, cookType: plan.processType || 'unspecified',
    targetTemp: plan.targetTemp || 0, expectedCookMinutes: Math.round((plan.estimatedCookTimeHours || 0) * 60),
    expectedChillMinutes: Math.round((plan.estimatedChillTimeHours || 0) * 60), expectedPackMinutes: 30,
    rackType: plan.rackType || 'Standard', species: plan.species || 'unknown', packagingType: plan.packagingType || 'Standard',
    thermalOwner: '', criticalLimit: plan.criticalLimit || null, sourcePlanId: plan.id,
  };
}
function canonicalFromPrep(prep, planId, prepId, at) {
  return { ...prep, weeklyPlanId: planId, prepQueueId: prepId, sourcePlanId: planId, transitions: [], createdAt: at, updatedAt: at, version: 1 };
}

async function executeProductionAction({ db, actor, input }) {
  requirePayload(input && ACTION_ROLES[input.action], 'A supported production action is required.');
  requirePayload(validateRequestId(input.requestId), 'A valid request identity is required.');
  assertRole(actor, input.action);
  const identity = input.itemId || input.planId;
  requirePayload(typeof identity === 'string' && identity, 'A production item is required.');

  const receiptRef = db.doc(`mutation_receipts/${receiptId(actor.uid, input.requestId)}`);
  const createsRtc = input.action === 'rtc_send_to_queue' || input.action === 'rtc_create_manual';
  const generatedPrepRef = createsRtc ? db.collection('prep_queue').doc() : null;
  const generatedItemRef = createsRtc ? db.collection('operational_items').doc() : null;

  return db.runTransaction(async (transaction) => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) return { ...receipt.data().result, idempotentReplay: true };
    const at = Timestamp.now();

    if (input.action === 'rtc_send_to_queue') {
      const planRef = db.doc(`weekly_plan/${input.planId}`); const planSnap = await transaction.get(planRef);
      if (!planSnap.exists) actionError('validation', 'Planning row not found.');
      const plan = { id: planSnap.id, ...planSnap.data() };
      if (plan.linkedPrepQueueId || plan.rtcPrepId) actionError('stale', 'This planning row has already been sent to RTC.');
      const prep = planPrep(plan, at, actor); const item = canonicalFromPrep(prep, input.planId, generatedPrepRef.id, at);
      transaction.create(generatedPrepRef, prep); transaction.create(generatedItemRef, item);
      transaction.update(planRef, { status: 'RTC', boardStatus: 'rtc', linkedPrepQueueId: generatedPrepRef.id, rtcPrepId: generatedPrepRef.id });
      const result = { item: { id: generatedItemRef.id, stage: 'rtc', status: 'staged', updatedAt: at, version: 1 }, prepId: generatedPrepRef.id, oItemId: generatedItemRef.id };
      audit(db, transaction, generatedItemRef.id, item, actor, input.action, { stage: 'planning', status: plan.status || 'planned' }, { stage: 'rtc', status: 'staged' }, input.requestId, at);
      transaction.create(receiptRef, { uid: actor.uid, action: input.action, itemId: generatedItemRef.id, requestId: input.requestId, createdAt: at, result });
      return result;
    }

    if (input.action === 'rtc_create_manual') {
      const payload = input.payload || {};
      requirePayload(cleanString(payload.productId, 120) && cleanString(payload.productName, 200), 'A configured product is required.');
      requirePayload(cleanString(payload.poNumber, 120) && cleanString(payload.makeDate, 40) && cleanString(payload.deliveryDate, 40), 'PO, make date, and delivery date are required.');
      requirePayload(finite(payload.racks) && payload.racks > 0 && finite(payload.pieces) && payload.pieces > 0, 'Racks and pieces must be greater than zero.');
      const prep = { ...payload, productId: cleanString(payload.productId, 120), productName: cleanString(payload.productName, 200), productNameSnapshot: cleanString(payload.productName, 200), productCode: cleanString(payload.productCode, 80) || null, productCodeSnapshot: cleanString(payload.productCode, 80) || null, poNumber: cleanString(payload.poNumber, 120), processOrder: cleanString(payload.poNumber, 120), makeDate: cleanString(payload.makeDate, 40), deliveryDate: cleanString(payload.deliveryDate, 40), plannedDate: cleanString(payload.makeDate, 40), status: 'staged', stage: 'rtc', startTime: at, createdBy: actor.uid, assignedSmokehouse: null };
      const item = canonicalFromPrep(prep, null, generatedPrepRef.id, at);
      transaction.create(generatedPrepRef, prep); transaction.create(generatedItemRef, item);
      const result = { item: { id: generatedItemRef.id, stage: 'rtc', status: 'staged', updatedAt: at, version: 1 }, prepId: generatedPrepRef.id, oItemId: generatedItemRef.id };
      audit(db, transaction, generatedItemRef.id, item, actor, input.action, { stage: 'planning', status: 'manual_entry' }, { stage: 'rtc', status: 'staged' }, input.requestId, at);
      transaction.create(receiptRef, { uid: actor.uid, action: input.action, itemId: generatedItemRef.id, requestId: input.requestId, createdAt: at, result });
      return result;
    }

    const itemRef = db.doc(`operational_items/${input.itemId}`); const itemSnap = await transaction.get(itemRef);
    if (!itemSnap.exists) actionError('validation', 'Production item not found.');
    const item = itemSnap.data(); assertExpected(item, input);
    const previousState = { stage: item.stage, status: item.status, version: item.version || 0 };
    const prepRef = item.prepQueueId ? db.doc(`prep_queue/${item.prepQueueId}`) : null;
    const prepSnap = prepRef ? await transaction.get(prepRef) : null;
    const prep = prepSnap?.exists ? prepSnap.data() : null;
    const alertKeys = RESOLVED_ALERT_KEYS[input.action] || [];
    const alertSnaps = alertKeys.length ? await transaction.get(db.collection('alerts').where('itemId', '==', input.itemId)) : null;
    let update = null; const payload = input.payload || {};

    if (input.action === 'rtc_advance') {
      assertStage(item, 'rtc', ['staging', 'staged', 'prepping', 'ready']);
      requirePayload(['prepping', 'ready_for_thermal'].includes(payload.toStatus), 'Unsupported RTC handoff state.');
      if (payload.toStatus === 'ready_for_thermal' && !['prepping', 'ready', 'staged'].includes(item.status)) actionError('invalid-transition', 'RTC preparation is not ready for Thermal handoff.');
      update = transition(item, payload.toStatus, actor, at, 'RTC handoff');
      if (prepRef) transaction.update(prepRef, { stage: update.stage, status: update.status, ...(payload.stagingLocation ? { stagingLocation: cleanString(payload.stagingLocation, 120) } : {}), ...(payload.toStatus === 'ready_for_thermal' ? { readyForThermalAt: at } : { prepStartedAt: at }) });
    } else if (input.action === 'allocate_oven_load') {
      assertStage(item, 'thermal', ['ready_for_thermal']);
      requirePayload(cleanString(payload.equipmentId, 120), 'An oven is required.');
      const found = await equipmentByIdOrName(db, transaction, 'smokehouses', payload.equipmentId);
      if (!found) actionError('equipment-conflict', 'Selected oven does not exist.');
      const equipment = found.data;
      if (equipment.status === 'cleaning' || equipment.status === 'unavailable' || equipment.currentLoadId) actionError('equipment-conflict', 'Selected oven is not available.');
      const conflicts = await transaction.get(db.collection('operational_items').where('assignedSmokehouse', '==', equipment.name || payload.equipmentId).where('stage', '==', 'thermal'));
      if (conflicts.docs.some((entry) => entry.id !== input.itemId && ['assigned', 'cooking'].includes(entry.data().status))) actionError('equipment-conflict', 'Selected oven already has an active load.');
      const children = await transaction.get(db.collection('operational_items').where('parentLoadId', '==', input.itemId));
      const capacity = payload.setupType === 'tree' ? 12 : 18;
      const original = item.originalRackCount || item.racks || 0; const allocated = item.allocatedRackCount || 0;
      const remaining = item.remainingRackCount ?? Math.max(0, original - allocated);
      requirePayload(remaining > 0, 'No racks remain to allocate.');
      const assigned = Math.min(remaining, capacity); const nextRemaining = remaining - assigned;
      const childPrepRef = db.collection('prep_queue').doc(); const childRef = db.collection('operational_items').doc();
      const equipmentName = equipment.name || payload.equipmentId; const splitIndex = children.size + 1; const splitCount = Math.ceil(original / capacity);
      const childPrep = { ...(prep || {}), racks: assigned, status: 'assigned', stage: 'thermal', assignedSmokehouse: equipmentName, targetSmokehouseId: equipmentName, startTime: at, sourcePlanId: item.sourcePlanId || item.weeklyPlanId || null, createdBy: actor.uid };
      const child = { ...item, racks: assigned, stage: 'thermal', status: 'assigned', transitions: [], createdAt: at, updatedAt: at, version: 1, prepQueueId: childPrepRef.id, chillLogId: null, qaCheckId: null, packagingLogId: null, parentLoadId: input.itemId, splitLoadIndex: splitIndex, splitLoadCount: splitCount, assignedRackCount: assigned, originalRackCount: original, remainingRackCount: 0, allocatedRackCount: assigned, assignedSmokehouse: equipmentName, activeHold: null };
      transaction.create(childPrepRef, childPrep); transaction.create(childRef, child); transaction.update(found.ref, { currentLoadId: childPrepRef.id });
      update = nextRemaining === 0
        ? { ...transition(item, 'split_parent', actor, at, 'Thermal load fully allocated'), originalRackCount: original, allocatedRackCount: allocated + assigned, remainingRackCount: 0, targetSmokehouseId: equipmentName }
        : { stage: item.stage, status: item.status, updatedAt: at, version: (item.version || 0) + 1, originalRackCount: original, allocatedRackCount: allocated + assigned, remainingRackCount: nextRemaining, targetSmokehouseId: equipmentName };
      payload.result = { childId: childRef.id, assignedRackCount: assigned, remainingRackCount: nextRemaining, capacity };
    } else if (input.action === 'assign_oven') {
      assertStage(item, 'thermal', ['ready_for_thermal', 'ready', 'in_thermal', 'moved_downstream']);
      requirePayload(cleanString(payload.equipmentId, 120), 'An oven is required.');
      const found = await equipmentByIdOrName(db, transaction, 'smokehouses', payload.equipmentId);
      if (!found) actionError('equipment-conflict', 'Selected oven does not exist.');
      const equipmentRef = found.ref; const equipment = found.data;
      if (equipment.status === 'cleaning' || equipment.status === 'unavailable' || (equipment.currentLoadId && equipment.currentLoadId !== item.prepQueueId && equipment.currentLoadId !== input.itemId)) actionError('equipment-conflict', 'Selected oven is not available.');
      update = { ...transition(item, 'assigned', actor, at, 'Oven assigned'), assignedSmokehouse: equipment.name || payload.equipmentId };
      transaction.update(equipmentRef, { currentLoadId: item.prepQueueId || input.itemId });
      if (prepRef) transaction.update(prepRef, { stage: 'thermal', status: 'assigned', assignedSmokehouse: update.assignedSmokehouse });
    } else if (input.action === 'verify_load') {
      assertStage(item, 'thermal', ['assigned']); requirePayload(cleanString(payload.verifiedBy, 120), 'Verified-by is required.');
      update = { stage: item.stage, status: item.status, updatedAt: at, version: (item.version || 0) + 1, loadedVerified: true, loadedVerifiedBy: actor.uid, loadedVerifiedAt: at };
      if (prepRef) transaction.update(prepRef, { loadedVerified: true, loadedVerifiedBy: actor.uid, loadedVerifiedAt: at });
    } else if (input.action === 'start_cook') {
      assertStage(item, 'thermal', ['assigned']); requirePayload(item.assignedSmokehouse, 'An oven assignment is required.');
      const equipmentId = payload.equipmentId || item.assignedSmokehouse; const found = await equipmentByIdOrName(db, transaction, 'smokehouses', equipmentId);
      if (!found) actionError('equipment-conflict', 'Assigned oven does not exist.');
      const equipmentRef = found.ref; const equipment = found.data;
      if (equipment.status === 'cleaning' || equipment.status === 'unavailable' || (equipment.currentLoadId && ![item.prepQueueId, input.itemId].includes(equipment.currentLoadId))) actionError('equipment-conflict', 'Assigned oven has a conflicting load.');
      update = { ...transition(item, 'cooking', actor, at, 'Cook started'), cookStartedAt: at, ...(finite(payload.startingTemp) ? { startingTemp: payload.startingTemp } : {}), ...(finite(payload.startingProductTemp) ? { startingProductTemp: payload.startingProductTemp } : {}) };
      transaction.update(equipmentRef, { status: 'cooking', currentLoadId: item.prepQueueId || input.itemId });
      if (prepRef) transaction.update(prepRef, { status: 'cooking', stage: 'thermal', cookStartedAt: at, ...(finite(payload.startingTemp) ? { startingTemp: payload.startingTemp } : {}), ...(finite(payload.startingProductTemp) ? { startingProductTemp: payload.startingProductTemp } : {}) });
    } else if (input.action === 'record_thermal_check') {
      assertStage(item, 'thermal', ['assigned', 'cooking']); const kind = payload.kind;
      const fields = { updatedAt: at, version: (item.version || 0) + 1 }; let check = {};
      if (kind === 'cut_50') { requirePayload(item.status === 'cooking' && !item.cut50At, '50°F cut is not currently recordable.'); check = { cut50At: at, ...(finite(payload.observedTemp) ? { cut50ObservedTemp: payload.observedTemp } : {}) }; }
      else if (kind === 'cut_130') { requirePayload(item.status === 'cooking' && item.cut50At && !item.cut130At, '130°F cut requires an uncompleted 50°F cut.'); const cut50Millis = item.cut50At?.toMillis?.(); requirePayload(Number.isFinite(cut50Millis), 'The recorded 50°F cut timestamp is invalid.'); if ((at.toMillis() - cut50Millis) > 6 * 60 * 60 * 1000 && !payload.deviation) actionError('validation', 'The configured six-hour window was exceeded. Escalate to a supervisor.'); check = { cut130At: at, ...(finite(payload.observedTemp) ? { cut130ObservedTemp: payload.observedTemp } : {}) }; }
      else if (kind === 'critical_temp') { requirePayload(item.status === 'cooking' && item.cut130At && !item.criticalTempReachedAt && finite(payload.value) && payload.value > 0, 'A valid critical-temperature check is required.'); if ((item.targetTemp || 0) > payload.value && !payload.deviation) actionError('validation', 'Recorded temperature is below the configured target.'); requirePayload(!payload.probeTemps || Array.isArray(payload.probeTemps) && payload.probeTemps.length > 0 && payload.probeTemps.every(finite), 'Probe temperatures must be finite values.'); check = { criticalTempReachedAt: at, criticalTempValue: payload.value, criticalTempVerifiedBy: actor.uid, ...(Array.isArray(payload.probeTemps) ? { probeTemps: payload.probeTemps } : {}) }; }
      else if (kind === 'duration') { requirePayload(item.status === 'cooking' && item.criticalTempReachedAt && !item.durationRequiredAt && typeof payload.required === 'boolean', 'Duration decision is not currently recordable.'); check = { durationRequired: payload.required, durationRequiredAt: at }; }
      else if (kind === 'smoke_applied') { requirePayload(item.status === 'cooking' && !item.smokeApplied, 'Smoke application was already recorded or cook is inactive.'); check = { smokeApplied: true, smokeAppliedAt: at, smokeAppliedBy: actor.uid }; }
      else actionError('validation', 'Unsupported Thermal check.');
      if (payload.deviation) check = { ...check, hasDeviation: true, deviationType: cleanString(payload.deviation.type, 80), deviationNotes: cleanString(payload.deviation.notes), deviationBy: actor.uid, deviationAt: at };
      update = { stage: item.stage, status: item.status, ...fields, ...check }; if (prepRef) transaction.update(prepRef, check);
    } else if (input.action === 'finish_thermal') {
      assertStage(item, 'thermal', ['cooking']); requirePayload(['dry_vac', 'cold_shower'].includes(payload.method), 'A supported evacuation method is required.');
      requirePayload(item.criticalTempReachedAt && item.durationRequiredAt, 'Required Thermal checks must be recorded before evacuation.');
      const chillRef = db.collection('chill_logs').doc();
      const linkedOven = item.assignedSmokehouse ? await equipmentByIdOrName(db, transaction, 'smokehouses', item.assignedSmokehouse) : null;
      if (!linkedOven || ![item.prepQueueId, input.itemId].includes(linkedOven.data.currentLoadId)) actionError('equipment-conflict', 'Linked oven assignment no longer matches this batch.');
      update = { ...transition(item, 'awaiting_chill', actor, at, 'Thermal complete'), evacuationMethod: payload.method, evacuationCompletedAt: at, chillLogId: chillRef.id, chillLogStatus: 'waiting', chillCreatedAt: at };
      transaction.create(chillRef, { prepId: item.prepQueueId || null, productName: item.productName, status: 'waiting', createdAt: at });
      if (prepRef) transaction.update(prepRef, { status: 'awaiting_chill', stage: 'chill', evacuationMethod: payload.method, evacuationCompletedAt: at });
      transaction.update(linkedOven.ref, { status: 'idle', currentLoadId: null });
    } else if (input.action === 'assign_chiller') {
      assertStage(item, 'chill', ['awaiting_chill']); requirePayload(cleanString(payload.equipmentId, 120), 'A chiller is required.');
      const equipmentRef = db.doc(`chillers/${payload.equipmentId}`); const equipmentSnap = await transaction.get(equipmentRef);
      if (!equipmentSnap.exists) actionError('equipment-conflict', 'Selected chiller does not exist.'); const equipment = equipmentSnap.data();
      if (!['idle', 'available'].includes(equipment.status) || equipment.currentLoadId) actionError('equipment-conflict', 'Selected chiller is not available.');
      update = { ...transition(item, 'in_chill', actor, at, 'Chiller assigned and chill started'), chillerId: payload.equipmentId, chillLogStatus: 'running', chillStartedAt: at };
      transaction.update(equipmentRef, { status: 'chilling', currentLoadId: input.itemId });
      if (item.chillLogId) transaction.update(db.doc(`chill_logs/${item.chillLogId}`), { chillerId: payload.equipmentId, status: 'running', startedAt: at });
    } else if (input.action === 'record_chill_check') {
      assertStage(item, 'chill', ['in_chill']); requirePayload(finite(payload.timeTo50F) && payload.timeTo50F > 0 || finite(payload.timeTo40F) && payload.timeTo40F > 0, 'At least one positive chill check is required.');
      const check = { ...(finite(payload.timeTo50F) ? { timeTo50F: payload.timeTo50F } : {}), ...(finite(payload.timeTo40F) ? { timeTo40F: payload.timeTo40F } : {}) };
      update = { stage: item.stage, status: item.status, updatedAt: at, version: (item.version || 0) + 1, ...check }; if (item.chillLogId) transaction.update(db.doc(`chill_logs/${item.chillLogId}`), check);
    } else if (input.action === 'complete_chill') {
      assertStage(item, 'chill', ['in_chill']); const qaRef = db.collection('qa_checks').doc();
      update = { ...transition(item, 'ready_for_qa', actor, at, 'Chill completed'), chillLogStatus: 'complete', qaCheckId: qaRef.id, qaCheckStatus: 'ready_for_qa', qaTimestamp: at, ...(finite(payload.signedOutTemp) ? { signedOutTemp: payload.signedOutTemp, signedOutAt: at } : {}) };
      if (item.chillLogId) transaction.update(db.doc(`chill_logs/${item.chillLogId}`), { status: 'complete', completedAt: at, ...(finite(payload.signedOutTemp) ? { signedOutTemp: payload.signedOutTemp, signedOutAt: at } : {}) });
      transaction.create(qaRef, { prepId: item.prepQueueId || null, productName: item.productName, status: 'ready_for_qa', timestamp: at, notes: '' });
      if (item.chillerId) transaction.update(db.doc(`chillers/${item.chillerId}`), { status: 'idle', currentLoadId: null });
      if (prepRef) transaction.update(prepRef, { stage: 'qa', status: 'ready_for_qa' });
    } else if (input.action === 'qa_review') {
      assertStage(item, 'qa', ['ready_for_qa']); requirePayload(['approve_for_packaging', 'qa_hold', 'needs_review'].includes(payload.decision), 'A supported QA decision is required.');
      const status = payload.decision === 'approve_for_packaging' ? 'ready_for_packaging' : payload.decision === 'qa_hold' ? 'qa_hold' : 'qa_review_required';
      update = { ...transition(item, status, actor, at, 'QA decision'), qaCheckStatus: status, qaDecision: payload.decision, qaReviewedBy: actor.uid, qaReviewedAt: at, qaNotes: cleanString(payload.notes) };
      if (item.qaCheckId) transaction.update(db.doc(`qa_checks/${item.qaCheckId}`), { status, decision: payload.decision, reviewedBy: actor.uid, reviewedAt: at, notes: cleanString(payload.notes) });
      if (prepRef) transaction.update(prepRef, { stage: 'qa', status });
    } else if (input.action === 'qa_resubmit') {
      assertStage(item, 'qa', ['qa_hold', 'qa_review_required']); requirePayload(cleanString(payload.note), 'A corrective-action note is required.');
      update = { ...transition(item, 'ready_for_qa', actor, at, 'QA resubmitted'), qaCheckStatus: 'ready_for_qa', qaReviewedBy: null, qaReviewedAt: null };
      if (item.qaCheckId) transaction.update(db.doc(`qa_checks/${item.qaCheckId}`), { status: 'ready_for_qa', reviewedBy: null, reviewedAt: null, notes: cleanString(payload.note) });
    } else if (input.action === 'start_packaging') {
      assertStage(item, 'qa', ['ready_for_packaging']); const packagingRef = db.collection('packaging_logs').doc();
      update = { ...transition(item, 'packaging_in_progress', actor, at, 'Packaging handoff accepted'), packagingLogId: packagingRef.id, packagingLogStatus: 'running', packagingStartedAt: at };
      transaction.create(packagingRef, { prepId: item.prepQueueId || null, qaCheckId: item.qaCheckId || null, productName: item.productName, status: 'running', startedAt: at, startedBy: actor.uid });
      if (prepRef) transaction.update(prepRef, { stage: 'packaging', status: 'packaging_in_progress' });
    } else if (input.action === 'complete_packaging') {
      assertStage(item, 'packaging', ['packaging_in_progress']); requirePayload(finite(payload.casesProduced) && payload.casesProduced > 0 && finite(payload.unitsProduced) && payload.unitsProduced > 0, 'Cases and units produced must be greater than zero.');
      update = { ...transition(item, 'complete', actor, at, 'Packaging and batch completed'), packagingLogStatus: 'complete', casesProduced: payload.casesProduced, unitsProduced: payload.unitsProduced, yieldPercent: finite(payload.yieldPercent) ? payload.yieldPercent : null, packagingLine: cleanString(payload.packagingLine, 120), packagedBy: actor.uid, packagingNotes: cleanString(payload.notes), packagingCompletedAt: at };
      if (item.packagingLogId) transaction.update(db.doc(`packaging_logs/${item.packagingLogId}`), { status: 'complete', completedAt: at, casesProduced: payload.casesProduced, unitsProduced: payload.unitsProduced, yieldPercent: finite(payload.yieldPercent) ? payload.yieldPercent : null, notes: cleanString(payload.notes), packagingLine: cleanString(payload.packagingLine, 120), packagedBy: actor.uid });
      if (prepRef) transaction.update(prepRef, { stage: 'complete', status: 'complete' });
    } else if (input.action === 'complete_batch') {
      assertStage(item, 'complete', ['packaging_complete']); update = transition(item, 'complete', actor, at, 'Batch completed');
      if (prepRef) transaction.update(prepRef, { stage: 'complete', status: 'complete' });
    }

    if (!update) actionError('internal', 'Production action produced no canonical update.');
    transaction.update(itemRef, update);
    for (const alertSnap of alertSnaps?.docs || []) {
      const alert = alertSnap.data();
      if (alertKeys.includes(alert.conditionKey) && alert.status !== 'resolved') {
        transaction.update(alertSnap.ref, { status: 'resolved', resolvedAt: at, resolvedBy: actor.uid, resolvedByName: actor.name, resolutionReason: `Resolved by ${input.action}.`, lastDetectedAt: at });
        transaction.create(db.collection('alert_events').doc(), { alertId: alert.alertId || alertSnap.id, itemId: input.itemId, action: 'resolved', actorId: actor.uid, actorName: actor.name, at, reason: `Resolved by ${input.action}.` });
      }
    }
    const result = { item: resultFor(input.itemId, update), ...(payload.result || {}) };
    audit(db, transaction, input.itemId, item, actor, input.action, previousState, { stage: update.stage, status: update.status, version: update.version }, input.requestId, at);
    transaction.create(receiptRef, { uid: actor.uid, action: input.action, itemId: input.itemId, requestId: input.requestId, createdAt: at, result });
    return result;
  });
}

module.exports = { ACTION_ROLES, executeProductionAction };
