import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { C3SBackHeader } from '@/components/c3s-brand';
import { C3SPage, C3SScreen } from '@/components/c3s-ui';
import { C3SOperatorFocus } from '@/components/operator-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { useC3S } from '@/store/c3s-store';
import { TRAINING_TOOLS_ENABLED } from '@/lib/training/config';

export default function SimulationAlertsScreen() {
  if (!TRAINING_TOOLS_ENABLED) return <C3SScreen><C3SPage><View style={styles.disabledPage}><Text style={styles.title}>Training tools unavailable</Text><Text style={styles.subtitle}>Simulation data is disabled in this build.</Text><Pressable style={styles.button} onPress={() => router.replace('/more')}><Text style={styles.buttonText}>Return to More</Text></Pressable></View></C3SPage></C3SScreen>;
  return <SimulationAlertsContent />;
}

function SimulationAlertsContent() {
  const { notifications, acknowledgeNotification } = useC3S();
  return (
    <C3SScreen><C3SPage><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <C3SBackHeader title="Simulation Alerts" subtitle="Local training scenarios only — not live production alerts" />
      <C3SOperatorFocus status={`${notifications.filter((item) => !item.acknowledged).length} open training alerts`} action="Acknowledge Training Alert" detail="This tool does not change live production records." tone="waiting" />
      <View style={styles.notice}><Text style={styles.noticeTitle}>Training tool</Text><Text style={styles.noticeText}>Use the main Alerts tab for live production exceptions.</Text></View>
      {notifications.map((item) => {
        const color = item.severity === 'Critical' ? C3S_COLORS.danger : item.severity === 'Warning' ? C3S_COLORS.warning : C3S_COLORS.info;
        return <View key={item.id} style={[styles.card, { borderLeftColor: color }]}>
          <View style={styles.top}><Text style={[styles.severity, { color }]}>{item.severity.toUpperCase()}</Text><Text style={styles.time}>{item.timestamp}</Text></View>
          <Text style={styles.message}>{item.message}</Text>
          <Text style={styles.batch}>Batch {item.batchId || 'not linked'}</Text>
          <View style={styles.actions}>
            <Pressable disabled={item.acknowledged} style={[styles.button, item.acknowledged && styles.disabled]} onPress={() => acknowledgeNotification(item.id)}><Text style={styles.buttonText}>{item.acknowledged ? 'Acknowledged' : 'Acknowledge'}</Text></Pressable>
            {item.batchId ? <Pressable style={[styles.button, styles.secondary]} onPress={() => router.push({ pathname: '/batch-timeline', params: { batchId: item.batchId } })}><Text style={styles.secondaryText}>Open Batch</Text></Pressable> : null}
          </View>
        </View>;
      })}
      {notifications.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>No local simulation alerts.</Text></View> : null}
    </ScrollView></C3SPage></C3SScreen>
  );
}

const styles = StyleSheet.create({
  disabledPage: { flex: 1, justifyContent: 'center', gap: 12 },
  content: { paddingBottom: 32, gap: 11 }, nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 55 }, back: { minWidth: 72, minHeight: 44, justifyContent: 'center' }, backText: { color: C3S_COLORS.accent, fontSize: 16, fontWeight: '900' },
  title: { color: C3S_COLORS.textStrong, fontSize: 32, fontWeight: '900' }, subtitle: { color: C3S_COLORS.textMuted, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  notice: { backgroundColor: C3S_COLORS.warningSoft, borderWidth: 1, borderColor: '#E8C98F', borderRadius: 12, padding: 13 }, noticeTitle: { color: C3S_COLORS.warning, fontSize: 13, fontWeight: '900' }, noticeText: { color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '600', marginTop: 2 },
  card: { backgroundColor: C3S_COLORS.panel, borderWidth: 1, borderColor: C3S_COLORS.border, borderLeftWidth: 5, borderRadius: 14, padding: 15 }, top: { flexDirection: 'row', justifyContent: 'space-between' }, severity: { fontSize: 10, fontWeight: '900', letterSpacing: 0.7 }, time: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  message: { color: C3S_COLORS.textStrong, fontSize: 17, lineHeight: 23, fontWeight: '800', marginTop: 8 }, batch: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '700', marginTop: 5 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 13 }, button: { flex: 1, minHeight: 48, backgroundColor: C3S_COLORS.accent, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' }, disabled: { backgroundColor: C3S_COLORS.textMuted }, secondary: { backgroundColor: C3S_COLORS.accentSoft, borderWidth: 1, borderColor: '#BAD2F4' }, secondaryText: { color: C3S_COLORS.accent, fontSize: 14, fontWeight: '900' },
  empty: { backgroundColor: C3S_COLORS.panel, borderWidth: 1, borderColor: C3S_COLORS.border, borderRadius: 14, padding: 18 }, emptyText: { color: C3S_COLORS.textMuted, fontSize: 14, fontWeight: '700' },
});
