import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { C3S_COLORS, C3S_RADIUS } from '@/constants/c3s-ui';
import {
  BATCH_STAGES,
  PREP_STATUSES,
} from '@/constants/c3s';
import { useC3S } from '@/store/c3s-store';

type SummaryItem = {
  label: string;
  value: number;
  accent: string;
};

export function DashboardSummary() {
  const { prepTickets, batches, notifications } = useC3S();

  const items = useMemo<SummaryItem[]>(
    () => [
      {
        label: 'RTC Queue',
        value: prepTickets.filter((prep) => prep.status !== PREP_STATUSES.LOADED).length,
        accent: '#4FC3F7',
      },
      {
        label: 'Production',
        value: batches.filter((batch) => batch.stage === BATCH_STAGES.COOK).length,
        accent: '#FFB74D',
      },
      {
        label: 'QA',
        value: batches.filter((batch) => batch.stage === BATCH_STAGES.QA).length,
        accent: '#E57373',
      },
      {
        label: 'Packaging Ops',
        value: batches.filter((batch) => batch.stage === BATCH_STAGES.PACKAGING).length,
        accent: '#81C784',
      },
      {
        label: 'Alerts',
        value: notifications.filter((item) => !item.acknowledged).length,
        accent: '#EF5350',
      },
    ],
    [prepTickets, batches, notifications],
  );

  return (
    <View style={styles.row}>
      {items.map((item) => (
        <View key={item.label} style={styles.card}>
          <View style={[styles.accent, { backgroundColor: item.accent }]} />
          <Text style={styles.value}>{item.value}</Text>
          <Text style={styles.label}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  card: {
    flex: 1,
    borderRadius: C3S_RADIUS.card,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panelAlt,
    paddingVertical: 12,
    paddingHorizontal: 10,
    minHeight: 102,
  },
  accent: {
    height: 4,
    width: 42,
    borderRadius: 10,
    marginBottom: 8,
  },
  value: {
    color: C3S_COLORS.textStrong,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34,
  },
  label: {
    color: C3S_COLORS.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
  },
});
