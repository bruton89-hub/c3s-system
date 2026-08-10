import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { type Href, router, useLocalSearchParams } from 'expo-router';

import { C3SBrandHeader } from '@/components/c3s-brand';
import { C3SDisclosure, C3SPrimaryAction } from '@/components/operator-ui';
import { C3SPage, C3SScreen } from '@/components/c3s-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { useAuth } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { ALERT_PERSISTENCE_ENABLED } from '@/lib/alerts/config';
import {
  acknowledgeAlert,
  getAlertEvents,
  getPersistentAlerts,
  syncPersistentAlerts,
  type PersistentAlert,
  type PersistentAlertEvent,
} from '@/lib/alerts/repository';
import { getOperationalItems, type OItemItem } from '@/lib/operational-items';
import { getItemPresentation, getProductionAlerts, itemBatch, itemName, type ProductionAlert } from '@/lib/production/presentation';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import { StressScenarioBanner } from '@/components/stress-scenario-banner';
import { getActiveStressScenario } from '@/lib/stress/scenarios';
import { DataFreshness } from '@/components/data-freshness';

type Filter = 'open' | 'acknowledged' | 'critical' | 'thermal' | 'chill' | 'qa' | 'equipment' | 'holds' | 'resolved' | 'all';
type AlertView = ProductionAlert & {
  lifecycle: 'open' | 'acknowledged' | 'resolved';
  acknowledgedAt?: number;
  acknowledgedByName?: string | null;
  resolvedAt?: number;
  resolvedByName?: string | null;
  resolutionReason?: string | null;
  occurrence?: number;
};

const filters: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'acknowledged', label: 'Acknowledged' }, { key: 'critical', label: 'Critical' },
  { key: 'thermal', label: 'Thermal' }, { key: 'chill', label: 'Chill' }, { key: 'qa', label: 'QA' },
  { key: 'equipment', label: 'Equipment' }, { key: 'holds', label: 'Holds' }, { key: 'resolved', label: 'Resolved' }, { key: 'all', label: 'All' },
];
const rank = { critical: 0, warning: 1, info: 2 } as const;

