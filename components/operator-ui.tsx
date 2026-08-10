import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C3S_COLORS } from '@/constants/c3s-ui';

export type OperatorTone = 'active' | 'waiting' | 'critical' | 'complete';

const toneColor: Record<OperatorTone, string> = {
  active: C3S_COLORS.accent,
  waiting: C3S_COLORS.warning,
  critical: C3S_COLORS.danger,
  complete: C3S_COLORS.success,
};

export function C3SOperatorFocus({
  status,
  action,
  detail,
  tone = 'active',
}: {
  status: string;
  action: string;
  detail?: string;
  tone?: OperatorTone;
}) {
  const color = toneColor[tone];
  return (
    <View style={[styles.focus, { borderLeftColor: color }]}>
      <View style={styles.focusStatusRow}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.focusStatus, { color }]}>{status}</Text>
      </View>
      <Text style={styles.actionLabel}>REQUIRED ACTION</Text>
      <Text style={styles.action}>{action}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

export function C3SDisclosure({
  title = 'More details',
  children,
  defaultOpen = false,
  count,
}: {
  title?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.disclosureButton, pressed && styles.pressed]}
        onPress={() => setOpen((value) => !value)}>
        <Text style={styles.disclosureTitle}>{title}{count != null ? ` (${count})` : ''}</Text>
        <Text style={styles.disclosureIcon}>{open ? '−' : '+'}</Text>
      </Pressable>
      {open ? <View style={styles.disclosureBody}>{children}</View> : null}
    </View>
  );
}

export function C3SPrimaryAction({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [styles.primary, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
      onPress={onPress}>
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  focus: {
    backgroundColor: C3S_COLORS.panel,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    borderLeftWidth: 5,
    borderRadius: 14,
    padding: 15,
    gap: 4,
  },
  focusStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  focusStatus: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  actionLabel: { color: C3S_COLORS.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 0.9, marginTop: 5 },
  action: { color: C3S_COLORS.textStrong, fontSize: 21, lineHeight: 26, fontWeight: '900' },
  detail: { color: C3S_COLORS.textMuted, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  disclosure: { backgroundColor: C3S_COLORS.panelAlt, borderRadius: 11, overflow: 'hidden' },
  disclosureButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  disclosureTitle: { color: C3S_COLORS.textPrimary, fontSize: 14, fontWeight: '800' },
  disclosureIcon: { color: C3S_COLORS.accent, fontSize: 22, fontWeight: '700' },
  disclosureBody: { borderTopWidth: 1, borderTopColor: C3S_COLORS.border, padding: 12, gap: 5 },
  primary: { minHeight: 54, backgroundColor: C3S_COLORS.accent, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
