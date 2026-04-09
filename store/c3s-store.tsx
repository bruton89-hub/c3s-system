import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

import {
  BATCH_STAGES,
  BATCH_STATUSES,
  CHILLERS,
  PREP_PRIORITIES,
  PREP_STATUSES,
  PRODUCT_PROFILES,
  QA_STATUSES,
  RTE_COOLER,
  SMOKEHOUSES,
  THERMAL_COOLERS,
  getChillerCapacity,
  type BatchStage as CBatchStage,
  type BatchStatus as CBatchStatus,
  type ChillerNumber,
  type PrepPriority as CPrepPriority,
  type PrepStatus as CPrepStatus,
  type ProductProfile as CProductProfile,
  type QAStatus as CQAStatus,
  type SmokehouseCode,
  type ThermalCoolerCode,
} from '@/constants/c3s';

export type BatchStage = CBatchStage;
export type BatchStatus = CBatchStatus;
export type QAStatus = CQAStatus;
export type PrepPriority = CPrepPriority;
export type PrepStatus = CPrepStatus;
export type ProductProfile = CProductProfile;
export type DelayRisk = 'Low' | 'Medium' | 'High';
export type WorkflowState = 'ready' | 'waiting' | 'blocked' | 'assigned' | 'running';
export type EquipmentType = 'Smokehouse' | 'Chiller' | 'ThermalCooler';
export type ChillerStatus = 'Available' | 'Near Full' | 'Full' | 'Out of Service';
export type PackagingLineType = 'slicing' | 'standard' | 'combo';
export type PackagingLineId = '8600' | '8614' | 'flip-flop';
export type SlicingStatus = 'Not Required' | 'Waiting' | 'Assigned' | 'Completed';
export type PackagingStatus = 'Waiting' | 'Assigned' | 'Running' | 'Completed';
export type SlicingLineId = 'SL-1';
export type NotificationSeverity = 'Critical' | 'Warning' | 'Info';
export type NotificationType =
  | 'Delay'
  | 'Equipment'
  | 'Assignment'
  | 'QA'
  | 'Batch'
  | 'System';
export type BatchActionType =
  | 'Critical Temp'
  | 'Probe Confirm'
  | 'Start Shower'
  | 'End Shower'
  | 'Move to Chill'
  | 'Chill Check'
  | 'Log Delay';

export type StartCookInput = {
  product: string;
  smokehouse: SmokehouseCode;
  rackCount: number;
  pieceCount: number;
  checklist: {
    smokehouseClean: boolean;
    sockChanged: boolean;
    generatorSetUp: boolean;
    productTagsVerified: boolean;
    temperatureBelow44F: boolean;
  };
  batchId?: string;
};
export type FlowOwner = 'RTC' | 'Thermal' | 'QA' | 'Packaging';
export type FlowArea = 'thermal' | 'qa' | 'packaging';
export type BatchFlowSnapshot = {
  currentOwner: FlowOwner;
  currentLocation: string;
  currentStage: BatchStage;
  waitingOn: string;
  nextValidAction: string;
};

export type PrepRecord = {
  id: string;
  product: string;
  tubs: number;
  racks: number;
  priority: PrepPriority;
  requestedStart: string;
  status: PrepStatus;
  assignedSmokehouse: SmokehouseCode | '--';
  qaPreOpStatus: 'Pending' | 'Passed' | 'Failed';
  stagingAreaReady: boolean;
  rtcEquipmentReady: boolean;
  awaitingThermalAssignment?: boolean;
  rtcReadyRackCount?: number;
  thermalAssignedRackCount?: number;
  readyToLoad: boolean;
  linkedBatchId?: string;
};

export type BatchRecord = {
  id: string;
  product: string;
  smokehouse: string;
  rackCount: number;
  requiresShower: boolean;
  requiresEvacuate: boolean;
  estimatedCookMinutes: number;
  estimatedChillMinutes: number;
  ccpType: string;
  productProfile: ProductProfile;
  requiresSlicing: boolean;
  stage: BatchStage;
  status: BatchStatus;
  eta: string;
  minutesToReady: number;
  qaStatus: QAStatus;
  slicingStatus?: SlicingStatus;
  slicingLineId?: SlicingLineId;
  rteCoolerId?: typeof RTE_COOLER;
  packagingLineId?: PackagingLineId;
  packagingStatus?: PackagingStatus;
  assignedChiller?: number;
  thermalCoolerId?: ThermalCoolerCode;
};

export type TimelineEvent = {
  id: string;
  time: string;
  title: string;
  detail: string;
};

export type EquipmentReadiness = {
  id: string;
  type: EquipmentType;
  clean: boolean;
  ready: boolean;
  notes: string;
};

export type ChillerLoad = {
  chillerNumber: ChillerNumber;
  capacity: number;
  currentAssignedRacks: number;
  remainingCapacity: number;
  status: ChillerStatus;
  assignedBatchIds: string[];
};

export type PackagingLine = {
  id: PackagingLineId;
  type: PackagingLineType;
  cleanStatus: boolean;
  qaPreOpStatus: 'Pending' | 'Passed' | 'Failed';
  readyStatus: boolean;
  assignedBatchId?: string;
};

export type SlicingLine = {
  id: SlicingLineId;
  cleanStatus: boolean;
  qaPreOpStatus: 'Pending' | 'Passed' | 'Failed';
  ready: boolean;
  assignedBatchId?: string;
};

export type RTECooler = {
  id: typeof RTE_COOLER;
  cleanStatus: boolean;
  qaPreOpStatus: 'Pending' | 'Passed' | 'Failed';
  readyStatus: boolean;
  notes: string;
};

export type C3SNotification = {
  id: string;
  severity: NotificationSeverity;
  type: NotificationType;
  batchId?: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
};

type TimelineAction =
  | 'Start Shower'
  | 'Complete Shower'
  | 'Assign Chiller'
  | 'Start Chill'
  | 'Complete Chill'
  | 'Send to QA'
  | 'Log Delay';
export type BatchTimelineAction = TimelineAction;

export type ProductThermalConfig = {
  requiresShower: boolean;
  requiresEvacuate: boolean;
  requiresSlicing: boolean;
  estimatedCookMinutes: number;
  estimatedChillMinutes: number;
  ccpType: string;
};
export type DemoScenario = 'Normal Shift' | 'Capacity Risk' | 'QA Hold';
export type PlanDay = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export type PlanShift = 'Day' | 'Night';
export type RunPlanStatus = 'planned' | 'scheduled' | 'in progress' | 'complete';
export type ProductCategory = 'Pork' | 'Poultry' | 'Sausage' | 'Other';
export type CookMethod = 'smoke' | 'steam';
export type PlannerPriority = 'rush' | 'normal' | 'hold';
export type PlannedRunItem = {
  id: string;
  runId: string;
  productName: string;
  productCategory: ProductCategory;
  cookMethod: CookMethod;
  recipeProfile: string;
  rackCount: number;
  pieceCount: number;
  priority: PlannerPriority;
  targetDay: PlanDay;
  targetShift: PlanShift;
  estimatedCookHours: number;
  estimatedChillHours: number;
  packagingLine?: string;
  planningStatus: RunPlanStatus;
  assignedSmokehouse?: SmokehouseCode;
  plannedLoadTime?: string;
  plannedCookStart?: string;
  plannedCookEnd?: string;
  assignedChiller?: ChillerNumber;
  plannedChillStart?: string;
  plannedChillEnd?: string;
  expectedQaWindow?: string;
  expectedPackagingReady?: string;
  forecastRiskFlags: string[];
  rtcStatus: string;
  thermalStatus: string;
  postCookStatus: string;
  qaStatus: string;
  packagingStatus: string;
  currentStage: string;
  currentLocation: string;
  waitingOn: string;
  atRisk: boolean;
  linkedPrepId?: string;
  linkedBatchId?: string;
};
export type PlannedRunInput = Omit<
  PlannedRunItem,
  | 'id'
  | 'planningStatus'
  | 'assignedSmokehouse'
  | 'plannedLoadTime'
  | 'plannedCookStart'
  | 'plannedCookEnd'
  | 'assignedChiller'
  | 'plannedChillStart'
  | 'plannedChillEnd'
  | 'expectedQaWindow'
  | 'expectedPackagingReady'
  | 'forecastRiskFlags'
  | 'rtcStatus'
  | 'thermalStatus'
  | 'postCookStatus'
  | 'qaStatus'
  | 'packagingStatus'
  | 'currentStage'
  | 'currentLocation'
  | 'waitingOn'
  | 'atRisk'
  | 'linkedPrepId'
  | 'linkedBatchId'
>;

type ScenarioState = {
  plannedRuns: PlannedRunItem[];
  prepTickets: PrepRecord[];
  batches: BatchRecord[];
  eventsByBatch: Record<string, TimelineEvent[]>;
  equipmentReadiness: EquipmentReadiness[];
  rteCooler: RTECooler;
  slicingLines: SlicingLine[];
  packagingLines: PackagingLine[];
  notifications: C3SNotification[];
};

type C3SState = {
  demoScenario: DemoScenario;
  plannedRuns: PlannedRunItem[];
  prepTickets: PrepRecord[];
  batches: BatchRecord[];
  equipmentReadiness: EquipmentReadiness[];
  rteCooler: RTECooler;
  slicingLines: SlicingLine[];
  packagingLines: PackagingLine[];
  notifications: C3SNotification[];
  eventsByBatch: Record<string, TimelineEvent[]>;
  getBatch: (batchId: string) => BatchRecord | undefined;
  getDelayRisk: (batch: BatchRecord) => DelayRisk;
  getBatchHandoffLabel: (batch: BatchRecord) => string;
  getBatchBlockedReasons: (batch: BatchRecord) => string[];
  getBatchWorkflowState: (batch: BatchRecord) => WorkflowState;
  getPrepHandoffLabel: (prep: PrepRecord) => string;
  getPrepBlockedReasons: (prep: PrepRecord) => string[];
  getPrepWorkflowState: (prep: PrepRecord) => WorkflowState;
  getChillerLoad: () => ChillerLoad[];
  getProductThermalConfig: (product: string) => ProductThermalConfig;
  getBatchThermalPath: (batchId: string) => BatchStage[];
  getEnabledBatchActions: (batchId: string) => BatchActionType[];
  getEnabledTimelineActions: (batchId: string) => TimelineAction[];
  getBatchFlowSnapshot: (batchId: string) => BatchFlowSnapshot | undefined;
  canViewBatchInArea: (area: FlowArea, batchId: string) => boolean;
  addPlannedRun: (input: PlannedRunInput) => string;
  updatePlannedRunStatus: (plannedRunId: string, status: RunPlanStatus) => void;
  promotePlannedRunToPrep: (plannedRunId: string) => string | null;
  setDemoScenario: (scenario: DemoScenario) => void;
  markSlicingLineClean: (lineId: SlicingLineId) => void;
  setSlicingLineQAPreOp: (lineId: SlicingLineId, status: 'Passed' | 'Failed') => void;
  markSlicingLineReady: (lineId: SlicingLineId) => void;
  assignBatchToSlicingLine: (lineId: SlicingLineId, batchId?: string) => string | null;
  markPackagingLineClean: (lineId: PackagingLineId) => void;
  setPackagingLineQAPreOp: (lineId: PackagingLineId, status: 'Passed' | 'Failed') => void;
  markPackagingLineReady: (lineId: PackagingLineId) => void;
  assignBatchToPackagingLine: (lineId: PackagingLineId, batchId?: string) => string | null;
  createPrep: () => PrepRecord;
  markPrepReady: (prepId: string) => void;
  markPrepRTCReady: (prepId: string) => void;
  setPrepQAPreOp: (prepId: string, status: PrepRecord['qaPreOpStatus']) => void;
  markPrepStagingReady: (prepId: string) => void;
  markPrepEquipmentReady: (prepId: string) => void;
  togglePrepQAPreOp: (prepId: string) => void;
  togglePrepStagingReady: (prepId: string) => void;
  togglePrepEquipmentReady: (prepId: string) => void;
  assignPrepSmokehouse: (prepId: string, confirmedRackCount?: number) => void;
  createBatchFromPrep: (prepId: string) => string | null;
  startCookBatch: (input: StartCookInput) => string | null;
  recordBatchAction: (batchId: string, action: BatchActionType) => void;
  markEquipmentClean: (equipmentId: string) => void;
  markEquipmentDirty: (equipmentId: string) => void;
  markEquipmentReady: (equipmentId: string) => void;
  markEquipmentNotReady: (equipmentId: string) => void;
  assignBatchToChiller: (batchId: string, chillerNumber: ChillerNumber) => boolean;
  assignNextBatchToChiller: (chillerNumber: ChillerNumber) => string | null;
  assignBatchToThermalCooler: (batchId: string, coolerId: ThermalCoolerCode) => boolean;
  assignNextBatchToThermalCooler: (coolerId: ThermalCoolerCode) => string | null;
  acknowledgeNotification: (notificationId: string) => void;
  runTimelineAction: (batchId: string, action: TimelineAction) => void;
  submitQADecision: (batchId: string, decision: Exclude<QAStatus, typeof QA_STATUSES.PENDING>) => void;
  releaseToPackaging: (batchId: string) => boolean;
};

