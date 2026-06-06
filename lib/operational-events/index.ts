/**
 * Operational Events module.
 *
 * Replaces the unstructured "Actual: Notes" column from the scheduling
 * spreadsheet with typed, severity-tagged event records.
 *
 * Firestore collection: `operational_events`
 *
 * Event types covered:
 *   - delay             (production behind schedule)
 *   - qa_hold           (load held for QA review)
 *   - maintenance       (equipment maintenance event)
 *   - cook_overrun      (cook ran past its planned duration)
 *   - steam_issue       (steam supply problem)
 *   - humidity_issue    (humidity excursion in house or chiller)
 *   - reassignment      (load moved to a different house / chiller)
 *   - other             (free-form fallback, must include notes)
 */
import {
  addDoc,
  getDocs,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { collectionRef, docRef } from '@/lib/firebase/collections';
import type {
  OperationalEventDepartment,
  OperationalEventDoc,
  OperationalEventSeverity,
  OperationalEventType,
} from '@/lib/firebase/models';

export type {
  OperationalEventDepartment,
  OperationalEventDoc,
  OperationalEventSeverity,
  OperationalEventType,
};

export type OperationalEvent = OperationalEventDoc & { id: string };

export const EVENT_TYPE_LABELS: Record<OperationalEventType, string> = {
  delay: 'Delay',
  qa_hold: 'QA Hold',
  maintenance: 'Maintenance',
  cook_overrun: 'Cook Overrun',
  steam_issue: 'Steam Issue',
  humidity_issue: 'Humidity Issue',
  reassignment: 'Reassignment',
  ready_for_thermal: 'Ready for Thermal',
  other: 'Other',
};

export const EVENT_SEVERITY_LABELS: Record<OperationalEventSeverity, string> = {
  info: 'Info',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const EVENT_DEPARTMENT_LABELS: Record<OperationalEventDepartment, string> = {
  rtc: 'RTC',
  boning_room: 'Boning Room',
  ham_stuffing: 'Ham Stuffing',
  process_meats: 'Process Meats',
  turkey_room: 'Turkey Room',
  thermal: 'Thermal',
  chill: 'Chill',
  qa: 'QA',
  packaging: 'Packaging',
};

export type NewOperationalEventInput = Omit<OperationalEventDoc, 'createdAt'> & {
  createdAt?: Timestamp;
};

function snap(snapshot: QueryDocumentSnapshot<OperationalEventDoc>): OperationalEvent {
  return { id: snapshot.id, ...snapshot.data() };
}

function removeUndefinedFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedFields(item))
      .filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      if (v === undefined) return;
      out[k] = removeUndefinedFields(v);
    });
    return out as T;
  }
  return value;
}

/** Fetch all events for a given weekly_plan id (most common read pattern). */
export async function getEventsForPlan(weeklyPlanId: string): Promise<OperationalEvent[]> {
  const snapshot = await getDocs(
    query(
      collectionRef('operational_events'),
      where('weeklyPlanId', '==', weeklyPlanId),
      orderBy('createdAt', 'desc'),
    ),
  );
  return snapshot.docs.map(snap);
}

/** Fetch the most recent N events across all sources (for dashboards). */
export async function getRecentEvents(maxItems = 50): Promise<OperationalEvent[]> {
  const snapshot = await getDocs(
    query(collectionRef('operational_events'), orderBy('createdAt', 'desc')),
  );
  return snapshot.docs.slice(0, maxItems).map(snap);
}

export async function getUnresolvedEvents(): Promise<OperationalEvent[]> {
  const snapshot = await getDocs(
    query(
      collectionRef('operational_events'),
      where('resolved', '==', false),
      orderBy('createdAt', 'desc'),
    ),
  );
  return snapshot.docs.map(snap);
}

export async function recordOperationalEvent(input: NewOperationalEventInput): Promise<string> {
  const payload: OperationalEventDoc = removeUndefinedFields({
    ...input,
    resolved: input.resolved ?? false,
    createdAt: input.createdAt ?? Timestamp.now(),
  } as OperationalEventDoc);
  const ref = await addDoc(collectionRef('operational_events'), payload);
  return ref.id;
}

export async function createOperationalEvent(input: NewOperationalEventInput): Promise<string> {
  return recordOperationalEvent(input);
}

export async function resolveOperationalEvent(
  eventId: string,
  resolvedBy: string,
): Promise<void> {
  await updateDoc(docRef('operational_events', eventId), removeUndefinedFields({
    resolved: true,
    resolvedBy,
    resolvedAt: Timestamp.now(),
  }));
}
