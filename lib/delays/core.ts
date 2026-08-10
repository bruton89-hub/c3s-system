export const DELAY_REASONS = [
  { key: 'equipment', label: 'Equipment' }, { key: 'staffing', label: 'Staffing' },
  { key: 'material', label: 'Material / Product' }, { key: 'quality', label: 'Quality Review' },
  { key: 'handoff', label: 'Stage Handoff' }, { key: 'other', label: 'Other' },
] as const;

export function buildDelayId(itemId: string, stage: string): string {
  const clean = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (!clean(itemId) || !clean(stage)) throw new Error('Delay identity requires item and stage.');
  return `${clean(itemId)}__${clean(stage)}__delay`;
}

export function delayDurationMinutes(startedAt: number, clearedAt: number): number {
  return Math.max(0, Math.round((clearedAt - startedAt) / 60000));
}

export function canClearDelay(status: 'active' | 'cleared'): boolean { return status === 'active'; }
