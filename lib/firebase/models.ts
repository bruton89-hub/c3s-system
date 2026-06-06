import { Timestamp } from 'firebase/firestore';
import type { OItemDoc } from '@/lib/operational-items/model';

export type UserRole = 'admin' | 'qa' | 'operator' | 'packaging';
export type UserDepartment = 'thermal' | 'rtc' | 'qa' | 'packaging';

export const PREP_STATUS_CONTRACT = [
  'staging',
  'ready',
  'assigned',
  'cooking',
  'awaiting_chill',
  'staged',
  'prepping',
  'ready_for_thermal',
  'in_thermal',
  'moved_downstream',
  'hold',
] as const;
export type PrepQueueStatus = (typeof PREP_STATUS_CONTRACT)[number];
export const ASSIGNABLE_PREP_STATUSES = ['staging', 'ready'] as const;
export type SmokehouseStatus = 'idle' | 'cooking' | 'cleaning';
export type CookLogStatus = 'running' | 'complete' | 'flagged';
export type ChillerStatus = 'idle' | 'chilling' | 'cleaning';
export type ChillLogStatus = 'waiting' | 'running' | 'complete' | 'deviation';
export type QACheckType = 'prep' | 'cook' | 'chill' | 'sanitation';
export type QACheckStatus = 'ready_for_qa' | 'ready_for_packaging' | 'qa_hold' | 'qa_review_required';
export type PackagingLogStatus = 'running' | 'complete' | 'deviation';
export type AlertType = 'temp_issue' | 'late_load' | 'cleaning_missing';
export type AlertSeverity = 'low' | 'medium' | 'high';

export interface UserDoc {
  name: string;
  role: UserRole;
  department: UserDepartment;
  active: boolean;
  createdAt: Timestamp;
}

/** A single deviation event recorded during a thermal execution step. */
export interface ThermalDeviationEntry {
  /** Step that deviated: 'cut50_temp' | 'cut130_temp' | 'cut130_6h_window' | 'critical_temp_below_target' */
  type: string;
  notes: string;
  supervisorName: string;
  recordedAt: Timestamp;
  observedValue?: number; // The out-of-range value that triggered the deviation
}

export interface PrepQueueDoc {
  productId: string;
  productName: string;
  productNameSnapshot: string;
  productCodeSnapshot?: string;
  racks: number;
  pieces: number;
  poNumber: string;
  deliveryDate: string;
  makeDate: string;
  status: PrepQueueStatus;
  stage?: 'rtc' | 'thermal' | 'chill' | 'qa' | 'packaging'; // Department-level routing; source of truth for which page owns this item
  startTime: Timestamp;
  createdBy: string;
  assignedSmokehouse: string | null;
  cookType: string;
  targetTemp: number;
  expectedCookMinutes: number;
  expectedChillMinutes?: number;
  expectedPackMinutes?: number;
  rackType: string;
  species: string;
  packagingType: string;
  thermalOwner: string;
  criticalLimit?: string;
  sourcePlanId?: string;
  productCode?: string;
  processOrder?: string;
  cases?: number;
  plannedDate?: string;
  department?: string;
  expectedCookComplete?: string;
  expectedChillComplete?: string;
  expectedBlastCellComplete?: string;
  packagingReadyETA?: string;
  targetSmokehouseId?: string;
  targetChillerId?: string;
  prepStartedAt?: string;
  readyForThermalAt?: string;
  movedDownstreamAt?: string;
  holdReason?: string;

  // ── Thermal execution tracking fields ─────────────────────────────────────
  // Load verification (pre-cook, during `assigned` state)
  loadedVerified?: boolean;
  loadedVerifiedBy?: string;
  loadedVerifiedAt?: Timestamp;

  // Cook start
  cookStartedAt?: Timestamp;
  startingTemp?: number;        // Smokehouse chamber temp at cook start (°F)
  startingProductTemp?: number; // Product surface/internal temp at cook start (°F, optional)

  // Cut time milestones
  cut50At?: Timestamp;
  cut50ObservedTemp?: number;  // Observed product surface temp at 50°F cut (°F), operator-entered
  cut130At?: Timestamp;
  cut130ObservedTemp?: number; // Observed product temp at 130°F cut (°F), operator-entered