const smokehouseCycle = [...SMOKEHOUSES];
const allChillers = [...CHILLERS];
const allThermalCoolers = [...THERMAL_COOLERS];
const defaultThermalConfig: ProductThermalConfig = {
  requiresShower: false,
  requiresEvacuate: false,
  requiresSlicing: false,
  estimatedCookMinutes: 110,
  estimatedChillMinutes: 90,
  ccpType: 'Internal Temp',
};
const defaultProductProfile: ProductProfile = {
  productName: 'Generic Product',
  cookType: 'steam',
  estimatedCookMinutes: 110,
  estimatedChillMinutes: 90,
  rackType: 'Standard Rack',
  averageRackCount: 8,
  averagePackagingMinutes: 60,
};
const productThermalConfig: Record<string, ProductThermalConfig> = {
  'Honey Baked Ham': {
    requiresShower: true,
    requiresEvacuate: false,
    requiresSlicing: false,
    estimatedCookMinutes: 120,
    estimatedChillMinutes: 80,
    ccpType: 'Core Temp',
  },
  'Smoked Bacon Slab': {
    requiresShower: true,
    requiresEvacuate: true,
    requiresSlicing: true,
    estimatedCookMinutes: 130,
    estimatedChillMinutes: 95,
    ccpType: 'Time/Temp',
  },
  'Turkey Breast': {
    requiresShower: false,
    requiresEvacuate: true,
    requiresSlicing: true,
    estimatedCookMinutes: 105,
    estimatedChillMinutes: 75,
    ccpType: 'Core Temp',
  },
  'Smoked Sausage': {
    requiresShower: false,
    requiresEvacuate: false,
    requiresSlicing: false,
    estimatedCookMinutes: 95,
    estimatedChillMinutes: 70,
    ccpType: 'Internal Temp',
  },
};
function getProductProfileForProduct(product: string): ProductProfile {
  return PRODUCT_PROFILES[product] ?? { ...defaultProductProfile, productName: product };
}

const seedPrepTickets: PrepRecord[] = [
  {
    id: 'PQ-20260406-001',
    product: 'Honey Baked Ham',
    tubs: 24,
    racks: 8,
    priority: PREP_PRIORITIES.RUSH,
    requestedStart: '05:55',
    status: PREP_STATUSES.ASSIGNED_TO_SMOKEHOUSE,
    assignedSmokehouse: 'D',
    qaPreOpStatus: 'Passed',
    stagingAreaReady: true,
    rtcEquipmentReady: true,
    awaitingThermalAssignment: false,
    rtcReadyRackCount: 8,
    thermalAssignedRackCount: 8,
    readyToLoad: false,
    linkedBatchId: 'B-20260406-014',
  },
  {
    id: 'PQ-20260406-002',
    product: 'Smoked Bacon Slab',
    tubs: 30,
    racks: 10,
    priority: PREP_PRIORITIES.NORMAL,
    requestedStart: '06:10',
    status: PREP_STATUSES.WAITING_QA_PRE_OP,
    assignedSmokehouse: '--',
    qaPreOpStatus: 'Pending',
    stagingAreaReady: true,
    rtcEquipmentReady: true,
    awaitingThermalAssignment: false,
    readyToLoad: false,
  },
  {
    id: 'PQ-20260406-003',
    product: 'Turkey Breast',
    tubs: 4,
    racks: 1,
    priority: PREP_PRIORITIES.NORMAL,
    requestedStart: '06:25',
    status: PREP_STATUSES.IN_PREP,
    assignedSmokehouse: 'E',
    qaPreOpStatus: 'Pending',
    stagingAreaReady: false,
    rtcEquipmentReady: true,
    awaitingThermalAssignment: false,
    readyToLoad: false,
    linkedBatchId: 'B-20260406-016',
  },
  {
    id: 'PQ-20260406-004',
    product: 'Smoked Sausage',
    tubs: 36,
    racks: 12,
    priority: PREP_PRIORITIES.HOLD,
    requestedStart: '06:40',
    status: PREP_STATUSES.IN_PREP,
    assignedSmokehouse: 'H',
    qaPreOpStatus: 'Passed',
    stagingAreaReady: false,
    rtcEquipmentReady: false,
    awaitingThermalAssignment: false,
    readyToLoad: false,
  },
];

function estimateBatchMinutes(config: ProductThermalConfig) {
  return (
    config.estimatedCookMinutes +
    config.estimatedChillMinutes +
    (config.requiresShower ? 12 : 0) +
    (config.requiresEvacuate ? 10 : 0)
  );
}

function applyProductConfigToBatch(
  batch: Omit<BatchRecord, 'requiresSlicing' | 'estimatedCookMinutes' | 'estimatedChillMinutes' | 'ccpType' | 'productProfile'>,
): BatchRecord {
  const config = productThermalConfig[batch.product] ?? defaultThermalConfig;
  const profile = getProductProfileForProduct(batch.product);
  return {
    ...batch,
    requiresShower: config.requiresShower,
    requiresEvacuate: config.requiresEvacuate,
    requiresSlicing: config.requiresSlicing,
    estimatedCookMinutes: config.estimatedCookMinutes,
    estimatedChillMinutes: config.estimatedChillMinutes,
    ccpType: config.ccpType,
    productProfile: profile,
  };
}

const seedBatchesBase: Omit<
  BatchRecord,
  'requiresSlicing' | 'estimatedCookMinutes' | 'estimatedChillMinutes' | 'ccpType' | 'productProfile'
>[] = [
  {
    id: 'B-20260406-014',
    product: 'Honey Baked Ham',
    smokehouse: 'D',
    rackCount: 8,
    requiresShower: true,
    requiresEvacuate: false,
    stage: BATCH_STAGES.COOK,
    status: BATCH_STATUSES.ON_TRACK,
    eta: '06:45',
    minutesToReady: 75,
    qaStatus: QA_STATUSES.PENDING,
  },
  {
    id: 'B-20260406-015',
    product: 'Smoked Bacon Slab',
    smokehouse: 'D',
    rackCount: 10,
    requiresShower: true,
    requiresEvacuate: true,
    stage: BATCH_STAGES.SHOWER,
    status: BATCH_STATUSES.DELAYED,
    eta: '06:58',
    minutesToReady: 88,
    qaStatus: QA_STATUSES.PENDING,
  },
  {
    id: 'B-20260406-016',
    product: 'Turkey Breast',
    smokehouse: 'E',
    rackCount: 1,
    requiresShower: false,
    requiresEvacuate: true,
    stage: BATCH_STAGES.QA,
    status: BATCH_STATUSES.QA_HOLD,
    eta: '07:10',
    minutesToReady: 100,
    qaStatus: QA_STATUSES.HOLD,
  },
  {
    id: 'B-20260406-017',
    product: 'Smoked Sausage',
    smokehouse: 'H',
    rackCount: 12,
    requiresShower: false,
    requiresEvacuate: false,
    stage: BATCH_STAGES.RTE,
    status: BATCH_STATUSES.READY,
    eta: 'Now',
    minutesToReady: 0,
    qaStatus: QA_STATUSES.PASS,
    packagingLineId: '8600',
    packagingStatus: 'Completed',
  },
  {
    id: 'B-20260406-018',
    product: 'Honey Baked Ham',
    smokehouse: 'F',
    rackCount: 8,
    requiresShower: true,
    requiresEvacuate: false,
    stage: BATCH_STAGES.CHILL,
    status: BATCH_STATUSES.ON_TRACK,
    eta: '07:22',
    minutesToReady: 112,
    qaStatus: QA_STATUSES.PENDING,
    assignedChiller: 8,
  },
  {
    id: 'B-20260406-019',
    product: 'Turkey Breast',
    smokehouse: 'I',
    rackCount: 6,
    requiresShower: false,
    requiresEvacuate: true,
    stage: BATCH_STAGES.COOK,
    status: BATCH_STATUSES.DELAYED,
    eta: '07:35',
    minutesToReady: 125,
    qaStatus: QA_STATUSES.PENDING,
  },
  {
    id: 'B-20260406-020',
    product: 'Honey Baked Ham',
    smokehouse: 'J',
    rackCount: 8,
    requiresShower: true,
    requiresEvacuate: false,
    stage: BATCH_STAGES.PACKAGING,
    status: BATCH_STATUSES.READY,
    eta: '07:35',
    minutesToReady: 35,
    qaStatus: QA_STATUSES.PASS,
    rteCoolerId: RTE_COOLER,
    packagingStatus: 'Waiting',
  },
  {
    id: 'B-20260406-021',
    product: 'Turkey Breast',
    smokehouse: 'K',
    rackCount: 6,
    requiresShower: false,
    requiresEvacuate: true,
    stage: BATCH_STAGES.CHILL,
    status: BATCH_STATUSES.ON_TRACK,
    eta: '08:12',
    minutesToReady: 72,
    qaStatus: QA_STATUSES.PENDING,
    assignedChiller: 10,
  },
  {
    id: 'B-20260406-022',
    product: 'Smoked Bacon Slab',
    smokehouse: 'L',
    rackCount: 10,
    requiresShower: true,
    requiresEvacuate: true,
    stage: BATCH_STAGES.COOK,
    status: BATCH_STATUSES.ON_TRACK,
    eta: '09:18',
    minutesToReady: 138,
    qaStatus: QA_STATUSES.PENDING,
  },
  {
    id: 'B-20260406-023',
    product: 'Honey Baked Ham',
    smokehouse: 'M',
    rackCount: 8,
    requiresShower: true,
    requiresEvacuate: false,
    stage: BATCH_STAGES.SHOWER,
    status: BATCH_STATUSES.DELAYED,
    eta: '10:05',
    minutesToReady: 185,
    qaStatus: QA_STATUSES.PENDING,
  },
  {
    id: 'B-20260406-024',
    product: 'Turkey Breast',
    smokehouse: 'N',
    rackCount: 6,
    requiresShower: false,
    requiresEvacuate: true,
    stage: BATCH_STAGES.CHILL,
    status: BATCH_STATUSES.QA_HOLD,
    eta: 'Delayed',
    minutesToReady: 240,
    qaStatus: QA_STATUSES.HOLD,
    assignedChiller: 11,
  },
  {
    id: 'B-20260406-025',
    product: 'Turkey Breast',
    smokehouse: 'E',
    rackCount: 1,
    requiresShower: false,
    requiresEvacuate: true,
    stage: BATCH_STAGES.CHILL,
    status: BATCH_STATUSES.ON_TRACK,
    eta: '07:28',
    minutesToReady: 58,
    qaStatus: QA_STATUSES.PENDING,
    assignedChiller: 8,
  },
];

const seedBatches: BatchRecord[] = seedBatchesBase.map(applyProductConfigToBatch);

const seedEvents: Record<string, TimelineEvent[]> = {
  'B-20260406-014': [
    { id: 'ev1', time: '05:42', title: 'Batch Created', detail: 'Prep ticket loaded into Smokehouse D' },
    { id: 'ev2', time: '05:45', title: 'Cook Started', detail: 'Operator: M. Rivera' },
    { id: 'ev3', time: '06:08', title: 'Delay Logged', detail: 'Reason: WaitMaterial (8 min)' },
  ],
  'B-20260406-015': [
    { id: 'ev1', time: '05:35', title: 'Cook Complete', detail: 'Transferred to shower lane' },
    { id: 'ev2', time: '05:41', title: 'Shower Started', detail: 'Line 2 active' },
    { id: 'ev3', time: '05:53', title: 'Delay Logged', detail: 'Reason: EquipmentIssue (12 min)' },
  ],
};

const defaultEvents: TimelineEvent[] = [
  { id: 'ev1', time: '05:30', title: 'Batch Created', detail: 'Batch entered production flow' },
  { id: 'ev2', time: '05:44', title: 'Stage Updated', detail: 'Operator action recorded' },
  { id: 'ev3', time: '06:01', title: 'Forecast ETA Updated', detail: 'ETA adjusted based on event timing' },
];

const seedEquipmentReadiness: EquipmentReadiness[] = [
  ...smokehouseCycle.map((code) => ({
    id: `SH-${code}`,
    type: 'Smokehouse' as const,
    clean: true,
    ready: true,
    notes: '',
  })),
  ...allChillers.map((number) => ({
    id: `CH-${number}`,
    type: 'Chiller' as const,
    clean: true,
    ready: true,
    notes: '',
  })),
  ...allThermalCoolers.map((coolerId) => ({
    id: `TC-${coolerId}`,
    type: 'ThermalCooler' as const,
    clean: true,
    ready: true,
    notes: '',
  })),
].map((item) => {
  if (item.id === 'CH-12') {
    return { ...item, ready: false, clean: false, notes: 'Maintenance in progress' };
  }

  if (item.id === 'SH-E') {
    return { ...item, clean: false, notes: 'Wash cycle pending' };
  }
  if (item.id === 'TC-29') {
    return { ...item, ready: false, notes: 'Door sensor fault' };
  }

  return item;
});

const seedRTECooler: RTECooler = {
  id: RTE_COOLER,
  cleanStatus: true,
  qaPreOpStatus: 'Passed',
  readyStatus: true,
  notes: '',
};

