/**
 * lib/operational-items/repository.ts
 *
 * Repository for the `operational_items` canonical collection.
 *
 * Pattern:
 *   1. Call the ORIGINAL legacy repository function (writes to prep_queue /
 *      chill_logs / qa_checks / packaging_logs as before — those docs remain
 *      the authoritative audit records).
 *   2. Sync the outcome into the `operational_items` doc (stage, status,
 *      cross-reference IDs, embedded snapshot fields).
 *   3. Append a TransitionRecord to `transitions[]`.
 *
 * Screens read from `operational_items`. Mutations go through these wrappers.
 */

import {
  addDoc,
  arrayUnion,
  getDocs,
  getDoc,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  doc,
} from 'firebase/firestore';

import { collectionRef, docRef } from '@/lib/firebase/collections';
import { auth, db } from '@/lib/firebase/config';
import {
  // Original transition functions
  sendPlanToRTC,
  createPrepQueueItem,
  assignSmokehouseToPrep,
  verifyLoadForPrep,
  startCookForPrep,
  startCookFromPrep,
  ensureSmokehouseDoc,
  record50CutForPrep,
  record130CutForPrep,
  recordSmokeAppliedForPrep,
  recordCriticalTempForPrep,
  recordDurationForPrep,
  recordEvacuationForPrep,
  evacuateAndFinishCookForPrep,
  assignChillLogToChiller,
  recordChillCheck,
  flagChillLogDeviation,
  resolveChillLogDeviation,
  finishChillLog,
  updateQACheckReview,
  resubmitQACheckForReview,
  appendQACheckNote,
  startPackagingForQACheck,
  completePackagingLog,
  holdPackagingLog,
  resumePackagingLog,
  appendPackagingLogNote,
  updatePrepQueueAssignment,
  type ThermalDeviationInput,
} from '@/lib/firebase/repository';
import type { HoldEventDoc, HoldReasonKey, HoldResolutionOutcome, PrepQueueDoc, SmokehouseDoc } from '@/lib/firebase/models';

import { buildTransitionRecord } from './transitions';
import type { OItemDoc, OItemItem, OItemStage, OItemStatus } from './model';
import { assertStressScenarioReadOnly, getActiveStressScenario } from '@/lib/stress/scenarios';
import { serverExecuteProductionAction, serverPlaceFormalHold, serverResolveFormalHold, type ProductionAction } from '@/lib/security/callables';

// ── Helpers ───────────────────────────────────────────────────────────────────

function removeUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function oiRef(id: string) {
  return docRef('operational_items', id);
}

function smokehouseCapacityForSetup(setupType: SmokehouseDoc['setupType'] | undefined): number {
  return setupType === 'tree' ? 12 : 18;
}

function requireActor() {
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in is required for hold actions.');
  return user;
}

function holdEventRef() {
  return doc(collectionRef('hold_events'));
}

const recentRequestIds = new Map<string, { id: string; expiresAt: number }>();

