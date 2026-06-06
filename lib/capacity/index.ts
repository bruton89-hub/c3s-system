/**
 * Smokehouse + Chiller capacity logic.
 *
 * Canonical equipment registry derived from operations spec:
 *   - Smokehouses D, E, F, G, H, I, J, K, L, M, N, O
 *     E is a 1-rack manual house (cannot hold a full load).
 *   - Chillers 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
 *     Chiller 8 = 10-rack capacity (larger).
 *
 * Functions here are pure — they take a list of planned loads + the
 * equipment registry and return utilization / overload information.
 */

export type SmokehouseId =
  | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O';

export const SMOKEHOUSE_IDS: SmokehouseId[] = ['D','E','F','G','H','I','J','K','L','M','N','O'];

export interface SmokehouseSpec {
  id: SmokehouseId;
  /** Racks the house can hold for a normal cooked-meats load. */
  rackCapacity: number;
  /** True when the house is a manual single-rack station. */
  manual: boolean;
  /** Display label (kept short for board widgets). */
  label: string;
}

export const SMOKEHOUSES: Record<SmokehouseId, SmokehouseSpec> = {
  D: { id: 'D', rackCapacity: 18, manual: false, label: 'House D' },
  E: { id: 'E', rackCapacity: 1,  manual: true,  label: 'House E (manual)' },
  F: { id: 'F', rackCapacity: 18, manual: false, label: 'House F' },
  G: { id: 'G', rackCapacity: 18, manual: false, label: 'House G' },
  H: { id: 'H', rackCapacity: 18, manual: false, label: 'House H' },
  I: { id: 'I', rackCapacity: 18, manual: false, label: 'House I' },
  J: { id: 'J', rackCapacity: 18, manual: false, label: 'House J' },
  K: { id: 'K', rackCapacity: 18, manual: false, label: 'House K' },
  L: { id: 'L', rackCapacity: 18, manual: false, label: 'House L' },
  M: { id: 'M', rackCapacity: 18, manual: false, label: 'House M' },
  N: { id: 'N', rackCapacity: 18, manual: false, label: 'House N' },
  O: { id: 'O', rackCapacity: 18, manual: false, label: 'House O' },
};

export type ChillerId = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16;

export const CHILLER_IDS: ChillerId[] = [4,5,6,7,8,9,10,11,12,13,14,15,16];

export interface ChillerSpec {
  id: ChillerId;
  rackCapacity: number;
  label: string;
}

export const CHILLERS: Record<ChillerId, ChillerSpec> = {
  4:  { id: 4,  rackCapacity: 6,  label: 'Chiller 4' },
  5:  { id: 5,  rackCapacity: 6,  label: 'Chiller 5' },
  6:  { id: 6,  rackCapacity: 6,  label: 'Chiller 6' },
  7:  { id: 7,  rackCapacity: 6,  label: 'Chiller 7' },
  8:  { id: 8,  rackCapacity: 10, label: 'Chiller 8 (10-rack)' },
  9:  { id: 9,  rackCapacity: 6,  label: 'Chiller 9' },
  10: { id: 10, rackCapacity: 6,  label: 'Chiller 10' },
  11: { id: 11, rackCapacity: 6,  label: 'Chiller 11' },
  12: { id: 12, rackCapacity: 6,  label: 'Chiller 12' },
  13: { id: 13, rackCapacity: 6,  label: 'Chiller 13' },
  14: { id: 14, rackCapacity: 6,  label: 'Chiller 14' },
  15: { id: 15, rackCapacity: 6,  label: 'Chiller 15' },
  16: { id: 16, rackCapacity: 6,  label: 'Chiller 16' },
};

/** A single planned utilization slot — used by the timeline + overload check. */
export interface UtilizationSlot {
  resourceId: string;          // smokehouse id ("D") or chiller id ("8")
  productCode: string;
  productName: string;
  rackCount: number;
  /** Slot start (cook start for houses, chill start for chillers). */
  start: Date;
  /** Slot end. */
  end: Date;
  /** Tracks which weekly_plan / prep doc this came from (optional). */
  sourceId?: string;
}

export type WarningKind =
  | 'over_capacity'
  | 'overlap'
  | 'equipment_unavailable'
  | 'qa_hold_conflict'
  | 'unassigned';

export interface CapacityWarning {
  kind: WarningKind;
  resourceId: string;
  message: string;
  /** Source slot ids implicated (one or many). */
  slotIds: string[];
  severity: 'low' | 'medium' | 'high';
}

function intervalsOverlap(a: UtilizationSlot, b: UtilizationSlot): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Aggregate utilization per smokehouse and emit warnings for:
 *   - over-capacity loads (rackCount > house capacity)
 *   - overlapping slots in the same house
 *   - manual house (E) used for multi-rack load
 */
