import {
  addDoc,
  arrayUnion,
  deleteDoc,
  doc as firestoreDoc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  QueryDocumentSnapshot,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { collectionRef, docRef } from '@/lib/firebase/collections';
import { db } from '@/lib/firebase/config';
import { toMillis, toSafeDate } from '@/lib/utils/dates';
import {
  AlertDoc,
  ChillerDoc,
  ChillLogDoc,
  CookLogDoc,
  PackagingLogDoc,
  ProductDoc,
  PrepQueueDoc,
  QACheckDoc,
  SmokehouseDoc,
  ThermalDeviationEntry,
  UserDoc,
  WeeklyPlanDoc,
} from '@/lib/firebase/models';
import { recordOperationalEvent } from '@/lib/operational-events';

/** Input required to record a thermal step deviation.
 *  Deviations allow an out-of-range step to proceed with supervisor approval. */
export interface ThermalDeviationInput {
  type: string;          // e.g. 'cut50_temp_high', 'cut130_6h_window', 'critical_temp_below_target'
  notes: string;         // Reason / corrective context (required)
  supervisorName: string; // Supervisor name or initials (required)
  observedValue?: number; // The out-of-range value that triggered the deviation
}

export type NewUserInput = Omit<UserDoc, 'createdAt'> & { createdAt?: Timestamp };
export type NewQACheckInput = Omit<QACheckDoc, 'timestamp'> & { timestamp?: Timestamp };
export type NewAlertInput = Omit<AlertDoc, 'createdAt'> & { createdAt?: Timestamp };
export type PrepQueueItem = PrepQueueDoc & { id: string };
export type SmokehouseItem = SmokehouseDoc & { id: string };
export type ProductItem = ProductDoc & { id: string };
export type ChillLogItem = ChillLogDoc & { id: string };
export type ChillerItem = ChillerDoc & { id: string };
export type QACheckItem = QACheckDoc & { id: string };
export type PackagingLogItem = PackagingLogDoc & { id: string };
export type NewProductInput = Omit<ProductDoc, 'createdAt'> & {
  createdAt?: Timestamp;
};

function removeUndefinedFields<T>(value: T): T {
  const removed: string[] = [];
  function walk<V>(node: V, path: string): V {
    if (Array.isArray(node)) {
      return node
        .map((item, idx) => walk(item, `${path}[${idx}]`))
        .filter((item) => item !== undefined) as V;
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      Object.entries(node as Record<string, unknown>).forEach(([k, v]) => {
        const p = path ? `${path}.${k}` : k;
        if (v === undefined) {
          removed.push(p);
          return;
        }
        out[k] = walk(v, p);
      });
      return out as V;
    }
    return node;
  }
  const result = walk(value, '');
  if (__DEV__ && removed.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[sanitizer] Removed undefined fields: ${removed.join(', ')}`);
  }
  return result;
}

function safeDateString(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function safeNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeForWrite<T>(value: T): T {
  return removeUndefinedFields(value);
}

function sanitizeWithSafePrimitives<T>(value: T): T {
  const out: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
    if (k.toLowerCase().includes('date') || k.toLowerCase().endsWith('eta') || k.toLowerCase().includes('time')) {
      if (typeof v === 'string' || v instanceof Date) {
        out[k] = safeDateString(v);
        return;
      }
    }
    if (typeof v === 'number') {
      out[k] = safeNumber(v);
      return;
    }
    out[k] = v;
  });
  return sanitizeForWrite(out as T);
}

function assertPrepStage(
  prepItem: PrepQueueDoc,
  expectedStage: NonNullable<PrepQueueDoc['stage']>,
  action: string,
) {
  if (prepItem.stage !== expectedStage) {
    throw new Error(
      `${action} blocked: expected stage "${expectedStage}" but found "${prepItem.stage ?? 'undefined'}".`,
    );
  }
}

export async function getProducts(): Promise<ProductItem[]> {
  const snapshot = await getDocs(
    query(collectionRef('products'), where('active', '==', true), orderBy('name', 'asc')),
  );
  return snapshot.docs.map((item: QueryDocumentSnapshot<ProductDoc>) => ({
    id: item.id,
    ...item.data(),
  }));
}

export async function getActiveProducts(): Promise<ProductItem[]> {
  return getProducts();
}

export async function createProduct(input: NewProductInput) {
  const payload: ProductDoc = {
    ...input,
    active: input.active ?? true,
    createdAt: input.createdAt ?? Timestamp.now(),
  };

  const ref = await addDoc(collectionRef('products'), sanitizeForWrite(payload));
  return ref.id;
}

export async function updateProduct(productId: string, updates: Partial<Omit<ProductDoc, 'createdAt'>>) {
  await updateDoc(docRef('products', productId), sanitizeForWrite(updates));
}

export async function deactivateProduct(productId: string) {
  await updateDoc(docRef('products', productId), sanitizeForWrite({
    active: false,
  }));
}

/** Fetch ALL products, including inactive ones. Used by Planning to manage the full master list. */
export async function getAllProducts(): Promise<ProductItem[]> {
  const snapshot = await getDocs(query(collectionRef('products'), orderBy('name', 'asc')));
  return snapshot.docs.map((item: QueryDocumentSnapshot<ProductDoc>) => ({
    id: item.id,
    ...item.data(),
  }));
}

/** Reactivate a previously deactivated product. */
export async function reactivateProduct(productId: string) {
  await updateDoc(docRef('products', productId), sanitizeForWrite({ active: true }));
}

// ── Weekly Plan ───────────────────────────────────────────────────────────────

export type WeeklyPlanItem = WeeklyPlanDoc & { id: string };

export async function getWeeklyPlanItems(): Promise<WeeklyPlanItem[]> {
  const snapshot = await getDocs(query(collectionRef('weekly_plan')));
  return snapshot.docs
    .map((item: QueryDocumentSnapshot<WeeklyPlanDoc>) => ({
      id: item.id,
      ...item.data(),
    }))
    .filter((item) => item.status !== 'cancelled')
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
}

export async function createWeeklyPlanItem(input: Omit<WeeklyPlanDoc, 'createdAt'> & { createdAt?: import('firebase/firestore').Timestamp }): Promise<string> {
  const payload: WeeklyPlanDoc = {
    ...input,
    createdAt: input.createdAt ?? Timestamp.now(),
  };
  const ref = await addDoc(collectionRef('weekly_plan'), sanitizeForWrite(payload));
  return ref.id;
}

export async function updateWeeklyPlanItem(planId: string, updates: Partial<Omit<WeeklyPlanDoc, 'createdAt' | 'createdBy'>>): Promise<void> {
  await updateDoc(docRef('weekly_plan', planId), removeUndefinedFields(updates as Record<string, unknown>));
}

export async function deleteWeeklyPlanItem(planId: string): Promise<void> {
  await deleteDoc(docRef('weekly_plan', planId));
}

/** Mark a weekly plan item as having a linked RTC prep queue item.
 *  Called after createPrepQueueItem succeeds for that plan entry. */
export async function markWeeklyPlanRtcCreated(planId: string, prepId: string): Promise<void> {
  await updateDoc(docRef('weekly_plan', planId), sanitizeForWrite({
    status: 'RTC',
    rtcPrepId: prepId,
    linkedPrepQueueId: prepId,
  }));
}

export async function updatePlanStatus(planId: string, status: WeeklyPlanDoc['status']): Promise<void> {
  const boardStatusMap: Partial<Record<WeeklyPlanDoc['status'], WeeklyPlanDoc['boardStatus']>> = {
    planned: 'planned',
    RTC: 'rtc',
    'Ready for Thermal': 'ready_for_thermal',
    Cooking: 'cooking',
    'Awaiting Chill': 'awaiting_chill',
    'Chill Running': 'chill_running',
    'Ready for QA': 'ready_for_qa',
    'Ready for Packaging': 'ready_for_packaging',
    Complete: 'complete',
    Hold: 'deviation',
  };
  await updateDoc(docRef('weekly_plan', planId), sanitizeForWrite({
    status,
    ...(boardStatusMap[status] ? { boardStatus: boardStatusMap[status] } : {}),
  }));
}

export async function linkPlanToPrepQueue(planId: string, prepQueueId: string): Promise<void> {
  await updateDoc(docRef('weekly_plan', planId), sanitizeForWrite({
    linkedPrepQueueId: prepQueueId,
    rtcPrepId: prepQueueId,
  }));
}

function timestampToIsoString(value?: Timestamp | null): string {
  const date = toSafeDate(value);
  return date ? date.toISOString() : '';
}

export async function sendPlanToRTC(planId: string): Promise<string> {
  const planSnapshot = await getDoc(docRef('weekly_plan', planId));
  if (!planSnapshot.exists()) throw new Error('Plan row does not exist.');
  const plan = planSnapshot.data();
  if (plan.linkedPrepQueueId) {
    throw new Error('This plan row is already sent to RTC.');
  }

  const prepPayload: PrepQueueDoc = {
    productId: plan.productId,
    productName: plan.productName,
    productNameSnapshot: plan.productName,
    productCodeSnapshot: plan.productCodeSnapshot,
    productCode: plan.productCodeSnapshot,
    processOrder: plan.processOrder ?? '',
    cases: plan.cases ?? 0,
    racks: plan.plannedRacks ?? 0,
    pieces: plan.plannedPieces ?? 0,
    poNumber: plan.processOrder ?? `PLAN-${planId.slice(0, 8)}`,
    deliveryDate: plan.plannedDate,
    makeDate: plan.plannedDate,
    plannedDate: plan.plannedDate,
    department: plan.productionSection ?? 'process_meats',
    expectedCookComplete: timestampToIsoString(plan.expectedCookComplete),
    expectedChillComplete: timestampToIsoString(plan.expectedChillComplete),
    expectedBlastCellComplete: timestampToIsoString(plan.expectedBlastCellComplete),
    packagingReadyETA: timestampToIsoString(plan.packagingReadyETA),
    targetSmokehouseId: plan.assignedSmokehouse ?? undefined,
    targetChillerId: plan.assignedChiller ?? undefined,
    status: 'staged',
    stage: 'rtc',
    startTime: Timestamp.now(),
    createdBy: plan.createdBy || 'planner',
    assignedSmokehouse: plan.assignedSmokehouse ?? null,
    cookType: plan.processType ?? 'unspecified',
    targetTemp: 0,
    expectedCookMinutes: Math.round((plan.estimatedCookTimeHours ?? 0) * 60),
    expectedChillMinutes: Math.round((plan.estimatedChillTimeHours ?? 0) * 60),
    expectedPackMinutes: 30,
    rackType: 'Standard',
    species: plan.species ?? 'unknown',
    packagingType: 'Standard',
    thermalOwner: '',
    criticalLimit: plan.criticalLimit,
    sourcePlanId: planId,
  };

  const prepId = await createPrepQueueItem(prepPayload);
  await updateDoc(docRef('weekly_plan', planId), sanitizeForWrite({
    status: 'RTC',
    boardStatus: 'rtc',
    linkedPrepQueueId: prepId,
    rtcPrepId: prepId,
  }));
  await recordOperationalEvent({
    department: 'rtc',
    weeklyPlanId: planId,
    prepId,
    type: 'other',
    severity: 'info',
    notes: `${plan.productName} sent to RTC from Planning.`,
    operator: plan.createdBy || 'planner',
    productCode: plan.productCodeSnapshot ?? null,
    productName: plan.productName ?? null,
    targetDepartment: 'rtc',
  });
  return prepId;
}

export async function createUser(userId: string, input: NewUserInput) {
  const payload: UserDoc = {
    ...input,
    createdAt: input.createdAt ?? Timestamp.now(),
  };

  await setDoc(docRef('users', userId), sanitizeForWrite(payload));
  return payload;
}

export async function createPrepItem(input: PrepQueueDoc) {
  const ref = await addDoc(
    collectionRef('prep_queue'),
    removeUndefinedFields({ ...input, stage: 'rtc' as const }),
  );
  return ref.id;
}

export async function readPrepQueue() {
  const prepQueueQuery = query(collectionRef('prep_queue'), orderBy('startTime', 'asc'));
  const snapshot = await getDocs(prepQueueQuery);

  return snapshot.docs.map((item: QueryDocumentSnapshot<PrepQueueDoc>) => ({
    id: item.id,
    ...item.data(),
  }));
}

export async function getPrepQueueItems(): Promise<PrepQueueItem[]> {
  return readPrepQueue();
}

export async function getPrepQueueByStatus(status: PrepQueueDoc['status']): Promise<PrepQueueItem[]> {
  const snapshot = await getDocs(query(collectionRef('prep_queue'), where('status', '==', status)));
  return snapshot.docs.map((item: QueryDocumentSnapshot<PrepQueueDoc>) => ({
    id: item.id,
    ...item.data(),
  }));
}

export async function createPrepQueueItem(input: PrepQueueDoc) {
  return createPrepItem(input);
}

async function hasPrepDownstreamProgress(prepId: string): Promise<boolean> {
  const [chillLogsSnapshot, qaChecksSnapshot, packagingSnapshot] = await Promise.all([
    getDocs(query(collectionRef('chill_logs'), where('prepId', '==', prepId), limit(1))),
    getDocs(query(collectionRef('qa_checks'), where('prepId', '==', prepId), limit(1))),
    getDocs(query(collectionRef('packaging_logs'), where('prepId', '==', prepId), limit(1))),
  ]);
  return !chillLogsSnapshot.empty || !qaChecksSnapshot.empty || !packagingSnapshot.empty;
}

export async function markPrepQueueItemReady(prepId: string) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) {
    throw new Error('Selected prep item does not exist.');
  }

  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'rtc', 'RTC ready handoff');
  if (prepItem.status === 'ready') {
    throw new Error('Selected prep item is already ready.');
  }
  if (prepItem.status !== 'staging') {
    throw new Error('Only staging prep items can be marked ready.');
  }
  if (prepItem.assignedSmokehouse) {
    throw new Error('Assigned prep items cannot be marked ready from RTC.');
  }
  if (await hasPrepDownstreamProgress(prepId)) {
    throw new Error('Selected prep item is workflow-locked by downstream records.');
  }

  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({
    status: 'ready',
    stage: 'thermal',
  }));
}

export async function startPrep(prepId: string): Promise<void> {
  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({
    status: 'prepping',
    prepStartedAt: safeDateString(new Date()),
  }));
}

export async function markReadyForThermal(prepId: string): Promise<void> {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prep = prepSnapshot.data();
  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({
    status: 'ready_for_thermal',
    stage: 'thermal',
    readyForThermalAt: safeDateString(new Date()),
  }));
  if (prep.sourcePlanId) {
    await updatePlanStatus(prep.sourcePlanId, 'Ready for Thermal');
  }
  await recordOperationalEvent({
    department: 'rtc',
    targetDepartment: 'thermal',
    weeklyPlanId: prep.sourcePlanId ?? null,
    prepId,
    productCode: prep.productCodeSnapshot ?? prep.productCode ?? null,
    productName: prep.productName ?? null,
    type: 'ready_for_thermal',
    severity: 'info',
    notes: `${prep.productNameSnapshot || prep.productName} is ready for Thermal loading.`,
    operator: prep.createdBy || 'rtc',
  });
}

export async function holdPrepItem(prepId: string, reason: string): Promise<void> {
  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({
    status: 'hold',
    holdReason: reason.trim() || 'Hold set by operator',
  }));
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (prepSnapshot.exists() && prepSnapshot.data().sourcePlanId) {
    await updatePlanStatus(prepSnapshot.data().sourcePlanId!, 'Hold');
  }
}

export async function movePrepDownstream(prepId: string): Promise<void> {
  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({
    status: 'moved_downstream',
    movedDownstreamAt: safeDateString(new Date()),
  }));
}

export async function getReadyForThermalItems(): Promise<PrepQueueItem[]> {
  const rows = await getPrepQueueByStatus('ready_for_thermal');
  return rows.filter((row) => !row.stage || row.stage === 'rtc' || row.stage === 'thermal');
}

export async function assignSmokehouseToPrep(prepId: string, smokehouseId: string): Promise<void> {
  await updatePrepQueueAssignment(prepId, smokehouseId);
}

export async function startCookFromPrep(
  prepId: string,
  smokehouseId: string,
  extras?: { startingTemp?: number; startingProductTemp?: number },
  oItemId?: string,
): Promise<void> {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prep = prepSnapshot.data();
  if (!prep.assignedSmokehouse) {
    await assignSmokehouseToPrep(prepId, smokehouseId);
  } else if (prep.assignedSmokehouse !== smokehouseId) {
    throw new Error(`Prep item is already assigned to Smokehouse ${prep.assignedSmokehouse}.`);
  }
  await startCookForPrep(prepId, extras, oItemId);
  const refreshedPrepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!refreshedPrepSnapshot.exists()) return;
  const refreshedPrep = refreshedPrepSnapshot.data();
  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({ status: 'in_thermal' }));
  if (refreshedPrep.sourcePlanId) {
    await updatePlanStatus(refreshedPrep.sourcePlanId, 'Cooking');
  }
  await recordOperationalEvent({
    department: 'thermal',
    weeklyPlanId: refreshedPrep.sourcePlanId ?? null,
    prepId,
    type: 'other',
    severity: 'info',
    notes: `Cook started in Smokehouse ${smokehouseId}.`,
    operator: 'thermal',
    equipment: `Smokehouse ${smokehouseId}`,
    productCode: refreshedPrep.productCodeSnapshot ?? refreshedPrep.productCode ?? null,
    productName: refreshedPrep.productName ?? null,
  });
}

export async function deletePrepQueueItem(prepId: string) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) {
    throw new Error('Prep item does not exist.');
  }
  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'rtc', 'RTC delete');
  if (prepItem.status !== 'staging') {
    throw new Error('Only staging prep items can be removed. Move to a different stage first.');
  }
  if (await hasPrepDownstreamProgress(prepId)) {
    throw new Error('Selected prep item is workflow-locked by downstream records.');
  }
  await deleteDoc(docRef('prep_queue', prepId));
}

export async function updatePrepQueueAssignment(prepId: string, assignedSmokehouse: string) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) {
    throw new Error('Selected prep item does not exist.');
  }

  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Thermal assignment');
  if (prepItem.status !== 'staging' && prepItem.status !== 'ready') {
    if (prepItem.status !== 'ready_for_thermal') {
      throw new Error('Only staged/ready prep items can be assigned.');
    }
  }
  if (prepItem.assignedSmokehouse) {
    throw new Error('Selected prep item is already assigned to a smokehouse.');
  }
  if (await hasPrepDownstreamProgress(prepId)) {
    throw new Error('Selected prep item is workflow-locked by downstream records.');
  }

  const smokehouseName = assignedSmokehouse.trim();
  if (!smokehouseName) {
    throw new Error('Assigned smokehouse is required.');
  }

  const smokehouseSnapshot = await getDocs(
    query(collectionRef('smokehouses'), where('name', '==', smokehouseName), limit(1)),
  );
  if (smokehouseSnapshot.empty) {
    throw new Error('Assigned smokehouse does not exist.');
  }
  const smokehouse = smokehouseSnapshot.docs[0].data();
  if (smokehouse.status === 'cleaning') {
    throw new Error('Assigned smokehouse is currently cleaning.');
  }

  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({
    status: 'assigned',
    stage: 'thermal',
    assignedSmokehouse: smokehouseName,
  }));
}

/**
 * Start a cook for a prep item.
 *
 * @param prepId   - The prep_queue document ID.
 * @param extras   - Optional starting temperatures.
 * @param oItemId  - Optional canonical OItem doc ID. Allows the occupancy
 *                   check to accept currentLoadId that matches either prepId
 *                   or oItemId (split child loads use a new prepId but the
 *                   smokehouse may have been pre-reserved with the oItemId).
 */
export async function startCookForPrep(
  prepId: string,
  extras?: { startingTemp?: number; startingProductTemp?: number },
  oItemId?: string,
) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) {
    throw new Error('Selected prep item does not exist.');
  }

  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Start cook');
  if (prepItem.status === 'cooking') {
    throw new Error('Selected prep item is already cooking.');
  }
  if (prepItem.status !== 'assigned') {
    throw new Error('Only assigned prep items can start cook.');
  }
  if (!prepItem.assignedSmokehouse) {
    throw new Error('Selected prep item is missing assigned smokehouse.');
  }
  if (await hasPrepDownstreamProgress(prepId)) {
    throw new Error('Selected prep item is workflow-locked by downstream records.');
  }

  const smokehouseSnapshot = await getDocs(
    query(collectionRef('smokehouses'), where('name', '==', prepItem.assignedSmokehouse), limit(1)),
  );
  if (smokehouseSnapshot.empty) {
    throw new Error('Assigned smokehouse does not exist.');
  }

  const smokehouseDoc = smokehouseSnapshot.docs[0];
  const smokehouseItem = smokehouseDoc.data();
  if (smokehouseItem.status === 'cleaning') {
    throw new Error('Assigned smokehouse is currently cleaning.');
  }

  // Dual-identity occupancy check with stale-reference repair.
  const allowedLoadIds = new Set<string>([prepId]);
  if (oItemId) allowedLoadIds.add(oItemId);
  const startCookCurrentLoadId = smokehouseItem.currentLoadId;
  if (startCookCurrentLoadId && !allowedLoadIds.has(startCookCurrentLoadId)) {
    const currentLoadActive = await isSmokehouseCurrentLoadActive(startCookCurrentLoadId);
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[VERIFY_LOAD_OCCUPANCY_REPAIR]', {
        smokehouseName: prepItem.assignedSmokehouse,
        currentLoadId: startCookCurrentLoadId,
        prepId,
        oItemId: oItemId ?? null,
        currentLoadActive,
        action: currentLoadActive ? 'block' : 'repair',
        reason: currentLoadActive ? 'startCook-active-conflict' : 'startCook-stale-currentLoadId',
      });
    }
    if (currentLoadActive) {
      throw new Error('Assigned smokehouse already has a different active load.');
    }
    // else: stale reference — will be overwritten when batch commits below
  }
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[THERMAL_VERIFY_GUARD]', {
      mode: 'start_cook',
      smokehouseName: prepItem.assignedSmokehouse,
      currentLoadId: startCookCurrentLoadId ?? null,
      prepId,
      oItemId: oItemId ?? null,
      allowed: !startCookCurrentLoadId || allowedLoadIds.has(startCookCurrentLoadId),
      reason: !startCookCurrentLoadId
        ? 'currentLoadId-null'
        : allowedLoadIds.has(startCookCurrentLoadId)
          ? 'currentLoadId-matches-item'
          : 'currentLoadId-different',
    });
  }

  const prepUpdates: Record<string, unknown> = { status: 'cooking', cookStartedAt: Timestamp.now() };
  if (extras?.startingTemp !== undefined) {
    prepUpdates.startingTemp = extras.startingTemp;
  }
  if (extras?.startingProductTemp !== undefined) {
    prepUpdates.startingProductTemp = extras.startingProductTemp;
  }

  const batch = writeBatch(db);
  batch.update(docRef('prep_queue', prepId), sanitizeWithSafePrimitives(prepUpdates));
  // Always normalise currentLoadId to prepId for downstream consistency.
  batch.update(smokehouseDoc.ref, sanitizeForWrite({ status: 'cooking', currentLoadId: prepId }));
  await batch.commit();
}

export async function finishCookForPrep(prepId: string, extras?: { assignedBlastChiller?: string }) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) {
    throw new Error('Selected prep item does not exist.');
  }

  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Finish cook');
  if (prepItem.status !== 'cooking') {
    throw new Error('Only cooking prep items can be finished.');
  }
  if (!prepItem.assignedSmokehouse) {
    throw new Error('Cooking prep item is missing assigned smokehouse.');
  }
  if (await hasPrepDownstreamProgress(prepId)) {
    throw new Error('Selected prep item is workflow-locked by downstream records.');
  }

  const smokehouseSnapshot = await getDocs(
    query(collectionRef('smokehouses'), where('name', '==', prepItem.assignedSmokehouse), limit(1)),
  );
  if (smokehouseSnapshot.empty) {
    throw new Error('Linked smokehouse does not exist.');
  }

  const smokehouseDoc = smokehouseSnapshot.docs[0];
  const smokehouseItem = smokehouseDoc.data();
  if (smokehouseItem.currentLoadId !== prepId) {
    throw new Error('Linked smokehouse load does not match selected prep item.');
  }

  const prepUpdates: Record<string, unknown> = { status: 'awaiting_chill', stage: 'chill' };
  if (extras?.assignedBlastChiller) {
    prepUpdates.assignedBlastChiller = extras.assignedBlastChiller;
  }

  const chillLogRef = firestoreDoc(collectionRef('chill_logs'));
  const batch = writeBatch(db);
  batch.update(docRef('prep_queue', prepId), sanitizeWithSafePrimitives(prepUpdates));
  batch.update(smokehouseDoc.ref, sanitizeForWrite({ status: 'idle', currentLoadId: null }));
  batch.set(chillLogRef, sanitizeWithSafePrimitives({
    chillerId: null,
    productName: prepItem.productNameSnapshot || prepItem.productName,
    prepId,
    timeTo50F: null,
    timeTo40F: null,
    status: 'waiting' as const,
    createdAt: Timestamp.now(),
    cookType: prepItem.cookType,
    targetTemp: prepItem.targetTemp,
    expectedCookMinutes: prepItem.expectedCookMinutes,
    rackType: prepItem.rackType,
    species: prepItem.species,
    packagingType: prepItem.packagingType,
    thermalOwner: prepItem.thermalOwner,
    makeDate: prepItem.makeDate,
    deliveryDate: prepItem.deliveryDate,
    racks: prepItem.racks,
    pieces: prepItem.pieces,
    // Carry thermal deviation count so the Chill page can surface a warning badge.
    thermalDeviationCount: prepItem.thermalDeviations?.length ?? 0,
  }) as ChillLogDoc);
  await batch.commit();
  await recordOperationalEvent({
    department: 'thermal',
    prepId,
    type: 'other',
    severity: 'info',
    notes: `Cook complete. Awaiting chill handoff created${extras?.assignedBlastChiller ? ` (Blast: ${extras.assignedBlastChiller})` : ''}.`,
    operator: 'thermal',
    equipment: prepItem.assignedSmokehouse ? `Smokehouse ${prepItem.assignedSmokehouse}` : null,
    productCode: prepItem.productCodeSnapshot ?? null,
    productName: prepItem.productNameSnapshot ?? prepItem.productName ?? null,
    targetDepartment: 'chill',
  });
}

export async function createSmokehouse(id: string, input: SmokehouseDoc) {
  await setDoc(docRef('smokehouses', id), sanitizeForWrite(input));
  return input;
}

export async function getSmokehouses(): Promise<SmokehouseItem[]> {
  const snapshot = await getDocs(query(collectionRef('smokehouses'), orderBy('name', 'asc')));
  return snapshot.docs.map((item: QueryDocumentSnapshot<SmokehouseDoc>) => ({
    id: item.id,
    ...item.data(),
  }));
}

export async function createChiller(id: string, input: ChillerDoc) {
  await setDoc(docRef('chillers', id), sanitizeForWrite(input));
  return input;
}

export async function getChillers(): Promise<ChillerItem[]> {
  const snapshot = await getDocs(query(collectionRef('chillers'), orderBy('name', 'asc')));
  return snapshot.docs.map((item: QueryDocumentSnapshot<ChillerDoc>) => ({
    id: item.id,
    ...item.data(),
  }));
}

/** Ensure a chiller doc exists by display name (e.g. "Chiller 4").
 *  If missing, create it in idle state and return the created record. */
export async function ensureChillerDoc(chillerName: string): Promise<ChillerItem> {
  const name = chillerName.trim();
  if (!name) throw new Error('Chiller name is required.');

  const existing = await getDocs(
    query(collectionRef('chillers'), where('name', '==', name), limit(1)),
  );
  if (!existing.empty) {
    const item = existing.docs[0];
    return { id: item.id, ...item.data() };
  }

  const normalizedId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const chillerId = normalizedId || `chiller-${Date.now()}`;
  const payload: ChillerDoc = {
    name,
    status: 'idle',
    currentLoadId: null,
  };
  await setDoc(docRef('chillers', chillerId), sanitizeForWrite(payload));
  return { id: chillerId, ...payload };
}

export async function createCookLog(input: CookLogDoc) {
  const ref = await addDoc(collectionRef('cook_logs'), sanitizeForWrite(input));
  return ref.id;
}

export async function createChillLog(input: ChillLogDoc) {
  const ref = await addDoc(collectionRef('chill_logs'), sanitizeForWrite(input));
  return ref.id;
}

export async function getChillLogs(): Promise<ChillLogItem[]> {
  const snapshot = await getDocs(query(collectionRef('chill_logs'), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((item: QueryDocumentSnapshot<ChillLogDoc>) => ({
    id: item.id,
    ...item.data(),
  }));
}

export async function assignChillLogToChiller(chillLogId: string, chillerId: string) {
  const chillLogSnapshot = await getDoc(docRef('chill_logs', chillLogId));
  if (!chillLogSnapshot.exists()) {
    throw new Error('Selected chill handoff does not exist.');
  }

  const chillLog = chillLogSnapshot.data();
  if (chillLog.prepId) {
    const prepSnapshot = await getDoc(docRef('prep_queue', chillLog.prepId));
    if (!prepSnapshot.exists()) throw new Error('Linked prep item does not exist.');
    assertPrepStage(prepSnapshot.data(), 'chill', 'Chiller assignment');
  }
  if (chillLog.status === 'running') {
    throw new Error('Selected chill handoff is already running.');
  }
  if (chillLog.status !== 'waiting') {
    throw new Error('Only waiting chill handoffs can be started.');
  }

  const chillerSnapshot = await getDoc(docRef('chillers', chillerId));
  if (!chillerSnapshot.exists()) {
    throw new Error('Selected chiller does not exist.');
  }

  const chiller = chillerSnapshot.data();
  if (chiller.status === 'cleaning') {
    throw new Error('Selected chiller is currently cleaning.');
  }
  if (chiller.currentLoadId && chiller.currentLoadId !== chillLog.prepId) {
    throw new Error('Selected chiller already has a different active load.');
  }

  const batch = writeBatch(db);
  batch.update(docRef('chill_logs', chillLogId), sanitizeForWrite({
    chillerId,
    status: 'running',
  }));
  batch.update(docRef('chillers', chillerId), sanitizeForWrite({
    status: 'chilling',
    currentLoadId: chillLog.prepId,
  }));
  await batch.commit();
  await recordOperationalEvent({
    department: 'chill',
    prepId: chillLog.prepId ?? null,
    chillLogId,
    type: 'other',
    severity: 'info',
    notes: `Chill started on chiller ${chillerId}.`,
    operator: 'chill',
    equipment: `Chiller ${chillerId}`,
    productName: chillLog.productName ?? null,
    targetDepartment: 'chill',
  });
}

export async function getQAChecks(): Promise<QACheckItem[]> {
  const snapshot = await getDocs(query(collectionRef('qa_checks'), orderBy('timestamp', 'desc')));
  return snapshot.docs.map((item: QueryDocumentSnapshot<QACheckDoc>) => ({
    id: item.id,
    ...item.data(),
  }));
}

export async function updateQACheckReview(
  qaCheckId: string,
  input: { decision: 'approve_for_packaging' | 'qa_hold' | 'needs_review'; reviewedBy: string; notes?: string },
) {
  const qaCheckSnapshot = await getDoc(docRef('qa_checks', qaCheckId));
  if (!qaCheckSnapshot.exists()) {
    throw new Error('Selected QA check does not exist.');
  }

  const qaCheck = qaCheckSnapshot.data();
  if (qaCheck.prepId) {
    const prepSnapshot = await getDoc(docRef('prep_queue', qaCheck.prepId));
    if (!prepSnapshot.exists()) throw new Error('Linked prep item does not exist.');
    assertPrepStage(prepSnapshot.data(), 'qa', 'QA review');
  }
  if (qaCheck.status !== 'ready_for_qa') {
    throw new Error('Only Ready for QA checks can be reviewed.');
  }

  const decision = input.decision;
  if (!decision) {
    throw new Error('QA decision is required.');
  }
  const reviewedBy = input.reviewedBy.trim();
  if (!reviewedBy) {
    throw new Error('QA reviewer is required.');
  }
  const notes = (input.notes ?? '').trim();
  if (notes.length < 10) {
    throw new Error('QA notes must be at least 10 characters.');
  }

  const updatePayload: Partial<QACheckDoc> = {
    status:
      decision === 'approve_for_packaging'
        ? 'ready_for_packaging'
        : decision === 'qa_hold'
          ? 'qa_hold'
          : 'qa_review_required',
    decision,
    reviewedBy,
    reviewedAt: Timestamp.now(),
  };
  if (notes) {
    updatePayload.notes = notes;
  }
  const batch = writeBatch(db);
  batch.update(docRef('qa_checks', qaCheckId), sanitizeForWrite(updatePayload));
  if (qaCheck.prepId) {
    batch.update(docRef('prep_queue', qaCheck.prepId), sanitizeForWrite({
      stage: decision === 'approve_for_packaging' ? 'packaging' : 'qa',
      status:
        decision === 'approve_for_packaging'
          ? 'ready_for_packaging'
          : decision === 'qa_hold'
            ? 'qa_hold'
            : 'qa_review_required',
    }));
  }
  await batch.commit();
  if (decision === 'approve_for_packaging') {
    await recordOperationalEvent({
      department: 'qa',
      prepId: qaCheck.prepId ?? null,
      chillLogId: qaCheck.chillLogId ?? null,
      type: 'other',
      severity: 'info',
      notes: `Released to Packaging by ${reviewedBy}.`,
      operator: reviewedBy,
      productName: qaCheck.productName ?? null,
      targetDepartment: 'packaging',
    });
  }
}

export async function finishChillLog(
  chillLogId: string,
  extras?: {
    signedOutTemp?: number;
    coolerId?: string;
    /** Minutes from chill start until product reached 50°F */
    timeTo50F?: number;
    /** Minutes from chill start until product reached 40°F */
    timeTo40F?: number;
  },
) {
  // Food safety hard check: sign-out temp must be ≤ 40°F.
  if (extras?.signedOutTemp !== undefined && extras.signedOutTemp > 40) {
    throw new Error(
      `Sign-out temp ${extras.signedOutTemp}°F exceeds 40°F maximum. ` +
        `Product must be at or below 40°F before sign-out. Verify reading or wait for further chilling.`,
    );
  }

  const chillLogSnapshot = await getDoc(docRef('chill_logs', chillLogId));
  if (!chillLogSnapshot.exists()) {
    throw new Error('Selected chill log does not exist.');
  }

  const chillLog = chillLogSnapshot.data();
  if (chillLog.prepId) {
    const prepSnapshot = await getDoc(docRef('prep_queue', chillLog.prepId));
    if (!prepSnapshot.exists()) throw new Error('Linked prep item does not exist.');
    assertPrepStage(prepSnapshot.data(), 'chill', 'Finish chill');
  }
  if (chillLog.status !== 'running') {
    throw new Error('Only running chill logs can be finished.');
  }
  if (!chillLog.chillerId) {
    throw new Error('Running chill log is missing linked chiller.');
  }

  const chillerSnapshot = await getDoc(docRef('chillers', chillLog.chillerId));
  if (!chillerSnapshot.exists()) {
    throw new Error('Linked chiller does not exist.');
  }
  const chiller = chillerSnapshot.data();
  if (chiller.currentLoadId !== chillLog.prepId && chiller.currentLoadId !== chillLogId) {
    throw new Error('Linked chiller load does not match selected chill log.');
  }

  // Build chill_log milestone updates.
  const chillLogUpdates: Record<string, unknown> = { status: 'complete' };
  if (extras?.timeTo50F !== undefined) chillLogUpdates.timeTo50F = extras.timeTo50F;
  if (extras?.timeTo40F !== undefined) chillLogUpdates.timeTo40F = extras.timeTo40F;

  // Build prep_queue sign-out updates.
  const prepSignOutUpdates: Record<string, unknown> = {};
  if (extras?.signedOutTemp !== undefined) {
    prepSignOutUpdates.signedOutAt = Timestamp.now();
    prepSignOutUpdates.signedOutTemp = extras.signedOutTemp;
  }
  if (extras?.coolerId !== undefined) {
    prepSignOutUpdates.movedToCooler = true;
    prepSignOutUpdates.coolerId = extras.coolerId;
  }

  // Read prep record to carry thermal execution data forward into the QA check.
  // This gives QA reviewers the full audit trail without a separate lookup.
  let thermalAuditFields: Record<string, unknown> = {};
  let prepDeviationFields: Record<string, unknown> = {
    hasDeviation: chillLog.hasDeviation ?? false,
    deviationType: chillLog.deviationType ?? undefined,
    deviationNotes: chillLog.deviationNotes ?? undefined,
    deviationBy: chillLog.deviationBy ?? undefined,
    correctiveAction: chillLog.correctiveAction ?? undefined,
    deviationAt: chillLog.deviationAt ?? undefined,
  };
  if (chillLog.prepId) {
    const prepSnapshot = await getDoc(docRef('prep_queue', chillLog.prepId));
    if (prepSnapshot.exists()) {
      const prep = prepSnapshot.data();
      thermalAuditFields = {
        thermalCriticalTempValue: prep.criticalTempValue ?? null,
        thermalCriticalTempVerifiedBy: prep.criticalTempVerifiedBy ?? null,
        thermalEvacuationMethod: prep.evacuationMethod ?? null,
        // prefer the extras value (just entered), fall back to what's already on the prep doc
        thermalSignedOutTemp: extras?.signedOutTemp ?? prep.signedOutTemp ?? null,
        thermalTimeTo50F: extras?.timeTo50F ?? null,
        thermalTimeTo40F: extras?.timeTo40F ?? null,
      };
      prepDeviationFields = {
        hasDeviation: (prep.hasDeviation ?? false) || (chillLog.hasDeviation ?? false),
        deviationType: prep.deviationType ?? chillLog.deviationType ?? undefined,
        deviationNotes: prep.deviationNotes ?? chillLog.deviationNotes ?? undefined,
        deviationBy: prep.deviationBy ?? chillLog.deviationBy ?? undefined,
        correctiveAction: prep.correctiveAction ?? chillLog.correctiveAction ?? undefined,
        deviationAt: prep.deviationAt ?? chillLog.deviationAt ?? undefined,
      };
    }
  }

  const qaCheckRef = firestoreDoc(collectionRef('qa_checks'));
  const batch = writeBatch(db);
  batch.update(docRef('chill_logs', chillLogId), removeUndefinedFields(chillLogUpdates));
  batch.update(docRef('chillers', chillLog.chillerId), { status: 'idle', currentLoadId: null });
  if (chillLog.prepId) {
    batch.update(docRef('prep_queue', chillLog.prepId), removeUndefinedFields({ stage: 'qa', ...prepSignOutUpdates }));
  }
  batch.set(qaCheckRef, removeUndefinedFields({
    prepId: chillLog.prepId,
    chillLogId,
    productName: chillLog.productName,
    type: 'chill',
    status: 'ready_for_qa',
    notes: '',
    reviewedBy: null,
    timestamp: Timestamp.now(),
    cookType: chillLog.cookType,
    targetTemp: chillLog.targetTemp,
    expectedCookMinutes: chillLog.expectedCookMinutes,
    rackType: chillLog.rackType,
    species: chillLog.species,
    packagingType: chillLog.packagingType,
    thermalOwner: chillLog.thermalOwner,
    makeDate: chillLog.makeDate,
    deliveryDate: chillLog.deliveryDate,
    racks: chillLog.racks,
    pieces: chillLog.pieces,
    ...thermalAuditFields,
    ...prepDeviationFields,
  }));
  await batch.commit();
  await recordOperationalEvent({
    department: 'chill',
    prepId: chillLog.prepId ?? null,
    chillLogId,
    type: 'other',
    severity: 'info',
    notes: 'Chill complete. Ready for QA.',
    operator: 'chill',
    equipment: chillLog.chillerId ? `Chiller ${chillLog.chillerId}` : null,
    productName: chillLog.productName ?? null,
    targetDepartment: 'qa',
  });
}

export async function recordChillCheck(
  chillLogId: string,
  input: { timeTo50F?: number; timeTo40F?: number },
): Promise<void> {
  const chillLogSnapshot = await getDoc(docRef('chill_logs', chillLogId));
  if (!chillLogSnapshot.exists()) throw new Error('Selected chill log does not exist.');
  const chillLog = chillLogSnapshot.data();
  if (chillLog.status !== 'running') throw new Error('Only running chill logs can be updated.');

  const updates: Record<string, unknown> = {};
  if (input.timeTo50F !== undefined) updates.timeTo50F = input.timeTo50F;
  if (input.timeTo40F !== undefined) updates.timeTo40F = input.timeTo40F;
  if (Object.keys(updates).length === 0) throw new Error('No chill check values provided.');

  await updateDoc(docRef('chill_logs', chillLogId), removeUndefinedFields(updates));
}

export async function getPackagingLogs(): Promise<PackagingLogItem[]> {
  const snapshot = await getDocs(query(collectionRef('packaging_logs'), orderBy('startedAt', 'desc')));
  return snapshot.docs.map((item: QueryDocumentSnapshot<PackagingLogDoc>) => ({
    id: item.id,
    ...item.data(),
  }));
}

export async function startPackagingForQACheck(qaCheckId: string) {
  const qaCheckSnapshot = await getDoc(docRef('qa_checks', qaCheckId));
  if (!qaCheckSnapshot.exists()) {
    throw new Error('Selected QA check does not exist.');
  }

  const qaCheck = qaCheckSnapshot.data();
  if (qaCheck.prepId) {
    const prepSnapshot = await getDoc(docRef('prep_queue', qaCheck.prepId));
    if (!prepSnapshot.exists()) throw new Error('Linked prep item does not exist.');
    assertPrepStage(prepSnapshot.data(), 'packaging', 'Start packaging');
  }
  if (qaCheck.status !== 'ready_for_packaging') {
    throw new Error('Only QA checks marked Ready for Packaging can start packaging.');
  }

  const existingPackaging = await getDocs(
    query(collectionRef('packaging_logs'), where('qaCheckId', '==', qaCheckId), limit(1)),
  );
  if (!existingPackaging.empty) {
    throw new Error('Packaging has already been started for this QA check.');
  }
  if (qaCheck.prepId) {
    const existingPackagingForPrep = await getDocs(
      query(collectionRef('packaging_logs'), where('prepId', '==', qaCheck.prepId), limit(10)),
    );
    const conflictingLog = existingPackagingForPrep.docs.find((item) => {
      const status = item.data().status;
      return status === 'running' || status === 'complete';
    });
    if (conflictingLog) {
      throw new Error('Packaging already exists for this prep batch.');
    }
  }

  const packagingRef = firestoreDoc(collectionRef('packaging_logs'));
  const batch = writeBatch(db);
  batch.set(packagingRef, removeUndefinedFields({
    prepId: qaCheck.prepId ?? '',
    qaCheckId,
    productName: qaCheck.productName ?? qaCheck.prepId ?? 'Unknown Product',
    casesProduced: null,
    unitsProduced: null,
    yieldPercent: null,
    packagingLine: null,
    packagedBy: null,
    status: 'running',
    startedAt: Timestamp.now(),
    completedAt: null,
    notes: '',
    hasDeviation: qaCheck.hasDeviation ?? false,
    deviationType: qaCheck.deviationType ?? undefined,
    deviationNotes: qaCheck.deviationNotes ?? undefined,
    deviationBy: qaCheck.deviationBy ?? undefined,
    correctiveAction: qaCheck.correctiveAction ?? undefined,
    deviationAt: qaCheck.deviationAt ?? undefined,
  }));

  // Advance prep stage to packaging so it no longer appears on the QA page.
  if (qaCheck.prepId) {
    batch.update(docRef('prep_queue', qaCheck.prepId), sanitizeForWrite({ stage: 'packaging', status: 'ready_for_packaging' }));
  }
  await batch.commit();

  return packagingRef.id;
}

export async function completePackagingLog(
  packagingLogId: string,
  input: {
    casesProduced: number;
    unitsProduced: number;
    yieldPercent: number | null;
    notes: string;
    packagingLine: string;
    packagedBy: string;
  },
) {
  const logSnapshot = await getDoc(docRef('packaging_logs', packagingLogId));
  if (!logSnapshot.exists()) {
    throw new Error('Selected packaging log does not exist.');
  }

  const logItem = logSnapshot.data();
  if (logItem.prepId) {
    const prepSnapshot = await getDoc(docRef('prep_queue', logItem.prepId));
    if (!prepSnapshot.exists()) throw new Error('Linked prep item does not exist.');
    assertPrepStage(prepSnapshot.data(), 'packaging', 'Complete packaging');
  }
  if (logItem.status !== 'running') {
    throw new Error('Only running packaging logs can be completed.');
  }
  if (!Number.isFinite(input.casesProduced) || input.casesProduced <= 0) {
    throw new Error('Cases produced must be greater than zero.');
  }
  if (!Number.isFinite(input.unitsProduced) || input.unitsProduced <= 0) {
    throw new Error('Units produced must be greater than zero.');
  }

  await updateDoc(docRef('packaging_logs', packagingLogId), removeUndefinedFields({
    status: 'complete',
    completedAt: Timestamp.now(),
    casesProduced: input.casesProduced,
    unitsProduced: input.unitsProduced,
    yieldPercent: input.yieldPercent,
    notes: input.notes.trim(),
    packagingLine: input.packagingLine.trim() || null,
    packagedBy: input.packagedBy.trim() || null,
  }));
  await recordOperationalEvent({
    department: 'packaging',
    prepId: logItem.prepId ?? null,
    type: 'other',
    severity: 'info',
    notes: `Packaged complete (${input.casesProduced} cases / ${input.unitsProduced} units).`,
    operator: input.packagedBy.trim() || 'packaging',
    productName: logItem.productName ?? null,
    targetDepartment: 'packaging',
  });
}

// ── Thermal execution step functions ──────────────────────────────────────────

/** Verify that loaded product matches the queued product. Call during `assigned` state. */
/**
 * Verify a thermal load before cook start.
 *
 * @param prepId     - The prep_queue document ID for this load.
 * @param verifiedBy - Operator name / initials.
 * @param oItemId    - Optional canonical OItem doc ID. When supplied the
 *                     occupancy check accepts currentLoadId matching EITHER
 *                     prepId OR oItemId (handles dual-identity from split
 *                     rack pool children whose parent's prepId may already
 *                     be registered on the smokehouse doc).
 */
// ── Smokehouse occupancy helpers ──────────────────────────────────────────────

/**
 * Statuses that indicate a load is actively occupying a smokehouse.
 * Includes legacy/extended status values that may appear in prep_queue docs.
 */
const ACTIVE_OCCUPANT_STATUSES = new Set([
  'assigned',
  'awaiting_cook_start',
  'loaded_verified',
  'cooking',
  'cook_in_progress',
]);

/**
 * Determine whether the load referenced by `currentLoadId` is still actively
 * occupying a smokehouse. Checks:
 *   1. `prep_queue` by direct doc ID (canonical path after normalization).
 *   2. `operational_items` by direct doc ID (edge case where currentLoadId
 *      was set to an OItem ID rather than a prepId).
 *
 * Returns `false` (stale) when neither doc is found or both have
 * non-active statuses — meaning the smokehouse occupancy reference is stale.
 */
async function isSmokehouseCurrentLoadActive(currentLoadId: string): Promise<boolean> {
  // 1. Check prep_queue by doc ID (expected canonical path)
  const prepSnap = await getDoc(docRef('prep_queue', currentLoadId));
  if (prepSnap.exists()) {
    return ACTIVE_OCCUPANT_STATUSES.has((prepSnap.data().status as string) ?? '');
  }

  // 2. Fallback: check operational_items by doc ID
  const oItemSnap = await getDoc(docRef('operational_items', currentLoadId));
  if (oItemSnap.exists()) {
    return ACTIVE_OCCUPANT_STATUSES.has((oItemSnap.data().status as string) ?? '');
  }

  // Referenced doc missing → stale reference → not active
  return false;
}

export async function verifyLoadForPrep(prepId: string, verifiedBy: string, oItemId?: string) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Verify load');
  if (prepItem.status !== 'assigned') throw new Error('Load verification requires assigned status.');
  if (!verifiedBy.trim()) throw new Error('Verified-by name is required.');
  if (!prepItem.assignedSmokehouse) throw new Error('Assigned smokehouse is required to verify load.');
  const smokehouseSnapshot = await getDocs(
    query(collectionRef('smokehouses'), where('name', '==', prepItem.assignedSmokehouse), limit(1)),
  );
  if (smokehouseSnapshot.empty) throw new Error('Assigned smokehouse does not exist.');
  const smokehouseDoc = smokehouseSnapshot.docs[0];
  const smokehouse = smokehouseDoc.data();
  if (smokehouse.status === 'cleaning') throw new Error('Assigned smokehouse is currently cleaning.');

  // Dual-identity set: currentLoadId is allowed if it matches the prepId or
  // the canonical OItem ID (handles split-rack child loads).
  const allowedLoadIds = new Set<string>([prepId]);
  if (oItemId) allowedLoadIds.add(oItemId);

  const currentLoadId = smokehouse.currentLoadId;
  const isOccupiedByOther = !!currentLoadId && !allowedLoadIds.has(currentLoadId);

  let action: 'allow' | 'repair' | 'block' = 'allow';
  let reason = 'currentLoadId-null-or-matches';

  if (isOccupiedByOther) {
    // Check whether the referenced load is still actively occupying a smokehouse.
    // If it is no longer active (completed, on hold, cancelled, or missing),
    // repair the stale reference and allow verification to proceed.
    const currentLoadActive = await isSmokehouseCurrentLoadActive(currentLoadId!);
    if (currentLoadActive) {
      action = 'block';
      reason = 'currentLoadId-references-active-load';
    } else {
      action = 'repair';
      reason = 'currentLoadId-stale-will-repair';
    }
  }

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[VERIFY_LOAD_OCCUPANCY_REPAIR]', {
      smokehouseName: prepItem.assignedSmokehouse,
      currentLoadId: currentLoadId ?? null,
      prepId,
      oItemId: oItemId ?? null,
      action,
      reason,
    });
    // eslint-disable-next-line no-console
    console.log('[THERMAL_VERIFY_GUARD]', {
      mode: 'verify_load',
      smokehouseName: prepItem.assignedSmokehouse,
      currentLoadId: currentLoadId ?? null,
      prepId,
      oItemId: oItemId ?? null,
      allowed: action !== 'block',
      reason,
    });
  }

  if (action === 'block') {
    throw new Error(
      `Smokehouse ${prepItem.assignedSmokehouse} already has a different active load ` +
      `(${currentLoadId}). Verify cannot proceed.`,
    );
  }

  // action === 'allow' or 'repair' — proceed and set/repair currentLoadId.
  const batch = writeBatch(db);
  batch.update(docRef('prep_queue', prepId), sanitizeForWrite({
    loadedVerified: true,
    loadedVerifiedBy: verifiedBy.trim(),
    loadedVerifiedAt: Timestamp.now(),
  }));
  // Always normalise currentLoadId to prepId so all downstream checks
  // (startCookForPrep, evacuateAndFinishCookForPrep) find a consistent value.
  // This also repairs any stale reference from a previously-cancelled load.
  batch.update(smokehouseDoc.ref, sanitizeForWrite({
    currentLoadId: prepId,
    ...(smokehouse.status === 'idle' ? { status: 'idle' } : {}),
  }));
  await batch.commit();
}

/** Record the 50°F cut time. Requires cook already started (status: cooking).
 *  observedTemp is the operator-verified product surface temp (°F) — stored for audit trail.
 *  When deviation is provided, the out-of-range temp is recorded alongside the deviation entry. */
export async function record50CutForPrep(prepId: string, extras?: { observedTemp?: number; deviation?: ThermalDeviationInput }) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Record 50 cut');
  if (prepItem.status !== 'cooking') throw new Error('50 cut requires cooking status.');
  if (prepItem.cut50At) throw new Error('50 cut time has already been recorded.');
  const updates: Record<string, unknown> = { cut50At: Timestamp.now() };
  if (extras?.observedTemp !== undefined) {
    updates.cut50ObservedTemp = extras.observedTemp;
  }
  if (extras?.deviation) {
    const entry: ThermalDeviationEntry = {
      type: extras.deviation.type,
      notes: extras.deviation.notes,
      supervisorName: extras.deviation.supervisorName,
      recordedAt: Timestamp.now(),
      ...(extras.deviation.observedValue !== undefined ? { observedValue: extras.deviation.observedValue } : {}),
    };
    updates.thermalDeviations = arrayUnion(entry);
    updates.hasDeviation = true;
    updates.deviationType = extras.deviation.type;
    updates.deviationNotes = extras.deviation.notes;
    updates.deviationBy = extras.deviation.supervisorName;
    updates.deviationAt = Timestamp.now();
  }
  await updateDoc(docRef('prep_queue', prepId), sanitizeWithSafePrimitives(updates));
}

/** Record the 130°F cut time. Validates 6-hour window from 50 cut.
 *  observedTemp is the operator-verified product temp (°F) — stored for audit trail.
 *  When deviation is provided, the 6-hour check is bypassed and the deviation is recorded. */
export async function record130CutForPrep(prepId: string, extras?: { observedTemp?: number; deviation?: ThermalDeviationInput }) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Record 130 cut');
  if (prepItem.status !== 'cooking') throw new Error('130 cut requires cooking status.');
  if (!prepItem.cut50At) throw new Error('50 cut must be recorded before 130 cut.');
  if (prepItem.cut130At) throw new Error('130 cut time has already been recorded.');

  const cut50Ms = toMillis(prepItem.cut50At);
  if (cut50Ms == null) {
    throw new Error('50 cut timestamp is invalid. Re-record 50 cut before 130 cut.');
  }
  const nowMs = Date.now();
  const elapsedHours = (nowMs - cut50Ms) / (1000 * 60 * 60);
  // Only enforce 6h window when no deviation is being recorded.
  if (elapsedHours > 6 && !extras?.deviation) {
    throw new Error(
      `6-hour window exceeded: ${elapsedHours.toFixed(1)}h elapsed since 50 cut. Escalate to supervisor.`,
    );
  }
  const updates: Record<string, unknown> = { cut130At: Timestamp.now() };
  if (extras?.observedTemp !== undefined) {
    updates.cut130ObservedTemp = extras.observedTemp;
  }
  if (extras?.deviation) {
    const entry: ThermalDeviationEntry = {
      type: extras.deviation.type,
      notes: extras.deviation.notes,
      supervisorName: extras.deviation.supervisorName,
      recordedAt: Timestamp.now(),
      ...(extras.deviation.observedValue !== undefined ? { observedValue: extras.deviation.observedValue } : {}),
    };
    updates.thermalDeviations = arrayUnion(entry);
    updates.hasDeviation = true;
    updates.deviationType = extras.deviation.type;
    updates.deviationNotes = extras.deviation.notes;
    updates.deviationBy = extras.deviation.supervisorName;
    updates.deviationAt = Timestamp.now();
  }
  await updateDoc(docRef('prep_queue', prepId), sanitizeWithSafePrimitives(updates));
}

/** Record smoke application. */
export async function recordSmokeAppliedForPrep(prepId: string, appliedBy: string) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Record smoke application');
  if (prepItem.status !== 'cooking') throw new Error('Smoke application requires cooking status.');
  if (prepItem.smokeApplied) throw new Error('Smoke has already been recorded for this batch.');
  if (!appliedBy.trim()) throw new Error('Applied-by name is required.');
  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({
    smokeApplied: true,
    smokeAppliedAt: Timestamp.now(),
    smokeAppliedBy: appliedBy.trim(),
  }));
}

/** Record Probe Out / Critical Temp Reached. Requires 130 cut to be recorded.
 *  Validates that the recorded temp meets or exceeds the product's required target temp.
 *  probeTemps stores individual readings; criticalTempValue is the minimum (conservative).
 *  When deviation is provided, the target temp check is bypassed and the deviation is recorded. */
export async function recordCriticalTempForPrep(
  prepId: string,
  criticalTempValue: number,
  verifiedBy: string,
  extras?: { probeTemps?: number[]; deviation?: ThermalDeviationInput },
) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Record critical temp');
  if (prepItem.status !== 'cooking') throw new Error('Probe Out / Critical Temp requires cooking status.');
  if (!prepItem.cut130At) throw new Error('130 cut must be recorded before recording critical temp.');
  if (prepItem.criticalTempReachedAt) throw new Error('Critical temp has already been recorded.');
  if (!Number.isFinite(criticalTempValue) || criticalTempValue <= 0) {
    throw new Error('A valid temperature value is required.');
  }
  if (!verifiedBy.trim()) throw new Error('Verified-by name is required.');

  // Food safety: recorded temp must meet or exceed the product's required target temp.
  // Only enforce when no deviation is being recorded.
  const requiredTarget: number = prepItem.targetTemp ?? 0;
  if (requiredTarget > 0 && criticalTempValue < requiredTarget && !extras?.deviation) {
    throw new Error(
      `Critical temp ${criticalTempValue}°F is below the required target of ${requiredTarget}°F. ` +
        `Verify the probe reading. Escalate to supervisor if below target.`,
    );
  }

  const critUpdates: Record<string, unknown> = {
    criticalTempReachedAt: Timestamp.now(),
    criticalTempValue,
    criticalTempVerifiedBy: verifiedBy.trim(),
  };
  if (extras?.probeTemps !== undefined) {
    critUpdates.probeTemps = extras.probeTemps;
  }
  if (extras?.deviation) {
    const entry: ThermalDeviationEntry = {
      type: extras.deviation.type,
      notes: extras.deviation.notes,
      supervisorName: extras.deviation.supervisorName,
      recordedAt: Timestamp.now(),
      ...(extras.deviation.observedValue !== undefined ? { observedValue: extras.deviation.observedValue } : {}),
    };
    critUpdates.thermalDeviations = arrayUnion(entry);
    critUpdates.hasDeviation = true;
    critUpdates.deviationType = extras.deviation.type;
    critUpdates.deviationNotes = extras.deviation.notes;
    critUpdates.deviationBy = extras.deviation.supervisorName;
    critUpdates.deviationAt = Timestamp.now();
  }
  await updateDoc(docRef('prep_queue', prepId), sanitizeWithSafePrimitives(critUpdates));
}

/** Record whether a 5-minute duration hold is required after critical temp.
 *  Requires critical temp to be recorded first. */
export async function recordDurationForPrep(prepId: string, required: boolean): Promise<void> {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Record duration');
  if (prepItem.status !== 'cooking') throw new Error('Duration recording requires cooking status.');
  if (!prepItem.criticalTempReachedAt) {
    throw new Error('Probe Out / Critical Temp must be recorded before duration decision.');
  }
  if (prepItem.durationRequiredAt) throw new Error('Duration decision has already been recorded.');
  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({
    durationRequired: required,
    durationRequiredAt: Timestamp.now(),
  }));
}

/** Record the evacuation stage method (dry vac or cold shower).
 *  Requires critical temp and duration decision to both be recorded first. */
export async function recordEvacuationForPrep(
  prepId: string,
  method: 'dry_vac' | 'cold_shower',
) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Record evacuation');
  if (prepItem.status !== 'cooking') throw new Error('Evacuation recording requires cooking status.');
  if (!prepItem.criticalTempReachedAt) {
    throw new Error('Probe Out / Critical Temp must be recorded before evacuation.');
  }
  if (!prepItem.durationRequiredAt) {
    throw new Error('Duration hold decision must be recorded before evacuation.');
  }
  if (prepItem.evacuationCompletedAt) throw new Error('Evacuation has already been recorded.');
  if (method !== 'dry_vac' && method !== 'cold_shower') {
    throw new Error('Evacuation method must be dry_vac or cold_shower.');
  }
  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({
    evacuationMethod: method,
    evacuationCompletedAt: Timestamp.now(),
  }));
}

/** Assign a blast chiller before transitioning to chill. Requires evacuation completed. */
export async function assignBlastChillerForPrep(prepId: string, blastChillerId: string) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Assign blast chiller');
  if (prepItem.status !== 'cooking') throw new Error('Blast chiller assignment requires cooking status.');
  if (!prepItem.evacuationCompletedAt) {
    throw new Error('Evacuation must be completed before assigning blast chiller.');
  }
  if (!blastChillerId.trim()) throw new Error('Blast chiller ID is required.');
  await updateDoc(docRef('prep_queue', prepId), sanitizeForWrite({
    assignedBlastChiller: blastChillerId.trim(),
  }));
}

/** Return a rejected QA check to pending for re-review (e.g., after corrective action).
 *  Appends a timestamped re-submission note so the audit trail is preserved. */
export async function resubmitQACheckForReview(qaCheckId: string, resubmissionNote: string) {
  const note = resubmissionNote.trim();
  if (!note) throw new Error('A re-submission note describing the corrective action is required.');

  const qaSnapshot = await getDoc(docRef('qa_checks', qaCheckId));
  if (!qaSnapshot.exists()) throw new Error('Selected QA check does not exist.');
  const qaCheck = qaSnapshot.data();
  if (qaCheck.prepId) {
    const prepSnapshot = await getDoc(docRef('prep_queue', qaCheck.prepId));
    if (!prepSnapshot.exists()) throw new Error('Linked prep item does not exist.');
    assertPrepStage(prepSnapshot.data(), 'qa', 'QA resubmission');
  }
  if (qaCheck.status !== 'qa_hold' && qaCheck.status !== 'qa_review_required') {
    throw new Error('Only QA hold/review-required checks can be re-submitted.');
  }

  const timestamp = new Date().toLocaleString();
  const appendedNotes = `${qaCheck.notes}\n[Re-submitted ${timestamp}]: ${note}`;

  const batch = writeBatch(db);
  batch.update(docRef('qa_checks', qaCheckId), sanitizeForWrite({
    status: 'ready_for_qa',
    reviewedBy: null,
    reviewedAt: null,
    notes: appendedNotes,
  }));
  if (qaCheck.prepId) {
    batch.update(docRef('prep_queue', qaCheck.prepId), sanitizeForWrite({ stage: 'qa', status: 'ready_for_qa' }));
  }
  await batch.commit();
}

export async function holdPackagingLog(packagingLogId: string, reason: string): Promise<void> {
  const clean = reason.trim();
  if (!clean) throw new Error('Hold reason is required.');
  await updateDoc(docRef('packaging_logs', packagingLogId), sanitizeForWrite({
    status: 'deviation',
    hasDeviation: true,
    deviationType: 'packaging_hold',
    deviationNotes: clean,
    deviationAt: Timestamp.now(),
    notes: clean,
  }));
}

export async function resumePackagingLog(packagingLogId: string): Promise<void> {
  const logSnapshot = await getDoc(docRef('packaging_logs', packagingLogId));
  if (!logSnapshot.exists()) throw new Error('Selected packaging log does not exist.');
  const logItem = logSnapshot.data();
  if (logItem.status !== 'deviation') throw new Error('Only hold/deviation packaging logs can be resumed.');
  await updateDoc(docRef('packaging_logs', packagingLogId), sanitizeForWrite({
    status: 'running',
    notes: `${logItem.notes ? `${logItem.notes}\n` : ''}[Resumed ${new Date().toISOString()}]`,
  }));
}

export async function appendPackagingLogNote(packagingLogId: string, note: string): Promise<void> {
  const clean = note.trim();
  if (!clean) throw new Error('Packaging note is required.');
  const logSnapshot = await getDoc(docRef('packaging_logs', packagingLogId));
  if (!logSnapshot.exists()) throw new Error('Selected packaging log does not exist.');
  const existing = logSnapshot.data();
  const prefix = existing.notes?.trim() ? `${existing.notes.trim()}\n` : '';
  await updateDoc(docRef('packaging_logs', packagingLogId), sanitizeForWrite({
    notes: `${prefix}[Packaging Note ${new Date().toISOString()}] ${clean}`,
  }));
}

export async function appendQACheckNote(qaCheckId: string, note: string) {
  const qaCheckSnapshot = await getDoc(docRef('qa_checks', qaCheckId));
  if (!qaCheckSnapshot.exists()) throw new Error('Selected QA check does not exist.');
  const existing = qaCheckSnapshot.data();
  const clean = note.trim();
  if (!clean) throw new Error('QA note is required.');
  const prefix = existing.notes?.trim() ? `${existing.notes.trim()}\n` : '';
  await updateDoc(docRef('qa_checks', qaCheckId), sanitizeWithSafePrimitives({ notes: `${prefix}[QA Note ${new Date().toISOString()}] ${clean}` }));
}

/** Atomic thermal->chill transition:
 *  records evacuation completion and moves to chill in the same commit,
 *  while creating chill handoff and releasing linked smokehouse.
 */
export async function evacuateAndFinishCookForPrep(
  prepId: string,
  method: 'dry_vac' | 'cold_shower',
  extras?: { assignedBlastChiller?: string },
) {
  const prepSnapshot = await getDoc(docRef('prep_queue', prepId));
  if (!prepSnapshot.exists()) throw new Error('Selected prep item does not exist.');
  const prepItem = prepSnapshot.data();
  assertPrepStage(prepItem, 'thermal', 'Evacuate and finish cook');
  if (prepItem.status !== 'cooking') throw new Error('Only cooking prep items can be transitioned to chill.');
  if (!prepItem.assignedSmokehouse) throw new Error('Cooking prep item is missing assigned smokehouse.');
  if (!prepItem.criticalTempReachedAt) throw new Error('Probe Out / Critical Temp must be recorded before evacuation.');
  if (!prepItem.durationRequiredAt) throw new Error('Duration hold decision must be recorded before evacuation.');
  if (prepItem.evacuationCompletedAt) throw new Error('Evacuation has already been recorded.');
  if (await hasPrepDownstreamProgress(prepId)) {
    throw new Error('Selected prep item is workflow-locked by downstream records.');
  }

  const smokehouseSnapshot = await getDocs(
    query(collectionRef('smokehouses'), where('name', '==', prepItem.assignedSmokehouse), limit(1)),
  );
  if (smokehouseSnapshot.empty) throw new Error('Linked smokehouse does not exist.');
  const smokehouseDoc = smokehouseSnapshot.docs[0];
  const smokehouseItem = smokehouseDoc.data();
  if (smokehouseItem.currentLoadId !== prepId) {
    throw new Error('Linked smokehouse load does not match selected prep item.');
  }

  const chillLogRef = firestoreDoc(collectionRef('chill_logs'));
  const batch = writeBatch(db);
  batch.update(docRef('prep_queue', prepId), sanitizeWithSafePrimitives({
    evacuationMethod: method,
    evacuationCompletedAt: Timestamp.now(),
    status: 'awaiting_chill',
    stage: 'chill',
    ...(extras?.assignedBlastChiller ? { assignedBlastChiller: extras.assignedBlastChiller } : {}),
  }));
  batch.update(smokehouseDoc.ref, sanitizeForWrite({ status: 'idle', currentLoadId: null }));
  batch.set(chillLogRef, sanitizeWithSafePrimitives({
    chillerId: null,
    productName: prepItem.productNameSnapshot || prepItem.productName,
    prepId,
    timeTo50F: null,
    timeTo40F: null,
    status: 'waiting' as const,
    createdAt: Timestamp.now(),
    cookType: prepItem.cookType,
    targetTemp: prepItem.targetTemp,
    expectedCookMinutes: prepItem.expectedCookMinutes,
    rackType: prepItem.rackType,
    species: prepItem.species,
    packagingType: prepItem.packagingType,
    thermalOwner: prepItem.thermalOwner,
    makeDate: prepItem.makeDate,
    deliveryDate: prepItem.deliveryDate,
    racks: prepItem.racks,
    pieces: prepItem.pieces,
    thermalDeviationCount: prepItem.thermalDeviations?.length ?? 0,
  }) as ChillLogDoc);
  await batch.commit();
}

// ── Chill deviation functions ─────────────────────────────────────────────────

/** Flag a running chill log as a deviation. Requires reason text. */
export async function flagChillLogDeviation(chillLogId: string, reason: string) {
  if (!reason.trim()) throw new Error('A deviation reason is required.');
  const snapshot = await getDoc(docRef('chill_logs', chillLogId));
  if (!snapshot.exists()) throw new Error('Chill log does not exist.');
  const log = snapshot.data();
  if (log.prepId) {
    const prepSnapshot = await getDoc(docRef('prep_queue', log.prepId));
    if (!prepSnapshot.exists()) throw new Error('Linked prep item does not exist.');
    assertPrepStage(prepSnapshot.data(), 'chill', 'Flag chill deviation');
  }
  if (log.status !== 'running') throw new Error('Only running chill logs can be flagged as a deviation.');
  const batch = writeBatch(db);
  const now = Timestamp.now();
  batch.update(docRef('chill_logs', chillLogId), sanitizeForWrite({
    hasDeviation: true,
    deviationType: 'chill_out_of_spec',
    deviationNotes: reason.trim(),
    deviationBy: 'Operator',
    deviationReason: reason.trim(),
    deviationAt: now,
  }));
  if (log.prepId) {
    batch.update(docRef('prep_queue', log.prepId), sanitizeForWrite({
      hasDeviation: true,
      deviationType: 'chill_out_of_spec',
      deviationNotes: reason.trim(),
      deviationBy: 'Operator',
      deviationAt: now,
    }));
  }
  await batch.commit();
}

/** Resolve a chill deviation and return it to running status. Requires corrective action note. */
export async function resolveChillLogDeviation(chillLogId: string, note: string) {
  if (!note.trim()) throw new Error('A corrective action note is required.');
  const snapshot = await getDoc(docRef('chill_logs', chillLogId));
  if (!snapshot.exists()) throw new Error('Chill log does not exist.');
  const log = snapshot.data();
  if (log.prepId) {
    const prepSnapshot = await getDoc(docRef('prep_queue', log.prepId));
    if (!prepSnapshot.exists()) throw new Error('Linked prep item does not exist.');
    assertPrepStage(prepSnapshot.data(), 'chill', 'Resolve chill deviation');
  }
  if (!log.hasDeviation && log.status !== 'deviation') throw new Error('Only deviation logs can be resolved.');
  const batch = writeBatch(db);
  batch.update(docRef('chill_logs', chillLogId), sanitizeForWrite({
    status: 'running',
    correctiveAction: note.trim(),
    deviationResolvedAt: Timestamp.now(),
    deviationResolutionNote: note.trim(),
  }));
  if (log.prepId) {
    batch.update(docRef('prep_queue', log.prepId), sanitizeForWrite({
      correctiveAction: note.trim(),
    }));
  }
  await batch.commit();
}

// ── End thermal execution step functions ──────────────────────────────────────

export async function createQACheck(input: NewQACheckInput) {
  const payload: QACheckDoc = removeUndefinedFields({
    ...input,
    timestamp: input.timestamp ?? Timestamp.now(),
  } as QACheckDoc);

  const ref = await addDoc(collectionRef('qa_checks'), sanitizeWithSafePrimitives(payload));
  return ref.id;
}

export async function createAlert(input: NewAlertInput) {
  const payload: AlertDoc = {
    ...input,
    createdAt: input.createdAt ?? Timestamp.now(),
  };

  const ref = await addDoc(collectionRef('alerts'), sanitizeWithSafePrimitives(payload));
  return ref.id;
}

/** Ensure a smokehouse document exists for the given name.
 *  If no Firestore record is found, creates one with idle status.
 *  Safe to call before assignment — no-ops if record already exists. */
export async function ensureSmokehouseDoc(name: string): Promise<void> {
  const snapshot = await getDocs(
    query(collectionRef('smokehouses'), where('name', '==', name.trim()), limit(1)),
  );
  if (!snapshot.empty) return;
  const newDoc: SmokehouseDoc = {
    name: name.trim(),
    status: 'idle',
    currentLoadId: null,
    lastCleanedAt: null,
  };
  await addDoc(collectionRef('smokehouses'), sanitizeWithSafePrimitives(newDoc));
}

/**
 * DEV-only: scan all smokehouse documents and clear any `currentLoadId` that
 * references a load that no longer exists or is no longer active/cooking.
 *
 * Stale occupancy causes "Blocked: Smokehouse has different active load" errors
 * for loads that should be allowed to proceed. Call this from the Thermal UI
 * when the DEV debug panel shows occupancy mismatches.
 *
 * Returns the list of smokehouse names whose `currentLoadId` was cleared and
 * any error messages for smokehouses that could not be checked.
 */
export async function repairStaleSmokehouseOccupancy(): Promise<{
  repaired: string[];
  errors: string[];
}> {
  const smokehouseSnap = await getDocs(collectionRef('smokehouses'));
  const repaired: string[] = [];
  const errors: string[] = [];

  for (const smokehouseDocSnap of smokehouseSnap.docs) {
    const data = smokehouseDocSnap.data();
    if (!data.currentLoadId) continue; // already clear — nothing to do

    try {
      const isActive = await isSmokehouseCurrentLoadActive(data.currentLoadId);
      if (!isActive) {
        // Clear the stale currentLoadId so the smokehouse is available again.
        // Also reset status to 'idle' if it was stuck in 'cooking'.
        const updates: Partial<SmokehouseDoc> = { currentLoadId: null };
        if (data.status === 'cooking') updates.status = 'idle';
        await updateDoc(smokehouseDocSnap.ref, sanitizeForWrite(updates));
        repaired.push(data.name);

        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[SMOKEHOUSE_OCCUPANCY_REPAIR]', {
            smokehouse: data.name,
            clearedLoadId: data.currentLoadId,
            statusWas: data.status,
            statusNow: updates.status ?? data.status,
          });
        }
      }
    } catch (err) {
      errors.push(`${data.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { repaired, errors };
}

export async function resetOperationalData(options?: { clearEquipmentLoads?: boolean }) {
  const clearEquipmentLoads = options?.clearEquipmentLoads ?? true;
  const collectionsToClear = [
    'weekly_plan',
    'prep_queue',
    'chill_logs',
    'qa_checks',
    'packaging_logs',
    'operational_events',
    'alerts',
    'operational_items',
  ] as const;

  for (const collectionName of collectionsToClear) {
    const snapshot = await getDocs(collectionRef(collectionName));
    if (snapshot.empty) continue;
    let batch = writeBatch(db);
    let opCount = 0;
    for (const docSnap of snapshot.docs) {
      batch.delete(docSnap.ref);
      opCount += 1;
      if (opCount === 400) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      }
    }
    if (opCount > 0) {
      await batch.commit();
    }
  }

  if (!clearEquipmentLoads) return;

  const [smokehouses, chillers] = await Promise.all([
    getDocs(collectionRef('smokehouses')),
    getDocs(collectionRef('chillers')),
  ]);

  let equipmentBatch = writeBatch(db);
  let count = 0;
  smokehouses.docs.forEach((snap) => {
    equipmentBatch.update(snap.ref, sanitizeForWrite({ currentLoadId: null, status: 'idle' }));
    count += 1;
  });
  chillers.docs.forEach((snap) => {
    equipmentBatch.update(snap.ref, sanitizeForWrite({ currentLoadId: null, status: 'idle' }));
    count += 1;
  });
  if (count > 0) await equipmentBatch.commit();
}
