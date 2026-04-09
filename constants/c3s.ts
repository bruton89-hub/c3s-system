export const BATCH_STAGES = {
  RTC: 'RTC',
  COOK: 'COOK',
  SHOWER: 'SHOWER',
  EVACUATE: 'EVACUATE',
  CHILL: 'CHILL',
  THERMAL_COOLER: 'THERMAL_COOLER',
  QA: 'QA',
  RTE: 'RTE',
  PACKAGING: 'PACKAGING',
} as const;

export type BatchStage = (typeof BATCH_STAGES)[keyof typeof BATCH_STAGES];

export const BATCH_STATUSES = {
  ON_TRACK: 'On Track',
  DELAYED: 'Delayed',
  QA_HOLD: 'QA Hold',
  READY: 'Ready',
} as const;

export type BatchStatus = (typeof BATCH_STATUSES)[keyof typeof BATCH_STATUSES];

export const QA_STATUSES = {
  PENDING: 'Pending',
  PASS: 'Pass',
  CONDITIONAL_PASS: 'Conditional Pass',
  HOLD: 'Hold',
  FAIL: 'Fail',
} as const;

export type QAStatus = (typeof QA_STATUSES)[keyof typeof QA_STATUSES];

export const PREP_STATUSES = {
  IN_PREP: 'In Prep',
  WAITING_QA_PRE_OP: 'Waiting QA Pre-Op',
  RTC_READY: 'Ready for Thermal',
  ASSIGNED_TO_SMOKEHOUSE: 'Assigned / Ready to Load',
  READY_TO_LOAD: 'Awaiting Assignment',
  LOADED: 'Loaded',
} as const;

export type PrepStatus = (typeof PREP_STATUSES)[keyof typeof PREP_STATUSES];

export const PREP_PRIORITIES = {
  RUSH: 'Rush',
  NORMAL: 'Normal',
  HOLD: 'Hold',
} as const;

export type PrepPriority = (typeof PREP_PRIORITIES)[keyof typeof PREP_PRIORITIES];

export const STAGE_COLORS: Record<BatchStage, string> = {
  [BATCH_STAGES.RTC]: '#90A4AE',
  [BATCH_STAGES.COOK]: '#FB8C00',
  [BATCH_STAGES.SHOWER]: '#29B6F6',
  [BATCH_STAGES.EVACUATE]: '#26C6DA',
  [BATCH_STAGES.CHILL]: '#4FC3F7',
  [BATCH_STAGES.THERMAL_COOLER]: '#26A69A',
  [BATCH_STAGES.QA]: '#EF5350',
  [BATCH_STAGES.RTE]: '#66BB6A',
  [BATCH_STAGES.PACKAGING]: '#AB47BC',
};

export const BATCH_STATUS_COLORS: Record<BatchStatus, string> = {
  [BATCH_STATUSES.ON_TRACK]: '#66BB6A',
  [BATCH_STATUSES.DELAYED]: '#FFA726',
  [BATCH_STATUSES.QA_HOLD]: '#EF5350',
  [BATCH_STATUSES.READY]: '#42A5F5',
};

export const QA_STATUS_COLORS: Record<QAStatus, string> = {
  [QA_STATUSES.PENDING]: '#90A4AE',
  [QA_STATUSES.PASS]: '#66BB6A',
  [QA_STATUSES.CONDITIONAL_PASS]: '#4FC3F7',
  [QA_STATUSES.HOLD]: '#EF5350',
  [QA_STATUSES.FAIL]: '#C62828',
};

export const PREP_STATUS_COLORS: Record<PrepStatus, string> = {
  [PREP_STATUSES.IN_PREP]: '#90A4AE',
  [PREP_STATUSES.WAITING_QA_PRE_OP]: '#FFA726',
  [PREP_STATUSES.RTC_READY]: '#66BB6A',
  [PREP_STATUSES.ASSIGNED_TO_SMOKEHOUSE]: '#42A5F5',
  [PREP_STATUSES.READY_TO_LOAD]: '#81C784',
  [PREP_STATUSES.LOADED]: '#5C6BC0',
};

export const PRIORITY_COLORS: Record<PrepPriority, string> = {
  [PREP_PRIORITIES.RUSH]: '#EF5350',
  [PREP_PRIORITIES.NORMAL]: '#4FC3F7',
  [PREP_PRIORITIES.HOLD]: '#B0BEC5',
};