function secureRequestId(action: string, itemId: string, payload: Record<string, unknown> = {}): string {
  const key = JSON.stringify({ action, itemId, payload });
  const cached = recentRequestIds.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.id;
  const id = `${action}_${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  recentRequestIds.set(key, { id, expiresAt: Date.now() + 5 * 60_000 });
  return id;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function submitProductionAction(
  action: ProductionAction,
  itemId: string,
  payload: Record<string, unknown> = {},
  expected?: { stage: OItemStage; status: OItemStatus },
) {
  assertStressScenarioReadOnly();
  const snap = await getDoc(oiRef(itemId));
  if (!snap.exists()) throw new Error('Production item no longer exists. Refresh and try again.');
  const item = snap.data();
  const expectedStage = expected?.stage ?? item.stage;
  const expectedStatus = expected?.status ?? item.status;
  if (item.stage !== expectedStage || item.status !== expectedStatus) {
    throw new Error(`Production state changed to ${item.stage}/${item.status}. Refresh before retrying.`);
  }
  const expectedUpdatedAt = item.updatedAt?.toMillis?.();
  const requestId = secureRequestId(action, itemId, payload);
  return serverExecuteProductionAction({ action, itemId, expectedStage, expectedStatus, expectedUpdatedAt, payload, requestId });
}

async function patchOItem(
  id: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  toStatus: OItemStatus,
  by: string,
  extra: Partial<OItemDoc> = {},
  reason?: string,
): Promise<void> {
  assertStressScenarioReadOnly();
  const ref = oiRef(id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Production item no longer exists. Refresh and try again.');
    const authoritative = snapshot.data();
    if (authoritative.stage !== currentStage || authoritative.status !== currentStatus) {
      throw new Error(`Production state changed to ${authoritative.stage}/${authoritative.status}. Refresh before retrying.`);
    }
    const { record, toStage } = buildTransitionRecord({ stage: authoritative.stage, status: authoritative.status }, toStatus, by, reason);
    transaction.update(ref, removeUndefined({ stage: toStage, status: toStatus, updatedAt: Timestamp.now(), transitions: arrayUnion(record), ...(extra as Record<string, unknown>) }));
  });
}

async function patchOItemFields(
  id: string,
  fields: Partial<OItemDoc>,
): Promise<void> {
  assertStressScenarioReadOnly();
  await updateDoc(oiRef(id), removeUndefined({
    ...fields as Record<string, unknown>,
    updatedAt: Timestamp.now(),
  }));
}

// ── Read helpers ──────────────────────────────────────────────────────────────

export async function getOperationalItems(filter?: {
  stage?: OItemStage;
}): Promise<OItemItem[]> {
  const stressScenario = getActiveStressScenario();
  if (stressScenario) {
    const selected = filter?.stage ? stressScenario.items.filter((item) => item.stage === filter.stage) : stressScenario.items;
    return [...selected].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }
  // A stage equality filter plus createdAt ordering requires a compound index.
  // The stage result sets are small enough to sort locally, which keeps this
  // optimized read usable before any index deployment and avoids a noisy
  // fallback to downloading the entire collection.
  const base = filter?.stage
    ? query(collectionRef('operational_items'), where('stage', '==', filter.stage))
    : query(collectionRef('operational_items'), orderBy('createdAt', 'desc'));

  const snapshot = await getDocs(base);
  const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as OItemItem[];
  if (!filter?.stage) return items;
  return items.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
}

export async function getOperationalItem(id: string): Promise<OItemItem | null> {
  const stressItem = getActiveStressScenario()?.items.find((item) => item.id === id);
  if (stressItem) return stressItem;
  const snap = await getDoc(oiRef(id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as OItemItem;
}

export async function getHoldEvents(itemId: string): Promise<(HoldEventDoc & { id: string })[]> {
  const snapshot = await getDocs(query(collectionRef('hold_events'), where('itemId', '==', itemId), orderBy('at', 'asc')));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function placeOperationalItemOnHold(input: {
  itemId: string;
  reasonKey: HoldReasonKey;
  reasonLabel: string;
  notes?: string;
  actorName: string;
}): Promise<void> {
  assertStressScenarioReadOnly();
  await serverPlaceFormalHold({ ...input, requestId: secureRequestId('hold', input.itemId, { reasonKey: input.reasonKey, reasonLabel: input.reasonLabel, notes: input.notes || '' }) });
}

export async function resolveOperationalItemHold(input: {
  itemId: string;
  outcome: HoldResolutionOutcome;
  explanation: string;
  actorName: string;
}): Promise<void> {
  assertStressScenarioReadOnly();
  await serverResolveFormalHold({ ...input, requestId: secureRequestId('resolve_hold', input.itemId, { outcome: input.outcome, explanation: input.explanation }) });
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createOperationalItem(
  input: Omit<OItemDoc, 'transitions' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const now = Timestamp.now();
  const doc: OItemDoc = {
    ...input,
    transitions: [],
    createdAt: now,
    updatedAt: now,
  };
  const ref = await addDoc(
    collectionRef('operational_items'),
    removeUndefined(doc as unknown as Record<string, unknown>) as unknown as OItemDoc,
  );
  return ref.id;
}

// ── Planning → RTC ────────────────────────────────────────────────────────────

/**
 * Send a weekly-plan row to RTC.
 *
 * Calls the original `sendPlanToRTC()`, then reads the newly created
 * prep_queue doc to build the canonical `operational_items` record.
 *
 * Returns both the legacy prepId and the new oItemId.
 */
export async function oItemSendPlanToRTC(
  planId: string,
  _by = 'system',
): Promise<{ prepId: string; oItemId: string }> {
  assertStressScenarioReadOnly();
  const requestId = `rtc_send_${planId}_${stableHash(planId)}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  const result = await serverExecuteProductionAction({ action: 'rtc_send_to_queue', planId, requestId });
  if (!result.prepId || !result.oItemId) throw new Error('RTC handoff returned an incomplete canonical result.');
  return { prepId: result.prepId, oItemId: result.oItemId };
}

export async function oItemCreateManualFromInput(
  input: Record<string, unknown>,
): Promise<{ prepId: string; oItemId: string }> {
  assertStressScenarioReadOnly();
  const identity = stableHash(JSON.stringify(input));
  const result = await serverExecuteProductionAction({
    action: 'rtc_create_manual', itemId: `manual_${identity}`, payload: input,
    requestId: secureRequestId('rtc_manual', identity, input),
  });
  if (!result.prepId || !result.oItemId) throw new Error('Manual RTC entry returned an incomplete canonical result.');
  return { prepId: result.prepId, oItemId: result.oItemId };
}

// ── RTC transitions ───────────────────────────────────────────────────────────

/**
 * Advance an RTC item's status (staging → ready → ready_for_thermal, etc.).
 * Does NOT call a legacy function — the original prep-queue screen mutations
 * still write to prep_queue; this just keeps operational_items in sync.
 */
export async function oItemAdvanceRTCStatus(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  toStatus: OItemStatus,
  by = 'system',
): Promise<void> {
  await submitProductionAction('rtc_advance', oItemId, { toStatus, requestedBy: by }, { stage: currentStage, status: currentStatus });
}

