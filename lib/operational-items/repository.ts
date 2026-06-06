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
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import { collectionRef, docRef } from '@/lib/firebase/collections';
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
import type { PrepQueueDoc, SmokehouseDoc } from '@/lib/firebase/models';

import { buildTransitionRecord } from './transitions';
import type { OItemDoc, OItemItem, OItemStage, OItemStatus } from './model';

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

async function patchOItem(
  id: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  toStatus: OItemStatus,
  by: string,
  extra: Partial<OItemDoc> = {},
  reason?: string,
): Promise<void> {
  const { record, toStage } = buildTransitionRecord(
    { stage: currentStage, status: currentStatus },
    toStatus,
    by,
    reason,
  );
  await updateDoc(oiRef(id), removeUndefined({
    stage: toStage,
    status: toStatus,
    updatedAt: Timestamp.now(),
    transitions: arrayUnion(record),
    ...(extra as Record<string, unknown>),
  }));
}

async function patchOItemFields(
  id: string,
  fields: Partial<OItemDoc>,
): Promise<void> {
  await updateDoc(oiRef(id), removeUndefined({
    ...fields as Record<string, unknown>,
    updatedAt: Timestamp.now(),
  }));
}

// ── Read helpers ──────────────────────────────────────────────────────────────

export async function getOperationalItems(filter?: {
  stage?: OItemStage;
}): Promise<OItemItem[]> {
  const base = filter?.stage
    ? query(
        collectionRef('operational_items'),
        where('stage', '==', filter.stage),
        orderBy('createdAt', 'desc'),
      )
    : query(collectionRef('operational_items'), orderBy('createdAt', 'desc'));

  const snapshot = await getDocs(base);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as OItemItem[];
}

export async function getOperationalItem(id: string): Promise<OItemItem | null> {
  const snap = await getDoc(oiRef(id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as OItemItem;
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
  by = 'system',
): Promise<{ prepId: string; oItemId: string }> {
  const prepId = await sendPlanToRTC(planId);

  // Read the freshly-created prep_queue doc for its snapshot fields.
  const prepSnap = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnap.exists()) throw new Error('Created prep_queue doc not found.');
  const prep = prepSnap.data();

  const now = Timestamp.now();
  const initStatus: OItemStatus = (prep.status as OItemStatus) ?? 'staging';

  const oItemId = await createOperationalItem({
    productId: prep.productId ?? '',
    productName: prep.productNameSnapshot || prep.productName || '',
    productNameSnapshot: prep.productNameSnapshot || prep.productName || '',
    productCode: prep.productCodeSnapshot ?? prep.productCode,
    productCodeSnapshot: prep.productCodeSnapshot ?? prep.productCode,
    racks: prep.racks ?? 0,
    pieces: prep.pieces ?? 0,
    cases: prep.cases,
    poNumber: prep.poNumber ?? '',
    deliveryDate: prep.deliveryDate ?? '',
    makeDate: prep.makeDate ?? '',
    cookType: prep.cookType ?? '',
    targetTemp: prep.targetTemp ?? 0,
    expectedCookMinutes: prep.expectedCookMinutes ?? 0,
    expectedChillMinutes: prep.expectedChillMinutes,
    expectedPackMinutes: prep.expectedPackMinutes,
    rackType: prep.rackType ?? '',
    species: prep.species ?? '',
    packagingType: prep.packagingType ?? '',
    thermalOwner: prep.thermalOwner ?? '',
    criticalLimit: prep.criticalLimit,
    stage: 'rtc',
    status: initStatus,
    weeklyPlanId: planId,
    prepQueueId: prepId,
    sourcePlanId: planId,
    startTime: prep.startTime ?? now,
    assignedSmokehouse: prep.assignedSmokehouse ?? null,
    processOrder: prep.processOrder,
    plannedDate: prep.plannedDate,
    department: prep.department,
    targetSmokehouseId: prep.targetSmokehouseId,
    targetChillerId: prep.targetChillerId,
    expectedCookComplete: prep.expectedCookComplete,
    expectedChillComplete: prep.expectedChillComplete,
    packagingReadyETA: prep.packagingReadyETA,
    createdBy: prep.createdBy,
  });

  return { prepId, oItemId };
}

/**
 * Create an OItem for a manually-entered prep item (no weekly_plan origin).
 * Called after `createPrepQueueItem()` returns the new prepId.
 */
export async function oItemCreateManual(
  prepId: string,
  by = 'system',
): Promise<string> {
  const prepSnap = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnap.exists()) throw new Error('Prep queue doc not found after creation.');
  const prep = prepSnap.data();
  const now = Timestamp.now();
  const initStatus: OItemStatus = (prep.status as OItemStatus) ?? 'staging';

  return createOperationalItem({
    productId: prep.productId ?? '',
    productName: prep.productNameSnapshot || prep.productName || '',
    productNameSnapshot: prep.productNameSnapshot || prep.productName || '',
    productCode: prep.productCodeSnapshot ?? prep.productCode,
    productCodeSnapshot: prep.productCodeSnapshot ?? prep.productCode,
    racks: prep.racks ?? 0,
    pieces: prep.pieces ?? 0,
    cases: prep.cases,
    poNumber: prep.poNumber ?? '',
    deliveryDate: prep.deliveryDate ?? '',
    makeDate: prep.makeDate ?? '',
    cookType: prep.cookType ?? '',
    targetTemp: prep.targetTemp ?? 0,
    expectedCookMinutes: prep.expectedCookMinutes ?? 0,
    expectedChillMinutes: prep.expectedChillMinutes,
    expectedPackMinutes: prep.expectedPackMinutes,
    rackType: prep.rackType ?? '',
    species: prep.species ?? '',
    packagingType: prep.packagingType ?? '',
    thermalOwner: prep.thermalOwner ?? '',
    criticalLimit: prep.criticalLimit,
    stage: 'rtc',
    status: initStatus,
    prepQueueId: prepId,
    startTime: prep.startTime ?? now,
    assignedSmokehouse: prep.assignedSmokehouse ?? null,
    processOrder: prep.processOrder,
    plannedDate: prep.plannedDate,
    department: prep.department,
    createdBy: prep.createdBy ?? by,
  });
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
  await patchOItem(oItemId, currentStage, currentStatus, toStatus, by);
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
  await assignSmokehouseToPrep(prepId, smokehouseId);
  await patchOItem(oItemId, currentStage, currentStatus, 'assigned', by, {
    assignedSmokehouse: smokehouseId,
  });
}

