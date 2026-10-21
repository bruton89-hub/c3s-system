/**
 * Production Planning Board — replaces the previous CRUD-style Planning screen.
 *
 * Design intent (per ops brief):
 *   - 7-day grid (Monday → Sunday) modeled directly after the deli scheduling
 *     spreadsheet (NewMeatSchedulingSpreadsheet.xlsm).
 *   - Each day groups rows by department: Boning Room, Ham Stuffing,
 *     Process Meats, Turkey Room.
 *   - Each card shows: description, code, process order, cases, racks, BTC,
 *     cook time, chill ETA, assigned smokehouse, assigned chiller, status.
 *   - Daily Grand Totals at the foot of each column (Cases / Racks / BTC).
 *   - Forecasting + capacity warnings surfaced inline.
 *
 * Optimized for iPad landscape: horizontal scroll between days, dense rows,
 * 44pt minimum touch targets on interactive elements.
 */
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getActiveStressScenario } from '@/lib/stress/scenarios';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Timestamp, deleteDoc, getDoc } from 'firebase/firestore';

import { C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { StressScenarioBanner } from '@/components/stress-scenario-banner';
import { C3SOperatorFocus } from '@/components/operator-ui';
import { C3S_COLORS, C3S_RADIUS } from '@/constants/c3s-ui';

import {
  createWeeklyPlanItem,
  deleteWeeklyPlanItem,
  getWeeklyPlanItems,
  updateWeeklyPlanItem,
  type WeeklyPlanItem,
} from '@/lib/firebase/repository';
import { oItemSendPlanToRTC } from '@/lib/operational-items';
import { docRef } from '@/lib/firebase/collections';
import {
  getActiveProductProfiles,
  PRODUCTION_SECTION_LABELS,
  PRODUCTION_SECTION_ORDER,
  type ProductionSection,
  type ProductProfile,
} from '@/lib/products';
import {
  computeBtc,
  forecastSchedule,
  formatForecastTime,
} from '@/lib/forecasting';
import {
  analyzeAll,
  SMOKEHOUSE_IDS,
  CHILLER_IDS,
  type UtilizationSlot,
} from '@/lib/capacity';
import type { ProductionBoardStatus } from '@/lib/firebase/models';
import {
  EVENT_TYPE_LABELS,
  recordOperationalEvent,
  type OperationalEventType,
} from '@/lib/operational-events';
import { toSafeDate } from '@/lib/utils/dates';

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const BOARD_STATUSES: { value: ProductionBoardStatus; label: string; color: string }[] = [
  { value: 'planned',            label: 'Planned',            color: C3S_COLORS.textMuted },
  { value: 'rtc',                label: 'RTC',                color: C3S_COLORS.accent },
  { value: 'ready_for_thermal',  label: 'RDY → Thermal',      color: C3S_COLORS.accent },
  { value: 'cooking',            label: 'Cooking',            color: C3S_COLORS.warning },
  { value: 'awaiting_chill',     label: 'Await Chill',        color: C3S_COLORS.warning },
  { value: 'chill_running',      label: 'Chill Running',      color: C3S_COLORS.info },
  { value: 'ready_for_qa',       label: 'RDY → QA',           color: C3S_COLORS.accent },
  { value: 'ready_for_packaging',label: 'RDY → Pack',         color: C3S_COLORS.success },
  { value: 'complete',           label: 'Complete',           color: C3S_COLORS.success },
  { value: 'deviation',          label: 'Deviation',          color: C3S_COLORS.danger },
];

function statusMeta(s: ProductionBoardStatus | undefined) {
  return BOARD_STATUSES.find((b) => b.value === s) ?? BOARD_STATUSES[0];
}

// ── Date helpers ─────────────────────────────────────────────────────────────

/** Monday of the week containing `date` (local time). */
function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtDateShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PlanningScreen() {
  // Anchor date controls which week is visible.
  const [anchor, setAnchor] = useState<Date>(() => mondayOf(new Date()));
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor]);

  const [profiles, setProfiles] = useState<ProductProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [items, setItems] = useState<WeeklyPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Modal state for add/edit
  const [editing, setEditing] = useState<{
    item: Partial<WeeklyPlanItem> | null;
    isNew: boolean;
    section?: ProductionSection;
    plannedDate?: string;
  } | null>(null);

  // Operational event modal
  const [eventModal, setEventModal] = useState<{ planItem: WeeklyPlanItem } | null>(null);
  const [flowTestPlanId, setFlowTestPlanId] = useState<string>('');
  const [flowTestPrepId, setFlowTestPrepId] = useState<string>('');
  const [flowTestStatus, setFlowTestStatus] = useState<{
    planningStatus: string;
    planningBoardStatus: string;
    prepStatus: string;
    prepStage: string;
    assignedSmokehouse: string;
    lastEvent: string;
  }>({
    planningStatus: '—',
    planningBoardStatus: '—',
    prepStatus: '—',
    prepStage: '—',
    assignedSmokehouse: '—',
    lastEvent: 'Idle',
  });

  const profileByCode = useMemo(() => {
    const map = new Map<string, ProductProfile>();
    profiles.forEach((p) => map.set(p.productCode, p));
    return map;
  }, [profiles]);

  const profileById = useMemo(() => {
    const map = new Map<string, ProductProfile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const load = useCallback(async () => {
    setLoading(true);
    setProfilesLoading(true);
    setError(null);
    if (getActiveStressScenario()) {
      setProfiles([]);
      setItems([]);
      setProfilesLoading(false);
      setLoading(false);
      return;
    }
    // Use allSettled so a weekly_plan permission failure never blocks
    // product_profiles from reaching the modal — they are independent fetches.
    const [profilesResult, itemsResult] = await Promise.allSettled([
      getActiveProductProfiles(),
      getWeeklyPlanItems(),
    ]);
    if (profilesResult.status === 'fulfilled') {
      setProfiles(profilesResult.value);
    } else if (__DEV__) {

      console.error('[load] getActiveProductProfiles failed:', profilesResult.reason);
    }
    setProfilesLoading(false);
    if (itemsResult.status === 'fulfilled') {
      setItems(itemsResult.value);
    } else {
      const reason = itemsResult.reason;
      setError(reason instanceof Error ? reason.message : 'Failed to load planning data');
      if (__DEV__) {

        console.error('[load] getWeeklyPlanItems failed:', reason);
      }
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Group items: by day → by section ─────────────────────────────────────
  const itemsByDayAndSection = useMemo(() => {
    const result: Record<string, Record<ProductionSection, WeeklyPlanItem[]>> = {};
    for (const d of weekDays) {
      const iso = toISODate(d);
      result[iso] = {
        boning_room: [],
        ham_stuffing: [],
        process_meats: [],
        turkey_room: [],
      };
    }
    for (const it of items) {
      const dayBucket = result[it.plannedDate];
      if (!dayBucket) continue;
      const section = (it.productionSection
        ?? profileByCode.get(it.productCodeSnapshot ?? '')?.productionSection
        ?? profileById.get(it.productId)?.productionSection
        ?? 'process_meats') as ProductionSection;
      dayBucket[section].push(it);
    }
    // Sort each bucket by priority then product name.
    for (const day of Object.values(result)) {
      for (const arr of Object.values(day)) {
        arr.sort((a, b) => (a.priority - b.priority) || a.productName.localeCompare(b.productName));
      }
    }
    return result;
  }, [items, weekDays, profileByCode, profileById]);

  // ── Capacity warnings for the visible week ───────────────────────────────
  const capacityWarnings = useMemo(() => {
    const smokeSlots: UtilizationSlot[] = [];
    const chillSlots: UtilizationSlot[] = [];

    for (const it of items) {
      if (!weekDays.some((d) => toISODate(d) === it.plannedDate)) continue;
      const profile = profileById.get(it.productId) ?? profileByCode.get(it.productCodeSnapshot ?? '');
      if (!profile) continue;

      const start = toSafeDate(it.plannedStartAt) ?? (() => {
        const d = new Date(`${it.plannedDate}T06:00:00`);
        return d;
      })();
      const forecast = forecastSchedule({
        profile,
        rackCount: it.plannedRacks,
        plannedStart: start,
      });

      if (it.assignedSmokehouse) {
        smokeSlots.push({
          resourceId: it.assignedSmokehouse,
          productCode: profile.productCode,
          productName: profile.productName,
          rackCount: it.plannedRacks,
          start: forecast.cookStart,
          end: forecast.cookEnd,
          sourceId: it.id,
        });
      }
      const chillStart = forecast.cookEnd;
      const chillEnd = forecast.postThermalEnd;
      if (it.assignedChiller && chillEnd.getTime() > chillStart.getTime()) {
        chillSlots.push({
          resourceId: it.assignedChiller,
          productCode: profile.productCode,
          productName: profile.productName,
          rackCount: it.plannedRacks,
          start: chillStart,
          end: chillEnd,
          sourceId: it.id,
        });
      }
    }

    return analyzeAll(smokeSlots, chillSlots);
  }, [items, weekDays, profileById, profileByCode]);

  // ── Daily totals ─────────────────────────────────────────────────────────
  function dayTotals(iso: string) {
    const buckets = itemsByDayAndSection[iso];
    if (!buckets) return { cases: 0, racks: 0, btc: 0 };
    let cases = 0, racks = 0, btc = 0;
    for (const arr of Object.values(buckets)) {
      for (const it of arr) {
        cases += it.cases ?? 0;
        racks += it.plannedRacks;
        btc += it.btc ?? 0;
      }
    }
    return { cases, racks, btc };
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  function openCreate(section: ProductionSection, plannedDate: string) {
    setEditing({
      isNew: true,
      section,
      plannedDate,
      item: {
        productionSection: section,
        plannedDate,
        plannedRacks: 0,
        plannedPieces: 0,
        cases: 0,
        priority: 1,
        boardStatus: 'planned',
        status: 'planned',
        notes: '',
      },
    });
  }

  function openEdit(item: WeeklyPlanItem) {
    setEditing({ isNew: false, item: { ...item } });
  }

  async function saveEditing() {
    if (!editing?.item) return;
    const draft = editing.item;
    const profile = draft.productId ? profileById.get(draft.productId) : undefined;
    if (!profile) {
      Alert.alert('Select a product', 'Choose a product profile before saving.');
      return;
    }
    const racks = Number(draft.plannedRacks) || 0;
    const btc = draft.btc != null ? Number(draft.btc) : computeBtc(racks, profile.rackCapacity);
    const plannedStart = toSafeDate(draft.plannedStartAt) ?? new Date(`${draft.plannedDate ?? toISODate(anchor)}T06:00:00`);
    const expectedSchedule = forecastSchedule({
      profile,
      rackCount: racks,
      plannedStart,
    });

    const payload = {
      productId: profile.id,
      productName: profile.productName,
      productCodeSnapshot: profile.productCode,
      description: draft.description ?? profile.productName,
      processOrder: draft.processOrder ?? '',
      cases: Number(draft.cases) || 0,
      btc,
      productionSection: (draft.productionSection ?? profile.productionSection ?? 'process_meats') as ProductionSection,
      assignedSmokehouse: draft.assignedSmokehouse ?? null,
      assignedChiller: draft.assignedChiller ?? null,
      plannedDate: draft.plannedDate ?? toISODate(anchor),
      plannedRacks: racks,
      plannedPieces: Number(draft.plannedPieces) || 0,
      priority: Number(draft.priority) || 1,
      notes: draft.notes ?? '',
      status: draft.status ?? 'planned',
      boardStatus: (draft.boardStatus ?? 'planned') as ProductionBoardStatus,
      createdBy: draft.createdBy ?? 'planner',
      species: profile.species,
      processType: profile.processType,
      estimatedCookTimeHours: profile.estimatedCookTimeHours,
      estimatedChillTimeHours: profile.estimatedChillTimeHours,
      estimatedBlastCellHours: profile.estimatedBlastCellHours,
      rackCapacity: profile.rackCapacity,
      criticalLimit: profile.criticalLimit,
      forecastCookEnd: Timestamp.fromDate(expectedSchedule.cookEnd),
      forecastChillEnd: expectedSchedule.chillEnd ? Timestamp.fromDate(expectedSchedule.chillEnd) : null,
      forecastBlastEnd: expectedSchedule.blastEnd ? Timestamp.fromDate(expectedSchedule.blastEnd) : null,
      forecastPackagingEta: Timestamp.fromDate(expectedSchedule.packagingReadyEta),
      expectedCookComplete: Timestamp.fromDate(expectedSchedule.cookEnd),
      expectedChillComplete: expectedSchedule.chillEnd ? Timestamp.fromDate(expectedSchedule.chillEnd) : null,
      expectedBlastCellComplete: expectedSchedule.blastEnd ? Timestamp.fromDate(expectedSchedule.blastEnd) : null,
      packagingReadyETA: Timestamp.fromDate(expectedSchedule.packagingReadyEta),
    };

    try {
      if (editing.isNew) {
        await createWeeklyPlanItem(payload as any);
      } else if (draft.id) {
        await updateWeeklyPlanItem(draft.id, payload as any);
      }
      setEditing(null);
      await load();
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async function deleteItem(item: WeeklyPlanItem) {
    Alert.alert('Delete row?', `Remove "${item.productName}" from the board?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteWeeklyPlanItem(item.id);
            await load();
          } catch (e) {
            Alert.alert('Delete failed', e instanceof Error ? e.message : 'Unknown error');
          }
        },
      },
    ]);
  }

  async function cycleStatus(item: WeeklyPlanItem) {
    const order: ProductionBoardStatus[] = [
      'planned', 'rtc', 'ready_for_thermal', 'cooking', 'awaiting_chill',
      'chill_running', 'ready_for_qa', 'ready_for_packaging', 'complete',
    ];
    const current = item.boardStatus ?? 'planned';
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length];
    try {
      await updateWeeklyPlanItem(item.id, { boardStatus: next } as any);
      await load();
    } catch (e) {
      Alert.alert('Status update failed', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async function sendToRtc(item: WeeklyPlanItem) {
    setActionMessage(null);
    try {
      const planId = item.id;
      if (!planId) throw new Error('Missing weekly_plan document id.');
      if (__DEV__) {

        console.log('[Planning->RTC] selected plan id:', planId);
      }
      const { prepId: prepQueueId, oItemId } = await oItemSendPlanToRTC(planId);
      const planSnap = await getDoc(docRef('weekly_plan', planId));
      const planData = planSnap.exists() ? planSnap.data() : null;
      if (__DEV__) {

        console.log('[Planning->RTC] oItemSendPlanToRTC success:', {
          planId,
          createdPrepQueueId: prepQueueId,
          oItemId,
          productName: item.productName,
          status: planData?.status ?? '—',
          boardStatus: planData?.boardStatus ?? '—',
        });
      }

      let prepVerified = false;
      if (__DEV__) {
        const prepSnap = await getDoc(docRef('prep_queue', prepQueueId));
        prepVerified = prepSnap.exists();
        const prepData = prepSnap.exists() ? prepSnap.data() : null;

        console.log('[Planning->RTC] verification read:', {
          exists: prepVerified,
          prepId: prepQueueId,
          productName: prepData?.productNameSnapshot ?? prepData?.productName ?? '—',
          status: prepData?.status ?? '—',
          stage: prepData?.stage ?? '—',
          sourcePlanId: prepData?.sourcePlanId ?? '—',
        });
      }

      if (__DEV__) {
        setActionMessage(
          prepVerified
            ? 'Sent to RTC and verified prep record.'
            : 'Sent to RTC, but prep record was not found.',
        );
      } else {
        setActionMessage(`Sent to RTC: ${item.productName}`);
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setActionMessage(`Send to RTC failed: ${msg}`);
      Alert.alert('Send to RTC failed', msg);
    }
  }

  function shiftWeek(delta: number) {
    setAnchor((a) => addDays(a, delta * 7));
  }

  async function refreshFlowTestStatus(planId = flowTestPlanId, prepId = flowTestPrepId, lastEvent = flowTestStatus.lastEvent) {
    let planningStatus = '—';
    let planningBoardStatus = '—';
    let prepStatus = '—';
    let prepStage = '—';
    let assignedSmokehouse = '—';

    if (planId) {
      const planSnap = await getDoc(docRef('weekly_plan', planId));
      if (planSnap.exists()) {
        const plan = planSnap.data();
        planningStatus = plan.status ?? '—';
        planningBoardStatus = plan.boardStatus ?? '—';
      }
    }
    if (prepId) {
      const prepSnap = await getDoc(docRef('prep_queue', prepId));
      if (prepSnap.exists()) {
        const prep = prepSnap.data();
        prepStatus = prep.status ?? '—';
        prepStage = prep.stage ?? '—';
        assignedSmokehouse = prep.assignedSmokehouse ?? '—';
      }
    }
    setFlowTestStatus({ planningStatus, planningBoardStatus, prepStatus, prepStage, assignedSmokehouse, lastEvent });
  }

  async function runFlowAction(action: string, fn: () => Promise<void>) {
    try {
      await fn();
      await refreshFlowTestStatus(undefined, undefined, `PASS: ${action}`);
      await load();
    } catch (e) {
      await refreshFlowTestStatus(undefined, undefined, `FAIL: ${action} (${e instanceof Error ? e.message : 'unknown error'})`);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader
          title="Production Board"
          subtitle={`Week of ${fmtDateShort(anchor)} — ${fmtDateShort(addDays(anchor, 6))} · Active Rows: ${items.length}`}
          right={
            <View style={styles.headerActions}>
              <Pressable style={styles.navBtn} onPress={load}>
                <Text style={styles.navBtnText}>Refresh</Text>
              </Pressable>
              <Pressable style={styles.navBtn} onPress={() => shiftWeek(-1)}>
                <Text style={styles.navBtnText}>‹ Prev</Text>
              </Pressable>
              <Pressable style={styles.navBtn} onPress={() => setAnchor(mondayOf(new Date()))}>
                <Text style={styles.navBtnText}>Today</Text>
              </Pressable>
              <Pressable style={styles.navBtn} onPress={() => shiftWeek(1)}>
                <Text style={styles.navBtnText}>Next ›</Text>
              </Pressable>
              <Pressable
                style={[styles.navBtn, styles.navBtnAccent]}
                onPress={() => router.push({ pathname: '/reload-planning', params: { week: toISODate(anchor) } })}>
                <Text style={styles.navBtnText}>Reload plan</Text>
              </Pressable>
              <Pressable
                style={[styles.navBtn, styles.navBtnAccent]}
                onPress={() => router.push('/thermal-timeline')}>
                <Text style={styles.navBtnText}>Timeline</Text>
              </Pressable>
              <Pressable
                style={[styles.navBtn, styles.navBtnAccent]}
                onPress={() => router.push('/products')}>
                <Text style={styles.navBtnText}>Products</Text>
              </Pressable>
            </View>
          }
        />
        <StressScenarioBanner />
        <C3SOperatorFocus
          status={`${items.length} planned batches this week`}
          action={capacityWarnings.warnings.length > 0 ? 'Review Capacity Risk' : items.some((item) => item.status === 'planned') ? 'Send to RTC' : 'Review Production Plan'}
          detail="Add or edit a batch only when the weekly plan needs to change."
          tone={capacityWarnings.warnings.length > 0 ? 'critical' : items.length > 0 ? 'active' : 'complete'}
        />

        {capacityWarnings.warnings.length > 0 && (
          <View style={styles.warningBar}>
            <Text style={styles.warningTitle}>
              {capacityWarnings.warnings.length} capacity warning{capacityWarnings.warnings.length === 1 ? '' : 's'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.warningRow}>
              {capacityWarnings.warnings.slice(0, 8).map((w, i) => (
                <View key={i} style={[styles.warningChip, w.severity === 'high' && styles.warningChipHigh]}>
                  <Text style={styles.warningChipText}>{w.message}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {actionMessage ? <Text style={styles.infoMsg}>{actionMessage}</Text> : null}

        {__DEV__ && (
          <View style={styles.devPanel}>
            <Text style={styles.devTitle}>C3S Flow Test Panel (DEV ONLY)</Text>
            <View style={styles.devBtnRow}>
              <Pressable
                style={styles.devBtn}
                onPress={() => runFlowAction('Create Test Plan Row', async () => {
                  const profile = profiles[0];
                  if (!profile) throw new Error('No product profiles loaded.');
                  const planId = await createWeeklyPlanItem({
                    productId: profile.id,
                    productName: profile.productName,
                    productCodeSnapshot: profile.productCode,
                    description: `[DEV TEST] ${profile.productName}`,
                    processOrder: `DEV-${Date.now()}`,
                    cases: 10,
                    btc: computeBtc(2, profile.rackCapacity),
                    productionSection: profile.productionSection ?? 'process_meats',
                    assignedSmokehouse: null,
                    assignedChiller: null,
                    plannedDate: toISODate(anchor),
                    plannedRacks: 2,
                    plannedPieces: 20,
                    priority: 1,
                    notes: 'DEV flow test row',
                    status: 'planned',
                    boardStatus: 'planned',
                    createdBy: 'flow_test_dev',
                    species: profile.species,
                    processType: profile.processType,
                    estimatedCookTimeHours: profile.estimatedCookTimeHours,
                    estimatedChillTimeHours: profile.estimatedChillTimeHours,
                    estimatedBlastCellHours: profile.estimatedBlastCellHours,
                    rackCapacity: profile.rackCapacity,
                    criticalLimit: profile.criticalLimit,
                    expectedCookComplete: Timestamp.now(),
                    expectedChillComplete: Timestamp.now(),
                    expectedBlastCellComplete: Timestamp.now(),
                    packagingReadyETA: Timestamp.now(),
                  });
                  setFlowTestPlanId(planId);
                  setFlowTestPrepId('');
                })}
              >
                <Text style={styles.devBtnText}>Create Test Plan Row</Text>
              </Pressable>
              <Pressable style={styles.devBtn} onPress={() => runFlowAction('Send Latest Test Plan to RTC', async () => {
                const planId = flowTestPlanId;
                if (!planId) throw new Error('No test plan row created.');
                const { prepId } = await oItemSendPlanToRTC(planId);
                setFlowTestPrepId(prepId);
              })}>
                <Text style={styles.devBtnText}>Send Latest Test Plan to RTC</Text>
              </Pressable>
              <Pressable style={styles.devBtn} onPress={() => runFlowAction('Start Prep', async () => {
                throw new Error('Direct DEV transitions were removed. Continue from the RTC screen.');
              })}>
                <Text style={styles.devBtnText}>Start Prep</Text>
              </Pressable>
              <Pressable style={styles.devBtn} onPress={() => runFlowAction('Mark Ready for Thermal', async () => {
                throw new Error('Direct DEV transitions were removed. Continue from the RTC screen.');
              })}>
                <Text style={styles.devBtnText}>Mark Ready for Thermal</Text>
              </Pressable>
              <Pressable style={styles.devBtn} onPress={() => runFlowAction('Assign Smokehouse D', async () => {
                throw new Error('Direct DEV transitions were removed. Continue from the Thermal screen.');
              })}>
                <Text style={styles.devBtnText}>Assign Smokehouse D</Text>
              </Pressable>
              <Pressable style={styles.devBtn} onPress={() => runFlowAction('Start Cook', async () => {
                throw new Error('Direct DEV transitions were removed. Continue from the Thermal screen.');
              })}>
                <Text style={styles.devBtnText}>Start Cook</Text>
              </Pressable>
              <Pressable style={[styles.devBtn, styles.devBtnDanger]} onPress={() => runFlowAction('Reset Test Flow', async () => {
                if (flowTestPrepId) await deleteDoc(docRef('prep_queue', flowTestPrepId));
                if (flowTestPlanId) await deleteDoc(docRef('weekly_plan', flowTestPlanId));
                setFlowTestPlanId('');
                setFlowTestPrepId('');
              })}>
                <Text style={styles.devBtnText}>Reset Test Flow</Text>
              </Pressable>
            </View>
            <Text style={styles.devStatus}>planId: {flowTestPlanId || '—'}</Text>
            <Text style={styles.devStatus}>prepQueueId: {flowTestPrepId || '—'}</Text>
            <Text style={styles.devStatus}>planning status: {flowTestStatus.planningStatus}</Text>
            <Text style={styles.devStatus}>planning boardStatus: {flowTestStatus.planningBoardStatus}</Text>
            <Text style={styles.devStatus}>prep status: {flowTestStatus.prepStatus}</Text>
            <Text style={styles.devStatus}>prep stage: {flowTestStatus.prepStage}</Text>
            <Text style={styles.devStatus}>assigned smokehouse: {flowTestStatus.assignedSmokehouse}</Text>
            <Text style={styles.devStatus}>last event: {flowTestStatus.lastEvent}</Text>
          </View>
        )}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={C3S_COLORS.accent} /></View>
        ) : (
          <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={styles.weekRow}>
            {weekDays.map((d, dayIdx) => {
              const iso = toISODate(d);
              const totals = dayTotals(iso);
              return (
                <View key={iso} style={styles.dayColumn}>
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayHeaderName}>{DAY_NAMES[dayIdx]}</Text>
                    <Text style={styles.dayHeaderDate}>{fmtDateShort(d)}</Text>
                  </View>

                  {PRODUCTION_SECTION_ORDER.map((section) => {
                    const rows = itemsByDayAndSection[iso]?.[section] ?? [];
                    return (
                      <View key={section} style={styles.section}>
                        <View style={styles.sectionHeader}>
                          <Text style={styles.sectionTitle}>{PRODUCTION_SECTION_LABELS[section]}</Text>
                          <Pressable
                            style={styles.addBtn}
                            onPress={() => openCreate(section, iso)}
                            accessibilityLabel={`Add row to ${PRODUCTION_SECTION_LABELS[section]}`}>
                            <Text style={styles.addBtnText}>+</Text>
                          </Pressable>
                        </View>

                        {rows.length === 0 ? (
                          <Text style={styles.empty}>—</Text>
                        ) : rows.map((row) => (
                          <BoardCard
                            key={row.id}
                            item={row}
                            profile={
                              profileById.get(row.productId) ?? profileByCode.get(row.productCodeSnapshot ?? '')
                            }
                            onEdit={() => openEdit(row)}
                            onDelete={() => deleteItem(row)}
                            onCycleStatus={() => cycleStatus(row)}
                            onLogEvent={() => setEventModal({ planItem: row })}
                            onSendToRtc={() => sendToRtc(row)}
                          />
                        ))}
                      </View>
                    );
                  })}

                  <View style={styles.totalsBox}>
                    <Text style={styles.totalsTitle}>Grand Total</Text>
                    <View style={styles.totalsRow}>
                      <Totals label="Cases" value={totals.cases.toLocaleString()} />
                      <Totals label="Racks" value={String(totals.racks)} />
                      <Totals label="BTC" value={totals.btc.toFixed(2)} />
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* ─ Edit modal ─ */}
        {editing && (
          <EditRowModal
            draft={editing.item ?? {}}
            isNew={editing.isNew}
            profiles={profiles}
            profilesLoading={profilesLoading}
            onChange={(next) => setEditing((e) => (e ? { ...e, item: { ...e.item, ...next } } : e))}
            onCancel={() => setEditing(null)}
            onSave={saveEditing}
          />
        )}

        {/* ─ Operational event modal ─ */}
        {eventModal && (
          <EventModal
            item={eventModal.planItem}
            onClose={() => setEventModal(null)}
            onSaved={async () => { setEventModal(null); await load(); }}
          />
        )}
      </C3SPage>
    </C3SScreen>
  );
}

// ── BoardCard ───────────────────────────────────────────────────────────────

function BoardCard({
  item, profile, onEdit, onDelete, onCycleStatus, onLogEvent, onSendToRtc,
}: {
  item: WeeklyPlanItem;
  profile?: ProductProfile;
  onEdit: () => void;
  onDelete: () => void;
  onCycleStatus: () => void;
  onLogEvent: () => void;
  onSendToRtc: () => void;
}) {
  const meta = statusMeta(item.boardStatus);
  const currentDepartment = (() => {
    if (item.boardStatus === 'planned' || item.boardStatus === 'rtc') return 'Planning/RTC';
    if (item.boardStatus === 'ready_for_thermal' || item.boardStatus === 'cooking') return 'Thermal';
    if (item.boardStatus === 'awaiting_chill' || item.boardStatus === 'chill_running') return 'Chill';
    if (item.boardStatus === 'ready_for_qa') return 'QA';
    if (item.boardStatus === 'ready_for_packaging') return 'Packaging';
    if (item.boardStatus === 'complete') return 'Complete';
    return 'Planning';
  })();
  const nextStep = (() => {
    if (!item.linkedPrepQueueId) return 'Send to RTC';
    if (item.boardStatus === 'rtc') return 'Start prep in RTC Queue';
    if (item.boardStatus === 'ready_for_thermal') return 'Assign smokehouse + start cook';
    if (item.boardStatus === 'cooking') return 'Run thermal steps and finish cook';
    if (item.boardStatus === 'awaiting_chill') return 'Assign chiller and start chill';
    if (item.boardStatus === 'chill_running') return 'Complete chill and handoff QA';
    if (item.boardStatus === 'ready_for_qa') return 'QA review and release';
    if (item.boardStatus === 'ready_for_packaging') return 'Start packaging';
    if (item.boardStatus === 'complete') return 'No action';
    return 'Review status';
  })();
  const forecast = useMemo(() => {
    if (!profile) return null;
    const start = toSafeDate(item.plannedStartAt) ?? new Date(`${item.plannedDate}T06:00:00`);
    return forecastSchedule({
      profile,
      rackCount: item.plannedRacks,
      plannedStart: start,
    });
  }, [profile, item.plannedStartAt, item.plannedDate, item.plannedRacks]);

  const alreadySent = Boolean(item.linkedPrepQueueId);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardName} numberOfLines={1}>
          {item.description || item.productName}
        </Text>
        <Pressable onPress={onCycleStatus} style={[styles.statusChip, { backgroundColor: meta.color }]}>
          <Text style={styles.statusChipText}>{meta.label}</Text>
        </Pressable>
      </View>

      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>{item.productCodeSnapshot || profile?.productCode || '—'}</Text>
        <Text style={styles.cardMeta}>PO {item.processOrder || '—'}</Text>
      </View>

      <View style={styles.cardStatsRow}>
        <Stat label="Cases" value={(item.cases ?? 0).toLocaleString()} />
        <Stat label="Racks" value={String(item.plannedRacks)} />
        <Stat label="BTC" value={(item.btc ?? 0).toFixed(2)} />
      </View>

      <View style={styles.cardStatsRow}>
        <Stat
          label="Cook"
          value={forecast ? formatForecastTime(forecast.cookEnd) : '—'}
        />
        <Stat
          label="Chill ETA"
          value={forecast ? formatForecastTime(forecast.postThermalEnd) : '—'}
        />
        <Stat
          label="Pack"
          value={forecast ? formatForecastTime(forecast.packagingReadyEta) : '—'}
        />
      </View>

      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>
          SH: {item.assignedSmokehouse || '—'}  •  CH: {item.assignedChiller || '—'}
        </Text>
      </View>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>Current Dept: {currentDepartment}</Text>
      </View>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>Next Step: {nextStep}</Text>
      </View>

      <View style={styles.cardActions}>
        <Pressable style={[styles.cardBtn, alreadySent && styles.cardBtnDisabled]} onPress={onSendToRtc} disabled={alreadySent}>
          <Text style={styles.cardBtnText}>{alreadySent ? 'Sent to RTC' : 'Send to RTC'}</Text>
        </Pressable>
        <Pressable style={styles.cardBtn} onPress={onEdit}>
          <Text style={styles.cardBtnText}>Edit</Text>
        </Pressable>
        <Pressable style={styles.cardBtn} onPress={onLogEvent}>
          <Text style={styles.cardBtnText}>Event</Text>
        </Pressable>
        <Pressable style={[styles.cardBtn, styles.cardBtnDanger]} onPress={onDelete}>
          <Text style={styles.cardBtnText}>×</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Totals({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.totalsStat}>
      <Text style={styles.totalsLabel}>{label}</Text>
      <Text style={styles.totalsValue}>{value}</Text>
    </View>
  );
}

// ── Edit Row Modal ──────────────────────────────────────────────────────────

function EditRowModal({
  draft, isNew, profiles, profilesLoading, onChange, onCancel, onSave,
}: {
  draft: Partial<WeeklyPlanItem>;
  isNew: boolean;
  profiles: ProductProfile[];
  profilesLoading: boolean;
  onChange: (n: Partial<WeeklyPlanItem>) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [productSearch, setProductSearch] = useState('');
  const filteredProfiles = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => {
      const label = `${p.productCode} ${p.productName}`.toLowerCase();
      return label.includes(q);
    });
  }, [profiles, productSearch]);

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onCancel}>
      <View style={styles.modalScrim}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{isNew ? 'Add Production Row' : 'Edit Production Row'}</Text>

          {/* Product picker */}
          <Text style={styles.modalLabel}>Product</Text>
          <TextInput
            value={productSearch}
            onChangeText={setProductSearch}
            placeholder="Search product code or name"
            placeholderTextColor={C3S_COLORS.textMuted}
            style={styles.modalInput}
          />
          {profilesLoading ? (
            <Text style={styles.infoMsg}>Loading product profiles…</Text>
          ) : profiles.length === 0 ? (
            <Text style={styles.error}>No products loaded. Run npm run seed:product-profiles.</Text>
          ) : null}
          <ScrollView style={styles.productPicker} contentContainerStyle={{ paddingVertical: 4 }}>
            {filteredProfiles.map((p) => {
              const selected = draft.productId === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.productOption, selected && styles.productOptionSelected]}
                  onPress={() => onChange({
                    productId: p.id,
                    productName: p.productName,
                    productCodeSnapshot: p.productCode,
                    description: draft.description ?? p.productName,
                    productionSection: draft.productionSection ?? p.productionSection,
                    species: p.species,
                    processType: p.processType,
                    estimatedCookTimeHours: p.estimatedCookTimeHours,
                    estimatedChillTimeHours: p.estimatedChillTimeHours,
                    estimatedBlastCellHours: p.estimatedBlastCellHours,
                    rackCapacity: p.rackCapacity,
                    criticalLimit: p.criticalLimit,
                  })}>
                  <Text style={[styles.productOptionText, selected && styles.productOptionTextSelected]}>
                    {p.productCode}  {p.productName}
                  </Text>
                </Pressable>
              );
            })}
            {profiles.length > 0 && filteredProfiles.length === 0 ? (
              <Text style={styles.empty}>No products match your search.</Text>
            ) : null}
          </ScrollView>

          <View style={styles.modalRow}>
            <ModalField label="Process Order" value={String(draft.processOrder ?? '')}
              onChange={(v) => onChange({ processOrder: v })} />
            <ModalField label="Cases" value={String(draft.cases ?? '')}
              onChange={(v) => onChange({ cases: Number(v) || 0 })} numeric />
          </View>

          <View style={styles.modalRow}>
            <ModalField label="Racks" value={String(draft.plannedRacks ?? '')}
              onChange={(v) => onChange({ plannedRacks: Number(v) || 0 })} numeric />
            <ModalField label="Pieces" value={String(draft.plannedPieces ?? '')}
              onChange={(v) => onChange({ plannedPieces: Number(v) || 0 })} numeric />
            <ModalField label="BTC" value={String(draft.btc ?? '')}
              onChange={(v) => onChange({ btc: Number(v) || 0 })} numeric />
          </View>

          <View style={styles.modalRow}>
            <ModalPicker
              label="Smokehouse"
              value={draft.assignedSmokehouse ?? ''}
              options={['', ...SMOKEHOUSE_IDS]}
              onChange={(v) => onChange({ assignedSmokehouse: v || null })}
            />
            <ModalPicker
              label="Chiller"
              value={draft.assignedChiller ?? ''}
              options={['', ...CHILLER_IDS.map((c) => String(c))]}
              onChange={(v) => onChange({ assignedChiller: v || null })}
            />
            <ModalField label="Priority" value={String(draft.priority ?? 1)}
              onChange={(v) => onChange({ priority: Number(v) || 1 })} numeric />
          </View>

          <ModalField label="Description"
            value={String(draft.description ?? draft.productName ?? '')}
            onChange={(v) => onChange({ description: v })} />

          <ModalField label="Notes" multiline
            value={String(draft.notes ?? '')}
            onChange={(v) => onChange({ notes: v })} />

          <View style={styles.modalActions}>
            <Pressable style={styles.modalBtn} onPress={onCancel}>
              <Text style={styles.modalBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={onSave}>
              <Text style={styles.modalBtnText}>{isNew ? 'Add' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ModalField({
  label, value, onChange, numeric, multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.modalLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        multiline={multiline}
        style={[styles.modalInput, multiline && { minHeight: 60, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

function ModalPicker({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: (string | number)[];
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.modalLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
        {options.map((o) => {
          const v = String(o);
          const selected = v === value;
          return (
            <Pressable
              key={v || 'none'}
              style={[styles.pickerChip, selected && styles.pickerChipSelected]}
              onPress={() => onChange(v)}>
              <Text style={[styles.pickerChipText, selected && styles.pickerChipTextSelected]}>
                {v || '—'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Operational Event Modal ─────────────────────────────────────────────────

function EventModal({
  item, onClose, onSaved,
}: {
  item: WeeklyPlanItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [eventType, setEventType] = useState<OperationalEventType>('delay');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('medium');
  const [operator, setOperator] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!notes.trim()) {
      Alert.alert('Notes required', 'Describe what happened for this event.');
      return;
    }
    setSaving(true);
    try {
      await recordOperationalEvent({
        department: (item.productionSection as any) ?? 'thermal',
        weeklyPlanId: item.id,
        productCode: item.productCodeSnapshot ?? null,
        productName: item.productName,
        type: eventType,
        severity,
        notes: notes.trim(),
        operator: operator.trim() || 'unknown',
      });
      await onSaved();
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View style={styles.modalScrim}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Log Operational Event</Text>
          <Text style={styles.modalSubtitle} numberOfLines={1}>
            {item.description || item.productName}
          </Text>

          <Text style={styles.modalLabel}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
            {(Object.keys(EVENT_TYPE_LABELS) as OperationalEventType[]).map((t) => (
              <Pressable
                key={t}
                style={[styles.pickerChip, t === eventType && styles.pickerChipSelected]}
                onPress={() => setEventType(t)}>
                <Text style={[styles.pickerChipText, t === eventType && styles.pickerChipTextSelected]}>
                  {EVENT_TYPE_LABELS[t]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.modalLabel}>Severity</Text>
          <View style={styles.pickerRow}>
            {(['low', 'medium', 'high'] as const).map((s) => (
              <Pressable
                key={s}
                style={[styles.pickerChip, s === severity && styles.pickerChipSelected]}
                onPress={() => setSeverity(s)}>
                <Text style={[styles.pickerChipText, s === severity && styles.pickerChipTextSelected]}>
                  {s.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>

          <ModalField label="Operator" value={operator} onChange={setOperator} />
          <ModalField label="Notes" value={notes} onChange={setNotes} multiline />

          <View style={styles.modalActions}>
            <Pressable style={styles.modalBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.modalBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={save} disabled={saving}>
              <Text style={styles.modalBtnText}>{saving ? 'Saving…' : 'Record'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const COLUMN_WIDTH = 280;

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 6 },
  navBtn: {
    backgroundColor: C3S_COLORS.panelAlt,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    borderRadius: C3S_RADIUS.button,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  navBtnAccent: { backgroundColor: C3S_COLORS.accent, borderColor: C3S_COLORS.accent },
  navBtnText: { color: C3S_COLORS.textStrong, fontSize: 12, fontWeight: '700' },

  warningBar: {
    borderWidth: 1, borderColor: C3S_COLORS.danger,
    backgroundColor: C3S_COLORS.dangerSoft,
    borderRadius: C3S_RADIUS.card,
    paddingHorizontal: 10, paddingVertical: 8,
    marginBottom: 10,
  },
  warningTitle: { color: C3S_COLORS.danger, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  warningRow: { gap: 6 },
  warningChip: {
    borderRadius: C3S_RADIUS.chip,
    borderWidth: 1, borderColor: C3S_COLORS.danger,
    backgroundColor: C3S_COLORS.dangerSoft,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  warningChipHigh: { borderColor: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft },
  warningChipText: { color: C3S_COLORS.danger, fontSize: 11, fontWeight: '600' },

  error: { color: C3S_COLORS.danger, fontSize: 12, marginBottom: 6 },
  infoMsg: { color: C3S_COLORS.accent, fontSize: 12, marginBottom: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  devPanel: {
    borderWidth: 1,
    borderColor: C3S_COLORS.accent,
    backgroundColor: C3S_COLORS.panelAlt,
    borderRadius: C3S_RADIUS.card,
    padding: 10,
    marginBottom: 10,
    gap: 6,
  },
  devTitle: { color: C3S_COLORS.accent, fontSize: 12, fontWeight: '800' },
  devBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  devBtn: {
    backgroundColor: C3S_COLORS.accentSoft,
    borderWidth: 1,
    borderColor: C3S_COLORS.accent,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  devBtnDanger: { backgroundColor: C3S_COLORS.dangerSoft, borderColor: C3S_COLORS.danger },
  devBtnText: { color: C3S_COLORS.accent, fontSize: 11, fontWeight: '800' },
  devStatus: { color: C3S_COLORS.textMuted, fontSize: 11, fontFamily: 'Menlo' },

  weekRow: { gap: 8, paddingBottom: 12 },
  dayColumn: {
    width: COLUMN_WIDTH,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: C3S_RADIUS.card,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    padding: 8,
    gap: 8,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: C3S_COLORS.accent,
  },
  dayHeaderName: { color: C3S_COLORS.textStrong, fontSize: 16, fontWeight: '800' },
  dayHeaderDate: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '700' },

  section: { gap: 4 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: C3S_COLORS.panelAlt,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
  },
  sectionTitle: { color: C3S_COLORS.textPrimary, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  addBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C3S_COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnText: { color: C3S_COLORS.textStrong, fontSize: 16, fontWeight: '800' },
  empty: { color: C3S_COLORS.textMuted, fontSize: 11, paddingHorizontal: 6, paddingVertical: 4 },

  card: {
    backgroundColor: C3S_COLORS.bg,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    padding: 6,
    gap: 4,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 4,
  },
  cardName: { flex: 1, color: C3S_COLORS.textStrong, fontSize: 12, fontWeight: '700' },
  statusChip: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: C3S_RADIUS.chip,
  },
  statusChipText: { color: '#0D1117', fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },

  cardMetaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  cardMeta: { color: C3S_COLORS.textMuted, fontSize: 10, fontFamily: 'Menlo' },

  cardStatsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  stat: { flex: 1, gap: 1 },
  statLabel: { color: C3S_COLORS.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
  statValue: { color: C3S_COLORS.textPrimary, fontSize: 11, fontWeight: '700' },

  cardActions: { flexDirection: 'row', gap: 4, marginTop: 2 },
  cardBtn: {
    flex: 1,
    paddingVertical: 6,
    backgroundColor: C3S_COLORS.panelAlt,
    borderRadius: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
  },
  cardBtnDisabled: { opacity: 0.55 },
  cardBtnDanger: { flex: 0, paddingHorizontal: 10, backgroundColor: C3S_COLORS.dangerSoft, borderColor: C3S_COLORS.danger },
  cardBtnText: { color: C3S_COLORS.textPrimary, fontSize: 11, fontWeight: '700' },

  totalsBox: {
    backgroundColor: C3S_COLORS.panelAlt,
    borderRadius: 4,
    padding: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: C3S_COLORS.accent,
  },
  totalsTitle: { color: C3S_COLORS.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  totalsStat: { flex: 1 },
  totalsLabel: { color: C3S_COLORS.textMuted, fontSize: 9, fontWeight: '700' },
  totalsValue: { color: C3S_COLORS.textStrong, fontSize: 14, fontWeight: '800' },

  // ── Modal styles ─────────────────────────────────────────────────────────
  modalScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: {
    width: '100%', maxWidth: 720,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: C3S_RADIUS.card,
    borderWidth: 1, borderColor: C3S_COLORS.border,
    padding: 16,
    gap: 8,
    maxHeight: '90%',
  },
  modalTitle: { color: C3S_COLORS.textStrong, fontSize: 18, fontWeight: '800' },
  modalSubtitle: { color: C3S_COLORS.textMuted, fontSize: 12 },
  modalLabel: { color: C3S_COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  modalRow: { flexDirection: 'row', gap: 8 },
  modalInput: {
    borderWidth: 1, borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.bg,
    color: C3S_COLORS.textPrimary,
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 6, fontSize: 13,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  modalBtn: {
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: C3S_COLORS.panelAlt,
    borderRadius: C3S_RADIUS.button,
    borderWidth: 1, borderColor: C3S_COLORS.border,
    minWidth: 88, alignItems: 'center',
  },
  modalBtnPrimary: { backgroundColor: C3S_COLORS.accent, borderColor: C3S_COLORS.accent },
  modalBtnText: { color: C3S_COLORS.textStrong, fontSize: 13, fontWeight: '700' },

  productPicker: {
    maxHeight: 180,
    borderWidth: 1, borderColor: C3S_COLORS.border,
    borderRadius: 6,
    backgroundColor: C3S_COLORS.bg,
  },
  productOption: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C3S_COLORS.border },
  productOptionSelected: { backgroundColor: C3S_COLORS.accentSoft },
  productOptionText: { color: C3S_COLORS.textPrimary, fontSize: 12 },
  productOptionTextSelected: { color: C3S_COLORS.textStrong, fontWeight: '800' },

  pickerRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', paddingVertical: 2 },
  pickerChip: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: C3S_RADIUS.chip,
    borderWidth: 1, borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.bg,
    minWidth: 36, alignItems: 'center',
  },
  pickerChipSelected: { backgroundColor: C3S_COLORS.accent, borderColor: C3S_COLORS.accent },
  pickerChipText: { color: C3S_COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  pickerChipTextSelected: { color: C3S_COLORS.textStrong },
});