// ── Thermal transitions ───────────────────────────────────────────────────────

export async function oItemAssignSmokehouse(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  prepId: string,
  smokehouseId: string,
  by = 'system',
): Promise<void> {
  await submitProductionAction('assign_oven', oItemId, { equipmentId: smokehouseId, prepId, requestedBy: by }, { stage: currentStage, status: currentStatus });
}

export async function oItemVerifyLoad(
  oItemId: string,
  prepId: string,
  verifiedBy: string,
): Promise<void> {
  await submitProductionAction('verify_load', oItemId, { prepId, verifiedBy });
}

/**
 * Assign smokehouse only (no cook start). Used when assignment is a separate step
 * from cook start (the "legacy" two-step assignment flow).
 */
export async function oItemAssignSmokehouseOnly(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  prepId: string,
  smokehouseName: string,
  by = 'system',
): Promise<void> {
  await submitProductionAction('assign_oven', oItemId, { equipmentId: smokehouseName, prepId, requestedBy: by }, { stage: currentStage, status: currentStatus });
}

/**
 * Combined: ensure smokehouse doc, assign, and start cook in one go.
 * Wraps the `startCookFromPrep` function (thermal one-step flow).
 */
export async function oItemAssignAndStartCook(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  prepId: string,
  smokehouseName: string,
  extras?: { startingTemp?: number; startingProductTemp?: number },
  by = 'system',
): Promise<void> {
  if (currentStatus !== 'assigned') {
    await submitProductionAction('assign_oven', oItemId, { equipmentId: smokehouseName, prepId, requestedBy: by }, { stage: currentStage, status: currentStatus });
  }
  await submitProductionAction('start_cook', oItemId, { equipmentId: smokehouseName, ...extras });
}

/**
 * Auto-split an oversized thermal-ready load into child loads that respect
 * smokehouse rack capacity rules:
 * - compression (9-shelf): 18 racks
 * - tree (5-shelf): 12 racks
 */
export async function oItemAutoSplitThermalLoad(
  oItemId: string,
  smokehouseName: string,
  setupType: SmokehouseDoc['setupType'] = 'compression',
  by = 'system',
): Promise<{ parentId: string; childIds: string[]; chunks: number[]; capacity: number }> {
  const parentSnap = await getDoc(oiRef(oItemId));
  if (!parentSnap.exists()) throw new Error('Operational item not found.');
  const parent = { id: parentSnap.id, ...parentSnap.data() } as OItemItem;
  const capacity = smokehouseCapacityForSetup(setupType);
  const totalRacks = parent.racks ?? 0;
  if (totalRacks <= capacity) {
    throw new Error(`Load has ${totalRacks} racks and does not require splitting (capacity ${capacity}).`);
  }
  if (!smokehouseName.trim()) throw new Error('Smokehouse is required before splitting.');

  const chunks: number[] = [];
  let remaining = totalRacks;
  while (remaining > 0) {
    const part = Math.min(capacity, remaining);
    chunks.push(part);
    remaining -= part;
  }
  const splitCount = chunks.length;

  let prepTemplate: PrepQueueDoc | null = null;
  const parentPrepId = parent.prepQueueId;
  if (parentPrepId) {
    const prepSnap = await getDoc(docRef('prep_queue', parentPrepId));
    if (prepSnap.exists()) prepTemplate = prepSnap.data() as PrepQueueDoc;
  }

  const childIds: string[] = [];
  for (let idx = 0; idx < chunks.length; idx += 1) {
    const rackCount = chunks[idx];
    let childPrepId: string | null = null;

    if (prepTemplate) {
      const childPrep: PrepQueueDoc = {
        ...prepTemplate,
        racks: rackCount,
        status: 'ready_for_thermal',
        stage: 'thermal',
        assignedSmokehouse: null,
        targetSmokehouseId: smokehouseName,
        startTime: Timestamp.now(),
      };
      childPrepId = await createPrepQueueItem(childPrep);
    }

    const childId = await createOperationalItem({
      productId: parent.productId,
      productName: parent.productName,
      productCode: parent.productCode,
      productNameSnapshot: parent.productNameSnapshot,
      productCodeSnapshot: parent.productCodeSnapshot,
      racks: rackCount,
      pieces: parent.pieces ?? 0,
      cases: parent.cases,
      poNumber: parent.poNumber ?? '',
      deliveryDate: parent.deliveryDate ?? '',
      makeDate: parent.makeDate ?? '',
      cookType: parent.cookType ?? '',
      targetTemp: parent.targetTemp ?? 0,
      expectedCookMinutes: parent.expectedCookMinutes ?? 0,
      expectedChillMinutes: parent.expectedChillMinutes,
      expectedPackMinutes: parent.expectedPackMinutes,
      rackType: parent.rackType ?? '',
      species: parent.species ?? '',
      packagingType: parent.packagingType ?? '',
      thermalOwner: parent.thermalOwner ?? '',
      criticalLimit: parent.criticalLimit,
      stage: 'thermal',
      status: 'ready_for_thermal',
      weeklyPlanId: parent.weeklyPlanId ?? null,
      prepQueueId: childPrepId,
      chillLogId: null,
      qaCheckId: null,
      packagingLogId: null,
      sourcePlanId: parent.sourcePlanId ?? parent.weeklyPlanId ?? null,
      processOrder: parent.processOrder,
      plannedDate: parent.plannedDate,
      department: parent.department,
      targetSmokehouseId: smokehouseName,
      targetChillerId: parent.targetChillerId ?? null,
      parentLoadId: parent.id,
      splitLoadIndex: idx + 1,
      splitLoadCount: splitCount,
      assignedRackCount: rackCount,
      originalRackCount: totalRacks,
      expectedCookComplete: parent.expectedCookComplete,
      expectedChillComplete: parent.expectedChillComplete,
      packagingReadyETA: parent.packagingReadyETA,
      createdBy: parent.createdBy,
      assignedSmokehouse: null,
      assignedBlastChiller: null,
      startTime: Timestamp.now(),
      hasDeviation: parent.hasDeviation,
      deviationType: parent.deviationType,
      deviationNotes: parent.deviationNotes,
      deviationBy: parent.deviationBy,
      correctiveAction: parent.correctiveAction,
      deviationAt: parent.deviationAt,
    });
    childIds.push(childId);
  }

  await patchOItem(
    parent.id,
    parent.stage,
    parent.status,
    'split_parent',
    by,
    {
      originalRackCount: totalRacks,
      splitLoadCount: splitCount,
      assignedRackCount: totalRacks,
      targetSmokehouseId: smokehouseName,
    },
    `Auto-split into ${splitCount} child loads for smokehouse ${smokehouseName} (${capacity} rack capacity).`,
  );

  return { parentId: parent.id, childIds, chunks, capacity };
}

