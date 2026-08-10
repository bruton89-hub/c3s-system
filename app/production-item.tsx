import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { type Href, router, useLocalSearchParams } from 'expo-router';

import { C3SBackHeader } from '@/components/c3s-brand';
import { C3SPage, C3SScreen } from '@/components/c3s-ui';
import { C3SDisclosure } from '@/components/operator-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { getOperationalItem, type OItemItem } from '@/lib/operational-items';
import { getItemPresentation, getProductionAlert, itemBatch, itemName, toneColor } from '@/lib/production/presentation';
import { toOperatorMessage } from '@/lib/auth/diagnostics';
import { useAuth } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { ALERT_PERSISTENCE_ENABLED } from '@/lib/alerts/config';
import { getAlertEvents, getPersistentAlertsForItem, type PersistentAlertEvent } from '@/lib/alerts/repository';
import { HOLD_WORKFLOW_ENABLED } from '@/lib/holds/config';
import { isHeldStatus } from '@/lib/holds/core';
import { getHoldEvents } from '@/lib/operational-items';
import type { HoldEventDoc } from '@/lib/firebase/models';
import { OperationTimeline } from '@/components/operation-timeline';
import { productionTimeline } from '@/lib/operations/summary';
import { DataFreshness } from '@/components/data-freshness';

