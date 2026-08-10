export type AlertCoreStatus = 'open' | 'acknowledged' | 'resolved';
export type AlertCoreSeverity = 'critical' | 'warning' | 'info';

export type AlertSortable = {
  severity: AlertCoreSeverity;
  status: AlertCoreStatus;
  firstDetectedAt: number;
};

export function buildAlertId(itemId: string, conditionKey: string): string {
  const cleanItem = itemId.trim();
  const cleanCondition = conditionKey.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (!cleanItem || !cleanCondition) throw new Error('Alert identity requires an item and condition.');
  return `${cleanItem}__${cleanCondition}`;
}

export function statusAfterDetection(status: AlertCoreStatus | null): AlertCoreStatus {
  return status === 'acknowledged' ? 'acknowledged' : 'open';
}

export function canAcknowledgeAlert(status: AlertCoreStatus): boolean {
  return status === 'open';
}

export function shouldResolveAlert(status: AlertCoreStatus, conditionActive: boolean): boolean {
  return status !== 'resolved' && !conditionActive;
}

export function sortAlerts<T extends AlertSortable>(alerts: T[]): T[] {
  const severityRank: Record<AlertCoreSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return [...alerts].sort((a, b) =>
    severityRank[a.severity] - severityRank[b.severity] || a.firstDetectedAt - b.firstDetectedAt,
  );
}
