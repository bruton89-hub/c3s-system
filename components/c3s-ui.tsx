import { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C3S_COLORS, C3S_RADIUS, C3S_SHADOW, C3S_SPACING, C3S_TYPE } from '@/constants/c3s-ui';
import { C3SLogo } from '@/components/c3s-brand';
import { isStagingEnvironment } from '@/lib/environment';
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
    <View style={styles.legacyHeader}>
      <View style={styles.logoRow}>
        <C3SLogo compact />
        {isStagingEnvironment ? <Text style={styles.stagingText}>C3S STAGING</Text> : null}
      </View>
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right ? <View>{right}</View> : null}
      </View>
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
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function C3SHandoffBadge({ state, label }: { state: WorkflowState; label: string }) {
  return (
    <View style={[styles.badge, { borderColor: workflowColors[state] }]}>
      <Text style={[styles.badgeText, { color: workflowColors[state] }]}>{label}</Text>
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
      <Text style={[styles.actionButtonText, variant === 'secondary' ? styles.actionButtonTextSecondary : null]}>{label}</Text>
    </Pressable>
  );
}

export function C3SEmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
    </View>
  );
}

export function C3SFeedback({
  kind,
  message,
}: {
  kind: 'success' | 'error' | 'warning' | 'info';
  message: string;
}) {
  return (
    <View style={[styles.feedback, styles[`feedback_${kind}`]]}>
      <Text style={[styles.feedbackText, styles[`feedbackText_${kind}`]]}>{message}</Text>
    </View>
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
  legacyHeader: { marginBottom: C3S_SPACING.sm },
  logoRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: C3S_SPACING.sm },
  stagingText: { color: C3S_COLORS.warning, backgroundColor: C3S_COLORS.warningSoft, borderWidth: 1, borderColor: C3S_COLORS.warning, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  headerRow: {
    minHeight: 56,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: C3S_SPACING.sectionGap,
  },
  headerTextWrap: {
    flexShrink: 1,
    minWidth: 180,
    flexGrow: 1,
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
    ...C3S_SHADOW,
  },
  badge: {
    borderRadius: C3S_RADIUS.chip,
    minHeight: 28,
    borderWidth: 1,
    backgroundColor: C3S_COLORS.panel,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
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
    borderColor: C3S_COLORS.danger,
    backgroundColor: C3S_COLORS.dangerSoft,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  blockedChipText: {
    color: C3S_COLORS.danger,
    fontSize: 11,
    fontWeight: '700',
  },
  actionButton: {
    minHeight: 44,
    borderRadius: C3S_RADIUS.button,
    backgroundColor: C3S_COLORS.accent,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonSecondary: {
    backgroundColor: C3S_COLORS.panel,
    borderWidth: 1,
    borderColor: C3S_COLORS.accent,
  },
  actionButtonDestructive: {
    backgroundColor: C3S_COLORS.danger,
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  actionButtonTextSecondary: { color: C3S_COLORS.accent },
  emptyState: { alignItems: 'center', backgroundColor: C3S_COLORS.panel, borderWidth: 1, borderColor: C3S_COLORS.border, borderRadius: C3S_RADIUS.card, padding: C3S_SPACING.xl },
  emptyTitle: { color: C3S_COLORS.textStrong, ...C3S_TYPE.cardTitle, textAlign: 'center' },
  emptyDetail: { color: C3S_COLORS.textMuted, ...C3S_TYPE.body, textAlign: 'center', marginTop: C3S_SPACING.xs },
  feedback: { borderWidth: 1, borderRadius: C3S_RADIUS.button, paddingHorizontal: C3S_SPACING.md, paddingVertical: C3S_SPACING.sm },
  feedback_success: { backgroundColor: C3S_COLORS.successSoft, borderColor: C3S_COLORS.success },
  feedback_error: { backgroundColor: C3S_COLORS.dangerSoft, borderColor: C3S_COLORS.danger },
  feedback_warning: { backgroundColor: C3S_COLORS.warningSoft, borderColor: C3S_COLORS.warning },
  feedback_info: { backgroundColor: C3S_COLORS.infoSoft, borderColor: C3S_COLORS.info },
  feedbackText: { ...C3S_TYPE.body, fontWeight: '800' },
  feedbackText_success: { color: C3S_COLORS.success },
  feedbackText_error: { color: C3S_COLORS.danger },
  feedbackText_warning: { color: C3S_COLORS.warning },
  feedbackText_info: { color: C3S_COLORS.info },
});