export default function ProductionItemScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [item, setItem] = useState<OItemItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alertEvents, setAlertEvents] = useState<PersistentAlertEvent[]>([]);
  const [holdEvents, setHoldEvents] = useState<(HoldEventDoc & { id: string })[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const { profile } = useAuth();
  const { width } = useWindowDimensions();

  const load = useCallback(async () => {
    if (!id) { setError('Production item was not specified.'); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      setItem(await getOperationalItem(id)); setRefreshedAt(Date.now());
      if (ALERT_PERSISTENCE_ENABLED) {
        const [alerts, holds] = await Promise.all([getPersistentAlertsForItem(id), getHoldEvents(id)]);
        const histories = await Promise.all(alerts.map((alert) => getAlertEvents(alert.id)));
        setAlertEvents(histories.flat()); setHoldEvents(holds);
      }
    }
    catch (err) { setError(toOperatorMessage(err, 'This production item could not be loaded.')); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) return <C3SScreen><View style={styles.center}><ActivityIndicator size="large" color={C3S_COLORS.accent} /><Text style={styles.loading}>Loading production item…</Text></View></C3SScreen>;
  if (!item) return <C3SScreen><C3SPage><Back /><Text style={styles.error}>{error || 'Production item not found.'}</Text></C3SPage></C3SScreen>;

  const info = getItemPresentation(item);
  const activeWarning = getProductionAlert(item);
  const color = toneColor(info.tone);
  const held = isHeldStatus(item.status);
  const primaryRoute = held ? `/hold?itemId=${encodeURIComponent(item.id)}&mode=resolve` : `${info.route}?itemId=${encodeURIComponent(item.id)}`;
  const primaryLabel = held ? 'Resolve Hold' : info.nextAction;
  const showSticky = width <= 430 && item.status !== 'complete';
  return (
    <C3SScreen><C3SPage>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, showSticky && styles.contentWithSticky]}>
        <C3SBackHeader title={itemName(item)} subtitle={`Production item • Batch ${itemBatch(item)}`} />
        <DataFreshness refreshedAt={refreshedAt} failed={Boolean(error)} />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {activeWarning ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningLabel}>{activeWarning.severity.toUpperCase()} • OPEN • {activeWarning.age}</Text>
            <Text style={styles.warningTitle}>{activeWarning.title}</Text>
            <Text style={styles.warningText}>{activeWarning.message}</Text>
          </View>
        ) : null}
        {held ? <View style={styles.holdBanner}><Text style={styles.holdBannerStatus}>● ON HOLD</Text><Text style={styles.holdBannerReason}>Reason: {item.activeHold?.reasonLabel || item.qaNotes || item.deviationNotes || 'Review required'}</Text><Text style={styles.holdBannerMeta}>Since: {item.activeHold?.placedAt?.toMillis?.() ? new Date(item.activeHold.placedAt.toMillis()).toLocaleString() : 'Time unavailable'} • {item.activeHold?.placedByName || item.qaReviewedBy || 'Recorded operator'}</Text></View> : null}
        <View style={[styles.statusCard, { borderTopColor: color }]}>
          <Text style={styles.label}>CURRENT STATUS</Text>
          <View style={styles.statusRow}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={styles.status}>{info.status}</Text></View>
          <Text style={styles.stage}>{info.stage} • {info.elapsed}</Text>
          {info.equipment ? <Text style={styles.equipment}>{info.equipment}</Text> : null}
        </View>

        <View style={styles.actionCard}>
          <Text style={styles.actionLabel}>NEXT REQUIRED ACTION</Text>
          <Text style={styles.action}>{info.nextAction}</Text>
          <Text style={styles.actionHelp}>Only the tools needed for the current {info.stage.toLowerCase()} stage are shown.</Text>
          {item.status !== 'complete' && !showSticky ? <Pressable style={styles.primary} onPress={() => router.push(primaryRoute as Href)}><Text style={styles.primaryText}>{primaryLabel}</Text></Pressable> : null}
        </View>

        {!held && item.status !== 'complete' && (!HOLD_WORKFLOW_ENABLED || can(profile, 'placeHold')) ? <Pressable style={styles.holdAction} onPress={() => router.push(`/hold?itemId=${encodeURIComponent(item.id)}&mode=place` as Href)}><Text style={styles.holdActionText}>{HOLD_WORKFLOW_ENABLED ? 'Place on Hold' : 'Review Hold Workflow'}</Text></Pressable> : null}

        <C3SDisclosure title="Process Details">
          <Detail label="Product" value={itemName(item)} />
          <Detail label="Batch / PO" value={itemBatch(item)} />
          <Detail label="Racks" value={String(item.racks ?? '—')} />
          {item.cookType ? <Detail label="Cook type" value={item.cookType} /> : null}
          {item.targetTemp ? <Detail label="Configured target" value={`${item.targetTemp}°F`} /> : null}
          {item.criticalLimit ? <Detail label="Critical limit" value={item.criticalLimit} /> : null}
          {item.deliveryDate ? <Detail label="Delivery date" value={item.deliveryDate} /> : null}
          {item.makeDate ? <Detail label="Make date" value={item.makeDate} /> : null}
          {item.hasDeviation ? <Detail label="Warning" value={item.deviationNotes || item.deviationType || 'Deviation requires review'} warning /> : null}
        </C3SDisclosure>
        <C3SDisclosure title="Timeline" count={productionTimeline(item).length}>
          <OperationTimeline rows={productionTimeline(item)} empty="No production events have been recorded." />
        </C3SDisclosure>
        <C3SDisclosure title="Alerts & Holds" count={alertEvents.length + holdEvents.length + (activeWarning ? 1 : 0)}>
          {activeWarning ? <View style={styles.historyRow}><Text style={styles.historyAction}>Open alert • {activeWarning.title}</Text><Text style={styles.historyMeta}>{activeWarning.message}</Text></View> : null}
          {alertEvents.map((event) => <View key={`alert-${event.id}`} style={styles.historyRow}><Text style={styles.historyAction}>Alert {event.action.replaceAll('_', ' ')}</Text><Text style={styles.historyMeta}>{event.at?.toMillis?.() ? new Date(event.at.toMillis()).toLocaleString() : 'Time pending'} • {event.actorName}</Text></View>)}
          {holdEvents.map((event) => <View key={`hold-${event.id}`} style={styles.historyRow}><Text style={styles.historyAction}>Hold {event.action}</Text><Text style={styles.historyMeta}>{event.at?.toMillis?.() ? new Date(event.at.toMillis()).toLocaleString() : 'Time pending'} • {event.actorName}{event.notes ? ` • ${event.notes}` : ''}</Text></View>)}
          {!activeWarning && !alertEvents.length && !holdEvents.length ? <Text style={styles.historyMeta}>No alerts or hold events are available.</Text> : null}
        </C3SDisclosure>
        <C3SDisclosure title="Checks" count={productionTimeline(item).filter((row) => row.kind === 'check').length}>
          <OperationTimeline rows={productionTimeline(item).filter((row) => row.kind === 'check')} empty="No checks have been recorded for this batch." />
        </C3SDisclosure>
        <C3SDisclosure title="Equipment History">
          <Detail label="Current assignment" value={info.equipment || 'No current assignment'} />
          {item.targetSmokehouseId ? <Detail label="Planned oven" value={item.targetSmokehouseId} /> : null}
          {item.targetChillerId ? <Detail label="Planned chiller" value={item.targetChillerId} /> : null}
          {!info.equipment && !item.targetSmokehouseId && !item.targetChillerId ? <Text style={styles.historyMeta}>No equipment assignments have been recorded.</Text> : null}
        </C3SDisclosure>
        <C3SDisclosure title="Notes">
          <Text style={styles.historyMeta}>{item.deviationNotes || item.qaNotes || 'No operational notes are attached to this production item.'}</Text>
        </C3SDisclosure>
      </ScrollView>
      {showSticky ? <View style={styles.sticky}><Pressable style={styles.primary} onPress={() => router.push(primaryRoute as Href)}><Text style={styles.primaryText}>{primaryLabel}</Text></Pressable></View> : null}
    </C3SPage></C3SScreen>
  );
}

