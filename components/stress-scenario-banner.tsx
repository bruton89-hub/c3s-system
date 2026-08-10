import { StyleSheet, Text, View } from 'react-native';

import { C3S_COLORS } from '@/constants/c3s-ui';
import { getActiveStressScenario } from '@/lib/stress/scenarios';

export function StressScenarioBanner() {
  const scenario = getActiveStressScenario();
  if (!scenario) return null;
  return <View style={styles.banner}><Text style={styles.label}>LOCAL STRESS SCENARIO • NO FIRESTORE WRITES</Text><Text style={styles.title}>{scenario.title}</Text><Text style={styles.detail}>{scenario.description}</Text></View>;
}

const styles = StyleSheet.create({ banner: { borderWidth: 1, borderColor: C3S_COLORS.warning, borderRadius: 12, backgroundColor: C3S_COLORS.warningSoft, padding: 12 }, label: { color: '#7A4A00', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 }, title: { color: C3S_COLORS.textStrong, fontSize: 16, fontWeight: '900', marginTop: 3 }, detail: { color: C3S_COLORS.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '600', marginTop: 2 } });
