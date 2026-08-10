import type { Href } from 'expo-router';

import { C3S_COLORS } from '@/constants/c3s-ui';
import type { OItemItem, OItemStage, OItemStatus } from '@/lib/operational-items';

type TimestampLike = { toMillis?: () => number } | null | undefined;

export type ProductionTone = 'normal' | 'waiting' | 'critical' | 'active' | 'inactive';
export type ProductionSeverity = 'critical' | 'warning' | 'info';

export const PRODUCTION_FLOW = ['Prep', 'RTC', 'Thermal', 'Chill', 'QA', 'Packaging', 'Complete'] as const;

const stageLabels: Record<OItemStage, string> = {
  planning: 'Prep', rtc: 'RTC', thermal: 'Thermal', chill: 'Chill',
  qa: 'QA', packaging: 'Packaging', complete: 'Complete',
};

const statusLabels: Record<OItemStatus, string> = {
  draft: 'Prep Not Started', staging: 'Ready for Prep', staged: 'Ready for Prep',
  prepping: 'Prep in Progress', ready: 'Ready for Thermal', ready_for_thermal: 'Ready for Thermal',
  split_parent: 'Load Split', in_thermal: 'Assigned to Thermal', moved_downstream: 'Ready for Thermal',
  assigned: 'Equipment Assigned', cooking: 'Cooking', awaiting_chill: 'Ready for Chill',
  in_chill: 'Chilling', chill_complete: 'Chill Complete', ready_for_qa: 'Waiting for QA',
  qa_hold: 'QA Hold', qa_review_required: 'QA Review Required', ready_for_packaging: 'Ready for Packaging',
  packaging_in_progress: 'Packaging', packaging_complete: 'Packaging Complete', complete: 'Complete', hold: 'On Hold',
};

const nextActions: Record<OItemStatus, string> = {
  draft: 'Complete Prep Plan', staging: 'Start Prep', staged: 'Start Prep', prepping: 'Send to Thermal',
  ready: 'Start Cook', ready_for_thermal: 'Start Cook', split_parent: 'Review Split Loads',
  in_thermal: 'Start Cook', moved_downstream: 'Start Cook', assigned: 'Start Cook',
  cooking: 'Record Check', awaiting_chill: 'Start Chill', in_chill: 'Record Check',
  chill_complete: 'Send to QA', ready_for_qa: 'Approve', qa_hold: 'Resolve Hold',
  qa_review_required: 'Review QA Hold', ready_for_packaging: 'Start Packaging',
  packaging_in_progress: 'Complete Batch', packaging_complete: 'Complete Batch',
  complete: 'No Action Required', hold: 'Resolve Hold',
};

const stageRoutes: Record<OItemStage, Href> = {
  planning: '/planning', rtc: '/prep-queue', thermal: '/thermal', chill: '/chill',
  qa: '/qa-review', packaging: '/packaging', complete: '/packaging',
};

export function toMillis(value: TimestampLike): number {
  return value?.toMillis?.() ?? 0;
}

export function itemTimestamp(item: OItemItem): number {
  const lastTransition = item.transitions?.[item.transitions.length - 1];
  return toMillis(lastTransition?.at) || toMillis(item.updatedAt) || toMillis(item.createdAt);
}