const seedPackagingLines: PackagingLine[] = [
  {
    id: '8600',
    type: 'slicing',
    cleanStatus: true,
    qaPreOpStatus: 'Passed',
    readyStatus: true,
  },
  {
    id: '8614',
    type: 'standard',
    cleanStatus: true,
    qaPreOpStatus: 'Passed',
    readyStatus: false,
  },
  {
    id: 'flip-flop',
    type: 'combo',
    cleanStatus: false,
    qaPreOpStatus: 'Pending',
    readyStatus: false,
  },
];

const seedSlicingLines: SlicingLine[] = [
  {
    id: 'SL-1',
    cleanStatus: true,
    qaPreOpStatus: 'Passed',
    ready: true,
  },
];

const seedNotifications: C3SNotification[] = [
  {
    id: 'N-001',
    severity: 'Critical',
    type: 'Equipment',
    message: 'CH-12 not ready. Chiller assignment blocked.',
    timestamp: '06:20',
    acknowledged: false,
  },
  {
    id: 'N-002',
    severity: 'Warning',
    type: 'Delay',
    batchId: 'B-20260406-015',
    message: 'Batch delay logged in shower stage.',
    timestamp: '06:08',
    acknowledged: false,
  },
  {
    id: 'N-003',
    severity: 'Warning',
    type: 'Equipment',
    batchId: 'B-20260406-025',
    message: 'Smokehouse E manual tracking required (1-rack active batch).',
    timestamp: '06:12',
    acknowledged: false,
  },
  {
    id: 'N-004',
    severity: 'Warning',
    type: 'Assignment',
    message: 'Chiller 8 at 90% utilization.',
    timestamp: '06:17',
    acknowledged: false,
  },
  {
    id: 'N-005',
    severity: 'Critical',
    type: 'QA',
    batchId: 'B-20260406-016',
    message: 'QA hold active: release blocked pending corrective action.',
    timestamp: '06:23',
    acknowledged: false,
  },
  {
    id: 'N-006',
    severity: 'Info',
    type: 'Batch',
    batchId: 'B-20260406-017',
    message: 'Batch ready for packaging.',
    timestamp: '06:04',
    acknowledged: true,
  },
];

const seedPlannedRuns: PlannedRunItem[] = [
  {
    id: 'WR-001',
    runId: 'B-WR-001',
    productName: 'Honey Baked Ham',
    productCategory: 'Pork',
    cookMethod: 'smoke',
    recipeProfile: 'Ham Standard 120F Curve',
    rackCount: 8,
    pieceCount: 320,
    priority: 'normal',
    targetDay: 'Mon',
    targetShift: 'Day',
    estimatedCookHours: 2,
    estimatedChillHours: 1.4,
    packagingLine: '8600',
    planningStatus: 'scheduled',
    assignedSmokehouse: 'D',
    plannedLoadTime: 'Mon 05:40',
    plannedCookStart: 'Mon 05:50',
    plannedCookEnd: 'Mon 07:50',
    assignedChiller: 8,
    plannedChillStart: 'Mon 08:05',
    plannedChillEnd: 'Mon 09:30',
    expectedQaWindow: 'Mon 09:35-09:50',
    expectedPackagingReady: 'Mon 10:05',
    forecastRiskFlags: [],
    rtcStatus: 'Staged for thermal loading',
    thermalStatus: 'Smokehouse assigned',
    postCookStatus: 'Awaiting post-cook transfer',
    qaStatus: 'Pending',
    packagingStatus: 'Not Released',
    currentStage: 'Weekly Planning',
    currentLocation: 'Planning Board',
    waitingOn: 'Execution Start',
    atRisk: false,
  },
  {
    id: 'WR-002',
    runId: 'B-WR-002',
    productName: 'Smoked Bacon Slab',
    productCategory: 'Pork',
    cookMethod: 'smoke',
    recipeProfile: 'Bacon Smoke 130F Curve',
    rackCount: 10,
    pieceCount: 280,
    priority: 'normal',
    targetDay: 'Mon',
    targetShift: 'Night',
    estimatedCookHours: 2.2,
    estimatedChillHours: 1.6,
    packagingLine: '8614',
    planningStatus: 'planned',
    forecastRiskFlags: ['Near smokehouse peak'],
    rtcStatus: 'Planned',
    thermalStatus: 'Not Started',
    postCookStatus: 'Not Started',
    qaStatus: 'Pending',
    packagingStatus: 'Not Released',
    currentStage: 'Weekly Planning',
    currentLocation: 'Planning Board',
    waitingOn: 'Scheduling',
    atRisk: true,
  },
  {
    id: 'WR-003',
    runId: 'B-WR-003',
    productName: 'Turkey Breast',
    productCategory: 'Poultry',
    cookMethod: 'steam',
    recipeProfile: 'Turkey Core Temp 105',
    rackCount: 6,
    pieceCount: 180,
    priority: 'normal',
    targetDay: 'Tue',
    targetShift: 'Day',
    estimatedCookHours: 1.8,
    estimatedChillHours: 1.3,
    packagingLine: 'SL-1 -> 8600',
    planningStatus: 'scheduled',
    assignedSmokehouse: 'F',
    assignedChiller: 10,
    plannedLoadTime: 'Tue 05:45',
    plannedCookStart: 'Tue 05:55',
    plannedCookEnd: 'Tue 07:40',
    plannedChillStart: 'Tue 07:55',
    plannedChillEnd: 'Tue 09:15',
    expectedQaWindow: 'Tue 09:20-09:40',
    expectedPackagingReady: 'Tue 09:55',
    forecastRiskFlags: [],
    rtcStatus: 'Planned',
    thermalStatus: 'Scheduled',
    postCookStatus: 'Planned',
    qaStatus: 'Pending',
    packagingStatus: 'Not Released',
    currentStage: 'Weekly Planning',
    currentLocation: 'Planning Board',
    waitingOn: 'Execution Start',
    atRisk: false,
  },
];

function cloneScenarioBase(): ScenarioState {
  return {
    plannedRuns: seedPlannedRuns.map((item) => ({ ...item })),
    prepTickets: seedPrepTickets.map((item) => ({ ...item })),
    batches: seedBatches.map((item) => ({ ...item })),
    eventsByBatch: Object.fromEntries(
      Object.entries(seedEvents).map(([batchId, events]) => [batchId, events.map((event) => ({ ...event }))]),
    ),
    equipmentReadiness: seedEquipmentReadiness.map((item) => ({ ...item })),
    rteCooler: { ...seedRTECooler },
    slicingLines: seedSlicingLines.map((item) => ({ ...item })),
    packagingLines: seedPackagingLines.map((item) => ({ ...item })),
    notifications: seedNotifications.map((item) => ({ ...item })),
  };
}

function buildScenarioState(scenario: DemoScenario): ScenarioState {
  const base = cloneScenarioBase();
  if (scenario === 'Normal Shift') {
    return base;
  }

  if (scenario === 'Capacity Risk') {
    const capacityBatch = applyProductConfigToBatch({
      id: 'B-20260406-026',
      product: 'Smoked Bacon Slab',
      smokehouse: 'L',
      rackCount: 2,
      requiresShower: true,
      requiresEvacuate: true,
      stage: BATCH_STAGES.CHILL,
      status: BATCH_STATUSES.DELAYED,
      eta: '08:40',
      minutesToReady: 130,
      qaStatus: QA_STATUSES.PENDING,
      assignedChiller: 8,
    });
    base.batches = [capacityBatch, ...base.batches];
    base.packagingLines = base.packagingLines.map((line) =>
      line.id === '8600' ? { ...line, assignedBatchId: 'B-20260406-017', readyStatus: true } : line,
    );
    base.slicingLines = base.slicingLines.map((line) =>
      line.id === 'SL-1' ? { ...line, cleanStatus: true, qaPreOpStatus: 'Passed', ready: true } : line,
    );
    base.rteCooler = { ...base.rteCooler, cleanStatus: true, qaPreOpStatus: 'Passed', readyStatus: true };
    base.notifications = [
      {
        id: 'N-CAP-001',
        severity: 'Critical',
        type: 'Assignment',
        message: 'Chiller 8 over capacity. Immediate rebalance required.',
        timestamp: '06:31',
        acknowledged: false,
      },
      {
        id: 'N-CAP-002',
        severity: 'Warning',
        type: 'Batch',
        batchId: capacityBatch.id,
        message: 'Batch assigned under overflow conditions.',
        timestamp: '06:29',
        acknowledged: false,
      },
      ...base.notifications.map((item) => ({ ...item, acknowledged: false })),
    ];
    return base;
  }

  base.batches = base.batches.map((batch) => {
    if (batch.id === 'B-20260406-014') {
      return {
        ...batch,
        stage: BATCH_STAGES.QA,
        status: BATCH_STATUSES.QA_HOLD,
        qaStatus: QA_STATUSES.HOLD,
        minutesToReady: 180,
        eta: '09:20',
      };
    }
    if (batch.id === 'B-20260406-020') {
      return {
        ...batch,
        stage: BATCH_STAGES.QA,
        status: BATCH_STATUSES.QA_HOLD,
        qaStatus: QA_STATUSES.FAIL,
        minutesToReady: 220,
        eta: 'Delayed',
      };
    }
    return batch;
  });
  base.packagingLines = base.packagingLines.map((line) =>
    line.id === '8600'
      ? { ...line, cleanStatus: true, qaPreOpStatus: 'Passed', readyStatus: true, assignedBatchId: undefined }
      : line.id === '8614'
        ? { ...line, cleanStatus: false, qaPreOpStatus: 'Pending', readyStatus: false }
        : line,
  );
  base.slicingLines = base.slicingLines.map((line) =>
    line.id === 'SL-1' ? { ...line, cleanStatus: false, qaPreOpStatus: 'Pending', ready: false } : line,
  );
  base.notifications = [
    {
      id: 'N-QA-001',
      severity: 'Critical',
      type: 'QA',
      batchId: 'B-20260406-014',
      message: 'QA hold active: documentation mismatch.',
      timestamp: '06:26',
      acknowledged: false,
    },
    {
      id: 'N-QA-002',
      severity: 'Critical',
      type: 'QA',
      batchId: 'B-20260406-020',
      message: 'QA failed: core temp verification required.',
      timestamp: '06:28',
      acknowledged: false,
    },
    ...base.notifications.map((item) => ({ ...item, acknowledged: false })),
  ];
  base.rteCooler = { ...base.rteCooler, cleanStatus: false, qaPreOpStatus: 'Pending', readyStatus: false, notes: 'Awaiting QA pre-op release' };
  return base;
}

const C3SContext = createContext<C3SState | null>(null);

function nowStamp() {
  const now = new Date();
  return {
    id: `${now.getTime()}-${Math.round(Math.random() * 1000)}`,
    time: formatClock(now),
  };
}

function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function minutesToEta(minutesToReady: number): string {
  if (minutesToReady <= 0) {
    return 'Now';
  }

  if (minutesToReady >= 240) {
    return 'Delayed';
  }

  const readyAt = new Date(Date.now() + minutesToReady * 60000);
  return formatClock(readyAt);
}

function formatTicketId(date: Date, index: number) {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `PQ-${day}-${String(index).padStart(3, '0')}`;
}

function formatBatchId(date: Date, index: number) {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `B-${day}-${String(index).padStart(3, '0')}`;
}

function smokehouseAfter(current: SmokehouseCode | '--'): SmokehouseCode {
  const active = current === '--' ? smokehouseCycle[0] : current;
  const idx = smokehouseCycle.indexOf(active);
  if (idx < 0) {
    return smokehouseCycle[0];
  }
  return smokehouseCycle[(idx + 1) % smokehouseCycle.length];
}

