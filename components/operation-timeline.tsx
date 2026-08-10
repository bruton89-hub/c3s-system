import { StyleSheet, Text, View } from 'react-native';
import { C3S_COLORS } from '@/constants/c3s-ui';
import type { TimelineRow } from '@/lib/operations/summary';

export function OperationTimeline({ rows, empty = 'No recorded activity.' }: { rows: TimelineRow[]; empty?: string }) {
  if (!rows.length) return <Text style={styles.empty}>{empty}</Text>;
  return <View>{rows.map((row) => <View key={row.id} style={styles.row}><View style={styles.rail}><View style={styles.dot} /><View style={styles.line} /></View><View style={styles.body}><Text style={styles.label}>{row.label}</Text><Text style={styles.detail}>{row.detail}</Text><Text style={styles.time}>{row.at ? new Date(row.at).toLocaleString() : 'Time unavailable'}</Text></View></View>)}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', minHeight: 62 }, rail: { width: 22, alignItems: 'center' }, dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C3S_COLORS.accent, marginTop: 5 }, line: { width: 2, flex: 1, backgroundColor: C3S_COLORS.border, marginVertical: 3 }, body: { flex: 1, paddingBottom: 12 },
  label: { color: C3S_COLORS.textStrong, fontSize: 14, fontWeight: '900', textTransform: 'capitalize' }, detail: { color: C3S_COLORS.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '600', marginTop: 2 }, time: { color: C3S_COLORS.textMuted, fontSize: 11, fontWeight: '700', marginTop: 3 }, empty: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '600' },
});
