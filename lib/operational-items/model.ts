/**
 * lib/operational-items/model.ts
 *
 * Canonical state machine model for a single production item as it flows
 * through the C3S plant: Planning → RTC → Thermal → Chill → QA → Packaging.
 *
 * One `operational_items` document tracks the full lifecycle of a batch,
 * replacing the need to query five separate collections for routing purposes.
 * Legacy collections (prep_queue, chill_logs, qa_checks, packaging_logs) are
 * still written by the original repository functions and serve as audit records.
 * The `operational_items` doc embeds all cross-reference IDs so screens can
 * call mutation functions without extra lookups.
 */

import { Timestamp } from 'firebase/firestore';
import type {
  ThermalDeviationEntry,
  ChillLogStatus,
  QACheckStatus,
  QACheckType,
  PackagingLogStatus,
} from '@/lib/firebase/models';

// ── Stages ────────────────────────────────────────────────────────────────────

/** Which department/screen currently "owns" this item. */
export type OItemStage =
  | 'planning'   // draft weekly plan (not yet sent to RTC)
  | 'rtc'        // Ready-To-Cook queue
  | 'thermal'    // Smokehouse cooking
  | 'chill'      // Post-cook chilling
  | 'qa'         // QA review
  | 'packaging'  // Packaging / label
  | 'complete';  // Terminal — fully packaged

// ── Statuses ──────────────────────────────────────────────────────────────────

/**
 * Canonical status values across the full pipeline.
 * RTC/Thermal values mirror PrepQueueStatus for backward compatibility.
 * Chill/QA/Packaging values are new canonical identifiers; stage-specific
 * mirror fields (chillLogStatus, qaCheckStatus, packagingLogStatus) are also
 * embedded for screens that need the granular per-doc status.
 */
export type OItemStatus =
  // ── Planning ──────────────────────────────────────────────────────────────
  | 'draft'

  // ── RTC (mirrors PrepQueueStatus values) ──────────────────────────────────
  | 'staging'           // just arrived in RTC
  | 'staged'
  | 'prepping'
  | 'ready'             // prepped, waiting for smokehouse
  | 'ready_for_thermal' // RTC-side confirmation done
  | 'split_parent'      // parent record after thermal load auto-split
  | 'in_thermal'        // legacy alias — treat same as assigned
  | 'moved_downstream'  // legacy alias

  // ── Thermal (mirrors PrepQueueStatus) ────────────────────────────────────
  | 'assigned'          // smokehouse assigned
  | 'cooking'           // cook in progress
  | 'awaiting_chill'    // evacuated — waiting for chiller assignment

  // ── Chill ────────────────────────────────────────────────────────────────
  | 'in_chill'          // chiller assigned, chill running  (ChillLogStatus 'running')
  | 'chill_complete'    // chill done, QA check created     (ChillLogStatus 'complete')

  // ── QA (mirrors QACheckStatus) ────────────────────────────────────────────
  | 'ready_for_qa'
  | 'qa_hold'
  | 'qa_review_required'
  | 'ready_for_packaging'

  // ── Packaging ─────────────────────────────────────────────────────────────
  | 'packaging_in_progress'
  | 'packaging_complete'

  // ── Terminal / cross-cutting ───────────────────────────────────────────────
  | 'complete'
  | 'hold';

// ── Valid transitions ─────────────────────────────────────────────────────────

/**
 * Allowed status → next-status moves.
 * Any transition not in this map is rejected by validateTransition().
 */