function timeMs(value: { toMillis?: () => number } | null | undefined): number { return value?.toMillis?.() ?? 0; }
function ageLabel(timestamp: number): string {
  if (!timestamp) return 'Time unavailable';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60); const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export default function AlertsScreen() {
  const params = useLocalSearchParams<{ filter?: string }>();
  const { profile } = useAuth();
  const [items, setItems] = useState<OItemItem[]>([]);
  const [persisted, setPersisted] = useState<PersistentAlert[]>([]);
  const [events, setEvents] = useState<Record<string, PersistentAlertEvent[]>>({});
  const [filter, setFilter] = useState<Filter>(filters.some((entry) => entry.key === params.filter) ? params.filter as Filter : 'open');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const nextItems = await getOperationalItems();
      setItems(nextItems);
      setRefreshedAt(Date.now());
      if (ALERT_PERSISTENCE_ENABLED && profile?.active) {
        await syncPersistentAlerts(nextItems, profile.name, can(profile, 'resolveHold'));
        const nextAlerts = await getPersistentAlerts();
        setPersisted(nextAlerts);
        const eventPairs = await Promise.all(nextAlerts.map(async (alert) => [alert.id, await getAlertEvents(alert.id)] as const));
        setEvents(Object.fromEntries(eventPairs));
      }
    } catch (err) {
      logFirebaseError('Alerts', 'alerts', err);
      setError(toOperatorMessage(err, 'Alerts could not be refreshed. Previous information is preserved.'));
    } finally { setLoading(false); }
  }, [profile]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const alerts = useMemo<AlertView[]>(() => {
    if (!ALERT_PERSISTENCE_ENABLED) {
      const acknowledged = new Set(getActiveStressScenario()?.simulatedAcknowledgedAlertIds ?? []);
      return items.flatMap((item) => getProductionAlerts(item)).map((alert) => acknowledged.has(alert.id) ? { ...alert, lifecycle: 'acknowledged' as const, acknowledgedByName: 'Outgoing Shift', acknowledgedAt: alert.timestamp + 60000 } : alert);
    }
    const byId = new Map(items.map((item) => [item.id, item]));
    return persisted.flatMap((alert) => {
      const item = byId.get(alert.itemId); if (!item) return [];
      const presentation = getItemPresentation(item); const timestamp = timeMs(alert.firstDetectedAt);
      return [{
        id: alert.id, itemId: item.id, conditionKey: alert.conditionKey, category: alert.category,
        severity: alert.severity, title: alert.title, message: alert.message, timestamp,
        age: ageLabel(timestamp), batch: itemBatch(item), product: itemName(item), stage: presentation.stage,
        currentStatus: presentation.status, actionLabel: presentation.nextAction,
        actionRoute: `${presentation.route}?itemId=${encodeURIComponent(item.id)}` as Href,
        lifecycle: alert.status, acknowledgedAt: timeMs(alert.acknowledgedAt),
        acknowledgedByName: alert.acknowledgedByName, resolvedAt: timeMs(alert.resolvedAt),
        resolvedByName: alert.resolvedByName, resolutionReason: alert.resolutionReason, occurrence: alert.occurrence,
      }];
    });
  }, [items, persisted]);

  const visible = useMemo(() => alerts
    .filter((alert) => filter === 'all' || filter === 'critical' ? filter === 'all' || alert.severity === 'critical' : filter === 'holds' ? alert.category === 'hold' : ['thermal', 'chill', 'qa', 'equipment'].includes(filter) ? alert.category === filter : alert.lifecycle === filter)
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.timestamp - b.timestamp), [alerts, filter]);

  async function onAcknowledge(alert: AlertView) {
    if (!profile || !can(profile, 'acknowledgeAlert')) return;
    setSavingId(alert.id); setError(null);
    try { await acknowledgeAlert(alert.id, profile.name); await load(); }
    catch (err) { setError(toOperatorMessage(err, 'Acknowledgement was not saved. Try again.')); }
    finally { setSavingId(null); }
  }

  return (
    <C3SScreen><C3SPage>
      <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C3S_COLORS.accent} />} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <C3SBrandHeader title="Alerts" subtitle="Production exceptions that need a response" />
        <StressScenarioBanner />
        <DataFreshness refreshedAt={refreshedAt} failed={Boolean(error)} />
        <View style={styles.filters}>{filters.map(({ key, label }) => (
          <Pressable key={key} style={[styles.filter, key === filter && styles.filterSelected]} onPress={() => setFilter(key)}><Text style={[styles.filterText, key === filter && styles.filterTextSelected]}>{label}</Text></Pressable>
        ))}</View>
        {!ALERT_PERSISTENCE_ENABLED ? <Text style={styles.notice}>Lifecycle writes are disabled in this environment. Current conditions remain read-only and appear as Open.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {visible.map((alert) => <AlertCard key={alert.id} alert={alert} audit={events[alert.id] ?? []} canAcknowledge={can(profile, 'acknowledgeAlert')} saving={savingId === alert.id} onAcknowledge={() => onAcknowledge(alert)} />)}
        {!loading && visible.length === 0 ? <View style={styles.clear}><Text style={styles.clearIcon}>✓</Text><Text style={styles.clearTitle}>No {filter === 'all' ? '' : filter} alerts</Text><Text style={styles.clearText}>Production exceptions will appear here automatically.</Text></View> : null}
      </ScrollView>
    </C3SPage></C3SScreen>
  );
}

function AlertCard({ alert, audit, canAcknowledge, saving, onAcknowledge }: { alert: AlertView; audit: PersistentAlertEvent[]; canAcknowledge: boolean; saving: boolean; onAcknowledge: () => void }) {
  const color = alert.severity === 'critical' ? C3S_COLORS.danger : alert.severity === 'warning' ? C3S_COLORS.warning : C3S_COLORS.info;
  const bg = alert.severity === 'critical' ? C3S_COLORS.dangerSoft : alert.severity === 'warning' ? C3S_COLORS.warningSoft : C3S_COLORS.infoSoft;
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.cardTop}><View style={styles.chipRow}><View style={[styles.severity, { backgroundColor: bg }]}><Text style={[styles.severityText, { color }]}>{alert.severity.toUpperCase()}</Text></View><View style={styles.statusChip}><Text style={styles.statusChipText}>{alert.lifecycle.toUpperCase()}</Text></View>{(alert.occurrence ?? 1) > 1 ? <View style={styles.recurringChip}><Text style={styles.recurringText}>RECURRING ×{alert.occurrence}</Text></View> : null}</View><Text style={styles.age}>{alert.age}</Text></View>
      <Text style={styles.batch}>Batch {alert.batch}</Text><Text style={styles.product} numberOfLines={2}>{alert.product}</Text>
      <Text style={[styles.title, { color }]}>{alert.title}</Text><Text style={styles.message}>{alert.message}</Text>
      <View style={styles.contextRow}><View style={styles.contextCell}><Text style={styles.contextLabel}>CURRENT STAGE</Text><Text style={styles.contextValue}>{alert.stage}</Text></View><View style={styles.contextCell}><Text style={styles.contextLabel}>STATUS</Text><Text style={styles.contextValue}>{alert.currentStatus}</Text></View></View>
      {alert.lifecycle !== 'resolved' ? <C3SPrimaryAction label={alert.actionLabel} onPress={() => router.push(alert.actionRoute)} /> : null}
      <View style={styles.secondaryRow}>
        <Pressable style={styles.secondary} onPress={() => router.push(`/production-item?id=${encodeURIComponent(alert.itemId)}` as Href)}><Text style={styles.secondaryText}>Open Batch</Text></Pressable>
        {alert.lifecycle === 'open' && ALERT_PERSISTENCE_ENABLED ? <Pressable disabled={!canAcknowledge || saving} style={[styles.secondary, (!canAcknowledge || saving) && styles.disabled]} onPress={onAcknowledge}><Text style={styles.secondaryText}>{saving ? 'Saving…' : 'Acknowledge'}</Text></Pressable> : null}
      </View>
      <C3SDisclosure title="View Details" count={audit.length}>
        {alert.acknowledgedAt ? <AuditLine label="Acknowledged" actor={alert.acknowledgedByName} at={alert.acknowledgedAt} /> : null}
        {alert.resolvedAt ? <AuditLine label="Resolved" actor={alert.resolvedByName} at={alert.resolvedAt} /> : null}
        {alert.resolutionReason ? <Text style={styles.auditText}>{alert.resolutionReason}</Text> : null}
        {audit.map((event) => <AuditLine key={event.id} label={event.action.replaceAll('_', ' ')} actor={event.actorName} at={timeMs(event.at)} />)}
        {!audit.length ? <Text style={styles.auditText}>No persisted audit events in this environment.</Text> : null}
      </C3SDisclosure>
    </View>
  );
}