export function analyzeSmokehouseUtilization(slots: UtilizationSlot[]): {
  warnings: CapacityWarning[];
  byHouse: Record<string, UtilizationSlot[]>;
} {
  const warnings: CapacityWarning[] = [];
  const byHouse: Record<string, UtilizationSlot[]> = {};

  for (const slot of slots) {
    if (!slot.resourceId) {
      warnings.push({
        kind: 'unassigned',
        resourceId: '',
        message: `${slot.productName} (${slot.productCode}) has no smokehouse assigned.`,
        slotIds: [slot.sourceId ?? ''],
        severity: 'medium',
      });
      continue;
    }
    if (!byHouse[slot.resourceId]) byHouse[slot.resourceId] = [];
    byHouse[slot.resourceId].push(slot);
  }

  for (const [houseId, houseSlots] of Object.entries(byHouse)) {
    const spec = SMOKEHOUSES[houseId as SmokehouseId];
    if (!spec) {
      warnings.push({
        kind: 'equipment_unavailable',
        resourceId: houseId,
        message: `Smokehouse "${houseId}" is not in the equipment registry.`,
        slotIds: houseSlots.map((s) => s.sourceId ?? ''),
        severity: 'high',
      });
      continue;
    }

    // Over-capacity check per slot.
    for (const slot of houseSlots) {
      if (slot.rackCount > spec.rackCapacity) {
        warnings.push({
          kind: 'over_capacity',
          resourceId: houseId,
          message: `${spec.label}: ${slot.rackCount} racks exceeds capacity ${spec.rackCapacity} (${slot.productName}).`,
          slotIds: [slot.sourceId ?? ''],
          severity: spec.manual ? 'high' : 'medium',
        });
      }
    }

    // Overlap detection.
    for (let i = 0; i < houseSlots.length; i += 1) {
      for (let j = i + 1; j < houseSlots.length; j += 1) {
        if (intervalsOverlap(houseSlots[i], houseSlots[j])) {
          warnings.push({
            kind: 'overlap',
            resourceId: houseId,
            message: `${spec.label}: ${houseSlots[i].productName} overlaps ${houseSlots[j].productName}.`,
            slotIds: [houseSlots[i].sourceId ?? '', houseSlots[j].sourceId ?? ''],
            severity: 'high',
          });
        }
      }
    }
  }

  return { warnings, byHouse };
}

/**
 * Aggregate chiller utilization. Same algorithm shape as smokehouses but with
 * the chiller spec table.
 */
export function analyzeChillerUtilization(slots: UtilizationSlot[]): {
  warnings: CapacityWarning[];
  byChiller: Record<string, UtilizationSlot[]>;
} {
  const warnings: CapacityWarning[] = [];
  const byChiller: Record<string, UtilizationSlot[]> = {};

  for (const slot of slots) {
    if (!slot.resourceId) {
      warnings.push({
        kind: 'unassigned',
        resourceId: '',
        message: `${slot.productName} (${slot.productCode}) has no chiller assigned.`,
        slotIds: [slot.sourceId ?? ''],
        severity: 'low',
      });
      continue;
    }
    if (!byChiller[slot.resourceId]) byChiller[slot.resourceId] = [];
    byChiller[slot.resourceId].push(slot);
  }

  for (const [chillerId, chillerSlots] of Object.entries(byChiller)) {
    const numericId = Number(chillerId) as ChillerId;
    const spec = CHILLERS[numericId];
    if (!spec) {
      warnings.push({
        kind: 'equipment_unavailable',
        resourceId: chillerId,
        message: `Chiller "${chillerId}" is not in the equipment registry.`,
        slotIds: chillerSlots.map((s) => s.sourceId ?? ''),
        severity: 'high',
      });
      continue;
    }

    // Aggregate concurrent occupancy (a chiller can hold multiple loads up to
    // its rack capacity at the same time).
    for (let i = 0; i < chillerSlots.length; i += 1) {
      const a = chillerSlots[i];
      let concurrentRacks = a.rackCount;
      const collidingIds: string[] = [a.sourceId ?? ''];
      for (let j = 0; j < chillerSlots.length; j += 1) {
        if (i === j) continue;
        const b = chillerSlots[j];
        if (intervalsOverlap(a, b)) {
          concurrentRacks += b.rackCount;
          collidingIds.push(b.sourceId ?? '');
        }
      }
      if (concurrentRacks > spec.rackCapacity) {
        warnings.push({
          kind: 'over_capacity',
          resourceId: chillerId,
          message: `${spec.label}: ${concurrentRacks} concurrent racks exceeds capacity ${spec.rackCapacity}.`,
          slotIds: collidingIds,
          severity: 'high',
        });
      }
    }
  }

  return { warnings, byChiller };
}

/** Combined helper that returns warnings for both. */
export function analyzeAll(smokehouseSlots: UtilizationSlot[], chillerSlots: UtilizationSlot[]) {
  const smoke = analyzeSmokehouseUtilization(smokehouseSlots);
  const chill = analyzeChillerUtilization(chillerSlots);
  return {
    warnings: [...smoke.warnings, ...chill.warnings],
    byHouse: smoke.byHouse,
    byChiller: chill.byChiller,
  };
}
