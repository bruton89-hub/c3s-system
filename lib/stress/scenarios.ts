import { Timestamp } from 'firebase/firestore';

import type { OItemItem, OItemStage, OItemStatus } from '@/lib/operational-items/model';
import type { EquipmentSummary } from '@/lib/operations/summary';

export type StressScenarioId = 'chaotic-shift' | 'empty-shift' | 'all-equipment-unavailable';
export type StressScenario = { id: StressScenarioId; title: string; description: string; items: OItemItem[]; equipment: EquipmentSummary[]; simulatedAcknowledgedAlertIds: string[] };
let activeScenarioId: StressScenarioId | null = null;

function item(input: { id: string; product: string; batch: string; stage: OItemStage; status: OItemStatus; ageMinutes: number; equipment?: string; expectedMinutes?: number; deviation?: string; hold?: { actor: string; reason: string; ageMinutes: number }; expectedCompleteMinutes?: number }): OItemItem {
  const now = Date.now(); const at = now - input.ageMinutes * 60000;
  const equipmentFields = input.stage === 'thermal' ? { assignedSmokehouse: input.equipment ?? null } : input.stage === 'chill' ? { chillerId: input.equipment ?? null } : input.stage === 'packaging' ? { packagingLine: input.equipment ?? null } : {};
  return {
    id: input.id, productId: `product-${input.id}`, productName: input.product, productNameSnapshot: input.product, productCode: input.id.toUpperCase(), racks: 12, pieces: 120, cases: 24,
    poNumber: input.batch, processOrder: input.batch, deliveryDate: '2026-08-11', makeDate: '2026-08-10', cookType: 'Configured profile', targetTemp: 160,
    expectedCookMinutes: input.stage === 'thermal' ? (input.expectedMinutes ?? 180) : 180, expectedChillMinutes: input.stage === 'chill' ? (input.expectedMinutes ?? 240) : 240,
    expectedPackMinutes: 90, rackType: 'Configured rack', species: 'pork', packagingType: 'Configured package', thermalOwner: 'Thermal', stage: input.stage, status: input.status,
    transitions: [], createdAt: Timestamp.fromMillis(at - 3600000), updatedAt: Timestamp.fromMillis(at), cookStartedAt: input.status === 'cooking' ? Timestamp.fromMillis(at) : null,
    packagingStartedAt: input.status === 'packaging_in_progress' ? Timestamp.fromMillis(at) : undefined,
    expectedCookComplete: input.stage === 'thermal' && input.expectedCompleteMinutes != null ? new Date(now + input.expectedCompleteMinutes * 60000).toISOString() : undefined,
    expectedChillComplete: input.stage === 'chill' && input.expectedCompleteMinutes != null ? new Date(now + input.expectedCompleteMinutes * 60000).toISOString() : undefined,
    packagingReadyETA: input.stage === 'packaging' ? new Date(now - Math.max(0, input.ageMinutes - 30) * 60000).toISOString() : undefined,
    hasDeviation: Boolean(input.deviation), deviationType: input.deviation ? 'stress-test-warning' : undefined, deviationNotes: input.deviation,
    activeHold: input.hold ? { reasonKey: 'qa_review', reasonLabel: input.hold.reason, notes: 'Local stress scenario only', placedBy: `stress-${input.hold.actor.toLowerCase().replaceAll(' ', '-')}`, placedByName: input.hold.actor, placedAt: Timestamp.fromMillis(now - input.hold.ageMinutes * 60000), previousStage: input.stage, previousStatus: input.stage === 'qa' ? 'ready_for_qa' : 'cooking' } : null,
    chillLogId: input.stage === 'chill' ? `stress-chill-${input.id}` : undefined,
    qaCheckId: input.stage === 'qa' ? `stress-qa-${input.id}` : undefined,
    ...equipmentFields,
  } as OItemItem;
}