export function C3SProvider({ children }: { children: ReactNode }) {
  const [demoScenario, setDemoScenarioState] = useState<DemoScenario>('Normal Shift');
  const [plannedRuns, setPlannedRuns] = useState<PlannedRunItem[]>(() => buildScenarioState('Normal Shift').plannedRuns);
  const [prepTickets, setPrepTickets] = useState<PrepRecord[]>(() => buildScenarioState('Normal Shift').prepTickets);
  const [batches, setBatches] = useState<BatchRecord[]>(() => buildScenarioState('Normal Shift').batches);
  const [eventsByBatch, setEventsByBatch] = useState<Record<string, TimelineEvent[]>>(
    () => buildScenarioState('Normal Shift').eventsByBatch,
  );
  const [equipmentReadiness, setEquipmentReadiness] = useState<EquipmentReadiness[]>(
    () => buildScenarioState('Normal Shift').equipmentReadiness,
  );
  const [rteCooler, setRTECooler] = useState<RTECooler>(() => buildScenarioState('Normal Shift').rteCooler);
  const [slicingLines, setSlicingLines] = useState<SlicingLine[]>(
    () => buildScenarioState('Normal Shift').slicingLines,
  );
  const [packagingLines, setPackagingLines] = useState<PackagingLine[]>(
    () => buildScenarioState('Normal Shift').packagingLines,
  );
  const [notifications, setNotifications] = useState<C3SNotification[]>(
    () => buildScenarioState('Normal Shift').notifications,
  );

  const getProductThermalConfig = (product: string): ProductThermalConfig =>
    productThermalConfig[product] ?? defaultThermalConfig;

  const getBatchThermalPathFromRecord = (batch: BatchRecord): BatchStage[] => {
    const path: BatchStage[] = [BATCH_STAGES.COOK];
    if (batch.requiresShower) {
      path.push(BATCH_STAGES.SHOWER);
    }
    if (batch.requiresEvacuate) {
      path.push(BATCH_STAGES.EVACUATE);
    }
    path.push(BATCH_STAGES.CHILL);
    return path;
  };

  const moveTowardChill = (batch: BatchRecord): BatchStage => {
    if (batch.stage === BATCH_STAGES.COOK) {
      if (batch.requiresShower) return BATCH_STAGES.SHOWER;
      if (batch.requiresEvacuate) return BATCH_STAGES.EVACUATE;
      return BATCH_STAGES.CHILL;
    }
    if (batch.stage === BATCH_STAGES.SHOWER) {
      return batch.requiresEvacuate ? BATCH_STAGES.EVACUATE : BATCH_STAGES.CHILL;
    }
    if (batch.stage === BATCH_STAGES.EVACUATE) {
      return BATCH_STAGES.CHILL;
    }
    return batch.stage;
  };

  const isBatchActionEnabledForRecord = (batch: BatchRecord, action: BatchActionType) => {
    if (action === 'Log Delay') return batch.stage !== BATCH_STAGES.RTE;
    if (action === 'Critical Temp' || action === 'Probe Confirm') return batch.stage === BATCH_STAGES.COOK;
    if (action === 'Start Shower') return batch.stage === BATCH_STAGES.COOK && batch.requiresShower;
    if (action === 'End Shower') return batch.stage === BATCH_STAGES.SHOWER;
    if (action === 'Move to Chill') {
      if (batch.stage === BATCH_STAGES.COOK) return !batch.requiresShower;
      return batch.stage === BATCH_STAGES.EVACUATE;
    }
    if (action === 'Chill Check') return batch.stage === BATCH_STAGES.CHILL;
    return false;
  };

  const getEnabledBatchActions = (batchId: string) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return [];
    const allActions: BatchActionType[] = [
      'Critical Temp',
      'Probe Confirm',
      'Start Shower',
      'End Shower',
      'Move to Chill',
      'Chill Check',
      'Log Delay',
    ];
    return allActions.filter((action) => isBatchActionEnabledForRecord(batch, action));
  };

  const isTimelineActionEnabledForRecord = (batch: BatchRecord, action: TimelineAction) => {
    if (action === 'Log Delay') return batch.stage !== BATCH_STAGES.RTE;
    if (action === 'Start Shower') return batch.stage === BATCH_STAGES.COOK && batch.requiresShower;
    if (action === 'Complete Shower') return batch.stage === BATCH_STAGES.SHOWER;
    if (action === 'Assign Chiller') return batch.stage === BATCH_STAGES.CHILL;
    if (action === 'Start Chill') {
      if (batch.stage === BATCH_STAGES.EVACUATE) return true;
      if (batch.stage === BATCH_STAGES.COOK) return !batch.requiresShower;
      return false;
    }
    if (action === 'Complete Chill') return batch.stage === BATCH_STAGES.CHILL;
    if (action === 'Send to QA') return batch.stage === BATCH_STAGES.THERMAL_COOLER;
    return false;
  };

  const getEnabledTimelineActions = (batchId: string) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return [];
    const allActions: TimelineAction[] = [
      'Start Shower',
      'Complete Shower',
      'Assign Chiller',
      'Start Chill',
      'Complete Chill',
      'Send to QA',
      'Log Delay',
    ];
    return allActions.filter((action) => isTimelineActionEnabledForRecord(batch, action));
  };

  const getBatchThermalPath = (batchId: string): BatchStage[] => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return [];
    return getBatchThermalPathFromRecord(batch);
  };
  const getBatchOwnerFromRecord = (batch: BatchRecord): FlowOwner => {
    if (
      batch.stage === BATCH_STAGES.COOK ||
      batch.stage === BATCH_STAGES.SHOWER ||
      batch.stage === BATCH_STAGES.EVACUATE ||
      batch.stage === BATCH_STAGES.CHILL ||
      batch.stage === BATCH_STAGES.THERMAL_COOLER
    ) {
      return 'Thermal';
    }
    if (batch.stage === BATCH_STAGES.QA) return 'QA';
    if (batch.stage === BATCH_STAGES.PACKAGING || batch.stage === BATCH_STAGES.RTE) return 'Packaging';
    return 'RTC';
  };
  const getBatchLocationFromRecord = (batch: BatchRecord): string => {
    if (batch.stage === BATCH_STAGES.RTC) {
      return 'Staging Area';
    }
    if (batch.stage === BATCH_STAGES.COOK || batch.stage === BATCH_STAGES.SHOWER || batch.stage === BATCH_STAGES.EVACUATE) {
      return `Smokehouse ${batch.smokehouse}`;
    }
    if (batch.stage === BATCH_STAGES.CHILL) {
      return batch.assignedChiller ? `Chiller ${batch.assignedChiller}` : 'Chiller Pending Assignment';
    }
    if (batch.stage === BATCH_STAGES.THERMAL_COOLER) {
      return 'Thermal Cooler';
    }
    if (batch.stage === BATCH_STAGES.QA) return 'Thermal Cooler';
    if (batch.stage === BATCH_STAGES.RTE) return `RTE Cooler ${RTE_COOLER}`;
    if (batch.stage === BATCH_STAGES.PACKAGING) {
      if (batch.packagingLineId) return `Packaging Line ${batch.packagingLineId}`;
      if (batch.slicingLineId) return `Slicing Line ${batch.slicingLineId}`;
      if (batch.rteCoolerId) return `RTE Cooler ${batch.rteCoolerId}`;
      return `RTE Cooler ${RTE_COOLER}`;
    }
    return 'Staging Area';
  };
  const getBatchNextValidActionFromRecord = (batch: BatchRecord): string => {
    const enabled = getEnabledTimelineActions(batch.id);
    if (enabled.includes('Start Shower')) return 'Start Shower';
    if (enabled.includes('Complete Shower')) return 'Complete Shower';
    if (enabled.includes('Assign Chiller')) return 'Assign Chiller';
    if (enabled.includes('Start Chill')) return 'Move to Chill';
    if (enabled.includes('Complete Chill')) return 'Complete Chill';
    if (enabled.includes('Send to QA')) return 'Send to QA';
    if (batch.stage === BATCH_STAGES.QA) {
      if (batch.qaStatus === QA_STATUSES.PASS) return 'Release to Packaging';
      return 'QA Decision';
    }
    if (batch.stage === BATCH_STAGES.PACKAGING) {
      if (batch.packagingStatus === 'Waiting') return 'Assign Packaging Line';
      if (batch.packagingStatus === 'Assigned') return 'Start Packaging Run';
      if (batch.packagingStatus === 'Running') return 'Complete Packaging Run';
    }
    return 'Monitor';
  };
  const getBatchWaitingOnFromRecord = (batch: BatchRecord): string => {
    if (batch.stage === BATCH_STAGES.CHILL && !batch.assignedChiller) return 'Thermal chiller assignment';
    if (batch.stage === BATCH_STAGES.THERMAL_COOLER) return 'QA transfer/signoff';
    if (batch.stage === BATCH_STAGES.QA && batch.qaStatus !== QA_STATUSES.PASS) return 'QA review decision';
    if (batch.stage === BATCH_STAGES.PACKAGING && batch.packagingStatus === 'Waiting') return 'Packaging line assignment';
    const blocked = getBatchBlockedReasons(batch);
    if (blocked.length > 0) return blocked[0];
    return 'In active process';
  };
  const getBatchFlowSnapshot = (batchId: string): BatchFlowSnapshot | undefined => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return undefined;
    return {
      currentOwner: getBatchOwnerFromRecord(batch),
      currentLocation: getBatchLocationFromRecord(batch),
      currentStage: batch.stage,
      waitingOn: getBatchWaitingOnFromRecord(batch),
      nextValidAction: getBatchNextValidActionFromRecord(batch),
    };
  };
  const canViewBatchInArea = (area: FlowArea, batchId: string) => {
    const snapshot = getBatchFlowSnapshot(batchId);
    if (!snapshot) return false;
    if (area === 'thermal') return snapshot.currentOwner === 'Thermal';
    if (area === 'qa') return snapshot.currentOwner === 'QA' && snapshot.currentStage === BATCH_STAGES.QA;
    return snapshot.currentOwner === 'Packaging' && snapshot.currentStage === BATCH_STAGES.PACKAGING;
  };

  const addEvent = (batchId: string, title: string, detail: string) => {
    const stamp = nowStamp();
    setEventsByBatch((prev) => {
      const current = prev[batchId] ?? defaultEvents;
      return {
        ...prev,
        [batchId]: [{ id: stamp.id, time: stamp.time, title, detail }, ...current],
      };
    });
  };

  const pushNotification = ({
    severity,
    type,
    message,
    batchId,
  }: {
    severity: NotificationSeverity;
    type: NotificationType;
    message: string;
    batchId?: string;
  }) => {
    const now = new Date();
    setNotifications((prev) => [
      {
        id: `N-${now.getTime()}`,
        severity,
        type,
        message,
        batchId,
        timestamp: formatClock(now),
        acknowledged: false,
      },
      ...prev,
    ]);
  };

  const updateBatch = (batchId: string, updates: Partial<BatchRecord>) => {
    setBatches((prev) =>
      prev.map((batch) => {
        if (batch.id !== batchId) {
          return batch;
        }

        const nextMinutes = updates.minutesToReady ?? batch.minutesToReady;
        return {
          ...batch,
          ...updates,
          minutesToReady: nextMinutes,
          eta: updates.eta ?? minutesToEta(nextMinutes),
        };
      }),
    );
  };

  const isPackagingLineOperational = (line: PackagingLine) =>
    line.cleanStatus && line.qaPreOpStatus === 'Passed' && line.readyStatus;
  const isSlicingLineOperational = (line: SlicingLine) =>
    line.cleanStatus && line.qaPreOpStatus === 'Passed' && line.ready;
  const isRTECoolerOperational = (cooler: RTECooler) =>
    cooler.cleanStatus && cooler.qaPreOpStatus === 'Passed' && cooler.readyStatus;

  const markSlicingLineClean = (lineId: SlicingLineId) => {
    setSlicingLines((prev) =>
      prev.map((line) => (line.id === lineId ? { ...line, cleanStatus: true } : line)),
    );
  };

  const setSlicingLineQAPreOp = (lineId: SlicingLineId, status: 'Passed' | 'Failed') => {
    setSlicingLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              qaPreOpStatus: status,
              ready: status === 'Passed' ? line.ready : false,
            }
          : line,
      ),
    );
  };

  const markSlicingLineReady = (lineId: SlicingLineId) => {
    setSlicingLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        if (!line.cleanStatus || line.qaPreOpStatus !== 'Passed') {
          pushNotification({
            severity: 'Warning',
            type: 'Equipment',
            message: `Slicing line ${lineId} cannot be ready until clean + QA pre-op passed.`,
          });
          return line;
        }
        return { ...line, ready: true };
      }),
    );
  };

  const assignBatchToSlicingLine = (lineId: SlicingLineId, batchId?: string) => {
    const line = slicingLines.find((item) => item.id === lineId);
    if (!line) return null;
    if (!isSlicingLineOperational(line)) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        message: `Slicing line ${lineId} not ready for assignment.`,
      });
      return null;
    }

    if (line.assignedBatchId) {
      updateBatch(line.assignedBatchId, { slicingStatus: 'Completed', slicingLineId: undefined });
      addEvent(line.assignedBatchId, 'Slicing Completed', `Slicing completed on line ${lineId}.`);
      setSlicingLines((prev) =>
        prev.map((item) => (item.id === lineId ? { ...item, assignedBatchId: undefined } : item)),
      );
      return line.assignedBatchId;
    }

    const targetBatch =
      (batchId ? batches.find((item) => item.id === batchId) : undefined) ??
      batches.find(
        (item) =>
          item.requiresSlicing &&
          item.slicingStatus === 'Waiting' &&
          item.qaStatus === QA_STATUSES.PASS &&
          item.rteCoolerId === RTE_COOLER &&
          item.packagingStatus === 'Waiting',
      );

    if (!targetBatch) {
      pushNotification({
        severity: 'Info',
        type: 'Assignment',
        message: `No slicing-ready batch available for line ${lineId}.`,
      });
      return null;
    }
    if (targetBatch.stage !== BATCH_STAGES.PACKAGING) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        batchId: targetBatch.id,
        message: `Assignment blocked: ${targetBatch.id} must be released to packaging before slicing assignment.`,
      });
      return null;
    }

    setSlicingLines((prev) =>
      prev.map((item) => (item.id === lineId ? { ...item, assignedBatchId: targetBatch.id } : item)),
    );
    updateBatch(targetBatch.id, { slicingLineId: lineId, slicingStatus: 'Assigned', rteCoolerId: undefined });
    addEvent(targetBatch.id, 'Slicing Assigned', `Assigned to slicing line ${lineId}.`);
    return targetBatch.id;
  };

  const markPackagingLineClean = (lineId: PackagingLineId) => {
    setPackagingLines((prev) =>
      prev.map((line) => (line.id === lineId ? { ...line, cleanStatus: true } : line)),
    );
    pushNotification({
      severity: 'Info',
      type: 'Equipment',
      message: `Packaging line ${lineId} marked clean.`,
    });
  };

  const setPackagingLineQAPreOp = (lineId: PackagingLineId, status: 'Passed' | 'Failed') => {
    setPackagingLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              qaPreOpStatus: status,
              readyStatus: status === 'Passed' ? line.readyStatus : false,
            }
          : line,
      ),
    );
  };

  const markPackagingLineReady = (lineId: PackagingLineId) => {
    setPackagingLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        if (!line.cleanStatus || line.qaPreOpStatus !== 'Passed') {
          pushNotification({
            severity: 'Warning',
            type: 'Equipment',
            message: `Packaging line ${lineId} cannot be ready until clean + QA pre-op passed.`,
          });
          return line;
        }
        return { ...line, readyStatus: true };
      }),
    );
  };

  const assignBatchToPackagingLine = (lineId: PackagingLineId, batchId?: string) => {
    const line = packagingLines.find((item) => item.id === lineId);
    if (!line) return null;
    if (!isPackagingLineOperational(line)) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        message: `Packaging line ${lineId} not ready for assignment.`,
      });
      return null;
    }

    if (line.assignedBatchId) {
      const currentBatch = line.assignedBatchId;
      const current = batches.find((item) => item.id === currentBatch);
      if (current?.packagingStatus === 'Assigned') {
        updateBatch(currentBatch, { packagingStatus: 'Running', stage: BATCH_STAGES.PACKAGING });
        addEvent(currentBatch, 'Packaging Running', `Packaging run started on line ${lineId}.`);
      } else if (current?.packagingStatus === 'Running') {
        updateBatch(currentBatch, { packagingStatus: 'Completed', stage: BATCH_STAGES.RTE, packagingLineId: undefined });
        setPlannedRuns((prev) =>
          prev.map((item) =>
            item.linkedBatchId === currentBatch || item.runId === currentBatch
              ? {
                  ...item,
                  planningStatus: 'complete',
                  packagingStatus: 'Complete',
                  currentStage: 'Packaging: Complete',
                  currentLocation: `RTE Cooler ${RTE_COOLER}`,
                  waitingOn: 'None',
                  atRisk: false,
                }
              : item,
          ),
        );
        addEvent(currentBatch, 'Packaging Completed', `Packaging completed on line ${lineId}.`);
        setPackagingLines((prev) =>
          prev.map((item) => (item.id === lineId ? { ...item, assignedBatchId: undefined } : item)),
        );
      }
      return currentBatch;
    }

    const targetBatch =
      (batchId ? batches.find((item) => item.id === batchId) : undefined) ??
      batches.find(
        (item) =>
          item.packagingStatus === 'Waiting' &&
          item.packagingLineId === undefined &&
          (!item.requiresSlicing || item.slicingStatus === 'Completed') &&
          item.rteCoolerId === RTE_COOLER &&
          item.qaStatus === QA_STATUSES.PASS,
      );

    if (!targetBatch) {
      pushNotification({
        severity: 'Info',
        type: 'Assignment',
        message: `No packaging-ready batch available for line ${lineId}.`,
      });
      return null;
    }
    if (targetBatch.stage !== BATCH_STAGES.PACKAGING) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        batchId: targetBatch.id,
        message: `Assignment blocked: ${targetBatch.id} is not in released-to-packaging stage.`,
      });
      return null;
    }

    if (targetBatch.qaStatus !== QA_STATUSES.PASS) {
      pushNotification({
        severity: 'Warning',
        type: 'QA',
        batchId: targetBatch.id,
        message: `Batch ${targetBatch.id} blocked from packaging until QA pass.`,
      });
      return null;
    }

    setPackagingLines((prev) =>
      prev.map((item) => (item.id === lineId ? { ...item, assignedBatchId: targetBatch.id } : item)),
    );
    updateBatch(targetBatch.id, {
      packagingLineId: lineId,
      packagingStatus: 'Assigned',
      stage: BATCH_STAGES.PACKAGING,
      rteCoolerId: undefined,
    });
    addEvent(targetBatch.id, 'Packaging Assigned', `Assigned to packaging line ${lineId}.`);
    return targetBatch.id;
  };

  const derivePrepStatus = (prep: PrepRecord): PrepStatus => {
    if (prep.linkedBatchId) {
      return PREP_STATUSES.LOADED;
    }
    if (prep.readyToLoad && prep.assignedSmokehouse !== '--') {
      return PREP_STATUSES.ASSIGNED_TO_SMOKEHOUSE;
    }
    if (prep.awaitingThermalAssignment) {
      return PREP_STATUSES.READY_TO_LOAD;
    }
    if (prep.qaPreOpStatus !== 'Passed') {
      return PREP_STATUSES.WAITING_QA_PRE_OP;
    }
    if (prep.stagingAreaReady && prep.rtcEquipmentReady) {
      return PREP_STATUSES.RTC_READY;
    }
    return PREP_STATUSES.IN_PREP;
  };

  const withDerivedPrepState = (prep: PrepRecord): PrepRecord => {
    const readyForThermalGate =
      prep.qaPreOpStatus === 'Passed' &&
      prep.stagingAreaReady &&
      prep.rtcEquipmentReady;
    const next = {
      ...prep,
      awaitingThermalAssignment:
        prep.linkedBatchId || !readyForThermalGate ? false : Boolean(prep.awaitingThermalAssignment),
      readyToLoad:
        prep.linkedBatchId || !readyForThermalGate || prep.assignedSmokehouse === '--'
          ? false
          : Boolean(prep.readyToLoad),
    };
    return { ...next, status: derivePrepStatus(next) };
  };

  const pushRTCBlockNotifications = (prep: PrepRecord) => {
    if (prep.qaPreOpStatus !== 'Passed') {
      pushNotification({
        severity: 'Warning',
        type: 'QA',
        message: `RTC QA Pre-Op Pending: ${prep.id}.`,
      });
    }
    if (!prep.stagingAreaReady) {
      pushNotification({
        severity: 'Warning',
        type: 'Equipment',
        message: `RTC Area Not Ready: ${prep.id}.`,
      });
    }
    if (!prep.rtcEquipmentReady) {
      pushNotification({
        severity: 'Warning',
        type: 'Equipment',
        message: `RTC Equipment Not Ready: ${prep.id}.`,
      });
    }
    if (prep.awaitingThermalAssignment) {
      pushNotification({
        severity: 'Info',
        type: 'Assignment',
        message: `Thermal assignment pending: ${prep.id}.`,
      });
    }
  };

  const addPlannedRun = (input: PlannedRunInput) => {
    const newId = `WR-${String(plannedRuns.length + 1).padStart(3, '0')}`;
    const cookMinutes = Math.round(input.estimatedCookHours * 60);
    const chillMinutes = Math.round(input.estimatedChillHours * 60);
    const plannedRun: PlannedRunItem = {
      id: newId,
      ...input,
      planningStatus: 'planned',
      forecastRiskFlags: [],
      assignedSmokehouse: undefined,
      plannedLoadTime: `${input.targetDay} ${input.targetShift}`,
      plannedCookStart: `${input.targetDay} ${input.targetShift}`,
      plannedCookEnd: minutesToEta(cookMinutes),
      assignedChiller: undefined,
      plannedChillStart: minutesToEta(cookMinutes + 15),
      plannedChillEnd: minutesToEta(cookMinutes + chillMinutes + 15),
      expectedQaWindow: minutesToEta(cookMinutes + chillMinutes + 35),
      expectedPackagingReady: minutesToEta(cookMinutes + chillMinutes + 55),
      rtcStatus: 'Planned',
      thermalStatus: 'Not Started',
      postCookStatus: 'Not Started',
      qaStatus: 'Pending',
      packagingStatus: 'Not Released',
      currentStage: 'Weekly Planning',
      currentLocation: 'Planning Board',
      waitingOn: 'Scheduling',
      atRisk: false,
    };
    setPlannedRuns((prev) => [plannedRun, ...prev]);
    pushNotification({
      severity: 'Info',
      type: 'Batch',
      message: `Weekly run item added: ${plannedRun.runId} (${plannedRun.targetDay} ${plannedRun.targetShift}).`,
    });
    return plannedRun.id;
  };

  const updatePlannedRunStatus = (plannedRunId: string, status: RunPlanStatus) => {
    setPlannedRuns((prev) =>
      prev.map((item) =>
        item.id === plannedRunId
          ? {
              ...item,
              planningStatus: status,
              currentStage:
                status === 'complete'
                  ? 'Packaging: Complete'
                  : status === 'in progress'
                    ? 'Execution'
                    : 'Weekly Planning',
            }
          : item,
      ),
    );
  };

  const promotePlannedRunToPrep = (plannedRunId: string) => {
    const run = plannedRuns.find((item) => item.id === plannedRunId);
    if (!run) return null;
    if (run.planningStatus === 'complete') {
      pushNotification({
        severity: 'Warning',
        type: 'Batch',
        message: `Run ${run.runId} is already complete and cannot be promoted.`,
      });
      return null;
    }
    if (run.linkedPrepId) return run.linkedPrepId;

    const now = new Date();
    const prepId = formatTicketId(now, prepTickets.length + 1);
    const prepFromPlan = withDerivedPrepState({
      id: prepId,
      product: run.productName,
      tubs: Math.max(run.rackCount * 3, run.rackCount),
      racks: run.rackCount,
      priority: PREP_PRIORITIES.NORMAL,
      requestedStart: `${run.targetDay} ${run.targetShift}`,
      status: PREP_STATUSES.IN_PREP,
      assignedSmokehouse: '--',
      qaPreOpStatus: 'Pending',
      stagingAreaReady: false,
      rtcEquipmentReady: false,
      awaitingThermalAssignment: false,
      readyToLoad: false,
    });

    setPrepTickets((prev) => [prepFromPlan, ...prev]);
    setPlannedRuns((prev) =>
      prev.map((item) =>
        item.id === plannedRunId
          ? {
              ...item,
              planningStatus: 'in progress',
              linkedPrepId: prepId,
              rtcStatus: 'In RTC Queue',
              currentStage: 'RTC: In Prep',
              currentLocation: 'Staging Area',
              waitingOn: 'Prep completion and thermal assignment',
            }
          : item,
      ),
    );

    pushNotification({
      severity: 'Info',
      type: 'Batch',
      message: `Run ${run.runId} promoted to RTC queue (${prepId}).`,
    });

    return prepId;
  };

  const createPrep = () => {
    const now = new Date();
    const products = ['Honey Baked Ham', 'Smoked Bacon Slab', 'Turkey Breast', 'Smoked Sausage'];
    const product = products[prepTickets.length % products.length];
    const rackCount = product === 'Turkey Breast' ? 6 : product === 'Smoked Bacon Slab' ? 10 : 8;

    const nextPrep: PrepRecord = withDerivedPrepState({
      id: formatTicketId(now, prepTickets.length + 1),
      product,
      tubs: rackCount * 3,
      racks: rackCount,
      priority: PREP_PRIORITIES.NORMAL,
      requestedStart: formatClock(now),
      assignedSmokehouse: '--',
      status: PREP_STATUSES.IN_PREP,
      qaPreOpStatus: 'Pending',
      stagingAreaReady: false,
      rtcEquipmentReady: false,
      awaitingThermalAssignment: false,
      readyToLoad: false,
    });

    setPrepTickets((prev) => [nextPrep, ...prev]);
    pushNotification({
      severity: 'Info',
      type: 'Batch',
      message: `RTC ticket created: ${nextPrep.id}.`,
    });
    return nextPrep;
  };

  const markPrepReady = (prepId: string) => {
    const prep = prepTickets.find((item) => item.id === prepId);
    if (!prep) return;

    const readyForThermalGate =
      prep.qaPreOpStatus === 'Passed' &&
      prep.stagingAreaReady &&
      prep.rtcEquipmentReady;

    if (!readyForThermalGate) {
      pushRTCBlockNotifications(prep);
      return;
    }

    setPrepTickets((prev) =>
      prev.map((item) =>
        item.id === prepId
          ? withDerivedPrepState({
              ...item,
              awaitingThermalAssignment: true,
              rtcReadyRackCount: item.racks,
              thermalAssignedRackCount: undefined,
              readyToLoad: false,
            })
          : item,
      ),
    );
    pushNotification({
      severity: 'Info',
      type: 'Batch',
      message: `Ready for thermal handoff: ${prepId}.`,
    });
    pushNotification({
      severity: 'Info',
      type: 'Assignment',
      message: `Thermal assignment queue: ${prepId}.`,
    });
  };

  const markPrepRTCReady = (prepId: string) => {
    setPrepTickets((prev) =>
      prev.map((prep) => {
        if (prep.id !== prepId) return prep;
        const next = withDerivedPrepState({
          ...prep,
          stagingAreaReady: true,
          rtcEquipmentReady: true,
          awaitingThermalAssignment: false,
          rtcReadyRackCount: prep.rtcReadyRackCount,
          thermalAssignedRackCount: prep.thermalAssignedRackCount,
          readyToLoad: false,
        });
        if (next.status === PREP_STATUSES.RTC_READY) {
          pushNotification({
            severity: 'Info',
            type: 'Batch',
            message: `Ready for Thermal: ${prepId}.`,
          });
          pushNotification({
            severity: 'Info',
            type: 'Assignment',
            message: `Awaiting Thermal Assignment: ${prepId}.`,
          });
        }
        return next;
      }),
    );
  };

  const setPrepQAPreOp = (prepId: string, status: PrepRecord['qaPreOpStatus']) => {
    setPrepTickets((prev) =>
      prev.map((prep) => {
        if (prep.id !== prepId) return prep;
        const next = withDerivedPrepState({
          ...prep,
          qaPreOpStatus: status,
          awaitingThermalAssignment: status === 'Passed' ? prep.awaitingThermalAssignment : false,
          thermalAssignedRackCount: status === 'Passed' ? prep.thermalAssignedRackCount : undefined,
          readyToLoad: false,
        });
        if (status === 'Failed') {
          pushNotification({
            severity: 'Warning',
            type: 'QA',
            message: `RTC QA Pre-Op Failed: ${prepId}.`,
          });
        } else if (status === 'Pending') {
          pushNotification({
            severity: 'Warning',
            type: 'QA',
            message: `RTC QA Pre-Op Pending: ${prepId}.`,
          });
        } else if (next.status === PREP_STATUSES.RTC_READY) {
          pushNotification({
            severity: 'Info',
            type: 'Batch',
            message: `Ready for Thermal: ${prepId}.`,
          });
          pushNotification({
            severity: 'Info',
            type: 'Assignment',
            message: `Awaiting Thermal Assignment: ${prepId}.`,
          });
        }
        return next;
      }),
    );
  };

  const markPrepStagingReady = (prepId: string) => {
    setPrepTickets((prev) =>
      prev.map((prep) => {
        if (prep.id !== prepId) return prep;
        const next = withDerivedPrepState({
          ...prep,
          stagingAreaReady: true,
          awaitingThermalAssignment: prep.awaitingThermalAssignment,
          readyToLoad: false,
        });
        if (next.status === PREP_STATUSES.RTC_READY) {
          pushNotification({
            severity: 'Info',
            type: 'Batch',
            message: `Ready for Thermal: ${prepId}.`,
          });
          pushNotification({
            severity: 'Info',
            type: 'Assignment',
            message: `Awaiting Thermal Assignment: ${prepId}.`,
          });
        }
        return next;
      }),
    );
  };

  const markPrepEquipmentReady = (prepId: string) => {
    setPrepTickets((prev) =>
      prev.map((prep) => {
        if (prep.id !== prepId) return prep;
        const next = withDerivedPrepState({
          ...prep,
          rtcEquipmentReady: true,
          awaitingThermalAssignment: prep.awaitingThermalAssignment,
          readyToLoad: false,
        });
        if (next.status === PREP_STATUSES.RTC_READY) {
          pushNotification({
            severity: 'Info',
            type: 'Batch',
            message: `Ready for Thermal: ${prepId}.`,
          });
          pushNotification({
            severity: 'Info',
            type: 'Assignment',
            message: `Awaiting Thermal Assignment: ${prepId}.`,
          });
        }
        return next;
      }),
    );
  };

  const assignPrepSmokehouse = (prepId: string, confirmedRackCount?: number) => {
    const prep = prepTickets.find((item) => item.id === prepId);
    if (!prep) return;

    const rtcReadyGate =
      prep.qaPreOpStatus === 'Passed' &&
      prep.stagingAreaReady &&
      prep.rtcEquipmentReady &&
      prep.awaitingThermalAssignment;
    if (!rtcReadyGate) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        message: `Thermal assignment blocked until RTC marks ready: ${prepId}.`,
      });
      pushRTCBlockNotifications(prep);
      return;
    }
    const nextRackCount = Math.max(1, Math.round(confirmedRackCount ?? prep.rtcReadyRackCount ?? prep.racks));

    setPrepTickets((prev) =>
      prev.map((item) =>
        item.id === prepId
          ? {
              ...withDerivedPrepState({
                ...item,
                assignedSmokehouse: smokehouseAfter(item.assignedSmokehouse),
                thermalAssignedRackCount: nextRackCount,
                awaitingThermalAssignment: false,
                readyToLoad: true,
              }),
            }
          : item,
      ),
    );
    pushNotification({
      severity: 'Info',
      type: 'Assignment',
      message: `Assigned and ready to load: ${prepId} (${nextRackCount} racks).`,
    });
  };

  const togglePrepQAPreOp = (prepId: string) => {
    const prep = prepTickets.find((item) => item.id === prepId);
    if (!prep) return;
    setPrepQAPreOp(prepId, prep.qaPreOpStatus === 'Passed' ? 'Pending' : 'Passed');
  };

  const togglePrepStagingReady = (prepId: string) => {
    setPrepTickets((prev) =>
      prev.map((prep) => {
        if (prep.id !== prepId) return prep;
        const next = withDerivedPrepState({
          ...prep,
          stagingAreaReady: !prep.stagingAreaReady,
          readyToLoad: false,
        });
        if (!next.stagingAreaReady) {
          pushNotification({
            severity: 'Warning',
            type: 'Equipment',
            message: `RTC Area Not Ready: ${prepId}.`,
          });
        } else if (next.status === PREP_STATUSES.RTC_READY) {
          pushNotification({
            severity: 'Info',
            type: 'Batch',
            message: `Ready for Thermal: ${prepId}.`,
          });
          pushNotification({
            severity: 'Info',
            type: 'Assignment',
            message: `Awaiting Thermal Assignment: ${prepId}.`,
          });
        }
        return next;
      }),
    );
  };

  const togglePrepEquipmentReady = (prepId: string) => {
    setPrepTickets((prev) =>
      prev.map((prep) => {
        if (prep.id !== prepId) return prep;
        const next = withDerivedPrepState({
          ...prep,
          rtcEquipmentReady: !prep.rtcEquipmentReady,
          readyToLoad: false,
        });
        if (!next.rtcEquipmentReady) {
          pushNotification({
            severity: 'Warning',
            type: 'Equipment',
            message: `RTC Equipment Not Ready: ${prepId}.`,
          });
        } else if (next.status === PREP_STATUSES.RTC_READY) {
          pushNotification({
            severity: 'Info',
            type: 'Batch',
            message: `Ready for Thermal: ${prepId}.`,
          });
          pushNotification({
            severity: 'Info',
            type: 'Assignment',
            message: `Awaiting Thermal Assignment: ${prepId}.`,
          });
        }
        return next;
      }),
    );
  };

  const createBatchFromPrep = (prepId: string) => {
    const prep = prepTickets.find((item) => item.id === prepId);
    if (!prep) {
      return null;
    }

    if (prep.linkedBatchId) {
      return prep.linkedBatchId;
    }

    if (!prep.readyToLoad || prep.assignedSmokehouse === '--' || !prep.thermalAssignedRackCount) {
      pushRTCBlockNotifications(prep);
      return null;
    }

    const now = new Date();
    const batchId = formatBatchId(now, batches.length + 1);
    const config = getProductThermalConfig(prep.product);
    const estimatedMinutes = estimateBatchMinutes(config);

    const newBatch: BatchRecord = {
      id: batchId,
      product: prep.product,
      smokehouse: prep.assignedSmokehouse,
      rackCount: prep.thermalAssignedRackCount,
      requiresShower: config.requiresShower,
      requiresEvacuate: config.requiresEvacuate,
      requiresSlicing: config.requiresSlicing,
      estimatedCookMinutes: config.estimatedCookMinutes,
      estimatedChillMinutes: config.estimatedChillMinutes,
      ccpType: config.ccpType,
      productProfile: getProductProfileForProduct(prep.product),
      stage: BATCH_STAGES.COOK,
      status: BATCH_STATUSES.ON_TRACK,
      minutesToReady: estimatedMinutes,
      eta: minutesToEta(estimatedMinutes),
      qaStatus: QA_STATUSES.PENDING,
      slicingStatus: undefined,
      packagingStatus: undefined,
    };

    setBatches((prev) => [newBatch, ...prev]);
    setEventsByBatch((prev) => ({
      ...prev,
      [batchId]: [
        {
          id: `${Date.now()}-0`,
          time: formatClock(now),
          title: 'Batch Created',
          detail: `Created from prep ticket ${prep.id}`,
        },
      ],
    }));

    setPrepTickets((prev) =>
      prev.map((item) =>
        item.id === prepId
          ? {
              ...item,
              status: PREP_STATUSES.LOADED,
              awaitingThermalAssignment: false,
              rtcReadyRackCount: item.rtcReadyRackCount,
              thermalAssignedRackCount: item.thermalAssignedRackCount,
              readyToLoad: false,
              assignedSmokehouse: item.assignedSmokehouse === '--' ? 'D' : item.assignedSmokehouse,
              linkedBatchId: batchId,
            }
          : item,
      ),
    );
    setPlannedRuns((prev) =>
      prev.map((item) =>
        item.linkedPrepId === prepId || item.runId === batchId
          ? {
              ...item,
              planningStatus: 'in progress',
              linkedBatchId: batchId,
              linkedPrepId: item.linkedPrepId ?? prepId,
              thermalStatus: 'Cook Started',
              currentStage: 'Thermal',
              currentLocation: `Smokehouse ${prep.assignedSmokehouse}`,
              waitingOn: 'Post-cook transfer to chill',
            }
          : item,
      ),
    );

    return batchId;
  };

  const startCookBatch = (input: StartCookInput) => {
    const checklistComplete = Object.values(input.checklist).every(Boolean);
    if (!checklistComplete) {
      pushNotification({
        severity: 'Warning',
        type: 'Batch',
        message: 'Start Cook blocked: complete all pre-cook checklist items.',
      });
      return null;
    }
    if (!SMOKEHOUSES.includes(input.smokehouse)) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        message: `Start Cook blocked: smokehouse ${input.smokehouse} is not a valid configured lane.`,
      });
      return null;
    }

    const now = new Date();
    const batchId = input.batchId?.trim() || formatBatchId(now, batches.length + 1);
    const config = getProductThermalConfig(input.product);
    const estimatedMinutes = estimateBatchMinutes(config);

    const newBatch: BatchRecord = {
      id: batchId,
      product: input.product,
      smokehouse: input.smokehouse,
      rackCount: input.rackCount,
      requiresShower: config.requiresShower,
      requiresEvacuate: config.requiresEvacuate,
      requiresSlicing: config.requiresSlicing,
      estimatedCookMinutes: config.estimatedCookMinutes,
      estimatedChillMinutes: config.estimatedChillMinutes,
      ccpType: config.ccpType,
      productProfile: getProductProfileForProduct(input.product),
      stage: BATCH_STAGES.COOK,
      status: BATCH_STATUSES.ON_TRACK,
      minutesToReady: estimatedMinutes,
      eta: minutesToEta(estimatedMinutes),
      qaStatus: QA_STATUSES.PENDING,
      slicingStatus: undefined,
      packagingStatus: undefined,
    };

    setBatches((prev) => [newBatch, ...prev]);
    setPlannedRuns((prev) =>
      prev.map((item) =>
        item.runId === batchId || item.linkedBatchId === batchId
          ? {
              ...item,
              planningStatus: 'in progress',
              linkedBatchId: batchId,
              thermalStatus: 'Cook Started',
              rtcStatus: 'Loaded to smokehouse',
              currentStage: 'Thermal',
              currentLocation: `Smokehouse ${input.smokehouse}`,
              waitingOn: 'Cook progression to critical limit',
            }
          : item,
      ),
    );
    setEventsByBatch((prev) => ({
      ...prev,
      [batchId]: [
        {
          id: `${Date.now()}-cook`,
          time: formatClock(now),
          title: 'Cook Started',
          detail: `${input.product} | ${input.rackCount} racks | ${input.pieceCount} pcs`,
        },
      ],
    }));

    pushNotification({
      severity: 'Info',
      type: 'Batch',
      batchId,
      message: `Cook started for ${input.product} in smokehouse ${input.smokehouse}.`,
    });

    return batchId;
  };

  const recordBatchAction = (batchId: string, action: BatchActionType) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) {
      return;
    }

    if (!isBatchActionEnabledForRecord(batch, action)) {
      addEvent(batchId, `${action} Blocked`, `Action unavailable in stage ${batch.stage} for this recipe path.`);
      return;
    }

    if (action === 'Start Shower') {
      updateBatch(batchId, {
        stage: BATCH_STAGES.SHOWER,
        status: BATCH_STATUSES.ON_TRACK,
        minutesToReady: Math.max(batch.minutesToReady - 12, 0),
      });
      addEvent(batchId, action, 'Shower stage started.');
      return;
    }

    if (action === 'End Shower') {
      const nextStage = moveTowardChill(batch);
      updateBatch(batchId, {
        stage: nextStage,
        status: BATCH_STATUSES.ON_TRACK,
        minutesToReady: Math.max(batch.minutesToReady - 10, 0),
      });
      addEvent(batchId, action, nextStage === BATCH_STAGES.EVACUATE ? 'Shower complete. Moving to evacuate.' : 'Shower complete. Moving to chill.');
      return;
    }

    if (action === 'Move to Chill') {
      const nextStage = moveTowardChill(batch);
      if (nextStage !== BATCH_STAGES.CHILL) {
        updateBatch(batchId, {
          stage: nextStage,
          status: BATCH_STATUSES.ON_TRACK,
          minutesToReady: Math.max(batch.minutesToReady - 8, 0),
        });
        addEvent(batchId, 'Thermal Transition', `Moved to ${nextStage} stage by recipe path.`);
        return;
      }
      updateBatch(batchId, {
        stage: BATCH_STAGES.CHILL,
        status: BATCH_STATUSES.ON_TRACK,
        minutesToReady: Math.max(batch.minutesToReady - 10, 0),
      });
      addEvent(batchId, action, 'Moved into chill stage.');
      const assigned = assignBatchToChiller(batchId, 8);
      if (!assigned) {
        addEvent(batchId, 'Chiller Assign Pending', 'No available ready chiller; assignment remains pending.');
      }
      return;
    }

    if (action === 'Log Delay') {
      updateBatch(batchId, {
        status: BATCH_STATUSES.DELAYED,
        minutesToReady: batch.minutesToReady + 20,
      });
      addEvent(batchId, action, 'Delay logged by operator.');
      pushNotification({
        severity: 'Warning',
        type: 'Delay',
        batchId,
        message: `Delay logged for ${batchId}.`,
      });
      return;
    }

    addEvent(batchId, action, 'Action recorded.');
  };

  const markEquipmentClean = (equipmentId: string) => {
    setEquipmentReadiness((prev) =>
      prev.map((item) =>
        item.id === equipmentId
          ? {
              ...item,
              clean: true,
              notes: item.ready ? '' : item.notes,
            }
          : item,
      ),
    );
    pushNotification({
      severity: 'Info',
      type: 'Equipment',
      message: `${equipmentId} marked clean.`,
    });
  };

  const markEquipmentDirty = (equipmentId: string) => {
    setEquipmentReadiness((prev) =>
      prev.map((item) =>
        item.id === equipmentId
          ? {
              ...item,
              clean: false,
              notes: item.notes || 'Cleaning required',
            }
          : item,
      ),
    );
    pushNotification({
      severity: 'Warning',
      type: 'Equipment',
      message: `${equipmentId} marked dirty.`,
    });
  };

  const markEquipmentReady = (equipmentId: string) => {
    setEquipmentReadiness((prev) =>
      prev.map((item) =>
        item.id === equipmentId
          ? {
              ...item,
              ready: true,
              notes: item.clean ? '' : item.notes,
            }
          : item,
      ),
    );
    pushNotification({
      severity: 'Info',
      type: 'Equipment',
      message: `${equipmentId} marked ready.`,
    });
  };

  const markEquipmentNotReady = (equipmentId: string) => {
    setEquipmentReadiness((prev) =>
      prev.map((item) =>
        item.id === equipmentId
          ? {
              ...item,
              ready: false,
              notes: item.notes || 'Not ready for use',
            }
          : item,
      ),
    );
    pushNotification({
      severity: 'Critical',
      type: 'Equipment',
      message: `${equipmentId} marked not ready. Assignment will be blocked.`,
    });
  };

  const getChillerLoad = (): ChillerLoad[] =>
    allChillers.map((chillerNumber) => {
      const capacity = getChillerCapacity(chillerNumber);
      const assignedBatches = batches.filter((batch) => batch.assignedChiller === chillerNumber);
      const currentAssignedRacks = assignedBatches.reduce((sum, batch) => sum + batch.rackCount, 0);
      const remainingCapacity = Math.max(capacity - currentAssignedRacks, 0);
      const readiness = equipmentReadiness.find((item) => item.id === `CH-${chillerNumber}`);

      let status: ChillerStatus = 'Available';
      if (!readiness?.ready) {
        status = 'Out of Service';
      } else if (currentAssignedRacks >= capacity) {
        status = 'Full';
      } else if (currentAssignedRacks / capacity >= 0.9) {
        status = 'Near Full';
      }

      return {
        chillerNumber,
        capacity,
        currentAssignedRacks,
        remainingCapacity,
        status,
        assignedBatchIds: assignedBatches.map((batch) => batch.id),
      };
    });

  const assignBatchToChiller = (batchId: string, chillerNumber: ChillerNumber) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) {
      return false;
    }
    if (batch.stage !== BATCH_STAGES.CHILL) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        batchId,
        message: `Assignment blocked: ${batchId} must be in chill stage before chiller assignment.`,
      });
      return false;
    }

    const chillerReadiness = equipmentReadiness.find((item) => item.id === `CH-${chillerNumber}`);
    if (!chillerReadiness || !chillerReadiness.ready) {
      pushNotification({
        severity: 'Critical',
        type: 'Assignment',
        batchId,
        message: `Assignment blocked: chiller ${chillerNumber} is not ready.`,
      });
      return false;
    }

    const smokehouseReadiness = equipmentReadiness.find((item) => item.id === `SH-${batch.smokehouse}`);
    if (!smokehouseReadiness || !smokehouseReadiness.ready) {
      pushNotification({
        severity: 'Critical',
        type: 'Assignment',
        batchId,
        message: `Assignment blocked: smokehouse ${batch.smokehouse} is not ready.`,
      });
      return false;
    }

    const capacity = getChillerCapacity(chillerNumber);
    const currentlyAssigned = batches
      .filter((item) => item.assignedChiller === chillerNumber && item.id !== batchId)
      .reduce((sum, item) => sum + item.rackCount, 0);

    if (currentlyAssigned + batch.rackCount > capacity) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        batchId,
        message: `Assignment blocked: chiller ${chillerNumber} capacity exceeded.`,
      });
      return false;
    }

    updateBatch(batchId, {
      assignedChiller: chillerNumber,
      stage: BATCH_STAGES.CHILL,
      status: BATCH_STATUSES.ON_TRACK,
      minutesToReady: Math.max(batch.minutesToReady - 10, 0),
    });
    addEvent(batchId, 'Chiller Assigned', `Assigned to chiller ${chillerNumber}.`);
    pushNotification({
      severity: 'Info',
      type: 'Assignment',
      batchId,
      message: `Batch assigned to chiller ${chillerNumber}.`,
    });
    setPlannedRuns((prev) =>
      prev.map((item) =>
        item.linkedBatchId === batchId || item.runId === batchId
          ? {
              ...item,
              assignedChiller: chillerNumber,
              postCookStatus: 'In chiller checks',
              currentStage: 'Post-Cook / Chill',
              currentLocation: `Chiller ${chillerNumber}`,
              waitingOn: 'Chill below 40F and thermal signout',
            }
          : item,
      ),
    );

    return true;
  };

  const assignNextBatchToChiller = (chillerNumber: ChillerNumber) => {
    const candidate = batches.find(
      (batch) =>
        batch.stage === BATCH_STAGES.CHILL &&
        batch.status !== BATCH_STATUSES.QA_HOLD &&
        batch.assignedChiller === undefined,
    );

    if (!candidate) {
      return null;
    }

    const success = assignBatchToChiller(candidate.id, chillerNumber);
    return success ? candidate.id : null;
  };

  const assignBatchToThermalCooler = (batchId: string, coolerId: ThermalCoolerCode) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return false;
    if (batch.stage !== BATCH_STAGES.CHILL) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        batchId,
        message: `Assignment blocked: ${batchId} must be in chill stage before thermal cooler hold.`,
      });
      return false;
    }
    if (!batch.assignedChiller) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        batchId,
        message: `Assignment blocked: ${batchId} requires chiller assignment before thermal cooler hold.`,
      });
      return false;
    }
    const thermalReadiness = equipmentReadiness.find((item) => item.id === `TC-${coolerId}`);
    if (!thermalReadiness || !thermalReadiness.ready) {
      pushNotification({
        severity: 'Critical',
        type: 'Assignment',
        batchId,
        message: `Assignment blocked: thermal cooler ${coolerId} is not ready.`,
      });
      return false;
    }
    const occupied = batches.find(
      (item) => item.thermalCoolerId === coolerId && item.id !== batchId && item.stage === BATCH_STAGES.THERMAL_COOLER,
    );
    if (occupied) {
      pushNotification({
        severity: 'Warning',
        type: 'Assignment',
        batchId,
        message: `Assignment blocked: thermal cooler ${coolerId} already holds ${occupied.id}.`,
      });
      return false;
    }

    updateBatch(batchId, {
      stage: BATCH_STAGES.THERMAL_COOLER,
      thermalCoolerId: coolerId,
      assignedChiller: undefined,
      status: BATCH_STATUSES.ON_TRACK,
      minutesToReady: Math.max(batch.minutesToReady - 10, 0),
    });
    addEvent(batchId, 'Thermal Cooler Hold', `Batch moved from chiller to thermal cooler ${coolerId}.`);
    pushNotification({
      severity: 'Info',
      type: 'Assignment',
      batchId,
      message: `Batch moved to thermal cooler ${coolerId}.`,
    });
    setPlannedRuns((prev) =>
      prev.map((item) =>
        item.linkedBatchId === batchId || item.runId === batchId
          ? {
              ...item,
              postCookStatus: 'Chill complete, in thermal cooler',
              currentStage: 'QA Review / Signoff',
              currentLocation: 'Thermal Cooler',
              waitingOn: 'QA review/signoff',
            }
          : item,
      ),
    );
    return true;
  };

  const assignNextBatchToThermalCooler = (coolerId: ThermalCoolerCode) => {
    const candidate = batches.find(
      (batch) =>
        batch.stage === BATCH_STAGES.CHILL &&
        batch.status !== BATCH_STATUSES.QA_HOLD &&
        batch.assignedChiller !== undefined &&
        !batch.thermalCoolerId,
    );
    if (!candidate) return null;
    return assignBatchToThermalCooler(candidate.id, coolerId) ? candidate.id : null;
  };

  const runTimelineAction = (batchId: string, action: TimelineAction) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) {
      return;
    }

    if (!isTimelineActionEnabledForRecord(batch, action)) {
      addEvent(batchId, `${action} Blocked`, `Action unavailable in stage ${batch.stage} for this recipe path.`);
      return;
    }

    if (action === 'Start Shower') {
      updateBatch(batchId, {
        stage: BATCH_STAGES.SHOWER,
        status: BATCH_STATUSES.ON_TRACK,
        minutesToReady: Math.max(batch.minutesToReady - 15, 0),
      });
      addEvent(batchId, 'Shower Started', 'Batch moved from cook to shower.');
      return;
    }

    if (action === 'Complete Shower') {
      const nextStage = moveTowardChill(batch);
      updateBatch(batchId, {
        stage: nextStage,
        status: BATCH_STATUSES.ON_TRACK,
        minutesToReady: Math.max(batch.minutesToReady - 10, 0),
      });
      addEvent(
        batchId,
        'Shower Completed',
        nextStage === BATCH_STAGES.EVACUATE
          ? 'Shower cycle completed; batch moved to evacuate.'
          : 'Shower cycle completed; batch moved to chill.',
      );
      return;
    }

    if (action === 'Assign Chiller') {
      const assigned = assignBatchToChiller(batchId, 8);
      if (!assigned) {
        addEvent(batchId, 'Chiller Assign Attempt', 'No capacity or no assignable batch for default chiller 8.');
      }
      return;
    }

    if (action === 'Start Chill') {
      const nextStage = moveTowardChill(batch);
      updateBatch(batchId, {
        stage: nextStage,
        status: BATCH_STATUSES.ON_TRACK,
        minutesToReady: Math.max(batch.minutesToReady - 20, 0),
      });
      addEvent(
        batchId,
        'Thermal Progressed',
        nextStage === BATCH_STAGES.CHILL
          ? 'Batch entered chill stage.'
          : `Batch progressed to ${nextStage} by recipe path.`,
      );
      return;
    }

    if (action === 'Complete Chill') {
      const preferredCooler = allThermalCoolers.find(
        (coolerId) =>
          !batches.find(
            (item) => item.thermalCoolerId === coolerId && item.stage === BATCH_STAGES.THERMAL_COOLER && item.id !== batchId,
          ),
      );
      if (!preferredCooler) {
        updateBatch(batchId, {
          stage: BATCH_STAGES.CHILL,
          status: BATCH_STATUSES.DELAYED,
          minutesToReady: batch.minutesToReady + 10,
        });
        addEvent(batchId, 'Chill Completed - Hold Blocked', 'No available thermal cooler for post-chill holding.');
        pushNotification({
          severity: 'Warning',
          type: 'Assignment',
          batchId,
          message: `No thermal cooler available for ${batchId} post-chill hold.`,
        });
        return;
      }
      assignBatchToThermalCooler(batchId, preferredCooler);
      return;
    }

    if (action === 'Send to QA') {
      if (batch.stage !== BATCH_STAGES.THERMAL_COOLER) {
        addEvent(batchId, 'Send to QA Blocked', 'Batch must be in thermal cooler hold before QA transfer.');
        return;
      }
      updateBatch(batchId, {
        stage: BATCH_STAGES.QA,
        status: BATCH_STATUSES.ON_TRACK,
        thermalCoolerId: undefined,
        minutesToReady: Math.max(batch.minutesToReady - 10, 0),
      });
      addEvent(batchId, 'Sent to QA', 'Batch released from thermal cooler and transferred to QA queue.');
      return;
    }

    updateBatch(batchId, { status: BATCH_STATUSES.DELAYED, minutesToReady: batch.minutesToReady + 20 });
    addEvent(batchId, 'Delay Logged', 'Operator logged a production delay (mock reason).');
  };

  const submitQADecision = (batchId: string, decision: Exclude<QAStatus, typeof QA_STATUSES.PENDING>) => {
    if (decision === QA_STATUSES.PASS) {
      updateBatch(batchId, { qaStatus: QA_STATUSES.PASS, status: BATCH_STATUSES.ON_TRACK });
      setPlannedRuns((prev) =>
        prev.map((item) =>
          item.linkedBatchId === batchId || item.runId === batchId
            ? { ...item, qaStatus: 'Pass', waitingOn: 'Release to packaging' }
            : item,
        ),
      );
      addEvent(batchId, 'QA Pass', 'QA approved batch for release.');
      pushNotification({
        severity: 'Info',
        type: 'QA',
        batchId,
        message: `QA pass recorded for ${batchId}.`,
      });
      return;
    }

    if (decision === QA_STATUSES.CONDITIONAL_PASS) {
      updateBatch(batchId, { qaStatus: QA_STATUSES.CONDITIONAL_PASS, status: BATCH_STATUSES.ON_TRACK });
      setPlannedRuns((prev) =>
        prev.map((item) =>
          item.linkedBatchId === batchId || item.runId === batchId
            ? { ...item, qaStatus: 'Conditional Pass', waitingOn: 'Conditional release actions' }
            : item,
        ),
      );
      addEvent(batchId, 'QA Conditional Pass', 'QA approved with condition.');
      pushNotification({
        severity: 'Warning',
        type: 'QA',
        batchId,
        message: `QA conditional pass for ${batchId}.`,
      });
      return;
    }

    if (decision === QA_STATUSES.HOLD) {
      updateBatch(batchId, {
        qaStatus: QA_STATUSES.HOLD,
        status: BATCH_STATUSES.QA_HOLD,
        slicingStatus: undefined,
        slicingLineId: undefined,
        rteCoolerId: undefined,
        thermalCoolerId: undefined,
        packagingStatus: undefined,
        packagingLineId: undefined,
      });
      setPlannedRuns((prev) =>
        prev.map((item) =>
          item.linkedBatchId === batchId || item.runId === batchId
            ? {
                ...item,
                qaStatus: 'Hold',
                atRisk: true,
                waitingOn: 'QA corrective action',
                currentStage: 'QA Review / Signoff',
              }
            : item,
        ),
      );
      addEvent(batchId, 'QA Hold', 'QA placed batch on hold.');
      pushNotification({
        severity: 'Critical',
        type: 'QA',
        batchId,
        message: `QA hold placed on ${batchId}.`,
      });
      return;
    }

    updateBatch(batchId, {
      qaStatus: QA_STATUSES.FAIL,
      status: BATCH_STATUSES.QA_HOLD,
      slicingStatus: undefined,
      slicingLineId: undefined,
      rteCoolerId: undefined,
      thermalCoolerId: undefined,
      packagingStatus: undefined,
      packagingLineId: undefined,
    });
    setPlannedRuns((prev) =>
      prev.map((item) =>
        item.linkedBatchId === batchId || item.runId === batchId
          ? {
              ...item,
              qaStatus: 'Fail',
              atRisk: true,
              waitingOn: 'Disposition decision',
              currentStage: 'QA Review / Signoff',
            }
          : item,
      ),
    );
    addEvent(batchId, 'QA Fail', 'Batch failed QA review.');
    pushNotification({
      severity: 'Critical',
      type: 'QA',
      batchId,
      message: `QA fail recorded for ${batchId}.`,
    });
  };

  const releaseToPackaging = (batchId: string) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch || batch.qaStatus !== QA_STATUSES.PASS || batch.stage !== BATCH_STAGES.QA) {
      return false;
    }
    if (!isRTECoolerOperational(rteCooler)) {
      pushNotification({
        severity: 'Warning',
        type: 'Equipment',
        batchId,
        message: `Release blocked: RTE cooler ${RTE_COOLER} is not ready.`,
      });
      return false;
    }

    updateBatch(batchId, {
      stage: BATCH_STAGES.PACKAGING,
      status: BATCH_STATUSES.READY,
      minutesToReady: 0,
      slicingStatus: batch.requiresSlicing ? 'Waiting' : 'Not Required',
      slicingLineId: undefined,
      rteCoolerId: RTE_COOLER,
      packagingStatus: 'Waiting',
      packagingLineId: undefined,
    });
    addEvent(batchId, 'Released to Packaging', 'Batch is ready for packaging.');
    pushNotification({
      severity: 'Info',
      type: 'Batch',
      batchId,
      message: `${batchId} released and ready for packaging.`,
    });
    setPlannedRuns((prev) =>
      prev.map((item) =>
        item.linkedBatchId === batchId || item.runId === batchId
          ? {
              ...item,
              packagingStatus: 'Released',
              currentStage: 'Packaging',
              currentLocation: 'RTE Cooler 67',
              waitingOn: 'Packaging line assignment',
            }
          : item,
      ),
    );
    return true;
  };

  const acknowledgeNotification = (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((item) => (item.id === notificationId ? { ...item, acknowledged: true } : item)),
    );
  };

  const setDemoScenario = (scenario: DemoScenario) => {
    const next = buildScenarioState(scenario);
    setDemoScenarioState(scenario);
    setPlannedRuns(next.plannedRuns);
    setPrepTickets(next.prepTickets);
    setBatches(next.batches);
    setEventsByBatch(next.eventsByBatch);
    setEquipmentReadiness(next.equipmentReadiness);
    setRTECooler(next.rteCooler);
    setSlicingLines(next.slicingLines);
    setPackagingLines(next.packagingLines);
    setNotifications(next.notifications);
  };

  const getBatch = (batchId: string) => batches.find((batch) => batch.id === batchId);

  const getDelayRisk = (batch: BatchRecord): DelayRisk => {
    if (
      batch.status === BATCH_STATUSES.DELAYED ||
      batch.status === BATCH_STATUSES.QA_HOLD ||
      batch.qaStatus === QA_STATUSES.HOLD ||
      batch.qaStatus === QA_STATUSES.FAIL
    ) {
      return 'High';
    }

    if (batch.minutesToReady > 120) {
      return 'Medium';
    }

    return 'Low';
  };

  const getPrepBlockedReasons = (prep: PrepRecord) => {
    if (prep.linkedBatchId) return [];
    const reasons: string[] = [];
    if (prep.qaPreOpStatus !== 'Passed') reasons.push('Needs QA Pre-Op');
    if (!prep.stagingAreaReady) reasons.push('Needs Staging Readiness');
    if (!prep.rtcEquipmentReady) reasons.push('Needs Equipment Readiness');
    if (prep.awaitingThermalAssignment) reasons.push('Awaiting Thermal Assignment');
    if (prep.readyToLoad && prep.assignedSmokehouse !== '--' && !prep.thermalAssignedRackCount) {
      reasons.push('Needs Thermal Rack Confirmation');
    }
    return reasons;
  };

  const getPrepHandoffLabel = (prep: PrepRecord) => {
    if (prep.linkedBatchId) return 'Loaded to Thermal';
    if (prep.qaPreOpStatus !== 'Passed') return 'Waiting on QA';
    if (prep.awaitingThermalAssignment) return 'Waiting on Thermal Assignment';
    if (prep.readyToLoad && prep.assignedSmokehouse !== '--') return 'Assigned / Ready to Load';
    return 'Ready for Thermal';
  };

  const getPrepWorkflowState = (prep: PrepRecord): WorkflowState => {
    const blocked = getPrepBlockedReasons(prep);
    const hasOnlyAssignmentWait =
      blocked.length === 1 &&
      (blocked[0] === 'Awaiting Thermal Assignment' || blocked[0] === 'Needs Thermal Rack Confirmation');
    if (blocked.length > 0 && !hasOnlyAssignmentWait) return 'blocked';
    if (prep.linkedBatchId || prep.readyToLoad || prep.status === PREP_STATUSES.ASSIGNED_TO_SMOKEHOUSE) return 'assigned';
    if (
      prep.status === PREP_STATUSES.RTC_READY ||
      prep.status === PREP_STATUSES.READY_TO_LOAD ||
      prep.awaitingThermalAssignment
    ) {
      return 'ready';
    }
    return 'waiting';
  };

  const getBatchBlockedReasons = (batch: BatchRecord) => {
    const reasons: string[] = [];
    if (batch.status === BATCH_STATUSES.DELAYED) reasons.push('Production delay active');
    if (batch.status === BATCH_STATUSES.QA_HOLD) reasons.push('QA hold active');
    if (batch.stage === BATCH_STAGES.QA && batch.qaStatus !== QA_STATUSES.PASS) reasons.push('Waiting on QA');
    if (batch.stage === BATCH_STAGES.CHILL && !batch.assignedChiller) reasons.push('Needs chiller assignment');
    if (batch.stage === BATCH_STAGES.THERMAL_COOLER && !batch.thermalCoolerId) reasons.push('Needs thermal cooler hold');
    if (batch.stage === BATCH_STAGES.PACKAGING && !batch.packagingLineId && batch.packagingStatus === 'Waiting') {
      if (batch.requiresSlicing && batch.slicingStatus !== 'Completed' && batch.slicingStatus !== 'Not Required') {
        reasons.push('Needs slicing completion');
      } else if (!batch.rteCoolerId) {
        reasons.push('Not staged in Cooler 67');
      } else {
        reasons.push('Needs packaging line assignment');
      }
    }
    return reasons;
  };

  const getBatchHandoffLabel = (batch: BatchRecord) => {
    if (batch.stage === BATCH_STAGES.RTC) return 'Waiting on Thermal';
    if (
      batch.stage === BATCH_STAGES.COOK ||
      batch.stage === BATCH_STAGES.SHOWER ||
      batch.stage === BATCH_STAGES.EVACUATE ||
      batch.stage === BATCH_STAGES.CHILL
    ) {
      return 'Waiting on Thermal';
    }
    if (batch.stage === BATCH_STAGES.THERMAL_COOLER) return 'Waiting on QA';
    if (batch.stage === BATCH_STAGES.QA) return 'Waiting on QA';
    if (batch.stage === BATCH_STAGES.PACKAGING) {
      if (batch.rteCoolerId === RTE_COOLER && batch.packagingStatus === 'Waiting') return 'Waiting in Cooler 67';
      if (batch.requiresSlicing && batch.slicingStatus !== 'Completed' && batch.slicingStatus !== 'Not Required') {
        return 'Waiting on Slicing Assignment';
      }
      return 'Waiting on Packaging Line';
    }
    return 'Ready';
  };

  const getBatchWorkflowState = (batch: BatchRecord): WorkflowState => {
    if (batch.packagingStatus === 'Running') return 'running';
    if (batch.packagingStatus === 'Assigned' || batch.slicingStatus === 'Assigned' || batch.assignedChiller) {
      return 'assigned';
    }
    if (getBatchBlockedReasons(batch).length > 0) return 'blocked';
    if (batch.status === BATCH_STATUSES.READY || batch.stage === BATCH_STAGES.RTE) return 'ready';
    return 'waiting';
  };

  const value = useMemo<C3SState>(
    () => ({
      demoScenario,
      plannedRuns,
      prepTickets,
      batches,
      equipmentReadiness,
      rteCooler,
      slicingLines,
      packagingLines,
      notifications,
      eventsByBatch,
      getBatch,
      getDelayRisk,
      getBatchHandoffLabel,
      getBatchBlockedReasons,
      getBatchWorkflowState,
      getPrepHandoffLabel,
      getPrepBlockedReasons,
      getPrepWorkflowState,
      getChillerLoad,
      getProductThermalConfig,
      getBatchThermalPath,
      getEnabledBatchActions,
      getEnabledTimelineActions,
      getBatchFlowSnapshot,
      canViewBatchInArea,
      addPlannedRun,
      updatePlannedRunStatus,
      promotePlannedRunToPrep,
      setDemoScenario,
      markSlicingLineClean,
      setSlicingLineQAPreOp,
      markSlicingLineReady,
      assignBatchToSlicingLine,
      markPackagingLineClean,
      setPackagingLineQAPreOp,
      markPackagingLineReady,
      assignBatchToPackagingLine,
      createPrep,
      markPrepReady,
      markPrepRTCReady,
      setPrepQAPreOp,
      markPrepStagingReady,
      markPrepEquipmentReady,
      togglePrepQAPreOp,
      togglePrepStagingReady,
      togglePrepEquipmentReady,
      assignPrepSmokehouse,
      createBatchFromPrep,
      startCookBatch,
      recordBatchAction,
      markEquipmentClean,
      markEquipmentDirty,
      markEquipmentReady,
      markEquipmentNotReady,
      assignBatchToChiller,
      assignNextBatchToChiller,
      assignBatchToThermalCooler,
      assignNextBatchToThermalCooler,
      acknowledgeNotification,
      runTimelineAction,
      submitQADecision,
      releaseToPackaging,
    }),
    [
      demoScenario,
      plannedRuns,
      prepTickets,
      batches,
      equipmentReadiness,
      rteCooler,
      slicingLines,
      packagingLines,
      notifications,
      eventsByBatch,
    ],
  );

  return <C3SContext.Provider value={value}>{children}</C3SContext.Provider>;
}

export function useC3S() {
  const context = useContext(C3SContext);
  if (!context) {
    throw new Error('useC3S must be used within C3SProvider');
  }

  return context;
}