  // Smoke application
  smokeApplied?: boolean;
  smokeAppliedAt?: Timestamp;
  smokeAppliedBy?: string;

  // Probe Out / Critical Temp Reached
  criticalTempReachedAt?: Timestamp;
  criticalTempValue?: number;       // Minimum of all probe readings (conservative)
  criticalTempVerifiedBy?: string;
  probeTemps?: number[];            // Individual probe readings [probe1, probe2, probe3]

  // Duration hold decision
  durationRequired?: boolean;       // Whether a 5-min hold after critical temp is required
  durationRequiredAt?: Timestamp;   // When the duration decision was recorded

  // Evacuation stage (dry vac or cold shower)
  evacuationMethod?: 'dry_vac' | 'cold_shower';
  evacuationCompletedAt?: Timestamp;

  // Blast chiller assignment (recorded before chill handoff)
  assignedBlastChiller?: string;

  // Sign-out and thermal cooler (recorded at end of chill)
  signedOutAt?: Timestamp;
  signedOutTemp?: number;
  movedToCooler?: boolean;
  coolerId?: string;

  // ── Thermal step deviations ────────────────────────────────────────────────
  // Each entry represents one deviation event (out-of-range temp, 6h window exceeded, etc.)
  // Recorded at the moment the deviation is approved and the step proceeds anyway.
  thermalDeviations?: ThermalDeviationEntry[];

  // Unified deviation tracking (must not block forward flow).
  hasDeviation?: boolean;
  deviationType?: string;
  deviationNotes?: string;
  deviationBy?: string;
  correctiveAction?: string;
  deviationAt?: Timestamp;
}

export interface ProductDoc {
  name: string;
  code: string;
  defaultRacks: number;
  defaultPieces: number;
  cookType: string;
  targetTemp: number;
  expectedCookMinutes: number;
  rackType: string;
  expectedChillMinutes: number;
  expectedPackMinutes: number;
  active: boolean;
  createdAt: Timestamp;
  notes?: string; // Optional planner notes about this product
}

export type WeeklyPlanStatus =
  | 'planned'
  | 'rtc_created'
  | 'cancelled'
  | 'RTC'
  | 'Ready for Thermal'
  | 'Cooking'
  | 'Awaiting Chill'
  | 'Chill Running'
  | 'Ready for QA'
  | 'Ready for Packaging'
  | 'Complete'
  | 'Hold';

/**
 * Production board runtime status. Drives the colored chip on each card on
 * the planning screen. Independent of `WeeklyPlanStatus` (which is the
 * lifecycle status: planned → rtc_created → cancelled).
 */
export type ProductionBoardStatus =
  | 'planned'
  | 'rtc'
  | 'ready_for_thermal'
  | 'cooking'
  | 'awaiting_chill'
  | 'chill_running'
  | 'ready_for_qa'
  | 'ready_for_packaging'
  | 'complete'
  | 'deviation';

export type ProductionSection =
  | 'boning_room'
  | 'ham_stuffing'
  | 'process_meats'
  | 'turkey_room';

export interface WeeklyPlanDoc {
  productId: string;
  productName: string;     // Snapshot for display (name at plan-creation time)
  plannedDate: string;     // 'YYYY-MM-DD' — the date production is scheduled
  plannedRacks: number;
  plannedPieces: number;
  priority: number;        // 1 = highest priority for that date
  notes: string;
  status: WeeklyPlanStatus;
  rtcPrepId?: string;      // Set when a prep queue item is created from this plan entry
  linkedPrepQueueId?: string;
  source?: 'planning' | 'manual';
  createdBy: string;
  createdAt: Timestamp;

  // ── Production board fields (matches the scheduling spreadsheet) ──────────
  /** Snapshot of the product code so the board renders without a lookup. */
  productCodeSnapshot?: string;
  /** Description shown on the board (e.g. "PBX MUO Meat Ham Tavern"). */
  description?: string;
  /** ERP process order number, e.g. "3035126". */
  processOrder?: string;
  /** Cases planned for this row. */
  cases?: number;
  /** BTC / load factor — usually rackCount / rackCapacity, but operators can override. */
  btc?: number;
  /** Which department the load belongs to on the board. */
  productionSection?: ProductionSection;
  /** Smokehouse the row is assigned to (e.g. "D"). */
  assignedSmokehouse?: string | null;
  /** Chiller the row is assigned to (e.g. "8"). */
  assignedChiller?: string | null;
  /** Runtime status chip shown on the board. */
  boardStatus?: ProductionBoardStatus;
  /** Planned start moment used by the forecasting engine. */
  plannedStartAt?: Timestamp;
  /** Product profile snapshot fields captured when selected in planning modal. */
  species?: ProductSpecies;
  processType?: ProductProcessType;
  estimatedCookTimeHours?: number;
  estimatedChillTimeHours?: number;
  estimatedBlastCellHours?: number;
  rackCapacity?: number;
  criticalLimit?: string;