function chaoticShift(): StressScenario {
  const items = [
    item({ id: 'cook-normal', product: 'Applewood Turkey Breast', batch: 'ST-5001', stage: 'thermal', status: 'cooking', ageMinutes: 45, equipment: 'D', expectedMinutes: 180, expectedCompleteMinutes: 135 }),
    item({ id: 'cook-approaching', product: 'Honey Cured Ham — Extra Long Production Name', batch: 'ST-5002', stage: 'thermal', status: 'cooking', ageMinutes: 170, equipment: 'F', expectedMinutes: 180, expectedCompleteMinutes: 10 }),
    item({ id: 'cook-overdue', product: 'Smoked Beef Top Round', batch: 'ST-5003', stage: 'thermal', status: 'cooking', ageMinutes: 255, equipment: 'G', expectedMinutes: 180, expectedCompleteMinutes: -75 }),
    item({ id: 'cook-warning', product: 'Pork Ribs Smoked', batch: 'ST-5004', stage: 'thermal', status: 'cooking', ageMinutes: 95, equipment: 'H', expectedMinutes: 210, deviation: 'Process check needs supervisor review.', expectedCompleteMinutes: 115 }),
    item({ id: 'awaiting-chill-a', product: 'Black Forest Ham', batch: 'ST-5010', stage: 'chill', status: 'awaiting_chill', ageMinutes: 88 }),
    item({ id: 'awaiting-chill-b', product: 'Smoked Turkey Drumsticks', batch: 'ST-5011', stage: 'chill', status: 'awaiting_chill', ageMinutes: 54 }),
    item({ id: 'active-chill', product: 'Cured Pork Loin', batch: 'ST-5012', stage: 'chill', status: 'in_chill', ageMinutes: 190, equipment: 'Chiller 8', expectedMinutes: 240, expectedCompleteMinutes: 50 }),
    item({ id: 'qa-hold', product: 'Smoked Sausage', batch: 'ST-5020', stage: 'qa', status: 'hold', ageMinutes: 75, hold: { actor: 'QA Morgan', reason: 'QA Review', ageMinutes: 75 } }),
    ...Array.from({ length: 10 }, (_, index) => item({ id: `pack-${index}`, product: index === 9 ? 'Extremely Long Packaging Product Name Intended to Verify Intentional Wrapping on Small Floor Devices' : `Packaging Backlog Product ${index + 1}`, batch: `ST-51${String(index).padStart(2, '0')}`, stage: 'packaging', status: 'ready_for_packaging', ageMinutes: 45 + index * 35, equipment: index % 2 ? 'Line 1' : 'Line 2' })),
    ...Array.from({ length: 4 }, (_, index) => item({ id: `complete-${index}`, product: `Recently Completed Product ${index + 1}`, batch: `ST-520${index}`, stage: 'complete', status: 'complete', ageMinutes: 15 + index * 20 })),
  ];
  const equipment: EquipmentSummary[] = [
    { id: 'D', kind: 'Oven', status: 'In Use', assignedItemId: 'cook-normal', assignedBatch: 'ST-5001' }, { id: 'F', kind: 'Oven', status: 'In Use', assignedItemId: 'cook-approaching', assignedBatch: 'ST-5002' },
    { id: 'G', kind: 'Oven', status: 'Unavailable', assignedItemId: 'cook-overdue', assignedBatch: 'ST-5003' }, { id: 'H', kind: 'Oven', status: 'In Use', assignedItemId: 'cook-warning', assignedBatch: 'ST-5004' },
    { id: 'Chiller 8', kind: 'Chiller', status: 'In Use', assignedItemId: 'active-chill', assignedBatch: 'ST-5012' }, { id: 'Chiller 9', kind: 'Chiller', status: 'Cleaning' },
    { id: 'Chiller 10', kind: 'Chiller', status: 'Unavailable' }, { id: 'Chiller 11', kind: 'Chiller', status: 'In Use' },
    ...['E', 'I', 'J', 'K', 'L', 'M', 'N', 'O'].map((id) => ({ id, kind: 'Oven' as const, status: 'Unavailable' as const })),
    ...['Chiller 4', 'Chiller 5', 'Chiller 6', 'Chiller 7', 'Chiller 12', 'Chiller 13', 'Chiller 14', 'Chiller 15', 'Chiller 16'].map((id) => ({ id, kind: 'Chiller' as const, status: 'Unavailable' as const })),
  ];
  return { id: 'chaotic-shift', title: 'Chaotic Shift', description: 'Crowded cooks, chiller contention, a QA hold, packaging backlog, and unavailable equipment.', items, equipment, simulatedAcknowledgedAlertIds: ['cook-overdue__thermal-check-overdue'] };
}

export function createStressScenario(id: StressScenarioId): StressScenario {
  if (id === 'chaotic-shift') return chaoticShift();
  if (id === 'empty-shift') return { id, title: 'Empty Shift', description: 'No active production.', items: [], equipment: [], simulatedAcknowledgedAlertIds: [] };
  const base = chaoticShift();
  return { ...base, id, title: 'All Equipment Unavailable', equipment: base.equipment.map((entry) => ({ ...entry, status: entry.status === 'Cleaning' ? 'Cleaning' : 'Unavailable', assignedItemId: null, assignedBatch: null })) };
}

export function getActiveStressScenario(): StressScenario | null {
  if (!__DEV__) return null;
  const queryId = typeof globalThis.location !== 'undefined' ? new URLSearchParams(globalThis.location.search).get('stress') : null;
  if (queryId === 'chaotic-shift' || queryId === 'empty-shift' || queryId === 'all-equipment-unavailable') activeScenarioId = queryId;
  return activeScenarioId ? createStressScenario(activeScenarioId) : null;
}

export function clearActiveStressScenario(): void { activeScenarioId = null; }

export function assertStressScenarioReadOnly(): void {
  if (getActiveStressScenario()) throw new Error('Local stress scenarios are read-only. No production action was sent.');
}
