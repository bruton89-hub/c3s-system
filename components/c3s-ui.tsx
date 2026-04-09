import { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C3S_COLORS, C3S_RADIUS, C3S_SPACING, C3S_TYPE } from '@/constants/c3s-ui';
import { type WorkflowState } from '@/store/c3s-store';

const workflowColors: Record<WorkflowState, string> = {
  ready: C3S_COLORS.success,
  waiting: C3S_COLORS.info,
  blocked: C3S_COLORS.danger,
  assigned: C3S_COLORS.assigned,
  running: C3S_COLORS.running,
};

export function C3SScreen({ children }: { children: ReactNode }) {
  return <SafeAreaView style={styles.safeArea}>{children}</SafeAreaView>;
}

export function C3SPage({ children }: { children: ReactNode }) {
  return <View style={styles.page}>{children}</View>;
}

export function C3SScroll({ children }: { children: ReactNode }) {
  return <ScrollView contentContainerStyle={styles.scrollContent}>{children}</ScrollView>;
}

export function C3SScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.headerRow}>
      <View style={styles.headerTextWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

export function C3SSectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

export function C3SCard({ children, borderColor }: { children: ReactNode; borderColor?: string }) {
  return <View style={[styles.card, borderColor ? { borderColor } : null]}>{children}</View>;
}

export function C3SStatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export function C3SHandoffBadge({ state, label }: { state: WorkflowState; label: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: workflowColors[state] }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export function C3SBlockedChips({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <View style={styles.chipsRow}>
      {reasons.map((reason) => (
        <View key={reason} style={styles.blockedChip}>
          <Text style={styles.blockedChipText}>{reason}</Text>
        </View>
      ))}
    </View>
  );
}

export function C3SActionButton({
  label,
  variant = 'primary',
  disabled,
  onPress,
}: {
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.actionButton,
        variant === 'secondary' ? styles.actionButtonSecondary : null,
        variant === 'destructive' ? styles.actionButtonDestructive : null,
        disabled ? styles.actionButtonDisabled : null,
      ]}
      disabled={disabled}
      onPress={onPress}>
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C3S_COLORS.bg,
  },
  page: {
    flex: 1,
    backgroundColor: C3S_COLORS.bg,
    paddingHorizontal: C3S_SPACING.pageH,
    paddingTop: C3S_SPACING.pageTop,
  },
  scrollContent: {
    gap: C3S_SPACING.sectionGap,
    paddingBottom: 24,
  },
  headerRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: C3S_SPACING.sectionGap,
  },
  headerTextWrap: {
    flexShrink: 1,
  },
  title: {
    color: C3S_COLORS.textPrimary,
    ...C3S_TYPE.title,
  },
  subtitle: {
    color: C3S_COLORS.textMuted,
    marginTop: 2,
    ...C3S_TYPE.subtitle,
  },
  sectionTitle: {
    color: C3S_COLORS.textPrimary,
    ...C3S_TYPE.section,
  },
  card: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: C3S_RADIUS.card,
    padding: 12,
  },
  badge: {
    borderRadius: C3S_RADIUS.chip,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: C3S_COLORS.bg,
    fontSize: 11,
    fontWeight: '800',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  blockedChip: {
    borderRadius: C3S_RADIUS.chip,
    borderWidth: 1,
    borderColor: '#7A2E2E',
    backgroundColor: '#311B1B',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  blockedChipText: {
    color: '#FFB4B4',
    fontSize: 11,
    fontWeight: '700',
  },
  actionButton: {
    minHeight: 44,
    borderRadius: C3S_RADIUS.button,
    backgroundColor: '#1565C0',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonSecondary: {
    backgroundColor: '#455A64',
  },
  actionButtonDestructive: {
    backgroundColor: '#B71C1C',
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  actionButtonText: {
    color: C3S_COLORS.textStrong,
    fontSize: 14,
    fontWeight: '800',
  },
});