  // ── Cached forecast values (recomputed when a row is edited) ──────────────
  forecastCookEnd?: Timestamp;
  forecastChillEnd?: Timestamp | null;
  forecastBlastEnd?: Timestamp | null;
  forecastPackagingEta?: Timestamp;
  expectedCookComplete?: Timestamp;
  expectedChillComplete?: Timestamp | null;
  expectedBlastCellComplete?: Timestamp | null;
  packagingReadyETA?: Timestamp;
}

export interface SmokehouseDoc {
  name: string;
  setupType?: 'compression' | 'tree';
  status: SmokehouseStatus;
  currentLoadId: string | null;
  lastCleanedAt: Timestamp | null;
}

export interface CookLogDoc {
  smokehouseId: string;
  productName: string;
  startTime: Timestamp;
  targetTemp: number;
  currentTemp: number;
  status: CookLogStatus;
  operatorId: string;
}

export interface ChillerDoc {
  name: string;
  status: ChillerStatus;
  currentLoadId: string | null;
}

export interface ChillLogDoc {
  chillerId: string | null;
  productName: string;
  prepId: string;
  timeTo50F: number | null;
  timeTo40F: number | null;
  status: ChillLogStatus;
  createdAt: Timestamp;
  cookType: string;
  targetTemp: number;
  expectedCookMinutes: number;
  rackType: string;
  species: string;
  packagingType: string;
  thermalOwner: string;
  makeDate: string;
  deliveryDate: string;
  racks: number;
  pieces: number;

  // ── Thermal deviation snapshot (carried forward from prep doc at handoff) ──
  thermalDeviationCount?: number; // Number of thermal step deviations recorded before chill handoff

  // ── Deviation tracking (flagged during chill) ─────────────────────────────
  deviationReason?: string;
  deviationAt?: Timestamp;
  deviationResolvedAt?: Timestamp;
  deviationResolutionNote?: string;

  hasDeviation?: boolean;
  deviationType?: string;
  deviationNotes?: string;
  deviationBy?: string;
  correctiveAction?: string;
}

export interface QACheckDoc {
  prepId?: string;
  chillLogId?: string;
  productName?: string;
  type: QACheckType;
  status: QACheckStatus;
  decision?: 'approve_for_packaging' | 'qa_hold' | 'needs_review';
  notes: string;
  reviewedBy: string | null;
  reviewedAt?: Timestamp | null;
  timestamp: Timestamp;
  cookType?: string;
  targetTemp?: number;
  expectedCookMinutes?: number;
  rackType?: string;
  species?: string;
  packagingType?: string;
  thermalOwner?: string;
  makeDate?: string;
  deliveryDate?: string;
  racks?: number;
  pieces?: number;

  // ── Thermal execution audit trail (captured at chill completion) ───────────
  // These give QA reviewers the evidence they need to make an informed decision.
  thermalCriticalTempValue?: number | null;
  thermalCriticalTempVerifiedBy?: string | null;
  thermalEvacuationMethod?: 'dry_vac' | 'cold_shower' | null;
  thermalSignedOutTemp?: number | null;
  thermalTimeTo50F?: number | null;  // minutes from chill start to 50°F
  thermalTimeTo40F?: number | null;  // minutes from chill start to 40°F
  hasDeviation?: boolean;
  deviationType?: string;
  deviationNotes?: string;
  deviationBy?: string;
  correctiveAction?: string;
  deviationAt?: Timestamp;
}

export interface PackagingLogDoc {
  prepId: string;
  qaCheckId: string;
  productName: string;
  casesProduced: number | null;
  unitsProduced: number | null;
  yieldPercent: number | null;
  packagingLine: string | null;
  packagedBy: string | null;
  status: PackagingLogStatus;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  notes: string;
  hasDeviation?: boolean;
  deviationType?: string;
  deviationNotes?: string;
  deviationBy?: string;
  correctiveAction?: string;
  deviationAt?: Timestamp;
}

