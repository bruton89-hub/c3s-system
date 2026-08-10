import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { type Href, router } from 'expo-router';

import { C3SBrandHeader } from '@/components/c3s-brand';
import { ProductionItemCard } from '@/components/production-item-card';
import { C3SPage, C3SScreen } from '@/components/c3s-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { getOperationalItems, type OItemItem } from '@/lib/operational-items';
import { getProductionAlert, sortProductionItems, type ProductionAlert } from '@/lib/production/presentation';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import { atRiskItems, equipmentCounts, recentlyCompleted, shiftFlowCounts, shiftSummary, type EquipmentSummary } from '@/lib/operations/summary';
import { getEquipmentOverview } from '@/lib/operations/equipment';
import { StressScenarioBanner } from '@/components/stress-scenario-banner';
import { DataFreshness } from '@/components/data-freshness';

export default function HomeScreen() {
  const [items, setItems] = useState<OItemItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<EquipmentSummary[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextItems = await getOperationalItems();
      setItems(nextItems);
      setRefreshedAt(Date.now());
      try { setEquipment(await getEquipmentOverview(nextItems)); } catch { setEquipment([]); }
    } catch (err) {
      logFirebaseError('Home', 'operational_items', err);
      setError(toOperatorMessage(err, 'Production status could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const active = useMemo(() => sortProductionItems(items.filter((item) => !['complete', 'packaging_complete', 'split_parent'].includes(item.status))), [items]);
  const alerts = useMemo(() => active.map((item) => getProductionAlert(item)).filter((alert): alert is ProductionAlert => Boolean(alert)), [active]);
  const upNext = active.filter((item) => ['ready', 'ready_for_thermal', 'awaiting_chill', 'chill_complete', 'ready_for_qa', 'ready_for_packaging'].includes(item.status)).slice(0, 4);
  const summary = useMemo(() => shiftSummary(items), [items]);
  const flow = useMemo(() => shiftFlowCounts(active), [active]);
  const risk = useMemo(() => atRiskItems(active, 4), [active]);
  const completed = useMemo(() => recentlyCompleted(items, 3), [items]);
  const equipmentSummary = useMemo(() => equipmentCounts(equipment), [equipment]);

  return (
    <C3SScreen>
      <C3SPage>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C3S_COLORS.accent} />}
          contentContainerStyle={styles.content}>
          <C3SBrandHeader title="Home" subtitle="What needs to happen next" />
          <StressScenarioBanner />
          <DataFreshness refreshedAt={refreshedAt} failed={Boolean(error)} />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.sectionTitle}>Shift Status</Text>
          <View style={styles.summaryRow}>
            <Summary value={summary.active} label="Active" tone="blue" />
            <Summary value={summary.waiting} label="Waiting" tone="amber" />
            <Summary value={summary.held} label="Held" tone="red" />
            <Summary value={summary.critical} label="Critical" tone="red" />
            <Summary value={equipmentSummary.inUse} label="Equipment In Use" tone="blue" />
            <Summary value={equipmentSummary.available} label="Available" tone="blue" />
          </View>

          <Text style={styles.sectionTitle}>Shift Progress</Text>
          <View style={styles.progressCard}>{(['planning', 'rtc', 'thermal', 'chill', 'qa', 'packaging'] as const).map((stage) => <View key={stage} style={styles.progressItem}><Text style={styles.progressValue}>{flow[stage]}</Text><Text style={styles.progressLabel}>{stage === 'planning' ? 'Prep' : stage.toUpperCase()}</Text></View>)}</View>

          <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>At Risk</Text><Pressable hitSlop={8} onPress={() => router.push('/notifications')}><Text style={styles.link}>View alerts</Text></Pressable></View>
          {risk.map((item) => <ProductionItemCard key={`risk-${item.id}`} item={item} compact />)}
          {!loading && risk.length === 0 ? <Empty text="All active batches are on track." /> : null}

          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Needs Attention</Text>
            <Pressable hitSlop={8} onPress={() => router.push('/notifications')}><Text style={styles.link}>View all</Text></Pressable>
          </View>
          {alerts.slice(0, 3).map((alert) => <AttentionCard key={alert.id} alert={alert} />)}
          {!loading && alerts.length === 0 ? <Empty text="No production exceptions right now." /> : null}

          <Text style={styles.sectionTitle}>Up Next</Text>
          {upNext.map((item) => <ProductionItemCard key={item.id} item={item} compact />)}
          {!loading && upNext.length === 0 ? <Empty text="No handoffs are waiting." /> : null}

          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Active Production</Text>
            <Text style={styles.sectionCount}>{active.length}</Text>
          </View>
          {active.slice(0, 5).map((item) => <ProductionItemCard key={item.id} item={item} compact />)}
          {!loading && active.length === 0 ? <Empty text="No active production items." /> : null}

          <Text style={styles.sectionTitle}>Recently Completed</Text>
          {completed.map((item) => <ProductionItemCard key={`completed-${item.id}`} item={item} compact />)}
          {!loading && completed.length === 0 ? <Empty text="No recently completed batches." /> : null}

          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickGrid}>
            <QuickAction label="Create / Load Batch" route="/planning" />
            <QuickAction label="View Holds" route="/holds" />
            <QuickAction label="Critical Alerts" route="/notifications?filter=critical" />
            <QuickAction label="Available Equipment" route="/equipment" />
            <QuickAction label="Shift Handoff" route="/shift-handoff" />
          </View>

          <Pressable style={styles.primaryButton} onPress={() => router.push('/production' as Href)}>
            <Text style={styles.primaryButtonText}>View Production</Text>
          </Pressable>
        </ScrollView>
      </C3SPage>
    </C3SScreen>
  );
}

