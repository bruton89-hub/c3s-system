import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { type Href, router } from 'expo-router';
import type { ReactNode } from 'react';

import { C3S_COLORS } from '@/constants/c3s-ui';
import { isStagingEnvironment } from '@/lib/environment';

const logo = require('@/assets/images/c3s-logo.png');

export function C3SLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Image
      source={logo}
      resizeMode={compact ? 'cover' : 'contain'}
      accessibilityLabel="C3S Production Flow System"
      style={compact ? styles.logoCompact : styles.logo}
    />
  );
}

export function C3SBrandHeader({
  title,
  subtitle,
  showMore = true,
}: {
  title: string;
  subtitle?: string;
  showMore?: boolean;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <C3SLogo compact />
        {showMore ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open more tools"
            hitSlop={8}
            style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
            onPress={() => router.push('/more' as Href)}>
            <Text style={styles.moreText}>More</Text>
          </Pressable>
        ) : null}
      </View>
      {isStagingEnvironment ? (
        <View accessibilityLabel="C3S staging environment" style={styles.stagingBadge}>
          <Text style={styles.stagingText}>C3S STAGING</Text>
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function C3SBackHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <C3SLogo compact />
      </View>
      {isStagingEnvironment ? (
        <View accessibilityLabel="C3S staging environment" style={styles.stagingBadge}>
          <Text style={styles.stagingText}>C3S STAGING</Text>
        </View>
      ) : null}
      <View style={styles.titleRow}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 3, marginBottom: 18 },
  brandRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  logo: { width: '100%', height: 142 },
  logoCompact: { width: 162, height: 54 },
  moreButton: {
    minWidth: 72,
    minHeight: 44,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    borderRadius: 12,
    backgroundColor: C3S_COLORS.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: { color: C3S_COLORS.navy, fontSize: 15, fontWeight: '800' },
  backButton: { minWidth: 72, minHeight: 44, justifyContent: 'center' },
  backText: { color: C3S_COLORS.accent, fontSize: 16, fontWeight: '900' },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  titleWrap: { flexGrow: 1, flexShrink: 1, minWidth: 180 },
  right: { alignSelf: 'center' },
  stagingBadge: {
    alignSelf: 'flex-start',
    minHeight: 32,
    borderRadius: 999,
    backgroundColor: C3S_COLORS.warningSoft,
    borderWidth: 1,
    borderColor: C3S_COLORS.warning,
    paddingHorizontal: 12,
    marginBottom: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stagingText: { color: C3S_COLORS.warning, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  pressed: { opacity: 0.7 },
  title: { color: C3S_COLORS.textStrong, fontSize: 32, lineHeight: 38, fontWeight: '900' },
  subtitle: { color: C3S_COLORS.textMuted, fontSize: 15, lineHeight: 21, fontWeight: '600' },
});
