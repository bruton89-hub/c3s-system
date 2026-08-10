import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type Href, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { C3SBackHeader } from '@/components/c3s-brand';
import { C3SPage, C3SScreen } from '@/components/c3s-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { getOperationalItems, type OItemItem } from '@/lib/operational-items';
import { isHeldStatus } from '@/lib/holds/core';
import { itemBatch, itemName, itemTimestamp } from '@/lib/production/presentation';
import { useAuth } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { StressScenarioBanner } from '@/components/stress-scenario-banner';

export default function HoldsScreen() {
  const { profile } = useAuth();
  const [items, setItems] = useState<OItemItem[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setItems(await getOperationalItems()); } finally { setLoading(false); } }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const active = useMemo(() => items.filter((item) => isHeldStatus(item.status)).sort((a, b) => itemTimestamp(a) - itemTimestamp(b)), [items]);
  const resolved = useMemo(() => items.filter((item) => !isHeldStatus(item.status) && (item.transitions ?? []).some((event) => event.from.status === 'hold')).sort((a, b) => itemTimestamp(b) - itemTimestamp(a)).slice(0, 8), [items]);

  return <C3SScreen><C3SPage><ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C3S_COLORS.accent} />} contentContainerStyle={styles.content}>
    <C3SBackHeader title="Holds" subtitle="Active production decisions requiring review" />
    <StressScenarioBanner />
    <View style={styles.summary}><Text style={styles.summaryValue}>{active.length}</Text><View><Text style={styles.summaryTitle}>Active holds</Text><Text style={styles.muted}>{active.length ? 'Oldest hold shown first' : 'No batches are currently held'}</Text></View></View>
    {active.map((item) => <HoldCard key={item.id} item={item} canResolve={can(profile, 'resolveHold')} />)}
    {!loading && active.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>No active holds</Text><Text style={styles.muted}>Production items that are placed on hold will appear here.</Text></View> : null}
    <Text style={styles.sectionTitle}>Recently Resolved</Text>
    <View style={styles.history}>{resolved.map((item) => <Pressable key={item.id} style={styles.historyRow} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}` as Href)}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{itemName(item)}</Text><Text style={styles.muted}>Batch {itemBatch(item)} • returned to {item.stage}</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}{!resolved.length ? <Text style={styles.muted}>No resolved hold history is available.</Text> : null}</View>
  </ScrollView></C3SPage></C3SScreen>;
}

function HoldCard({ item, canResolve }: { item: OItemItem; canResolve: boolean }) {
  const heldAt = item.activeHold?.placedAt?.toMillis?.() ?? itemTimestamp(item);
  return <View style={styles.card}><View style={styles.cardTop}><View style={{ flex: 1 }}><Text style={styles.holdLabel}>● ON HOLD</Text><Text style={styles.cardTitle}>{itemName(item)}</Text><Text style={styles.muted}>Batch {itemBatch(item)} • {item.stage.toUpperCase()}</Text></View><Text style={styles.duration}>{elapsed(heldAt)}</Text></View><Text style={styles.reason}>{item.activeHold?.reasonLabel || item.qaNotes || 'Review required'}</Text><Text style={styles.muted}>Placed by {item.activeHold?.placedByName || item.qaReviewedBy || 'Recorded operator'}</Text><View style={styles.actions}><Pressable style={styles.secondary} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}` as Href)}><Text style={styles.secondaryText}>Open Batch</Text></Pressable>{canResolve ? <Pressable style={styles.primary} onPress={() => router.push(`/hold?itemId=${encodeURIComponent(item.id)}&mode=resolve` as Href)}><Text style={styles.primaryText}>Resolve Hold</Text></Pressable> : null}</View></View>;
}
function elapsed(at: number) { const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000)); return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }

const styles = StyleSheet.create({ content: { width: '100%', maxWidth: 960, alignSelf: 'center', gap: 11, paddingBottom: 32 }, nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 54 }, back: { minHeight: 44, minWidth: 70, justifyContent: 'center' }, backText: { color: C3S_COLORS.accent, fontSize: 16, fontWeight: '900' }, title: { color: C3S_COLORS.textStrong, fontSize: 32, fontWeight: '900' }, subtitle: { color: C3S_COLORS.textMuted, fontSize: 15, fontWeight: '600', marginTop: -7 }, summary: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: C3S_COLORS.dangerSoft, borderRadius: 14, padding: 15 }, summaryValue: { color: C3S_COLORS.danger, fontSize: 32, fontWeight: '900' }, summaryTitle: { color: C3S_COLORS.textStrong, fontSize: 16, fontWeight: '900' }, card: { borderWidth: 1, borderColor: C3S_COLORS.border, borderLeftWidth: 5, borderLeftColor: C3S_COLORS.danger, backgroundColor: C3S_COLORS.panel, borderRadius: 14, padding: 14, gap: 8 }, cardTop: { flexDirection: 'row', gap: 10 }, holdLabel: { color: C3S_COLORS.danger, fontSize: 11, fontWeight: '900' }, cardTitle: { color: C3S_COLORS.textStrong, fontSize: 17, fontWeight: '900', marginTop: 3 }, muted: { color: C3S_COLORS.textMuted, fontSize: 13, lineHeight: 18, fontWeight: '600' }, duration: { color: C3S_COLORS.danger, fontSize: 14, fontWeight: '900' }, reason: { color: C3S_COLORS.textPrimary, fontSize: 15, fontWeight: '800' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }, secondary: { minHeight: 46, flexGrow: 1, borderWidth: 1, borderColor: C3S_COLORS.accent, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13 }, secondaryText: { color: C3S_COLORS.accent, fontSize: 14, fontWeight: '900' }, primary: { minHeight: 46, flexGrow: 1, backgroundColor: C3S_COLORS.danger, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13 }, primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' }, sectionTitle: { color: C3S_COLORS.textStrong, fontSize: 20, fontWeight: '900', marginTop: 5 }, history: { borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel, borderRadius: 14, padding: 13, gap: 8 }, historyRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C3S_COLORS.border, paddingVertical: 7 }, chevron: { color: C3S_COLORS.accent, fontSize: 27 }, empty: { alignItems: 'center', backgroundColor: C3S_COLORS.panel, borderWidth: 1, borderColor: C3S_COLORS.border, borderRadius: 14, padding: 24 }, emptyTitle: { color: C3S_COLORS.textStrong, fontSize: 17, fontWeight: '900', marginBottom: 4 } });
