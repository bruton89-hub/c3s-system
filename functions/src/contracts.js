'use strict';

const ACTIVE_ROLES = ['operator', 'supervisor', 'qa', 'admin', 'packaging'];
const HOLD_RESOLVERS = ['supervisor', 'qa', 'admin'];
const transitions = {
  draft: ['staging'], staging: ['staged', 'prepping', 'ready'], staged: ['prepping', 'ready'], prepping: ['ready', 'ready_for_thermal'],
  ready: ['ready_for_thermal', 'assigned'], ready_for_thermal: ['assigned'], in_thermal: ['assigned', 'cooking'], moved_downstream: ['assigned', 'ready_for_thermal'],
  assigned: ['cooking'], cooking: ['awaiting_chill'], awaiting_chill: ['in_chill'], in_chill: ['chill_complete'], chill_complete: ['ready_for_qa'],
  ready_for_qa: ['ready_for_packaging', 'qa_hold', 'qa_review_required'], qa_hold: ['ready_for_qa'], qa_review_required: ['ready_for_qa'],
  ready_for_packaging: ['packaging_in_progress'], packaging_in_progress: ['packaging_complete'], packaging_complete: ['complete'],
};
const stageForStatus = {
  draft: 'planning', staging: 'rtc', staged: 'rtc', prepping: 'rtc', ready: 'rtc', ready_for_thermal: 'thermal', split_parent: 'thermal', in_thermal: 'thermal', moved_downstream: 'thermal', assigned: 'thermal', cooking: 'thermal',
  awaiting_chill: 'chill', in_chill: 'chill', chill_complete: 'chill', ready_for_qa: 'qa', qa_hold: 'qa', qa_review_required: 'qa', ready_for_packaging: 'qa', packaging_in_progress: 'packaging', packaging_complete: 'complete', complete: 'complete',
};

function assertActiveProfile(profile) { if (!profile || profile.active !== true || !ACTIVE_ROLES.includes(profile.role)) throw Object.assign(new Error('Active production access is required.'), { category: 'permission' }); }
function assertRole(profile, roles) { assertActiveProfile(profile); if (!roles.includes(profile.role)) throw Object.assign(new Error('Your role cannot perform this action.'), { category: 'permission' }); }
function validateTransition(fromStatus, toStatus) { return transitions[fromStatus]?.includes(toStatus) === true; }
function destinationStage(toStatus) { return stageForStatus[toStatus] ?? null; }
function validateRequestId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value); }
function receiptId(uid, requestId) { return `${uid}__${requestId}`; }
function isStale(item, input) { return item.stage !== input.expectedStage || item.status !== input.expectedStatus || (Number.isFinite(input.expectedUpdatedAt) && item.updatedAt?.toMillis?.() !== input.expectedUpdatedAt); }
function assertAuthenticated(auth) { if (!auth?.uid) throw Object.assign(new Error('Sign in is required.'), { category: 'authentication' }); return auth.uid; }
function buildTransitionPlan(item, input, actor, at) {
  if (isStale(item, input)) throw Object.assign(new Error('Production state changed.'), { category: 'stale' });
  if (item.status === 'hold' || !validateTransition(item.status, input.toStatus)) throw Object.assign(new Error('Invalid transition.'), { category: 'invalid' });
  const stage = destinationStage(input.toStatus);
  return { item: { stage, status: input.toStatus, version: (item.version || 0) + 1, updatedAt: at }, transition: { from: { stage: item.stage, status: item.status }, to: { stage, status: input.toStatus }, by: actor.uid, at, reason: 'Secure production transition' }, audit: { actorId: actor.uid, action: 'transitionProductionItem', result: 'success' } };
}
function priorReceiptResult(receipt) { return receipt?.result ?? null; }
function buildEquipmentAssignmentPlan(item, equipment, input, actor, at) {
  if (isStale(item, input)) throw Object.assign(new Error('Production state changed.'), { category: 'stale' });
  const oven = input.equipmentKind === 'oven'; const chiller = input.equipmentKind === 'chiller';
  if ((!oven && !chiller) || equipment.status !== 'idle' || equipment.currentLoadId) throw Object.assign(new Error('Equipment is not available.'), { category: 'invalid' });
  if ((oven && item.stage !== 'thermal') || (chiller && (item.stage !== 'chill' || item.status !== 'awaiting_chill'))) throw Object.assign(new Error('Equipment is incompatible with the current production stage.'), { category: 'invalid' });
  return { item: { stage: item.stage, status: oven ? 'assigned' : 'in_chill', version: (item.version || 0) + 1, updatedAt: at, [oven ? 'assignedSmokehouse' : 'chillerId']: input.equipmentId }, equipment: { status: oven ? 'cooking' : 'chilling', currentLoadId: input.itemId }, audit: { actorId: actor.uid, action: 'assignEquipment', result: 'success' } };
}

module.exports = { ACTIVE_ROLES, HOLD_RESOLVERS, assertAuthenticated, assertActiveProfile, assertRole, validateTransition, destinationStage, validateRequestId, receiptId, isStale, buildTransitionPlan, priorReceiptResult, buildEquipmentAssignmentPlan };