export async function oItemVerifyLoad(
  oItemId: string,
  prepId: string,
  verifiedBy: string,
): Promise<void> {
  // Pass oItemId so verifyLoadForPrep accepts currentLoadId matching either the
  // prep doc ID OR the canonical OItem doc ID (dual-identity for child loads).
  await verifyLoadForPrep(prepId, verifiedBy, oItemId);
  await patchOItemFields(oItemId, {
    loadedVerified: true,
    loadedVerifiedBy: verifiedBy,
    loadedVerifiedAt: Timestamp.now(),
  });
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
  await updatePrepQueueAssignment(prepId, smokehouseName);
  await patchOItem(oItemId, currentStage, currentStatus, 'assigned', by, {
    assignedSmokehouse: smokehouseName,
  });
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
  await ensureSmokehouseDoc(smokehouseName);
  // Pass oItemId so the occupancy check accepts currentLoadId matching either
  // the prep ID or the OItem ID (handles edge cases from split-rack allocation).
  await startCookFromPrep(prepId, smokehouseName, extras, oItemId);
  await patchOItem(oItemId, currentStage, currentStatus, 'cooking', by, {
    assignedSmokehouse: smokehouseName,
    cookStartedAt: Timestamp.now(),
    startingTemp: extras?.startingTemp,
    startingProductTemp: extras?.startingProductTemp,
  });
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
  if (parent.prepQueueId) {
    const prepSnap = await getDoc(docRef('prep_queue', parent.prepQueueId));
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
  if (parent.prepQueueId) {
    const prepSnap = await getDoc(docRef('prep_queue', parent.prepQueueId));
    if (prepSnap.exists()) prepTemplate = prepSnap.data() as PrepQueueDoc;
  }

  let childPrepId: string | null = null;
  if (prepTemplate) {
    const childPrep: PrepQueueDoc = {
      ...prepTemplate,
      racks: assignedRackCount,
      status: 'assigned',
      stage: 'thermal',
      assignedSmokehouse: smokehouseName,
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
  // Pass oItemId for dual-identity occupancy check inside startCookForPrep.
  await startCookForPrep(prepId, extras, oItemId);
  await patchOItem(oItemId, currentStage, currentStatus, 'cooking', by, {
    cookStartedAt: Timestamp.now(),
    startingTemp: extras?.startingTemp,
    startingProductTemp: extras?.startingProductTemp,
  });
}

export async function oItemRecord50Cut(
  oItemId: string,
  prepId: string,
  extras?: { observedTemp?: number; deviation?: ThermalDeviationInput },
): Promise<void> {
  await record50CutForPrep(prepId, extras);
  const update: Partial<OItemDoc> = { cut50At: Timestamp.now() };
  if (extras?.observedTemp !== undefined) update.cut50ObservedTemp = extras.observedTemp;
  if (extras?.deviation) {
    update.hasDeviation = true;
    update.deviationType = extras.deviation.type;
    update.deviationNotes = extras.deviation.notes;
    update.deviationBy = extras.deviation.supervisorName;
    update.deviationAt = Timestamp.now();
  }
  await patchOItemFields(oItemId, update);
}

export async function oItemRecord130Cut(
  oItemId: string,
  prepId: string,
  extras?: { observedTemp?: number; deviation?: ThermalDeviationInput },
): Promise<void> {
  await record130CutForPrep(prepId, extras);
  const update: Partial<OItemDoc> = { cut130At: Timestamp.now() };
  if (extras?.observedTemp !== undefined) update.cut130ObservedTemp = extras.observedTemp;
  if (extras?.deviation) {
    update.hasDeviation = true;
    update.deviationType = extras.deviation.type;
    update.deviationNotes = extras.deviation.notes;
    update.deviationBy = extras.deviation.supervisorName;
    update.deviationAt = Timestamp.now();
  }
  await patchOItemFields(oItemId, update);
}

export async function oItemRecordSmokeApplied(
  oItemId: string,
  prepId: string,
  appliedBy: string,
): Promise<void> {
  await recordSmokeAppliedForPrep(prepId, appliedBy);
  await patchOItemFields(oItemId, {
    smokeApplied: true,
    smokeAppliedAt: Timestamp.now(),
    smokeAppliedBy: appliedBy,
  });
}

export async function oItemRecordCriticalTemp(
  oItemId: string,
  prepId: string,
  criticalTempValue: number,
  verifiedBy: string,
  extras?: { probeTemps?: number[]; deviation?: ThermalDeviationInput },
): Promise<void> {
  await recordCriticalTempForPrep(prepId, criticalTempValue, verifiedBy, extras);
  const update: Partial<OItemDoc> = {
    criticalTempReachedAt: Timestamp.now(),
    criticalTempValue,
    criticalTempVerifiedBy: verifiedBy,
  };
  if (extras?.probeTemps !== undefined) update.probeTemps = extras.probeTemps;
  if (extras?.deviation) {
    update.hasDeviation = true;
    update.deviationType = extras.deviation.type;
    update.deviationNotes = extras.deviation.notes;
    update.deviationBy = extras.deviation.supervisorName;
    update.deviationAt = Timestamp.now();
  }
  await patchOItemFields(oItemId, update);
}

export async function oItemRecordDuration(
  oItemId: string,
  prepId: string,
  required: boolean,
): Promise<void> {
  await recordDurationForPrep(prepId, required);
  await patchOItemFields(oItemId, {
    durationRequired: required,
    durationRequiredAt: Timestamp.now(),
  });
}

export async function oItemRecordEvacuation(
  oItemId: string,
  prepId: string,
  method: 'dry_vac' | 'cold_shower',
): Promise<void> {
  await recordEvacuationForPrep(prepId, method);
  await patchOItemFields(oItemId, {
    evacuationMethod: method,
    evacuationCompletedAt: Timestamp.now(),
  });
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
  await evacuateAndFinishCookForPrep(prepId, method, extras);

  // Find the newly-created chill_log doc for this prepId.
  const chillSnap = await getDocs(
    query(collectionRef('chill_logs'), where('prepId', '==', prepId)),
  );
  const chillDoc = chillSnap.docs.find((d) => d.data().status === 'waiting');
  const chillLogId = chillDoc?.id ?? null;

  await patchOItem(oItemId, currentStage, currentStatus, 'awaiting_chill', by, {
    evacuationMethod: method,
    evacuationCompletedAt: Timestamp.now(),
    chillLogId,
    chillLogStatus: 'waiting',
    chillCreatedAt: chillDoc?.data().createdAt ?? Timestamp.now(),
    ...(extras?.assignedBlastChiller ? { assignedBlastChiller: extras.assignedBlastChiller } : {}),
  });
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
  await assignChillLogToChiller(chillLogId, chillerId);
  await patchOItem(oItemId, currentStage, currentStatus, 'in_chill', by, {
    chillerId,
    chillLogStatus: 'running',
  });
}

export async function oItemRecordChillCheck(
  oItemId: string,
  chillLogId: string,
  input: { timeTo50F?: number; timeTo40F?: number },
): Promise<void> {
  await recordChillCheck(chillLogId, input);
  const update: Partial<OItemDoc> = {};
  if (input.timeTo50F !== undefined) update.timeTo50F = input.timeTo50F;
  if (input.timeTo40F !== undefined) update.timeTo40F = input.timeTo40F;
  await patchOItemFields(oItemId, update);
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
  await finishChillLog(chillLogId, extras);

  // Find the newly-created qa_check doc.
  const prepId = (await getDoc(docRef('chill_logs', chillLogId))).data()?.prepId;
  let qaCheckId: string | null = null;
  if (prepId) {
    const qaSnap = await getDocs(
      query(
        collectionRef('qa_checks'),
        where('prepId', '==', prepId),
        where('status', '==', 'ready_for_qa'),
      ),
    );
    qaCheckId = qaSnap.docs[0]?.id ?? null;
  }

  await patchOItem(oItemId, currentStage, currentStatus, 'ready_for_qa', by, {
    chillLogStatus: 'complete',
    qaCheckId,
    qaCheckStatus: 'ready_for_qa',
    qaTimestamp: Timestamp.now(),
    signedOutTemp: extras?.signedOutTemp,
    signedOutAt: extras?.signedOutTemp !== undefined ? Timestamp.now() : undefined,
    coolerId: extras?.coolerId,
    movedToCooler: extras?.coolerId !== undefined,
    timeTo50F: extras?.timeTo50F,
    timeTo40F: extras?.timeTo40F,
  });
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
  await updateQACheckReview(qaCheckId, input);

  const toStatus: OItemStatus =
    input.decision === 'approve_for_packaging'
      ? 'ready_for_packaging'
      : input.decision === 'qa_hold'
        ? 'qa_hold'
        : 'qa_review_required';

  const qaCheckStatus =
    input.decision === 'approve_for_packaging'
      ? 'ready_for_packaging'
      : input.decision === 'qa_hold'
        ? 'qa_hold'
        : 'qa_review_required';

  await patchOItem(oItemId, currentStage, currentStatus, toStatus, by, {
    qaCheckStatus,
    qaDecision: input.decision,
    qaReviewedBy: input.reviewedBy,
    qaReviewedAt: Timestamp.now(),
    qaNotes: input.notes,
  });
}

export async function oItemQAResubmit(
  oItemId: string,
  currentStage: OItemStage,
  currentStatus: OItemStatus,
  qaCheckId: string,
  resubmissionNote: string,
  by = 'system',
): Promise<void> {
  await resubmitQACheckForReview(qaCheckId, resubmissionNote);
  await patchOItem(oItemId, currentStage, currentStatus, 'ready_for_qa', by, {
    qaCheckStatus: 'ready_for_qa',
    qaReviewedBy: null,
    qaReviewedAt: null,
  });
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
  const packagingLogId = await startPackagingForQACheck(qaCheckId);
  await patchOItem(oItemId, currentStage, currentStatus, 'packaging_in_progress', by, {
    packagingLogId,
    packagingLogStatus: 'running',
    packagingStartedAt: Timestamp.now(),
  });
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
  await completePackagingLog(packagingLogId, input);
  await patchOItem(oItemId, currentStage, currentStatus, 'packaging_complete', by, {
    packagingLogStatus: 'complete',
    casesProduced: input.casesProduced,
    unitsProduced: input.unitsProduced,
    yieldPercent: input.yieldPercent,
    packagingLine: input.packagingLine,
    packagedBy: input.packagedBy,
    packagingNotes: input.notes,
    packagingCompletedAt: Timestamp.now(),
  });
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
