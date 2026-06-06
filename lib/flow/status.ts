import type { PrepQueueStatus, WeeklyPlanStatus } from '@/lib/firebase/models';

export function normalizePrepStatus(status: PrepQueueStatus): PrepQueueStatus {
  if (status === 'staging') return 'staged';
  if (status === 'ready') return 'ready_for_thermal';
  return status;
}

export function prepStatusLabel(status: PrepQueueStatus): string {
  const s = normalizePrepStatus(status);
  if (s === 'staged') return 'Sent from Planning';
  if (s === 'prepping') return 'In Prep';
  if (s === 'ready_for_thermal') return 'Ready for Thermal';
  if (s === 'assigned') return 'Assigned';
  if (s === 'cooking' || s === 'in_thermal') return 'Cooking';
  if (s === 'awaiting_chill') return 'Awaiting Chill';
  if (s === 'moved_downstream') return 'Moved Downstream';
  if (s === 'hold') return 'Hold';
  return s;
}

export function weeklyPlanStatusLabel(status: WeeklyPlanStatus): string {
  if (status === 'RTC' || status === 'rtc_created') return 'Sent to RTC';
  return status;
}
