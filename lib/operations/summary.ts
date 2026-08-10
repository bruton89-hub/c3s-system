import type { UserRole } from '@/lib/firebase/models';
import type { OItemItem, OItemStage } from '@/lib/operational-items';
import { getProductionAlert, getProductionAlerts, itemBatch, itemEquipment, itemName, itemTimestamp } from '@/lib/production/presentation';
import { isHeldStatus } from '@/lib/holds/core';
import { actionAvailabilityFor, countEquipmentStatuses, matchesOperationalSearch, urgencyRank } from './core';

export const ACTIVE_STAGES: OItemStage[] = ['planning', 'rtc', 'thermal', 'chill', 'qa', 'packaging'];
export type ProductionSort = 'priority' | 'stage' | 'oldest' | 'newest' | 'deadline';

export function shiftFlowCounts(items: OItemItem[]): Record<OItemStage, number> {
  const counts: Record<OItemStage, number> = { planning: 0, rtc: 0, thermal: 0, chill: 0, qa: 0, packaging: 0, complete: 0 };
  items.forEach((item) => { counts[item.stage] += 1; });
  return counts;
}

export function isWaitingItem(item: OItemItem): boolean {
  return ['staging', 'staged', 'ready', 'ready_for_thermal', 'awaiting_chill', 'ready_for_qa', 'ready_for_packaging'].includes(item.status);
}

export function shiftSummary(items: OItemItem[]) {
  const active = items.filter((item) => item.stage !== 'complete' && item.status !== 'complete');
  const alerts = items.flatMap((item) => getProductionAlerts(item));
  return {
    active: active.length,
    waiting: active.filter(isWaitingItem).length,
    held: active.filter((item) => isHeldStatus(item.status)).length,
    critical: alerts.filter((alert) => alert.severity === 'critical').length,
    completed: items.filter((item) => item.stage === 'complete' || item.status === 'complete').length,
  };
}

export function recentlyCompleted(items: OItemItem[], limit = 4): OItemItem[] {
  return items.filter((item) => item.stage === 'complete' || item.status === 'complete')
    .sort((a, b) => itemTimestamp(b) - itemTimestamp(a)).slice(0, limit);
}

export function atRiskItems(items: OItemItem[], limit = 6): OItemItem[] {
  return items.filter((item) => Boolean(getProductionAlert(item)))
    .sort((a, b) => {
      const aa = getProductionAlert(a); const bb = getProductionAlert(b);
      const rank = { critical: 0, warning: 1, info: 2 };
      return rank[aa?.severity ?? 'info'] - rank[bb?.severity ?? 'info'] || itemTimestamp(a) - itemTimestamp(b);
    }).slice(0, limit);
}

export function matchesProductionSearch(item: OItemItem, rawQuery: string): boolean {
  return matchesOperationalSearch([itemBatch(item), itemName(item), itemEquipment(item), item.productCode, item.processOrder], rawQuery);
}

export function sortProduction(items: OItemItem[], sort: ProductionSort): OItemItem[] {
  const stageRank: Record<OItemStage, number> = { planning: 0, rtc: 1, thermal: 2, chill: 3, qa: 4, packaging: 5, complete: 6 };
  const priority = (item: OItemItem) => urgencyRank(getProductionAlert(item)?.severity ?? null, isWaitingItem(item));
  const deadline = (item: OItemItem) => {
    const iso = item.expectedCookComplete || item.expectedChillComplete || item.packagingReadyETA;
    const value = iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER;
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  };
  return [...items].sort((a, b) => {
    if (sort === 'stage') return stageRank[a.stage] - stageRank[b.stage] || itemTimestamp(a) - itemTimestamp(b);
    if (sort === 'oldest') return itemTimestamp(a) - itemTimestamp(b);
    if (sort === 'newest') return itemTimestamp(b) - itemTimestamp(a);
    if (sort === 'deadline') return deadline(a) - deadline(b) || priority(a) - priority(b);
    return priority(a) - priority(b) || itemTimestamp(a) - itemTimestamp(b);
  });
}

export function stageActionAvailability(status: string, role: UserRole | null) {
  return actionAvailabilityFor(role, status);
}

export type EquipmentSummary = {
  id: string;
  kind: 'Oven' | 'Chiller';
  status: 'Available' | 'In Use' | 'Cleaning' | 'Unavailable';
  assignedItemId?: string | null;
  assignedBatch?: string | null;
};

export function equipmentCounts(equipment: EquipmentSummary[]) {
  return countEquipmentStatuses(equipment);
}

export type TimelineRow = { id: string; label: string; detail: string; at: number; kind: 'transition' | 'check' | 'equipment' | 'note' };

export function productionTimeline(item: OItemItem): TimelineRow[] {
  const rows: TimelineRow[] = (item.transitions ?? []).map((transition, index) => ({
    id: `transition-${index}-${transition.at?.toMillis?.() ?? 0}`,
    label: `${transition.from.status.replaceAll('_', ' ')} → ${transition.to.status.replaceAll('_', ' ')}`,
    detail: `${transition.by}${transition.reason ? ` • ${transition.reason}` : ''}`,
    at: transition.at?.toMillis?.() ?? 0,
    kind: 'transition',
  }));
  const checks: Array<[string, { toMillis?: () => number } | null | undefined, string]> = [
    ['Load verified', item.loadedVerifiedAt, item.loadedVerifiedBy || 'Recorded operator'],
    ['Cook started', item.cookStartedAt, item.startingTemp != null ? `${item.startingTemp}°F chamber` : 'Temperature recorded'],
    ['50°F check', item.cut50At, item.cut50ObservedTemp != null ? `${item.cut50ObservedTemp}°F` : 'Recorded'],
    ['130°F check', item.cut130At, item.cut130ObservedTemp != null ? `${item.cut130ObservedTemp}°F` : 'Recorded'],
    ['Critical temperature', item.criticalTempReachedAt, item.criticalTempValue != null ? `${item.criticalTempValue}°F` : 'Recorded'],
    ['QA reviewed', item.qaReviewedAt, item.qaReviewedBy || 'QA reviewer'],
    ['Packaging started', item.packagingStartedAt, item.packagedBy || 'Packaging'],
    ['Packaging completed', item.packagingCompletedAt, item.packagedBy || 'Packaging'],
  ];
  checks.forEach(([label, timestamp, detail], index) => {
    const at = timestamp?.toMillis?.() ?? 0;
    if (at) rows.push({ id: `check-${index}-${at}`, label, detail, at, kind: 'check' });
  });
  return rows.sort((a, b) => b.at - a.at);
}