function Back() { return <Pressable hitSlop={8} style={styles.back} onPress={() => router.back()}><Text style={styles.backText}>‹ Back</Text></Pressable>; }
function Detail({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={[styles.detailValue, warning && styles.warning]}>{value}</Text></View>; }

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 900, alignSelf: 'center', paddingBottom: 32, gap: 12 }, contentWithSticky: { paddingBottom: 96 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, loading: { color: C3S_COLORS.textMuted, marginTop: 10, fontWeight: '700' },
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 55 },
  back: { minWidth: 72, minHeight: 44, justifyContent: 'center' }, backText: { color: C3S_COLORS.accent, fontSize: 16, fontWeight: '900' },
  eyebrow: { color: C3S_COLORS.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, name: { color: C3S_COLORS.textStrong, fontSize: 29, lineHeight: 34, fontWeight: '900' }, batch: { color: C3S_COLORS.textMuted, fontSize: 15, fontWeight: '700' },
  statusCard: { borderWidth: 1, borderColor: C3S_COLORS.border, borderTopWidth: 5, backgroundColor: C3S_COLORS.panel, borderRadius: 14, padding: 16 },
  label: { color: C3S_COLORS.textMuted, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 }, statusRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8 }, dot: { width: 12, height: 12, borderRadius: 6 }, status: { color: C3S_COLORS.textStrong, fontSize: 22, fontWeight: '900' },
  stage: { color: C3S_COLORS.textMuted, fontSize: 14, fontWeight: '700', marginTop: 6 }, equipment: { color: C3S_COLORS.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 5 },
  actionCard: { backgroundColor: C3S_COLORS.navy, borderRadius: 14, padding: 18 }, actionLabel: { color: '#72ADFF', fontSize: 11, fontWeight: '900', letterSpacing: 0.9 }, action: { color: '#FFFFFF', fontSize: 24, lineHeight: 29, fontWeight: '900', marginTop: 7 }, actionHelp: { color: '#BDD4EF', fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 5 },
  primary: { minHeight: 56, borderRadius: 12, backgroundColor: C3S_COLORS.accent, alignItems: 'center', justifyContent: 'center', marginTop: 16, paddingHorizontal: 14 }, primaryText: { color: '#FFFFFF', fontSize: 16, textAlign: 'center', fontWeight: '900' },
  sticky: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: '#FFFFFFF2', borderTopWidth: 1, borderTopColor: C3S_COLORS.border },
  holdBanner: { backgroundColor: C3S_COLORS.dangerSoft, borderWidth: 2, borderColor: C3S_COLORS.danger, borderRadius: 14, padding: 15, gap: 4 }, holdBannerStatus: { color: C3S_COLORS.danger, fontSize: 20, fontWeight: '900' }, holdBannerReason: { color: C3S_COLORS.textStrong, fontSize: 16, fontWeight: '900' }, holdBannerMeta: { color: C3S_COLORS.textMuted, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  holdAction: { minHeight: 50, borderWidth: 1, borderColor: C3S_COLORS.danger, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, holdActionText: { color: C3S_COLORS.danger, fontSize: 15, fontWeight: '900' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C3S_COLORS.border, paddingVertical: 11 }, detailLabel: { color: C3S_COLORS.textMuted, fontSize: 14, fontWeight: '700' }, detailValue: { flex: 1, color: C3S_COLORS.textPrimary, fontSize: 14, fontWeight: '800', textAlign: 'right' }, warning: { color: C3S_COLORS.danger },
  error: { color: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft, borderRadius: 10, padding: 12, fontSize: 14, fontWeight: '700' },
  warningCard: { backgroundColor: C3S_COLORS.dangerSoft, borderWidth: 1, borderColor: '#E9B7B7', borderRadius: 13, padding: 14 }, warningLabel: { color: C3S_COLORS.danger, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }, warningTitle: { color: C3S_COLORS.textStrong, fontSize: 17, fontWeight: '900', marginTop: 5 }, warningText: { color: C3S_COLORS.textMuted, fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 3 },
  historyRow: { paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C3S_COLORS.border }, historyAction: { color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '800', textTransform: 'capitalize' }, historyMeta: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '600', marginTop: 2 },
});