/**
 * Allocate exactly one smokehouse-capacity chunk from a parent thermal-ready
 * item. Remaining racks stay on the parent for subsequent allocations.
 */
export async function oItemAllocateSmokehouseLoad(
  parentOItemId: string,
  smokehouseName: string,
  setupType: SmokehouseDoc['setupType'] = 'compression',
  by = 'system',
): Promise<{
  parentId: string;
  childId: string;
  assignedRackCount: number;
  remainingRackCount: number;
  capacity: number;
}> {
  const result = await submitProductionAction('allocate_oven_load', parentOItemId, { equipmentId: smokehouseName, setupType, requestedBy: by });
  if (!result.childId || result.assignedRackCount == null || result.remainingRackCount == null || result.capacity == null) {
    throw new Error('Smokehouse allocation returned an incomplete canonical result.');
  }
  return { parentId: parentOItemId, childId: result.childId, assignedRackCount: result.assignedRackCount, remainingRackCount: result.remainingRackCount, capacity: result.capacity };

  /* istanbul ignore next -- retained only as schema documentation until the
     staged migration proves no old clients depend on this legacy algorithm. */
  // eslint-disable-next-line no-unreachable
  const parentSnap = await getDoc(oiRef(parentOItemId));
  if (!parentSnap.exists()) throw new Error('Operational item not found.');
  const parent = { id: parentSnap.id, ...parentSnap.data() } as OItemItem;
  if (parent.stage !== 'thermal' || parent.status !== 'ready_for_thermal') {
    throw new Error('Only thermal-ready parent loads can allocate smokehouse capacity.');
  }
  if (!smokehouseName.trim()) throw new Error('Smokehouse is required.');

  const capacity = smokehouseCapacityForSetup(setupType);
  const originalRackCount = parent.originalRackCount ?? parent.racks ?? 0;
  const allocatedRackCount = parent.allocatedRackCount ?? 0;
  const remainingRackCount = parent.remainingRackCount ?? Math.max(0, originalRackCount - allocatedRackCount);
  if (remainingRackCount <= 0) throw new Error('No remaining racks to allocate.');

  const assignedRackCount = Math.min(remainingRackCount, capacity);
  const nextRemaining = Math.max(0, remainingRackCount - assignedRackCount);
  const nextAllocated = allocatedRackCount + assignedRackCount;

  // ── Comprehensive occupancy guard ──────────────────────────────────────────
  // 1. Check ALL active thermal OItems claiming this smokehouse (any parent).
  // 2. Check the smokehouse document's currentLoadId directly.
  // Both must be clear before we allow a new allocation.
  const ACTIVE_THERMAL_STATUSES = ['assigned', 'awaiting_cook_start', 'cooking', 'cook_in_progress'];

  const anyActiveInSmokehouseSnap = await getDocs(
    query(
      collectionRef('operational_items'),
      where('assignedSmokehouse', '==', smokehouseName),
      where('stage', '==', 'thermal'),
    ),
  );
  const activeOItemConflicts = anyActiveInSmokehouseSnap.docs.filter((d) => {
    const s = (d.data().status as string) ?? '';
    return ACTIVE_THERMAL_STATUSES.includes(s);
  });
  const hasOItemConflict = activeOItemConflicts.length > 0;

  const smokehouseDocSnap = await getDocs(
    query(collectionRef('smokehouses'), where('name', '==', smokehouseName), limit(1)),
  );
  const smokehouseCurrentLoadId = smokehouseDocSnap.docs[0]?.data()?.currentLoadId ?? null;
  const smokehouseOccupied = !!smokehouseCurrentLoadId;

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[THERMAL_ALLOCATE_GUARD]', {
      selectedSmokehouse: smokehouseName,
      currentLoadId: smokehouseCurrentLoadId,
      activeOItemCount: activeOItemConflicts.length,
      activeOItemIds: activeOItemConflicts.map((d) => d.id),
      smokehouseOccupied,
      blocked: hasOItemConflict || smokehouseOccupied,
      reason: hasOItemConflict ? 'active-oitem-conflict' : smokehouseOccupied ? 'smokehouse-currentLoadId-set' : 'ok',
    });
  }

  if (hasOItemConflict || smokehouseOccupied) {
    const conflictId = activeOItemConflicts[0]?.id ?? smokehouseCurrentLoadId;
    throw new Error(
      `Smokehouse ${smokehouseName} already has an active load (${conflictId ?? 'unknown'}). ` +
      `Choose another smokehouse.`,
    );
  }

  // Ensure the smokehouse Firestore document exists (creates it if absent).
  // This lets verifyLoadForPrep and startCookForPrep find it reliably.
  await ensureSmokehouseDoc(smokehouseName);

  const existingChildrenSnap = await getDocs(
    query(collectionRef('operational_items'), where('parentLoadId', '==', parent.id)),
  );
  const splitIndex = existingChildrenSnap.size + 1;
  const splitCount = Math.ceil(originalRackCount / capacity);

  let prepTemplate: PrepQueueDoc | null = null;
  const allocatedParentPrepId = parent.prepQueueId;
  if (allocatedParentPrepId) {
    const prepSnap = await getDoc(docRef('prep_queue', allocatedParentPrepId!));
    if (prepSnap.exists()) prepTemplate = prepSnap.data() as PrepQueueDoc;
  }

  let childPrepId: string | null = null;
  if (prepTemplate) {
    const childPrep = {
      ...prepTemplate,
      racks: assignedRackCount,
      status: 'assigned',
      stage: 'thermal',
      assignedSmokehouse: smokehouseName,
      targetSmokehouseId: smokehouseName,
      startTime: Timestamp.now(),
    } as PrepQueueDoc;
    childPrepId = await createPrepQueueItem(childPrep);
  }

  const childId = await createOperationalItem({
    productId: parent.productId,
    productName: parent.productName,
    productCode: parent.productCode,
    productNameSnapshot: parent.productNameSnapshot,
    productCodeSnapshot: parent.productCodeSnapshot,
    racks: assignedRackCount,
    pieces: parent.pieces ?? 0,
    cases: parent.cases,
    poNumber: parent.poNumber ?? '',
    deliveryDate: parent.deliveryDate ?? '',
    makeDate: parent.makeDate ?? '',
    cookType: parent.cookType ?? '',
    targetTemp: parent.targetTemp ?? 0,
    expectedCookMinutes: parent.expectedCookMinutes ?? 0,
    expectedChillMinutes: parent.expectedChillMinutes,
    expectedPackMinutes: parent.expectedPackMinutes,
    rackType: parent.rackType ?? '',
    species: parent.species ?? '',
    packagingType: parent.packagingType ?? '',
    thermalOwner: parent.thermalOwner ?? '',
    criticalLimit: parent.criticalLimit,
    stage: 'thermal',
    status: 'assigned',
    weeklyPlanId: parent.weeklyPlanId ?? null,
    prepQueueId: childPrepId,
    chillLogId: null,
    qaCheckId: null,
    packagingLogId: null,
    sourcePlanId: parent.sourcePlanId ?? parent.weeklyPlanId ?? null,
    processOrder: parent.processOrder,
    plannedDate: parent.plannedDate,
    department: parent.department,
    targetSmokehouseId: smokehouseName,
    targetChillerId: parent.targetChillerId ?? null,
    parentLoadId: parent.id,
    splitLoadIndex: splitIndex,
    splitLoadCount: splitCount,
    assignedRackCount,
    originalRackCount,
    remainingRackCount: 0,
    allocatedRackCount: assignedRackCount,
    expectedCookComplete: parent.expectedCookComplete,
    expectedChillComplete: parent.expectedChillComplete,
    packagingReadyETA: parent.packagingReadyETA,
    createdBy: parent.createdBy,
    assignedSmokehouse: smokehouseName,
    assignedBlastChiller: null,
    startTime: Timestamp.now(),
    hasDeviation: parent.hasDeviation,
    deviationType: parent.deviationType,
    deviationNotes: parent.deviationNotes,
    deviationBy: parent.deviationBy,
    correctiveAction: parent.correctiveAction,
    deviationAt: parent.deviationAt,
  });

  if (nextRemaining === 0) {
    await patchOItem(
      parent.id,
      parent.stage,
      parent.status,
      'split_parent',
      by,
      {
        originalRackCount,
        allocatedRackCount: nextAllocated,
        remainingRackCount: 0,
        targetSmokehouseId: smokehouseName,
      },
      `Fully allocated across smokehouses. Last allocation ${assignedRackCount} rack(s) to ${smokehouseName}.`,
    );
  } else {
    await patchOItemFields(parent.id, {
      originalRackCount,
      allocatedRackCount: nextAllocated,
      remainingRackCount: nextRemaining,
      targetSmokehouseId: smokehouseName,
    });
  }

  return {
    parentId: parent.id,
    childId,
    assignedRackCount,
    remainingRackCount: nextRemaining,
    capacity,
  };
}