export const VALID_TRANSITIONS: Readonly<Partial<Record<OItemStatus, readonly OItemStatus[]>>> = {
  draft:                ['staging'],

  // RTC
  staging:              ['staged', 'prepping', 'ready', 'hold'],
  staged:               ['prepping', 'ready', 'hold'],
  prepping:             ['ready', 'ready_for_thermal', 'hold'],
  ready:                ['ready_for_thermal', 'assigned', 'hold'],
  ready_for_thermal:    ['assigned', 'hold'],
  split_parent:         [],
  in_thermal:           ['assigned', 'cooking', 'hold'],
  moved_downstream:     ['assigned', 'ready_for_thermal'],

  // Thermal
  assigned:             ['cooking', 'hold'],
  cooking:              ['awaiting_chill', 'hold'],

  // Chill
  awaiting_chill:       ['in_chill', 'hold'],
  in_chill:             ['chill_complete', 'hold'],
  chill_complete:       ['ready_for_qa'],

  // QA
  ready_for_qa:         ['ready_for_packaging', 'qa_hold', 'qa_review_required'],
  qa_hold:              ['ready_for_qa'],
  qa_review_required:   ['ready_for_qa'],
  ready_for_packaging:  ['packaging_in_progress'],

  // Packaging
  packaging_in_progress: ['packaging_complete', 'hold'],
  packaging_complete:   ['complete'],

  // Terminal
  complete:             [],

  // Hold can return to any active status (the calling code must supply the target)
  hold: [
    'staging', 'staged', 'prepping', 'ready', 'ready_for_thermal',
    'assigned', 'cooking', 'awaiting_chill', 'in_chill',
    'ready_for_qa', 'packaging_in_progress',
  ],
} as const;

// ── Stage derivation ──────────────────────────────────────────────────────────

/**
 * Derive the canonical stage from a status value.
 * `hold` does NOT change the stage — callers must preserve the current stage.
 */
export const STATUS_TO_STAGE: Readonly<Partial<Record<OItemStatus, OItemStage>>> = {
  draft:                'planning',
  staging:              'rtc',
  staged:               'rtc',
  prepping:             'rtc',
  ready:                'rtc',
  ready_for_thermal:    'thermal',
  split_parent:         'thermal',
  in_thermal:           'thermal',
  moved_downstream:     'thermal',
  assigned:             'thermal',
  cooking:              'thermal',
  awaiting_chill:       'chill',
  in_chill:             'chill',
  chill_complete:       'chill',
  ready_for_qa:         'qa',
  qa_hold:              'qa',
  qa_review_required:   'qa',
  ready_for_packaging:  'qa',
  packaging_in_progress: 'packaging',
  packaging_complete:   'complete',
  complete:             'complete',
  // 'hold' intentionally omitted — stage is preserved when going on hold
};

// ── Transition record ─────────────────────────────────────────────────────────

/** One entry in the immutable audit trail stored on `OItemDoc.transitions`. */
export interface TransitionRecord {
  from: { stage: OItemStage; status: OItemStatus };
  to:   { stage: OItemStage; status: OItemStatus };
  /** Firebase UID, anonymous UID, or 'system'. */
  by: string;
  at: Timestamp;
  reason?: string;
}

// ── OItemDoc ──────────────────────────────────────────────────────────────────

/**
 * The canonical Firestore document for a production item.
 *
 * Fields are grouped by the stage at which they are populated.
 * All stage-specific log IDs are embedded so screens can call legacy
 * mutation functions without additional Firestore reads.
 */
export interface OItemDoc {
  // ── Core identity (set when the planning row is sent to RTC) ──────────────
  productId: string;
  productName: string;
  productCode?: string;
  racks: number;
  pieces: number;
  cases?: number;
  poNumber: string;
  deliveryDate: string;
  makeDate: string;

  // ── Production specs ──────────────────────────────────────────────────────
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

  // ── Canonical state machine ────────────────────────────────────────────────
  stage: OItemStage;
  status: OItemStatus;
  /** Full ordered history of every stage/status transition. Never mutated — only appended via arrayUnion. */
  transitions: TransitionRecord[];
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // ── Cross-references to legacy collection docs ─────────────────────────────
  weeklyPlanId?: string | null;
  prepQueueId?: string | null;
  chillLogId?: string | null;
  qaCheckId?: string | null;
  packagingLogId?: string | null;

