export type OperationalRole = 'admin' | 'supervisor' | 'qa' | 'operator' | 'packaging' | null;
export type EquipmentState = 'Available' | 'In Use' | 'Cleaning' | 'Unavailable';
export type OperationalSeverity = 'critical' | 'warning' | 'info' | null;

export function urgencyRank(severity: OperationalSeverity, waiting = false): number {
  return severity === 'critical' ? 0 : severity === 'warning' ? 1 : waiting ? 2 : 3;
}

export function freshnessState(lastSuccessfulRefresh: number | null, refreshFailed: boolean, now = Date.now()) {
  if (!lastSuccessfulRefresh) return { state: 'unknown' as const, label: refreshFailed ? 'Live state unavailable' : 'Waiting for live state' };
  const seconds = Math.max(0, Math.floor((now - lastSuccessfulRefresh) / 1000));
  if (refreshFailed) return { state: 'stale' as const, label: `Last known state • updated ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`} ago` };
  return { state: 'live' as const, label: seconds < 10 ? 'Live state' : `Updated ${seconds}s ago` };
}

const allowedTransitions: Record<string, readonly string[]> = {
  draft: ['staging'], staging: ['staged', 'prepping', 'ready'], staged: ['prepping', 'ready'], prepping: ['ready', 'ready_for_thermal'],
  ready: ['ready_for_thermal', 'assigned'], ready_for_thermal: ['assigned'], in_thermal: ['assigned', 'cooking'], moved_downstream: ['assigned', 'ready_for_thermal'],
  assigned: ['cooking'], cooking: ['awaiting_chill'], awaiting_chill: ['in_chill'], in_chill: ['chill_complete'], chill_complete: ['ready_for_qa'],
  ready_for_qa: ['ready_for_packaging', 'qa_hold', 'qa_review_required'], qa_hold: ['ready_for_qa'], qa_review_required: ['ready_for_qa'],
  ready_for_packaging: ['packaging_in_progress'], packaging_in_progress: ['packaging_complete'], packaging_complete: ['complete'],
};

export function isValidProductionTransition(fromStatus: string, toStatus: string): boolean {
  return allowedTransitions[fromStatus]?.includes(toStatus) ?? false;
}

export function matchesOperationalSearch(values: Array<string | null | undefined>, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  return !query || values.some((value) => (value ?? '').toLowerCase().includes(query));
}

export function countEquipmentStatuses(equipment: Array<{ status: EquipmentState }>) {
  return {
    inUse: equipment.filter((entry) => entry.status === 'In Use').length,
    available: equipment.filter((entry) => entry.status === 'Available').length,
    unavailable: equipment.filter((entry) => entry.status === 'Cleaning' || entry.status === 'Unavailable').length,
  };
}

export function isEquipmentSelectable(status: EquipmentState): boolean {
  return status === 'Available';
}

export function actionAvailabilityFor(role: OperationalRole, status: string) {
  const held = status === 'hold' || status === 'qa_hold' || status === 'qa_review_required';
  return {
    canProgress: !held && !['complete', 'packaging_complete', 'split_parent'].includes(status),
    canPlaceHold: !held && Boolean(role && ['admin', 'supervisor', 'qa', 'operator', 'packaging'].includes(role)),
    canResolveHold: held && Boolean(role && ['admin', 'supervisor', 'qa'].includes(role)),
  };
}

export function summarizeHandoff(records: Array<{ status: string; stage: string; severity?: 'critical' | 'warning' | 'info' | null }>) {
  const complete = (record: { status: string; stage: string }) => record.status === 'complete' || record.stage === 'complete';
  const held = (record: { status: string }) => ['hold', 'qa_hold', 'qa_review_required'].includes(record.status);
  return {
    active: records.filter((record) => !complete(record)).length,
    held: records.filter(held).length,
    critical: records.filter((record) => record.severity === 'critical').length,
    completed: records.filter(complete).length,
  };
}