function Summary({ value, label, tone }: { value: number; label: string; tone: 'blue' | 'amber' | 'red' }) {
  const color = tone === 'red' ? C3S_COLORS.danger : tone === 'amber' ? C3S_COLORS.warning : C3S_COLORS.accent;
  return <View style={styles.summary}><Text style={[styles.summaryValue, { color }]}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

function AttentionCard({ alert }: { alert: ProductionAlert }) {
  const critical = alert.severity === 'critical';
  const color = critical ? C3S_COLORS.danger : C3S_COLORS.warning;
  return (
    <Pressable style={[styles.attention, { borderLeftColor: color }]} onPress={() => router.push(`/production-item?id=${encodeURIComponent(alert.itemId)}` as Href)}>
      <View style={styles.attentionTop}><Text style={[styles.attentionLabel, { color }]}>{critical ? 'ACTION REQUIRED' : 'NEEDS ATTENTION'}</Text><Text style={styles.chevron}>›</Text></View>
      <Text style={styles.attentionTitle}>{alert.title}</Text>
      <Text style={styles.attentionMessage}>{alert.message}</Text>
    </Pressable>
  );
}

function Empty({ text }: { text: string }) { return <View style={styles.empty}><Text style={styles.emptyText}>{text}</Text></View>; }
function QuickAction({ label, route }: { label: string; route: string }) { return <Pressable style={styles.quickAction} onPress={() => router.push(route as Href)}><Text style={styles.quickActionText}>{label}</Text><Text style={styles.quickChevron}>›</Text></Pressable>; }

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 1080, alignSelf: 'center', gap: 11, paddingBottom: 32 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 5 },
  sectionTitle: { color: C3S_COLORS.textStrong, fontSize: 21, fontWeight: '900', marginTop: 5 },
  sectionCount: { color: C3S_COLORS.textMuted, fontSize: 15, fontWeight: '800' },
  link: { color: C3S_COLORS.accent, fontSize: 15, fontWeight: '900' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  summary: { flex: 1, minWidth: 82, minHeight: 98, borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel, borderRadius: 14, padding: 12, justifyContent: 'center' },
  summaryValue: { fontSize: 30, lineHeight: 34, fontWeight: '900' },
  summaryLabel: { color: C3S_COLORS.textMuted, fontSize: 12, lineHeight: 15, fontWeight: '800', marginTop: 3 },
  progressCard: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: C3S_COLORS.navy, borderRadius: 14, padding: 12 },
  progressItem: { minWidth: 72, flex: 1, alignItems: 'center', paddingVertical: 5 },
  progressValue: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  progressLabel: { color: '#A9C7EC', fontSize: 10, fontWeight: '900', marginTop: 2 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  quickAction: { minHeight: 52, minWidth: 155, flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel, borderRadius: 12, paddingHorizontal: 13 },
  quickActionText: { color: C3S_COLORS.textStrong, fontSize: 14, fontWeight: '900', flexShrink: 1 },
  quickChevron: { color: C3S_COLORS.accent, fontSize: 25, fontWeight: '700' },
  attention: { backgroundColor: C3S_COLORS.panel, borderWidth: 1, borderColor: C3S_COLORS.border, borderLeftWidth: 5, borderRadius: 14, padding: 14 },
  attentionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  attentionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  attentionTitle: { color: C3S_COLORS.textStrong, fontSize: 17, fontWeight: '900', marginTop: 5 },
  attentionMessage: { color: C3S_COLORS.textMuted, fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 3 },
  chevron: { color: C3S_COLORS.textMuted, fontSize: 26, lineHeight: 26 },
  empty: { borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel, borderRadius: 14, padding: 17 },
  emptyText: { color: C3S_COLORS.textMuted, fontSize: 14, fontWeight: '700' },
  primaryButton: { minHeight: 56, backgroundColor: C3S_COLORS.accent, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 7 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  error: { color: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft, borderRadius: 10, padding: 12, fontSize: 14, fontWeight: '700' },
});
