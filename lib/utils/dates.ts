export function toSafeDate(value: unknown): Date | null {
  try {
    if (value == null) return null;

    if (typeof value === 'object' && value !== null) {
      const withToDate = value as { toDate?: unknown };
      if (typeof withToDate.toDate === 'function') {
        const d = (withToDate.toDate as () => unknown)();
        return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
      }
    }

    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value : null;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      return Number.isFinite(d.getTime()) ? d : null;
    }

    return null;
  } catch {
    return null;
  }
}

export function toMillis(value: unknown): number | null {
  const d = toSafeDate(value);
  return d ? d.getTime() : null;
}

export function formatSafeDate(value: unknown): string {
  const d = toSafeDate(value);
  return d ? d.toLocaleString() : '—';
}