export interface AlertDoc {
  type: AlertType;
  message: string;
  severity: AlertSeverity;
  createdAt: Timestamp;
  resolved: boolean;
}

// ── Product Intelligence (operational rules engine) ──────────────────────────
// Extended product profile used by planning, forecasting, capacity, and timeline.
// Stored in the `product_profiles` Firestore collection alongside legacy `products`.

export type ProductSpecies = 'pork' | 'beef' | 'poultry' | 'mixed';
export type ProductProcessType = 'cured' | 'uncured';
export type ProductSmokeType = '' | 'hickory' | 'oak' | 'apple' | 'cherry' | 'maple';
export type ProductBoxType = 'Combo' | 'Misc' | 'NV' | 'MB';
export type ProductCategory =
  | 'salad_items'
  | 'fresh_kitchen'
  | 'bulk_items'
  | 'slicing_items'
  | 'other';

export interface ProductProfileDoc {
  productCode: string;            // e.g. "247789"
  productName: string;            // e.g. "MUO Sweet Ham"
  category: ProductCategory;
  species: ProductSpecies;
  processType: ProductProcessType;
  smokeType: ProductSmokeType;
  criticalLimit: string;          // e.g. "152°/46 sec"
  boxType: ProductBoxType;
  probeOutTemp: number;           // °F
  shelfLifeDays: number;
  rackCapacity: number;           // racks per smokehouse
  estimatedCookTimeHours: number;
  estimatedChillTimeHours: number;       // 0 if NA
  estimatedBlastCellHours: number;       // 0 if NA
  preferredSmokehouses: string[]; // e.g. ["D","F","G"]
  /** Recommended department/section for the production board. */
  productionSection?: 'boning_room' | 'ham_stuffing' | 'process_meats' | 'turkey_room';
  notes: string[];
  active: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ── Operational Events (structured deviations / delays / QA holds) ───────────

export type OperationalEventType =
  | 'delay'
  | 'qa_hold'
  | 'maintenance'
  | 'cook_overrun'
  | 'steam_issue'
  | 'humidity_issue'
  | 'reassignment'
  | 'ready_for_thermal'
  | 'other';

export type OperationalEventDepartment =
  | 'rtc'
  | 'boning_room'
  | 'ham_stuffing'
  | 'process_meats'
  | 'turkey_room'
  | 'thermal'
  | 'chill'
  | 'qa'
  | 'packaging';

export type OperationalEventSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface OperationalEventDoc {
  /** Where the event occurred. */
  department: OperationalEventDepartment;
  /** Linked plan/prep/cook/chill IDs (optional but encouraged). */
  weeklyPlanId?: string | null;
  prepId?: string | null;
  cookLogId?: string | null;
  chillLogId?: string | null;
  productCode?: string | null;
  productName?: string | null;
  type: OperationalEventType;
  severity: OperationalEventSeverity;
  notes: string;
  operator: string;                // operator/supervisor name
  /** Optional planned vs actual minutes (for delay / cook_overrun). */
  plannedMinutes?: number | null;
  actualMinutes?: number | null;
  /** Equipment context (e.g. "Smokehouse F", "Chiller 8"). */
  equipment?: string | null;
  targetDepartment?: OperationalEventDepartment | null;
  resolved?: boolean;
  resolvedAt?: Timestamp | null;
  resolvedBy?: string | null;
  createdAt: Timestamp;
}

export type C3SCollections = {
  users: UserDoc;
  products: ProductDoc;
  product_profiles: ProductProfileDoc;
  prep_queue: PrepQueueDoc;
  smokehouses: SmokehouseDoc;
  cook_logs: CookLogDoc;
  chillers: ChillerDoc;
  chill_logs: ChillLogDoc;
  qa_checks: QACheckDoc;
  packaging_logs: PackagingLogDoc;
  alerts: AlertDoc;
  weekly_plan: WeeklyPlanDoc;
  operational_events: OperationalEventDoc;
  operational_items: OItemDoc;
};

// Re-export so consumers can import from a single location.
export type { OItemDoc } from '@/lib/operational-items/model';