export function formatElapsed(ms: number, now = Date.now()): string {
  if (!ms) return 'Time unavailable';
  const minutes = Math.max(0, Math.floor((now - ms) / 60000));
  if (minutes < 60) return `${minutes}m in stage`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m in stage` : `${hours}h in stage`;
}

export function itemName(item: OItemItem): string {
  return item.productNameSnapshot || item.productName || `Production item ${item.id.slice(0, 6)}`;
}

export function itemBatch(item: OItemItem): string {
  return item.processOrder || item.poNumber || item.id.slice(0, 8).toUpperCase();
}

export function itemEquipment(item: OItemItem): string | null {
  if (item.stage === 'thermal') return item.assignedSmokehouse ? `Smokehouse ${item.assignedSmokehouse}` : null;
  if (item.stage === 'chill') return item.chillerId ? `Chiller ${item.chillerId}` : null;
  if (item.stage === 'packaging') return item.packagingLine ? `Line ${item.packagingLine}` : null;
  return item.department || null;
}

export function getItemTone(item: OItemItem): ProductionTone {
  if (item.status === 'hold' || item.status === 'qa_hold' || item.status === 'qa_review_required' || item.hasDeviation) return 'critical';
  if (['staging', 'staged', 'ready', 'ready_for_thermal', 'awaiting_chill', 'ready_for_qa', 'ready_for_packaging'].includes(item.status)) return 'waiting';
  if (item.status === 'complete' || item.status === 'packaging_complete') return 'inactive';
  return 'active';
}

export function toneColor(tone: ProductionTone): string {
  if (tone === 'critical') return C3S_COLORS.danger;
  if (tone === 'waiting') return C3S_COLORS.warning;
  if (tone === 'normal') return C3S_COLORS.success;
  if (tone === 'inactive') return C3S_COLORS.textMuted;
  return C3S_COLORS.info;
}

export function getItemPresentation(item: OItemItem) {
  return {
    stage: stageLabels[item.stage],
    status: statusLabels[item.status] || item.status.replaceAll('_', ' '),
    nextAction: nextActions[item.status] || 'Review production item',
    route: stageRoutes[item.stage],
    tone: getItemTone(item),
    equipment: itemEquipment(item),
    elapsed: formatElapsed(itemTimestamp(item)),
  };
}

export type ProductionAlert = {
  id: string;
  itemId: string;
  conditionKey: string;
  category: 'equipment' | 'thermal' | 'chill' | 'qa' | 'packaging' | 'hold' | 'workflow';
  severity: ProductionSeverity;
  title: string;
  message: string;
  timestamp: number;
  age: string;
  batch: string;
  product: string;
  stage: string;
  currentStatus: string;
  actionLabel: string;
  actionRoute: Href;
  lifecycle: 'open' | 'acknowledged' | 'resolved';
};

function formatConditionAge(timestamp: number, now: number): string {
  if (!timestamp) return 'Time unavailable';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function alertFor(
  item: OItemItem,
  now: number,
  severity: ProductionSeverity,
  key: string,
  category: ProductionAlert['category'],
  title: string,
  message: string,
): ProductionAlert {
  const timestamp = itemTimestamp(item);
  const presentation = getItemPresentation(item);
  return {
    id: `${item.id}__${key}`,
    itemId: item.id,
    conditionKey: key,
    category,
    severity,
    title,
    message,
    timestamp,
    age: formatConditionAge(timestamp, now),
    batch: itemBatch(item),
    product: itemName(item),
    stage: presentation.stage,
    currentStatus: presentation.status,
    actionLabel: presentation.nextAction,
    actionRoute: `${presentation.route}?itemId=${encodeURIComponent(item.id)}` as Href,
    lifecycle: 'open',
  };
}

export function getProductionAlerts(item: OItemItem, now = Date.now()): ProductionAlert[] {
  const timestamp = itemTimestamp(item);
  const hours = timestamp ? (now - timestamp) / 3600000 : 0;
  const name = itemName(item);
  const alerts: ProductionAlert[] = [];

  if (item.status === 'qa_hold' || item.status === 'qa_review_required') {
    alerts.push(alertFor(item, now, 'critical', 'qa-hold', 'qa', 'QA action required', `${name} cannot move forward until QA resolves the hold.`));
  }
  if (item.status === 'hold') {
    alerts.push(alertFor(item, now, 'critical', 'production-hold', 'hold', 'Production hold', `${name} needs immediate review.`));
  }
  if (item.hasDeviation) alerts.push(alertFor(item, now, 'critical', 'process-deviation', 'workflow', 'Production deviation', item.deviationNotes || `${name} needs immediate review.`));
  if (item.status === 'cooking' && hours > ((item.expectedCookMinutes || 0) / 60 + 1)) {
    alerts.push(alertFor(item, now, 'critical', 'thermal-check-overdue', 'thermal', 'Thermal action overdue', `${name} is beyond its expected cook window.`));
  } else if (item.status === 'cooking' && item.expectedCookMinutes > 0 && hours >= item.expectedCookMinutes / 60) {
    alerts.push(alertFor(item, now, 'warning', 'thermal-limit-approaching', 'thermal', 'Thermal timing attention', `${name} has reached its configured expected cook time.`));
  }
  if (item.status === 'in_chill' && hours > ((item.expectedChillMinutes || 0) / 60 + 1)) {
    alerts.push(alertFor(item, now, 'critical', 'chill-check-overdue', 'chill', 'Chill action overdue', `${name} is beyond its expected chill window.`));
  } else if (item.status === 'in_chill' && (item.expectedChillMinutes || 0) > 0 && hours >= (item.expectedChillMinutes || 0) / 60) {
    alerts.push(alertFor(item, now, 'warning', 'chill-limit-approaching', 'chill', 'Chill timing attention', `${name} has reached its configured expected chill time.`));
  }
  if ((item.status === 'ready_for_thermal' || item.status === 'ready') && !item.assignedSmokehouse) {
    alerts.push(alertFor(item, now, hours > 2 ? 'critical' : 'warning', 'waiting-for-smokehouse', 'equipment', 'Smokehouse needed', `${name} is ready but has no smokehouse assigned.`));
  }
  if (item.status === 'awaiting_chill' && !item.chillerId) {
    alerts.push(alertFor(item, now, hours > 1 ? 'critical' : 'warning', 'waiting-for-chiller', 'equipment', 'Chiller needed', `${name} is waiting for a chiller assignment.`));
  }
  if (item.status === 'ready_for_qa' && hours > 2) {
    alerts.push(alertFor(item, now, 'warning', 'qa-wait-overdue', 'qa', 'QA waiting too long', `${name} has been waiting for QA for more than 2 hours.`));
  }
  if (item.status === 'ready_for_packaging' && hours > 4) {
    alerts.push(alertFor(item, now, 'warning', 'packaging-wait-overdue', 'packaging', 'Packaging handoff delayed', `${name} has been waiting for packaging for more than 4 hours.`));
  }
  const severityRank: Record<ProductionSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.timestamp - b.timestamp || a.conditionKey.localeCompare(b.conditionKey));
}

export function getProductionAlert(item: OItemItem, now = Date.now()): ProductionAlert | null {
  return getProductionAlerts(item, now)[0] ?? null;
}

export function sortProductionItems(items: OItemItem[]): OItemItem[] {
  const rank: Record<ProductionTone, number> = { critical: 0, waiting: 1, active: 2, normal: 3, inactive: 4 };
  return [...items].sort((a, b) => rank[getItemTone(a)] - rank[getItemTone(b)] || itemTimestamp(a) - itemTimestamp(b));
}
