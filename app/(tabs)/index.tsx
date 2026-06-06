import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import {
  getChillLogs,
  getPackagingLogs,
  getPrepQueueItems,
  getQAChecks,
  resetOperationalData,
  getWeeklyPlanItems,
  type ChillLogItem,
  type PackagingLogItem,
  type PrepQueueItem,
  type QACheckItem,
  type WeeklyPlanItem,
} from '@/lib/firebase/repository';
import { getRecentEvents, type OperationalEvent } from '@/lib/operational-events';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import { getOperationalItems, type OItemItem } from '@/lib/operational-items';

type NavRoute = '/planning' | '/prep-queue' | '/thermal' | '/chill' | '/qa-review' | '/packaging';

function ageHours(ms: number) {
  return (Date.now() - ms) / (1000 * 60 * 60);
}

function fmtTs(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

export default function PlantFlowScreen() {
  const [plans, setPlans] = useState<WeeklyPlanItem[]>([]);
  const [preps, setPreps] = useState<PrepQueueItem[]>([]);
  const [chillLogs, setChillLogs] = useState<ChillLogItem[]>([]);
  const [qaChecks, setQaChecks] = useState<QACheckItem[]>([]);
  const [packagingLogs, setPackagingLogs] = useState<PackagingLogItem[]>([]);
  const [events, setEvents] = useState<OperationalEvent[]>([]);
  const [oItems, setOItems] = useState<OItemItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const results = await Promise.allSettled([
      getOperationalItems(),
      getWeeklyPlanItems(),
      getPrepQueueItems(),
      getChillLogs(),
      getQAChecks(),
      getPackagingLogs(),
      getRecentEvents(10),
    ]);
    const [oR, pR, prR, chR, qaR, pkR, evR] = results;
    if (oR.status === 'fulfilled') setOItems(oR.value);
    if (pR.status === 'fulfilled') setPlans(pR.value);
    if (prR.status === 'fulfilled') setPreps(prR.value);
    if (chR.status === 'fulfilled') setChillLogs(chR.value);
    if (qaR.status === 'fulfilled') setQaChecks(qaR.value);
    if (pkR.status === 'fulfilled') setPackagingLogs(pkR.value);
    if (evR.status === 'fulfilled') setEvents(evR.value);
    // Surface the first failure as an error banner
    const firstFail = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstFail) {
      logFirebaseError('PlantFlow', 'operational_items/weekly_plan/prep_queue/chill_logs/qa_checks/packaging_logs', firstFail.reason);
      setLoadError(toOperatorMessage(firstFail.reason, 'Failed to load plant flow data.'));
    }
    setIsLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const summary = useMemo(() => {
    const planning = {
      planned: plans.filter((x) => x.status === 'planned').length,
      rtc: plans.filter((x) => x.status === 'RTC').length,
      thermal: plans.filter((x) => x.status === 'Ready for Thermal').length,
      cooking: plans.filter((x) => x.status === 'Cooking').length,
      chill: plans.filter((x) => x.status === 'Awaiting Chill' || x.status === 'Chill Running').length,
      qa: plans.filter((x) => x.status === 'Ready for QA').length,
      packaging: plans.filter((x) => x.status === 'Ready for Packaging').length,
      complete: plans.filter((x) => x.status === 'Complete').length,
      hold: plans.filter((x) => x.status === 'Hold').length,
    };

    const rtc = {
      sent: oItems.filter((x) => x.stage === 'rtc' && (x.status === 'staged' || x.status === 'staging')).length,
      prep: oItems.filter((x) => x.stage === 'rtc' && x.status === 'prepping').length,
      ready: oItems.filter((x) => x.status === 'ready_for_thermal' || x.status === 'ready').length,
      hold: oItems.filter((x) => x.stage === 'rtc' && x.status === 'hold').length,
      moved: oItems.filter((x) => x.status === 'moved_downstream').length,
    };

    const thermal = {
      readyToLoad: oItems.filter((x) => x.stage === 'thermal' && (x.status === 'ready_for_thermal' || x.status === 'ready')).length,
      assigned: oItems.filter((x) => x.stage === 'thermal' && x.status === 'assigned').length,
      cooking: oItems.filter((x) => x.stage === 'thermal' && (x.status === 'cooking' || x.status === 'in_thermal')).length,
      hold: oItems.filter((x) => x.stage === 'thermal' && x.status === 'hold').length,
    };

    const chill = {
      awaitingAssignment: oItems.filter((x) => x.stage === 'chill' && x.status === 'awaiting_chill').length,
      running: oItems.filter((x) => x.stage === 'chill' && x.status === 'in_chill').length,
      readyForQa: oItems.filter((x) => x.status === 'ready_for_qa').length,
      hold: oItems.filter((x) => x.stage === 'chill' && (x.status === 'hold' || x.chillLogStatus === 'deviation')).length,
    };

    const qa = {
      ready: oItems.filter((x) => x.stage === 'qa' && x.status === 'ready_for_qa').length,
      hold: oItems.filter((x) => x.stage === 'qa' && (x.status === 'qa_hold' || x.status === 'qa_review_required')).length,
      released: oItems.filter((x) => x.status === 'ready_for_packaging').length,
      deviation: oItems.filter((x) => x.stage === 'qa' && x.hasDeviation).length,
    };

    const packaging = {
      ready: oItems.filter((x) => x.stage === 'packaging' && x.status === 'ready_for_packaging').length,
      inProgress: oItems.filter((x) => x.stage === 'packaging' && x.status === 'packaging_in_progress').length,
      packaged: oItems.filter((x) => x.status === 'packaging_complete' || x.status === 'complete').length,
      hold: oItems.filter((x) => x.stage === 'packaging' && (x.status === 'hold' || x.packagingLogStatus === 'deviation')).length,
    };

    return { planning, rtc, thermal, chill, qa, packaging };
  }, [plans, preps, chillLogs, qaChecks, packagingLogs, oItems]);

  const stuckItems = useMemo(() => {
    const items: string[] = [];

    oItems.forEach((p) => {
      const startMs = p.startTime?.toMillis?.() ?? 0;
      const cookStartMs = p.cookStartedAt?.toMillis?.() ?? startMs;
      const hFromStart = ageHours(startMs);
      const hFromCook = ageHours(cookStartMs);
      const cookExpectedH = ((p.expectedCookMinutes ?? 0) / 60) + 1;

      if ((p.status === 'staged' || p.status === 'staging') && hFromStart > 4) items.push(`${p.productNameSnapshot || p.productName}: RTC staged > 4h`);
      if (p.status === 'prepping' && hFromStart > 4) items.push(`${p.productNameSnapshot || p.productName}: In Prep > 4h`);
      if ((p.status === 'ready_for_thermal' || p.status === 'ready') && hFromStart > 2) items.push(`${p.productNameSnapshot || p.productName}: Ready for Thermal > 2h`);
      if ((p.status === 'cooking' || p.status === 'in_thermal') && hFromCook > cookExpectedH) {
        items.push(`${p.productNameSnapshot || p.productName}: Cooking beyond expected (${cookExpectedH.toFixed(1)}h)`);
      }
    });

    oItems.forEach((log) => {
      const created = log.chillCreatedAt?.toMillis?.() ?? log.updatedAt?.toMillis?.() ?? 0;
      const h = ageHours(created);
      const expectedH = ((log.expectedChillMinutes ?? 0) / 60) + 1;
      if (log.status === 'in_chill' && h > expectedH) {
        items.push(`${log.productName || log.id}: Chill Running beyond expected (${expectedH.toFixed(1)}h)`);
      }
    });

    oItems.forEach((q) => {
      const ts = q.updatedAt?.toMillis?.() ?? 0;
      if (q.status === 'ready_for_qa' && ageHours(ts) > 2) items.push(`${q.productName || q.id}: Ready for QA > 2h`);
      if (q.status === 'ready_for_packaging' && ageHours(ts) > 4) items.push(`${q.productName || q.id}: Ready for Packaging > 4h`);
    });

    return items.slice(0, 20);
  }, [oItems]);

  const missingActions = useMemo(() => {
    const items: string[] = [];

    oItems.forEach((p) => {
      if ((p.status === 'ready_for_thermal' || p.status === 'ready') && !p.assignedSmokehouse) {
        items.push(`${p.productNameSnapshot || p.productName}: Ready for Thermal with no smokehouse`);
      }
      if ((p.status === 'cooking' || p.status === 'in_thermal') && !p.criticalTempReachedAt) {
        items.push(`${p.productNameSnapshot || p.productName}: Cooking with no probe-out/critical temp`);
      }
    });

    oItems.forEach((log) => {
      if (log.stage === 'chill' && log.status === 'awaiting_chill' && !log.chillerId) {
        items.push(`${log.productName || log.id}: Cook complete with no chiller assigned`);
      }
      if (log.stage === 'chill' && log.status === 'in_chill' && (log.timeTo50F == null || log.timeTo40F == null)) {
        items.push(`${log.productName || log.id}: Chill running with no next check due`);
      }
    });

    oItems.forEach((q) => {
      if (q.status === 'ready_for_qa' && !q.qaReviewedBy) {
        items.push(`${q.productName || q.id}: Ready for QA with no reviewer`);
      }
      if (q.status === 'ready_for_packaging') {
        const started = q.packagingLogStatus === 'running';
        if (!started) items.push(`${q.productName || q.id}: Ready for Packaging with no packaging start`);
      }
    });

    return items.slice(0, 20);
  }, [oItems]);

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader
          title="Plant Flow"
          subtitle="Supervisor command center: cross-department visibility"
          right={<Pressable style={styles.refreshBtn} onPress={load}><Text style={styles.refreshText}>Refresh</Text></Pressable>}
        />

        <ScrollView contentContainerStyle={styles.content}>
          {__DEV__ ? (
            <C3SCard borderColor="#C62828">
              <Text style={styles.devTitle}>DEV ONLY — deletes operational test data</Text>
              <Text style={styles.rowText}>
                Clears: weekly_plan, prep_queue, chill_logs, qa_checks, packaging_logs, operational_events, alerts.
              </Text>
              <Text style={styles.rowText}>
                Preserves: product_profiles, app config, product intelligence data. Equipment definitions are preserved.
              </Text>
              {confirmReset ? (
                <View style={styles.devActions}>
                  <Pressable
                    style={styles.devDangerBtn}
                    disabled={isResetting}
                    onPress={async () => {
                      try {
                        setIsResetting(true);
                        setResetMessage(null);
                        await resetOperationalData({ clearEquipmentLoads: true });
                        setResetMessage('Reset complete: operational data cleared and equipment loads reset.');
                        setConfirmReset(false);
                        await load();
                      } catch (e) {
                        setResetMessage(toOperatorMessage(e, 'Reset failed.'));
                      } finally {
                        setIsResetting(false);
                      }
                    }}>
                    <Text style={styles.devDangerBtnText}>{isResetting ? 'Resetting...' : 'Confirm Reset Operational Data'}</Text>
                  </Pressable>
                  <Pressable style={styles.devCancelBtn} onPress={() => setConfirmReset(false)} disabled={isResetting}>
                    <Text style={styles.devCancelBtnText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.devDangerBtn} onPress={() => setConfirmReset(true)}>
                  <Text style={styles.devDangerBtnText}>Reset Operational Data</Text>
                </Pressable>
              )}
              {resetMessage ? <Text style={styles.info}>{resetMessage}</Text> : null}
            </C3SCard>
          ) : null}
          {isLoading ? <Text style={styles.info}>Loading plant flow...</Text> : null}
          {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

          <Text style={styles.sectionTitle}>Department Flow Summary</Text>
          <View style={styles.grid}>
            <SummaryCard title="Planning" route="/planning" rows={[
              `Planned: ${summary.planning.planned}`,
              `Sent to RTC: ${summary.planning.rtc}`,
              `Ready for Thermal: ${summary.planning.thermal}`,
              `Cooking: ${summary.planning.cooking}`,
              `Awaiting/Running Chill: ${summary.planning.chill}`,
              `Ready for QA: ${summary.planning.qa}`,
              `Ready for Packaging: ${summary.planning.packaging}`,
              `Complete/Hold: ${summary.planning.complete}/${summary.planning.hold}`,
            ]} onGo={() => router.push('/planning')} />
            <SummaryCard title="RTC" route="/prep-queue" rows={[
              `Sent from Planning: ${summary.rtc.sent}`,
              `In Prep: ${summary.rtc.prep}`,
              `Ready for Thermal: ${summary.rtc.ready}`,
              `Moved Downstream: ${summary.rtc.moved}`,
              `Hold: ${summary.rtc.hold}`,
            ]} onGo={() => router.push('/prep-queue')} />
            <SummaryCard title="Thermal" route="/thermal" rows={[
              `Ready to Load: ${summary.thermal.readyToLoad}`,
              `Assigned: ${summary.thermal.assigned}`,
              `Cooking: ${summary.thermal.cooking}`,
              `Hold: ${summary.thermal.hold}`,
            ]} onGo={() => router.push('/thermal')} />
            <SummaryCard title="Chill" route="/chill" rows={[
              `Awaiting Chiller Assignment: ${summary.chill.awaitingAssignment}`,
              `Chill Running: ${summary.chill.running}`,
              `Ready for QA: ${summary.chill.readyForQa}`,
              `Hold/Deviation: ${summary.chill.hold}`,
            ]} onGo={() => router.push('/chill')} />
            <SummaryCard title="QA" route="/qa-review" rows={[
              `Ready for Review: ${summary.qa.ready}`,
              `QA Hold: ${summary.qa.hold}`,
              `Released to Packaging: ${summary.qa.released}`,
              `Deviation Logged: ${summary.qa.deviation}`,
            ]} onGo={() => router.push('/qa-review')} />
            <SummaryCard title="Packaging" route="/packaging" rows={[
              `Ready for Packaging: ${summary.packaging.ready}`,
              `Packaging In Progress: ${summary.packaging.inProgress}`,
              `Packaged: ${summary.packaging.packaged}`,
              `Hold/Deviation: ${summary.packaging.hold}`,
            ]} onGo={() => router.push('/packaging')} />
          </View>

          <Text style={styles.sectionTitle}>Stuck Items</Text>
          <ListCard empty="No stuck items currently.">
            {stuckItems.map((x) => <Text key={x} style={styles.rowText}>• {x}</Text>)}
          </ListCard>

          <Text style={styles.sectionTitle}>Missing Required Actions</Text>
          <ListCard empty="No missing required actions currently.">
            {missingActions.map((x) => <Text key={x} style={styles.rowText}>• {x}</Text>)}
          </ListCard>

          <Text style={styles.sectionTitle}>Latest Operational Events</Text>
          <ListCard empty="No operational events available.">
            {events.slice(0, 10).map((e) => (
              <View key={e.id} style={styles.eventRow}>
                <Text style={styles.eventTime}>{fmtTs(e.createdAt?.toMillis?.())}</Text>
                <Text style={styles.eventMeta}>{`${e.type} | ${e.department} | ${e.severity}`}</Text>
                <Text style={styles.rowText}>{e.notes || '—'}</Text>
              </View>
            ))}
          </ListCard>
        </ScrollView>
      </C3SPage>
    </C3SScreen>
  );
}