export async function oItemStartCook(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  prepId: string,
  extras?: { startingTemp?: number; startingProductTemp?: number },
  by = 'system',
): Promise<void> {
  await submitProductionAction('start_cook', oItemId, { prepId, requestedBy: by, ...extras }, { stage: currentStage, status: currentStatus });
}

export async function oItemRecord50Cut(
  oItemId: string,
  prepId: string,
  extras?: { observedTemp?: number; deviation?: ThermalDeviationInput },
): Promise<void> {
  await submitProductionAction('record_thermal_check', oItemId, { kind: 'cut_50', prepId, ...extras });
}

export async function oItemRecord130Cut(
  oItemId: string,
  prepId: string,
  extras?: { observedTemp?: number; deviation?: ThermalDeviationInput },
): Promise<void> {
  await submitProductionAction('record_thermal_check', oItemId, { kind: 'cut_130', prepId, ...extras });
}

export async function oItemRecordSmokeApplied(
  oItemId: string,
  prepId: string,
  appliedBy: string,
): Promise<void> {
  await submitProductionAction('record_thermal_check', oItemId, { kind: 'smoke_applied', prepId, appliedBy });
}

export async function oItemRecordCriticalTemp(
  oItemId: string,
  prepId: string,
  criticalTempValue: number,
  verifiedBy: string,
  extras?: { probeTemps?: number[]; deviation?: ThermalDeviationInput },
): Promise<void> {
  await submitProductionAction('record_thermal_check', oItemId, { kind: 'critical_temp', prepId, value: criticalTempValue, verifiedBy, ...extras });
}