function AuditLine({ label, actor, at }: { label: string; actor?: string | null; at: number }) { return <View style={styles.auditRow}><Text style={styles.auditLabel}>{label}</Text><Text style={styles.auditText}>{actor || 'System'} • {at ? new Date(at).toLocaleString() : 'Time pending'}</Text></View>; }

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 1080, alignSelf: 'center', gap: 11, paddingBottom: 32 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, filter: { minWidth: 132, flexGrow: 1, minHeight: 46, paddingHorizontal: 12, borderWidth: 1, borderColor: C3S_COLORS.border, borderRadius: 999, backgroundColor: C3S_COLORS.panel, alignItems: 'center', justifyContent: 'center' },
  filterSelected: { backgroundColor: C3S_COLORS.accent, borderColor: C3S_COLORS.accent }, filterText: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '800' }, filterTextSelected: { color: '#FFFFFF' },
  notice: { color: C3S_COLORS.textMuted, backgroundColor: C3S_COLORS.infoSoft, borderRadius: 10, padding: 10, fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: C3S_COLORS.panel, borderWidth: 1, borderColor: C3S_COLORS.border, borderLeftWidth: 5, borderRadius: 14, padding: 15, gap: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flexShrink: 1 },
  severity: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }, severityText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  statusChip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: C3S_COLORS.panelAlt }, statusChipText: { color: C3S_COLORS.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  recurringChip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: C3S_COLORS.infoSoft }, recurringText: { color: C3S_COLORS.info, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  age: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '800', flexShrink: 0 }, batch: { color: C3S_COLORS.textStrong, fontSize: 20, fontWeight: '900', marginTop: 8 },
  product: { color: C3S_COLORS.textMuted, fontSize: 14, fontWeight: '700' }, title: { fontSize: 16, fontWeight: '900', marginTop: 7 }, message: { color: C3S_COLORS.textMuted, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  contextRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, backgroundColor: C3S_COLORS.panelAlt, borderRadius: 10, padding: 11, marginVertical: 8 }, contextCell: { minWidth: 120, flex: 1 }, contextLabel: { color: C3S_COLORS.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 }, contextValue: { color: C3S_COLORS.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 2 },
  secondaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }, secondary: { minHeight: 48, minWidth: 130, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C3S_COLORS.accent, borderRadius: 10 }, secondaryText: { color: C3S_COLORS.accent, fontSize: 14, fontWeight: '900' }, disabled: { opacity: 0.45 },
  auditRow: { paddingVertical: 5 }, auditLabel: { color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '900', textTransform: 'capitalize' }, auditText: { color: C3S_COLORS.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  clear: { alignItems: 'center', borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel, borderRadius: 14, padding: 28 }, clearIcon: { color: C3S_COLORS.success, fontSize: 24, fontWeight: '900' }, clearTitle: { color: C3S_COLORS.textStrong, fontSize: 18, fontWeight: '900', marginTop: 10, textTransform: 'capitalize' }, clearText: { color: C3S_COLORS.textMuted, fontSize: 14, textAlign: 'center', marginTop: 4 },
  error: { color: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft, borderRadius: 10, padding: 12, fontSize: 14, fontWeight: '700' },
});
