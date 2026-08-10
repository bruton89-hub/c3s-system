import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { C3SLogo } from '@/components/c3s-brand';
import { C3SActionButton, C3SCard, C3SScreen } from '@/components/c3s-ui';
import { C3S_COLORS, C3S_SPACING, C3S_TYPE } from '@/constants/c3s-ui';

export default function ModalScreen() {
  return (
    <C3SScreen>
      <View style={styles.screen}>
        <View style={styles.content}>
        <C3SLogo compact />
        <C3SCard>
          <View style={styles.card}>
            <Text style={styles.title}>C3S</Text>
            <Text style={styles.body}>Return to the operational workspace when you are ready.</Text>
            <C3SActionButton label="Return Home" onPress={() => router.dismissTo('/')} />
          </View>
        </C3SCard>
        </View>
      </View>
    </C3SScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center' },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: C3S_SPACING.lg },
  card: { gap: C3S_SPACING.md },
  title: { color: C3S_COLORS.textStrong, fontSize: C3S_TYPE.cardTitle.fontSize, fontWeight: '900' },
  body: { color: C3S_COLORS.textMuted, fontSize: C3S_TYPE.body.fontSize, lineHeight: 21 },
});