export async function oItemRecordDuration(
  oItemId: string,
  prepId: string,
  required: boolean,
): Promise<void> {
  await submitProductionAction('record_thermal_check', oItemId, { kind: 'duration', prepId, required });
}

export async function oItemRecordEvacuation(
  oItemId: string,
  prepId: string,
  method: 'dry_vac' | 'cold_shower',
): Promise<void> {
  await submitProductionAction('finish_thermal', oItemId, { prepId, method });
}

/**
 * Atomic thermal→chill handoff.
 * Calls the original `evacuateAndFinishCookForPrep`, then:
 *  - reads the newly created chill_log doc
 *  - advances stage to 'chill', status to 'awaiting_chill'
 *  - embeds chillLogId + chillLogStatus = 'waiting'
 */
export async function oItemEvacuateToChill(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  prepId: string,
  method: 'dry_vac' | 'cold_shower',
  extras?: { assignedBlastChiller?: string },
  by = 'system',
): Promise<void> {
  await submitProductionAction('finish_thermal', oItemId, { prepId, method, requestedBy: by, ...extras }, { stage: currentStage, status: currentStatus });
}

// ── Chill transitions ─────────────────────────────────────────────────────────

export async function oItemAssignChiller(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  chillLogId: string,
  chillerId: string,
  by = 'system',
): Promise<void> {
  await submitProductionAction('assign_chiller', oItemId, { chillLogId, equipmentId: chillerId, requestedBy: by }, { stage: currentStage, status: currentStatus });
}

export async function oItemRecordChillCheck(
  oItemId: string,
  chillLogId: string,
  input: { timeTo50F?: number; timeTo40F?: number },
): Promise<void> {
  await submitProductionAction('record_chill_check', oItemId, { chillLogId, ...input });
}

export async function oItemFlagChillDeviation(
  oItemId: string,
  chillLogId: string,
  reason: string,
): Promise<void> {
  await flagChillLogDeviation(chillLogId, reason);
  await patchOItemFields(oItemId, {
    chillLogStatus: 'deviation',
    hasDeviation: true,
    deviationType: 'chill_out_of_spec',
    deviationNotes: reason,
    deviationBy: 'Operator',
    deviationAt: Timestamp.now(),
  });
}

export async function oItemResolveChillDeviation(
  oItemId: string,
  chillLogId: string,
  note: string,
): Promise<void> {
  await resolveChillLogDeviation(chillLogId, note);
  await patchOItemFields(oItemId, {
    chillLogStatus: 'running',
    correctiveAction: note,
  });
}

/**
 * Finish chill + create QA check.
 * Reads the newly-created qa_check doc to embed qaCheckId.
 */
export async function oItemFinishChill(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  chillLogId: string,
  extras?: {
    signedOutTemp?: number;
    coolerId?: string;
    timeTo50F?: number;
    timeTo40F?: number;
  },
  by = 'system',
): Promise<void> {
  await submitProductionAction('complete_chill', oItemId, { chillLogId, requestedBy: by, ...extras }, { stage: currentStage, status: currentStatus });
}

