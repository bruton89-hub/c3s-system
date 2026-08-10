export function handoffIdentity(shiftDate: string, shiftName = 'shift'): string {
  const date = shiftDate.trim(); const shift = shiftName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !shift) throw new Error('Handoff identity requires an ISO date and shift.');
  return `${date}__${shift}`;
}

export function validateHandoffNote(note: string): string {
  const value = note.trim(); if (!value) throw new Error('Handoff note is required.'); if (value.length > 500) throw new Error('Handoff note must be 500 characters or fewer.'); return value;
}
