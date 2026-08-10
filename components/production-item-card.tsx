import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type Href, router } from 'expo-router';

import { C3S_COLORS } from '@/constants/c3s-ui';
import type { OItemItem } from '@/lib/operational-items';
import { getItemPresentation, getProductionAlert, itemBatch, itemName, toneColor } from '@/lib/production/presentation';
import { isHeldStatus } from '@/lib/holds/core';

export function ProductionItemCard({ item, compact = false }: { item: OItemItem; compact?: boolean }) {
  const info = getItemPresentation(item);
  const color = toneColor(info.tone);
  const alert = getProductionAlert(item);
  const held = isHeldStatus(item.status);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${itemName(item)}, ${info.status}`}
      style={({ pressed }) => [styles.card, { borderLeftColor: color }, pressed && styles.pressed]}
      onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}` as Href)}>
      <View style={styles.topRow}>
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.name}>{itemName(item)}</Text>
          <Text style={styles.batch}>Batch {itemBatch(item)}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: `${color}16`, borderColor: `${color}55` }]}>
          <Text style={[styles.chipText, { color }]}>{info.stage}</Text>
        </View>
      </View>
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.status}>{info.status}</Text>
        <Text style={styles.elapsed}>• {info.elapsed}</Text>
        {held ? <Text style={[styles.flag, styles.holdFlag]}>ON HOLD</Text> : null}
        {alert ? <Text style={[styles.flag, alert.severity === 'critical' ? styles.criticalFlag : styles.warningFlag]}>{alert.severity === 'critical' ? 'CRITICAL' : 'AT RISK'}</Text> : null}
      </View>
      {!compact ? (
        <>
          {info.equipment ? <Text style={styles.equipment}>{info.equipment}</Text> : null}
          <View style={styles.nextRow}>
            <View style={styles.nextTextWrap}>
              <Text style={styles.nextLabel}>NEXT REQUIRED ACTION</Text>
              <Text style={styles.nextAction}>{info.nextAction}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </View>
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C3S_COLORS.panel,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    borderLeftWidth: 5,
    borderRadius: 14,
    padding: 14,
    gap: 9,
  },
  pressed: { opacity: 0.72 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  identity: { flex: 1 },
  name: { color: C3S_COLORS.textStrong, fontSize: 18, lineHeight: 23, fontWeight: '900' },
  batch: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '700', marginTop: 2 },
  chip: { minHeight: 30, borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 12, fontWeight: '900' },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  status: { color: C3S_COLORS.textPrimary, fontSize: 15, fontWeight: '800' },
  elapsed: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  flag: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '900' },
  holdFlag: { color: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft },
  criticalFlag: { color: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft },
  warningFlag: { color: '#7A4A00', backgroundColor: C3S_COLORS.warningSoft },
  equipment: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  nextRow: {
    minHeight: 55,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C3S_COLORS.accentSoft,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  nextTextWrap: { flex: 1 },
  nextLabel: { color: C3S_COLORS.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  nextAction: { color: C3S_COLORS.navy, fontSize: 15, fontWeight: '900', marginTop: 2 },
  chevron: { color: C3S_COLORS.accent, fontSize: 30, lineHeight: 30, fontWeight: '600', marginLeft: 8 },
});