  // ── Legacy display fields (from PrepQueueDoc — kept for JSX compatibility) ──
  /**
   * Snapshot name at creation time. Mirrors PrepQueueDoc.productNameSnapshot.
   * On OItemDoc this equals `productName`; kept so existing JSX can reference
   * `item.productNameSnapshot || item.productName` without changes.
   */
  productNameSnapshot?: string;
  productCodeSnapshot?: string;
  /** Alias for weeklyPlanId — kept for legacy JSX that reads item.sourcePlanId. */
  sourcePlanId?: string | null;
  processOrder?: string;
  plannedDate?: string;
  department?: string;
  targetSmokehouseId?: string | null;
  targetChillerId?: string | null;
  parentLoadId?: string | null;
  splitLoadIndex?: number;
  splitLoadCount?: number;
  assignedRackCount?: number;
  originalRackCount?: number;
  remainingRackCount?: number;
  allocatedRackCount?: number;
  expectedCookComplete?: string;
  expectedChillComplete?: string;
  packagingReadyETA?: string;
  createdBy?: string;

  // ── RTC / Thermal fields (mirrors PrepQueueDoc) ────────────────────────────
  assignedSmokehouse?: string | null;
  assignedBlastChiller?: string | null;
  startTime?: Timestamp;
  loadedVerified?: boolean;
  loadedVerifiedBy?: string;
  loadedVerifiedAt?: Timestamp;
  cookStartedAt?: Timestamp | null;
  startingTemp?: number;
  startingProductTemp?: number;
  cut50At?: Timestamp | null;
  cut50ObservedTemp?: number;
  cut130At?: Timestamp | null;
  cut130ObservedTemp?: number;
  smokeApplied?: boolean;
  smokeAppliedAt?: Timestamp;
  smokeAppliedBy?: string;
  criticalTempReachedAt?: Timestamp | null;
  criticalTempValue?: number;
  criticalTempVerifiedBy?: string;
  probeTemps?: number[];
  durationRequired?: boolean;
  durationRequiredAt?: Timestamp;
  evacuationMethod?: 'dry_vac' | 'cold_shower';
  evacuationCompletedAt?: Timestamp;
  thermalDeviations?: ThermalDeviationEntry[];
  signedOutAt?: Timestamp;
  signedOutTemp?: number;
  movedToCooler?: boolean;
  coolerId?: string;

  // ── Chill-stage fields ─────────────────────────────────────────────────────
  /**
   * Mirrors ChillLogDoc.status for screens that check the granular chill status.
   * 'waiting' = awaiting chiller assignment (canonical: awaiting_chill)
   * 'running' = chill in progress         (canonical: in_chill)
   * 'complete' = chill done               (canonical: chill_complete)
   * 'deviation' = flagged                 (still in_chill with hasDeviation=true)
   */
  chillLogStatus?: ChillLogStatus;
  chillerId?: string | null;
  chillCreatedAt?: Timestamp;
  timeTo50F?: number | null;
  timeTo40F?: number | null;

  // ── QA-stage fields ───────────────────────────────────────────────────────
  /** Mirrors QACheckDoc.status for screens that need the granular QA status. */
  qaCheckStatus?: QACheckStatus;
  qaType?: QACheckType;
  qaNotes?: string;
  qaReviewedBy?: string | null;
  qaReviewedAt?: Timestamp | null;
  qaTimestamp?: Timestamp;
  qaDecision?: 'approve_for_packaging' | 'qa_hold' | 'needs_review';
  thermalCriticalTempVerifiedBy?: string | null;
  thermalEvacuationMethod?: 'dry_vac' | 'cold_shower' | null;
  thermalSignedOutTemp?: number | null;
  thermalTimeTo50F?: number | null;
  thermalTimeTo40F?: number | null;

  // ── Packaging-stage fields ─────────────────────────────────────────────────
  /** Mirrors PackagingLogDoc.status for screens that need granular packaging status. */
  packagingLogStatus?: PackagingLogStatus;
  casesProduced?: number | null;
  unitsProduced?: number | null;
  yieldPercent?: number | null;
  packagingLine?: string | null;
  packagedBy?: string | null;
  packagingStartedAt?: Timestamp;
  packagingCompletedAt?: Timestamp | null;
  packagingNotes?: string;

  // ── Cross-stage deviation tracking ────────────────────────────────────────
  hasDeviation?: boolean;
  deviationType?: string;
  deviationNotes?: string;
  deviationBy?: string;
  correctiveAction?: string;
  deviationAt?: Timestamp;
}

/** OItemDoc hydrated with its Firestore document ID. */
export type OItemItem = OItemDoc & { id: string };