// ── QA transitions ────────────────────────────────────────────────────────────

export async function oItemQAReview(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  qaCheckId: string,
  input: {
    decision: 'approve_for_packaging' | 'qa_hold' | 'needs_review';
    reviewedBy: string;
    notes?: string;
  },
  by = 'system',
): Promise<void> {
  await submitProductionAction('qa_review', oItemId, { qaCheckId, requestedBy: by, ...input }, { stage: currentStage, status: currentStatus });
}

export async function oItemQAResubmit(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  qaCheckId: string,
  resubmissionNote: string,
  by = 'system',
): Promise<void> {
  await submitProductionAction('qa_resubmit', oItemId, { qaCheckId, note: resubmissionNote, requestedBy: by }, { stage: currentStage, status: currentStatus });
}

export async function oItemAppendQANote(
  oItemId: string,
  qaCheckId: string,
  note: string,
): Promise<void> {
  await appendQACheckNote(qaCheckId, note);
  // Notes are stored on the qa_check doc; we don't embed full note history in OItem.
  await patchOItemFields(oItemId, { updatedAt: Timestamp.now() });
}

// ── Packaging transitions ─────────────────────────────────────────────────────

/**
 * Start packaging from a QA-approved check.
 * Reads the newly-created packaging_log doc to embed packagingLogId.
 */
export async function oItemStartPackaging(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  qaCheckId: string,
  by = 'system',
): Promise<string> {
  const result = await submitProductionAction('start_packaging', oItemId, { qaCheckId, requestedBy: by }, { stage: currentStage, status: currentStatus });
  const refreshed = await getDoc(oiRef(result.item.id));
  const packagingLogId = refreshed.data()?.packagingLogId;
  if (!packagingLogId) throw new Error('Packaging handoff returned no log identity.');
  return packagingLogId;
}

export async function oItemCompletePackaging(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  packagingLogId: string,
  input: {
    casesProduced: number;
    unitsProduced: number;
    yieldPercent: number | null;
    notes: string;
    packagingLine: string;
    packagedBy: string;
  },
  by = 'system',
): Promise<void> {
  await submitProductionAction('complete_packaging', oItemId, { packagingLogId, requestedBy: by, ...input }, { stage: currentStage, status: currentStatus });
}

export async function oItemHoldPackaging(
  oItemId: string,
  packagingLogId: string,
  reason: string,
): Promise<void> {
  await holdPackagingLog(packagingLogId, reason);
  await patchOItemFields(oItemId, {
    packagingLogStatus: 'deviation',
    hasDeviation: true,
    deviationType: 'packaging_hold',
    deviationNotes: reason,
    deviationAt: Timestamp.now(),
  });
}

export async function oItemResumePackaging(
  oItemId: string,
  packagingLogId: string,
): Promise<void> {
  await resumePackagingLog(packagingLogId);
  await patchOItemFields(oItemId, { packagingLogStatus: 'running' });
}

export async function oItemAppendPackagingNote(
  oItemId: string,
  packagingLogId: string,
  note: string,
): Promise<void> {
  await appendPackagingLogNote(packagingLogId, note);
  await patchOItemFields(oItemId, { updatedAt: Timestamp.now() });
}

// ── DEV: Duplicate cleanup ────────────────────────────────────────────────────

/**
 * DEV-only: resolve duplicate active child loads assigned to the same smokehouse.
 *
 * For each smokehouse with > 1 active (assigned / cooking) OItem:
 *   1. Keep the oldest child OR the one whose prepQueueId / id matches
 *      `smokehouses.currentLoadId`.
 *   2. Move all extras to `status: 'hold'` with a transition note.
 *   3. Return each extra child's `assignedRackCount` back to its parent
 *      (`remainingRackCount` ↑, `allocatedRackCount` ↓).
 *   4. If the parent was `split_parent` after returning racks, move it back
 *      to `ready_for_thermal`.
 *   5. Set `smokehouses.currentLoadId` to the kept child's `prepQueueId`
 *      (or `id` if no prepQueueId).
 *
 * Safe to call multiple times — idempotent once duplicates are resolved.
 */