function SummaryCard({ title, rows, onGo }: { title: string; route: NavRoute; rows: string[]; onGo: () => void }) {
  return (
    <C3SCard borderColor="#2F6D8A">
      <Text style={styles.cardTitle}>{title}</Text>
      {rows.map((r) => <Text key={`${title}-${r}`} style={styles.rowText}>{r}</Text>)}
      <Pressable style={styles.goBtn} onPress={onGo}>
        <Text style={styles.goBtnText}>Go to {title}</Text>
      </Pressable>
    </C3SCard>
  );
}

function ListCard({ children, empty }: { children: React.ReactNode; empty: string }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <C3SCard borderColor="#30363D">
      {hasChildren ? children : <Text style={styles.empty}>{empty}</Text>}
    </C3SCard>
  );
}

const styles = StyleSheet.create({
  content: { gap: 8, paddingBottom: 24 },
  devTitle: { color: '#FFB4B4', fontSize: 12, fontWeight: '800', marginBottom: 4 },
  devActions: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  devDangerBtn: {
    borderWidth: 1,
    borderColor: '#C62828',
    backgroundColor: '#2A1414',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  devDangerBtnText: { color: '#FFB4B4', fontSize: 12, fontWeight: '700' },
  devCancelBtn: {
    borderWidth: 1,
    borderColor: '#455A64',
    backgroundColor: '#1A2430',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  devCancelBtnText: { color: '#C9D1D9', fontSize: 12, fontWeight: '700' },
  refreshBtn: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshText: { color: '#E6EDF3', fontSize: 12, fontWeight: '700' },
  sectionTitle: { color: '#8AB4F8', fontSize: 13, fontWeight: '800', marginTop: 4 },
  grid: { gap: 8 },
  cardTitle: { color: '#E6EDF3', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  rowText: { color: '#AAB4BE', fontSize: 12, marginBottom: 2 },
  eventRow: { borderTopWidth: 1, borderTopColor: '#30363D', paddingTop: 6, marginTop: 6 },
  eventTime: { color: '#8B949E', fontSize: 11, fontFamily: 'Menlo' },
  eventMeta: { color: '#9FD3FF', fontSize: 11, fontWeight: '700' },
  goBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2F6D8A',
    backgroundColor: '#13314A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  goBtnText: { color: '#E6EDF3', fontSize: 12, fontWeight: '700' },
  info: { color: '#8B949E', fontSize: 12 },
  error: { color: '#FF7B72', fontSize: 12, fontWeight: '700' },
  empty: { color: '#8B949E', fontSize: 12 },
});
