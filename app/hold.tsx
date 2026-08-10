import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';

import { C3SBackHeader } from '@/components/c3s-brand';
import { C3SPage, C3SScreen } from '@/components/c3s-ui';
import { C3SPrimaryAction } from '@/components/operator-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { useAuth } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { HOLD_REASONS, SUPPORTED_HOLD_OUTCOMES } from '@/lib/holds/core';
import { HOLD_WORKFLOW_ENABLED } from '@/lib/holds/config';
import {
  getOperationalItem,
  placeOperationalItemOnHold,
  resolveOperationalItemHold,
  type OItemItem,
} from '@/lib/operational-items';
import type { HoldReasonKey, HoldResolutionOutcome } from '@/lib/firebase/models';
import { itemBatch, itemName } from '@/lib/production/presentation';
import { toOperatorMessage } from '@/lib/auth/diagnostics';

export default function HoldWorkflowScreen() {
  const params = useLocalSearchParams<{ itemId?: string; mode?: string }>();
  const itemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const mode = (Array.isArray(params.mode) ? params.mode[0] : params.mode) === 'resolve' ? 'resolve' : 'place';
  const { profile } = useAuth();
  const [item, setItem] = useState<OItemItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState<HoldReasonKey | null>(null);
  const [outcome, setOutcome] = useState<HoldResolutionOutcome>('released_to_production');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!itemId) { setMessage('Production item was not specified.'); setLoading(false); return; }
    setLoading(true);
    try { setItem(await getOperationalItem(itemId)); }
    catch (error) { setMessage(toOperatorMessage(error, 'The production item could not be loaded.')); }
    finally { setLoading(false); }
  }, [itemId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const allowed = HOLD_WORKFLOW_ENABLED && can(profile, mode === 'resolve' ? 'resolveHold' : 'placeHold');
  const selectedReason = useMemo(() => HOLD_REASONS.find((entry) => entry.key === reason), [reason]);
  const qaManagedHold = item?.status === 'qa_hold' || item?.status === 'qa_review_required';

  async function submit() {
    if (!item || !profile || !allowed) return;
    setMessage(null);
    if (mode === 'place' && !selectedReason) { setMessage('Select a hold reason.'); return; }
    if (mode === 'place' && selectedReason?.key === 'other' && !notes.trim()) { setMessage('Add a short note for Other.'); return; }
    if (mode === 'resolve' && !notes.trim()) { setMessage('A resolution explanation is required.'); return; }
    setSaving(true);
    try {
      if (mode === 'place' && selectedReason) {
        await placeOperationalItemOnHold({
          itemId: item.id, reasonKey: selectedReason.key, reasonLabel: selectedReason.label,
          notes, actorName: profile.name,
        });
      } else {
        await resolveOperationalItemHold({ itemId: item.id, outcome, explanation: notes, actorName: profile.name });
      }
      router.replace(`/production-item?id=${encodeURIComponent(item.id)}`);
    } catch (error) {
      setMessage(toOperatorMessage(error, mode === 'place' ? 'Hold was not saved. Your entries are preserved for retry.' : 'Hold resolution was not saved. Your explanation is preserved for retry.'));
    } finally { setSaving(false); }
  }

  if (loading) return <C3SScreen><View style={styles.center}><ActivityIndicator color={C3S_COLORS.accent} /><Text style={styles.muted}>Loading hold workflow…</Text></View></C3SScreen>;
  if (!item) return <C3SScreen><C3SPage><Back /><Text style={styles.error}>{message || 'Production item not found.'}</Text></C3SPage></C3SScreen>;

  return (
    <C3SScreen><C3SPage>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <C3SBackHeader title={itemName(item)} subtitle={`Batch ${itemBatch(item)}`} />
        <Text style={styles.eyebrow}>{mode === 'place' ? 'PLACE BATCH ON HOLD' : 'RESOLVE PRODUCTION HOLD'}</Text>
        <Text style={styles.title}>{itemName(item)}</Text>
        <Text style={styles.subtitle}>Batch {itemBatch(item)}</Text>

        {!HOLD_WORKFLOW_ENABLED ? <Text style={styles.error}>Hold writes are disabled in this environment until the new rules are deployed. The workflow is available for review only.</Text> : !allowed ? <Text style={styles.error}>Your current role can view this hold but cannot {mode === 'place' ? 'place' : 'resolve'} it.</Text> : null}
        {message ? <Text style={styles.error}>{message}</Text> : null}

        {mode === 'resolve' ? (
          <View style={styles.holdSummary}>
            <Text style={styles.holdStatus}>● ON HOLD</Text>
            <Text style={styles.summaryTitle}>{item.activeHold?.reasonLabel || item.qaNotes || 'QA or production review'}</Text>
            <Text style={styles.muted}>Placed by {item.activeHold?.placedByName || item.qaReviewedBy || 'Recorded operator'}</Text>
          </View>
        ) : null}

        {qaManagedHold ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>QA-managed hold</Text>
            <Text style={styles.muted}>This hold is tied to the existing QA review record. Resolve it in QA Review so the current QA validations and transition rules remain authoritative.</Text>
            <C3SPrimaryAction label="Open QA Review" onPress={() => router.replace(`/qa-review?itemId=${encodeURIComponent(item.id)}`)} />
          </View>
        ) : mode === 'place' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Reason</Text>
            <View style={styles.choices}>{HOLD_REASONS.map((entry) => (
              <Pressable key={entry.key} style={[styles.choice, reason === entry.key && styles.choiceSelected]} onPress={() => setReason(entry.key)}>
                <Text style={[styles.choiceText, reason === entry.key && styles.choiceTextSelected]}>{entry.label}</Text>
              </Pressable>
            ))}</View>
            <Text style={styles.fieldLabel}>Optional notes{reason === 'other' ? ' — required for Other' : ''}</Text>
            <TextInput value={notes} onChangeText={setNotes} editable={!saving} multiline style={styles.input} placeholder="Short operational context" placeholderTextColor={C3S_COLORS.textMuted} />
            <C3SPrimaryAction label={saving ? 'Saving Hold…' : 'Place on Hold'} disabled={saving || !allowed} onPress={submit} />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Resolution outcome</Text>
            <View style={styles.choices}>{SUPPORTED_HOLD_OUTCOMES.map((entry) => (
              <Pressable key={entry.key} style={[styles.choice, outcome === entry.key && styles.choiceSelected]} onPress={() => setOutcome(entry.key)}>
                <Text style={[styles.choiceText, outcome === entry.key && styles.choiceTextSelected]}>{entry.label}</Text>
              </Pressable>
            ))}</View>
            <Text style={styles.fieldLabel}>Resolution explanation</Text>
            <TextInput value={notes} onChangeText={setNotes} editable={!saving} multiline style={styles.input} placeholder="What was reviewed or corrected?" placeholderTextColor={C3S_COLORS.textMuted} />
            <C3SPrimaryAction label={saving ? 'Saving Resolution…' : 'Release to Production'} disabled={saving || !allowed} onPress={submit} />
            <Text style={styles.safety}>Other dispositions are not offered because the existing state machine cannot safely represent them.</Text>
          </View>
        )}
      </ScrollView>
    </C3SPage></C3SScreen>
  );
}