export const SMOKEHOUSES = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'] as const;
export type SmokehouseCode = (typeof SMOKEHOUSES)[number];

export const CHILLERS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
export type ChillerNumber = (typeof CHILLERS)[number];

export const THERMAL_COOLERS = ['18', '18A', '18B', '29'] as const;
export type ThermalCoolerCode = (typeof THERMAL_COOLERS)[number];

export const RTE_COOLER = '67' as const;

export const PROCESS_FLOW_STEPS = [
  'RTC',
  'Thermal',
  'Post-Cook / Chill',
  'QA Review / Signoff',
  'Packaging',
] as const;

export type ProductProfile = {
  productName: string;
  cookType: 'smoke' | 'steam';
  estimatedCookMinutes: number;
  estimatedChillMinutes: number;
  rackType: string;
  averageRackCount: number;
  averagePackagingMinutes: number;
};

export const PRODUCT_PROFILES: Record<string, ProductProfile> = {
  'Honey Baked Ham': {
    productName: 'Honey Baked Ham',
    cookType: 'smoke',
    estimatedCookMinutes: 120,
    estimatedChillMinutes: 80,
    rackType: 'Ham Tree Rack',
    averageRackCount: 8,
    averagePackagingMinutes: 55,
  },
  'Smoked Bacon Slab': {
    productName: 'Smoked Bacon Slab',
    cookType: 'smoke',
    estimatedCookMinutes: 130,
    estimatedChillMinutes: 95,
    rackType: 'Belly Rack',
    averageRackCount: 10,
    averagePackagingMinutes: 75,
  },
  'Turkey Breast': {
    productName: 'Turkey Breast',
    cookType: 'steam',
    estimatedCookMinutes: 105,
    estimatedChillMinutes: 75,
    rackType: 'Poultry Rack',
    averageRackCount: 6,
    averagePackagingMinutes: 65,
  },
  'Smoked Sausage': {
    productName: 'Smoked Sausage',
    cookType: 'smoke',
    estimatedCookMinutes: 95,
    estimatedChillMinutes: 70,
    rackType: 'Sausage Stick Rack',
    averageRackCount: 12,
    averagePackagingMinutes: 50,
  },
};

export function getChillerCapacity(chillerNumber: number) {
  return chillerNumber === 8 ? 10 : 18;
}

export function getStageDisplayLabel(stage: BatchStage) {
  if (stage === BATCH_STAGES.RTC) return 'RTC: In Prep';
  if (stage === BATCH_STAGES.COOK) return 'Thermal: Cook Tracking';
  if (stage === BATCH_STAGES.SHOWER) return 'Post-Cook: Cold Shower';
  if (stage === BATCH_STAGES.EVACUATE) return 'Post-Cook: Evac';
  if (stage === BATCH_STAGES.CHILL) return 'Post-Cook: Chiller Checks';
  if (stage === BATCH_STAGES.THERMAL_COOLER) return 'Thermal Cooler: Awaiting QA';
  if (stage === BATCH_STAGES.QA) return 'QA Review / Signoff';
  if (stage === BATCH_STAGES.PACKAGING) return 'Released to Packaging';
  return 'Packaging: Complete';
}

export function getPrepStageDisplayLabel(status: PrepStatus) {
  if (status === PREP_STATUSES.IN_PREP || status === PREP_STATUSES.WAITING_QA_PRE_OP) return 'RTC: In Prep';
  if (status === PREP_STATUSES.RTC_READY) return 'RTC: Ready for Thermal';
  if (status === PREP_STATUSES.READY_TO_LOAD) return 'Thermal: Awaiting Assignment';
  if (status === PREP_STATUSES.ASSIGNED_TO_SMOKEHOUSE) return 'Thermal: Assigned / Ready to Load';
  return 'Thermal: Cook Tracking';
}

export function isThermalStage(stage: BatchStage) {
  return (
    stage === BATCH_STAGES.COOK ||
    stage === BATCH_STAGES.SHOWER ||
    stage === BATCH_STAGES.EVACUATE ||
    stage === BATCH_STAGES.CHILL ||
    stage === BATCH_STAGES.THERMAL_COOLER
  );
}