export async function resolveSmokehouseDuplicates(): Promise<{
  resolved: number;
  cancelled: string[];
  errors: string[];
}> {
  const ACTIVE_THERMAL_STATUSES = [
    'assigned', 'awaiting_cook_start', 'cooking', 'cook_in_progress',
  ];

  // Fetch all thermal OItems
  const snap = await getDocs(
    query(
      collectionRef('operational_items'),
      where('stage', '==', 'thermal'),
    ),
  );

  const activeItems = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as OItemItem)
    .filter((x) => ACTIVE_THERMAL_STATUSES.includes(x.status as string) && !!x.assignedSmokehouse);

  // Group by assigned smokehouse
  const bySmokehouse: Record<string, OItemItem[]> = {};
  activeItems.forEach((x) => {
    const key = x.assignedSmokehouse as string;
    if (!bySmokehouse[key]) bySmokehouse[key] = [];
    bySmokehouse[key].push(x);
  });

  // Only process smokehouses with duplicates
  const duplicateEntries = Object.entries(bySmokehouse).filter(([, its]) => its.length > 1);

  const cancelled: string[] = [];
  const errors: string[] = [];
  let resolved = 0;

  for (const [smokehouseName, items] of duplicateEntries) {
    try {
      // Look up smokehouse Firestore doc for currentLoadId
      const smokehouseDocSnap = await getDocs(
        query(collectionRef('smokehouses'), where('name', '==', smokehouseName), limit(1)),
      );
      const smokehouseFirestoreDoc = smokehouseDocSnap.docs[0] ?? null;
      const currentLoadId: string | null = smokehouseFirestoreDoc?.data()?.currentLoadId ?? null;

      // Decide which child to keep:
      // Priority 1 — matches smokehouse.currentLoadId (via prepQueueId or id).
      // Priority 2 — oldest by startTime / createdAt.
      const matchesCurrent = (item: OItemItem): boolean =>
        !!currentLoadId &&
        (item.prepQueueId === currentLoadId || item.id === currentLoadId);

      const itemMs = (item: OItemItem): number => {
        const st = item.startTime as (Timestamp | null | undefined);
        if (st && typeof (st as Timestamp).toMillis === 'function') return (st as Timestamp).toMillis();
        const ca = item.createdAt as (Timestamp | null | undefined);
        if (ca && typeof (ca as Timestamp).toMillis === 'function') return (ca as Timestamp).toMillis();
        return 0;
      };

      const keptItem: OItemItem =
        items.find(matchesCurrent) ??
        items.reduce((oldest, x) => (itemMs(x) < itemMs(oldest) ? x : oldest), items[0]);

      const extras = items.filter((x) => x.id !== keptItem.id);

      // Process each extra duplicate
      for (const extra of extras) {
        const now = Timestamp.now();

        // 1. Mark extra child as hold
        await updateDoc(oiRef(extra.id), removeUndefined({
          status: 'hold' as OItemStatus,
          updatedAt: now,
          transitions: arrayUnion({
            from: { stage: extra.stage as OItemStage, status: extra.status as OItemStatus },
            to: { stage: 'thermal' as OItemStage, status: 'hold' as OItemStatus },
            by: 'system',
            at: now,
            reason: 'Duplicate smokehouse allocation cleanup — excess child load put on hold',
          }),
        } as Record<string, unknown>));

        // 2. Return racks to parent
        const rackCount = extra.assignedRackCount ?? 0;
        if (extra.parentLoadId && rackCount > 0) {
          const parentRef = oiRef(extra.parentLoadId);
          const parentSnap = await getDoc(parentRef);
          if (parentSnap.exists()) {
            const parent = parentSnap.data() as OItemDoc;
            const parentNow = Timestamp.now();
            const newRemaining = (parent.remainingRackCount ?? 0) + rackCount;
            const newAllocated = Math.max(0, (parent.allocatedRackCount ?? 0) - rackCount);

            const parentFields: Record<string, unknown> = {
              remainingRackCount: newRemaining,
              allocatedRackCount: newAllocated,
              updatedAt: parentNow,
            };

            // If parent was fully allocated (split_parent), restore to ready_for_thermal
            if (parent.status === 'split_parent') {
              parentFields.status = 'ready_for_thermal' as OItemStatus;
              parentFields.transitions = arrayUnion({
                from: { stage: 'thermal' as OItemStage, status: 'split_parent' as OItemStatus },
                to: { stage: 'thermal' as OItemStage, status: 'ready_for_thermal' as OItemStatus },
                by: 'system',
                at: parentNow,
                reason: `Duplicate child cancelled — ${rackCount} rack(s) returned to parent pool`,
              });
            }

            await updateDoc(parentRef, removeUndefined(parentFields));
          }
        }

        // 3. Best-effort: put legacy prep_queue doc on hold too
        if (extra.prepQueueId) {
          try {
            const prepRef = docRef('prep_queue', extra.prepQueueId);
            const prepSnap = await getDoc(prepRef);
            if (prepSnap.exists()) {
              await updateDoc(prepRef, removeUndefined({ status: 'hold', updatedAt: Timestamp.now() } as Record<string, unknown>));
            }
          } catch {
            // Non-fatal — prep_queue doc may not exist for all child allocations
          }
        }

        cancelled.push(extra.id);
      }

      // 4. Repair smokehouse.currentLoadId → kept child's prepQueueId (or id)
      if (smokehouseFirestoreDoc) {
        const keptPrepId = keptItem.prepQueueId ?? keptItem.id;
        await updateDoc(smokehouseFirestoreDoc.ref, { currentLoadId: keptPrepId });
      }

      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[THERMAL_CLEANUP]', {
          smokehouse: smokehouseName,
          kept: keptItem.id,
          keptPrepId: keptItem.prepQueueId ?? keptItem.id,
          cancelled: extras.map((x) => x.id),
        });
      }

      resolved += 1;
    } catch (err) {
      errors.push(
        `Smokehouse ${smokehouseName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { resolved, cancelled, errors };
}