function Back() { return <Pressable style={styles.back} onPress={() => router.back()}><Text style={styles.backText}>‹ Back</Text></Pressable>; }

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 12, paddingBottom: 36 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  nav: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { minWidth: 72, minHeight: 48, justifyContent: 'center' }, backText: { color: C3S_COLORS.accent, fontSize: 16, fontWeight: '900' },
  eyebrow: { color: C3S_COLORS.danger, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: C3S_COLORS.textStrong, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: C3S_COLORS.textMuted, fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: C3S_COLORS.panel, borderWidth: 1, borderColor: C3S_COLORS.border, borderRadius: 14, padding: 16, gap: 12 },
  holdSummary: { backgroundColor: C3S_COLORS.dangerSoft, borderWidth: 2, borderColor: C3S_COLORS.danger, borderRadius: 14, padding: 16, gap: 4 },
  holdStatus: { color: C3S_COLORS.danger, fontSize: 16, fontWeight: '900' }, summaryTitle: { color: C3S_COLORS.textStrong, fontSize: 20, fontWeight: '900' },
  sectionTitle: { color: C3S_COLORS.textStrong, fontSize: 19, fontWeight: '900' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: C3S_COLORS.border, borderRadius: 999, paddingHorizontal: 14, backgroundColor: C3S_COLORS.panelAlt },
  choiceSelected: { backgroundColor: C3S_COLORS.navy, borderColor: C3S_COLORS.navy },
  choiceText: { color: C3S_COLORS.textPrimary, fontSize: 14, fontWeight: '800' }, choiceTextSelected: { color: '#FFFFFF' },
  fieldLabel: { color: C3S_COLORS.textPrimary, fontSize: 14, fontWeight: '900' },
  input: { minHeight: 104, borderWidth: 1, borderColor: C3S_COLORS.border, borderRadius: 11, padding: 12, color: C3S_COLORS.textStrong, backgroundColor: '#FFFFFF', fontSize: 16, textAlignVertical: 'top' },
  error: { color: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft, borderRadius: 10, padding: 12, fontWeight: '800' },
  muted: { color: C3S_COLORS.textMuted, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  safety: { color: C3S_COLORS.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '600' },
});
