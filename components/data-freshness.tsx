import { StyleSheet, Text, View } from 'react-native';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { freshnessState } from '@/lib/operations/core';

export function DataFreshness({ refreshedAt, failed = false }: { refreshedAt: number | null; failed?: boolean }) {
  const freshness = freshnessState(refreshedAt, failed);
  return <View style={[styles.row, freshness.state === 'stale' && styles.stale]}><View style={[styles.dot, freshness.state === 'live' ? styles.liveDot : styles.staleDot]} /><Text style={[styles.text, freshness.state === 'stale' && styles.staleText]}>{freshness.label}</Text></View>;
}
const styles = StyleSheet.create({ row: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: C3S_COLORS.panelAlt }, stale: { backgroundColor: C3S_COLORS.warningSoft }, dot: { width: 6, height: 6, borderRadius: 3 }, liveDot: { backgroundColor: C3S_COLORS.success }, staleDot: { backgroundColor: C3S_COLORS.warning }, text: { color: C3S_COLORS.textMuted, fontSize: 10, fontWeight: '800' }, staleText: { color: '#7A4A00' } });
