import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { C3SDisclosure, C3SOperatorFocus } from '@/components/operator-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import {
  getChillLogs,
  getPrepQueueItems,
  type ChillLogItem,
  type PrepQueueItem,
} from '@/lib/firebase/repository';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import {
  getOperationalItems,
  oItemAppendQANote,
  oItemQAResubmit,
  oItemQAReview,
  type OItemItem,
} from '@/lib/operational-items';
import { useAuth } from '@/lib/auth/context';

let _sessionReviewer = '';

function fmtTs(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

export default function QAReviewScreen() {
  const { profile } = useAuth();
  const canReview = Boolean(profile?.active && ['admin', 'supervisor', 'qa'].includes(profile.role));
  const params = useLocalSearchParams<{ itemId?: string }>();
  const targetItemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const [oItems, setOItems] = useState<OItemItem[]>([]);
  const [preps, setPreps] = useState<PrepQueueItem[]>([]);
  const [chillLogs, setChillLogs] = useState<ChillLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState(_sessionReviewer);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const results = await Promise.allSettled([
      getOperationalItems(),
      getPrepQueueItems(),
      getChillLogs(),
    ]);
    const [oR, pR, cR] = results;
    if (oR.status === 'fulfilled') setOItems(oR.value);
    if (pR.status === 'fulfilled') setPreps(pR.value);
    if (cR.status === 'fulfilled') setChillLogs(cR.value);
    const firstFail = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstFail) {
      logFirebaseError('QAReview', 'operational_items/qa_checks/prep_queue/chill_logs', firstFail.reason);
      setLoadError(toOperatorMessage(firstFail.reason, 'Failed to load QA data.'));
    }
    setIsLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const prepById = useMemo(
    () => preps.reduce<Record<string, PrepQueueItem>>((map, p) => { map[p.id] = p; return map; }, {}),
    [preps],
  );

  const chillById = useMemo(
    () => chillLogs.reduce<Record<string, ChillLogItem>>((map, c) => { map[c.id] = c; return map; }, {}),
    [chillLogs],
  );

  const qaStageItems = useMemo(
    () => oItems.filter((item) => item.stage === 'qa' || item.status === 'ready_for_packaging'),
    [oItems],
  );

  const readyForQa = useMemo(
    () => qaStageItems.filter((item) => item.status === 'ready_for_qa').sort((a, b) => Number(b.id === targetItemId) - Number(a.id === targetItemId)),
    [qaStageItems, targetItemId],
  );

  const qaHold = useMemo(
    () => qaStageItems.filter((item) => item.status === 'qa_hold' || item.status === 'qa_review_required' || item.status === 'hold').sort((a, b) => Number(b.id === targetItemId) - Number(a.id === targetItemId)),
    [qaStageItems, targetItemId],
  );

  const released = useMemo(
    () => qaStageItems.filter((item) => item.status === 'ready_for_packaging'),
    [qaStageItems],
  );

  const deviationNotes = useMemo(
    () => qaStageItems.filter((item) => item.hasDeviation || (item.qaNotes ?? '').toLowerCase().includes('deviation')).slice(0, 10),
    [qaStageItems],
  );

  async function onApprove(item: OItemItem) {
    const note = (noteById[item.id] ?? '').trim();
    if (!item.qaCheckId) { setActionMsg('Missing QA check linkage.'); return; }
    if (!reviewer.trim()) { setActionMsg('Reviewer is required.'); return; }
    if (note.length < 10) { setActionMsg('QA note must be at least 10 characters.'); return; }
    try {
      setWorkingId(item.id);
      await oItemQAReview(item.id, item.stage, item.status, item.qaCheckId, {
        decision: 'approve_for_packaging',
        reviewedBy: reviewer.trim(),
        notes: note,
      }, reviewer.trim());
      setActionMsg(`Released to Packaging: ${item.productName || item.id}`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to release to packaging.'));
    } finally {
      setWorkingId(null);
    }
  }

  async function onHold(item: OItemItem) {
    const note = (noteById[item.id] ?? '').trim();
    if (!item.qaCheckId) { setActionMsg('Missing QA check linkage.'); return; }
    if (!reviewer.trim()) { setActionMsg('Reviewer is required.'); return; }
    if (note.length < 10) { setActionMsg('QA hold note must be at least 10 characters.'); return; }
    try {
      setWorkingId(item.id);
      await oItemQAReview(item.id, item.stage, item.status, item.qaCheckId, {
        decision: 'qa_hold',
        reviewedBy: reviewer.trim(),
        notes: note,
      }, reviewer.trim());
      setActionMsg(`Placed on QA Hold: ${item.productName || item.id}`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to place QA hold.'));
    } finally {
      setWorkingId(null);
    }
  }

  async function onReleaseHold(item: OItemItem) {
    const note = (noteById[item.id] ?? '').trim();
    if (!item.qaCheckId) { setActionMsg('Missing QA check linkage.'); return; }
    if (!note) { setActionMsg('Release hold note is required.'); return; }
    try {
      setWorkingId(item.id);
      await oItemQAResubmit(item.id, item.stage, item.status, item.qaCheckId, note, reviewer.trim() || 'QA reviewer');
      setActionMsg(`Released hold and re-submitted: ${item.productName || item.id}`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to release hold.'));
    } finally {
      setWorkingId(null);
    }
  }

  async function onAddNote(item: OItemItem) {
    const note = (noteById[item.id] ?? '').trim();
    if (!item.qaCheckId) { setActionMsg('Missing QA check linkage.'); return; }
    if (!note) { setActionMsg('QA note is required.'); return; }
    try {
      setWorkingId(item.id);
      await oItemAppendQANote(item.id, item.qaCheckId, note);
      setActionMsg(`QA note added: ${item.productName || item.id}`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to add QA note.'));
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader
          title="QA Review"
          subtitle={`Ready for QA: ${readyForQa.length}`}
          right={<Pressable style={styles.refreshBtn} onPress={load}><Text style={styles.refreshText}>Refresh</Text></Pressable>}
        />
        <C3SOperatorFocus
          status={`${readyForQa.length} waiting for QA`}
          action={qaHold.length > 0 ? 'Resolve Hold' : readyForQa.length > 0 ? 'Approve' : 'No Action Required'}
          detail={qaHold.length > 0 ? `${qaHold.length} held item${qaHold.length === 1 ? '' : 's'} require QA review.` : 'Reviewer identity and traceability notes remain required.'}
          tone={qaHold.length > 0 ? 'critical' : readyForQa.length > 0 ? 'active' : 'complete'}
        />

        {canReview ? <View style={styles.reviewerRow}>
          <Text style={styles.reviewerLabel}>Reviewer</Text>
          <TextInput
            style={styles.reviewerInput}
            value={reviewer}
            onChangeText={(v) => { setReviewer(v); _sessionReviewer = v; }}
            placeholder="Reviewer name"
            placeholderTextColor={C3S_COLORS.textMuted}
            autoCorrect={false}
            autoCapitalize="words"
          />
        </View> : <Text style={styles.info}>QA actions are read-only for your current role.</Text>}

        <ScrollView contentContainerStyle={styles.content}>
          {isLoading ? <Text style={styles.info}>Loading QA gate data...</Text> : null}
          {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
          {actionMsg ? <Text style={styles.info}>{actionMsg}</Text> : null}

          <Text style={styles.sectionTitle}>Ready for QA</Text>
          {readyForQa.length === 0 ? <Empty text="No products ready for QA." /> : null}
          {readyForQa.map((item) => {
            const prep = item.prepQueueId ? prepById[item.prepQueueId] : null;
            const chill = item.chillLogId ? chillById[item.chillLogId] : null;
            return (
              <C3SCard key={item.id} borderColor={C3S_COLORS.accent}>
                <Text style={styles.itemTitle}>{item.productName || prep?.productNameSnapshot || '—'}</Text>
                <Meta label="Product Code" value={prep?.productCodeSnapshot ?? prep?.productCode ?? '—'} />
                <Meta label="Cases / Racks" value={`${prep?.cases ?? '—'} / ${item.racks ?? prep?.racks ?? '—'}`} />
                <Meta label="Source Chiller" value={chill?.chillerId ?? '—'} />
                <Meta label="Chill Complete Time" value={fmtTs(item.qaTimestamp?.toMillis?.())} />
                <Meta label="Expected Packaging ETA" value={prep?.packagingReadyETA ?? '—'} />
                <Meta label="Deviation" value={item.hasDeviation ? 'Yes' : 'No'} />
                <Meta label="Current Department" value="QA" />
                <Meta label="Next Step" value="Approve to Packaging or Hold" />
                <Meta label="From" value="Chill" />
                <Meta label="To" value="Packaging" />
                <TextInput
                  style={styles.noteInput}
                  value={noteById[item.id] ?? ''}
                  onChangeText={(v) => setNoteById((m) => ({ ...m, [item.id]: v }))}
                  placeholder="QA note"
                  placeholderTextColor={C3S_COLORS.textMuted}
                />
                <View style={styles.actions}>
                  <Pressable style={styles.secondaryBtn} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}`)}><Text style={styles.secondaryBtnText}>Open Batch</Text></Pressable>
                  {canReview ? <Pressable style={styles.primaryBtn} disabled={workingId === item.id} onPress={() => onApprove(item)}>
                    <Text style={styles.primaryBtnText}>{workingId === item.id ? 'Saving...' : 'Approve'}</Text>
                  </Pressable> : null}
                  {canReview ? <Pressable style={styles.warnBtn} disabled={workingId === item.id} onPress={() => onHold(item)}>
                    <Text style={styles.warnBtnText}>Place QA Hold</Text>
                  </Pressable> : null}
                  {canReview ? <Pressable style={styles.secondaryBtn} disabled={workingId === item.id} onPress={() => onAddNote(item)}>
                    <Text style={styles.secondaryBtnText}>Add QA Note</Text>
                  </Pressable> : null}
                </View>
              </C3SCard>
            );
          })}

          <Text style={styles.sectionTitle}>QA Hold</Text>
          {qaHold.length === 0 ? <Empty text="No items on QA hold." /> : null}
          {qaHold.map((item) => (
            <C3SCard key={item.id} borderColor={C3S_COLORS.danger}>
              <Text style={styles.itemTitle}>{item.productName || item.prepQueueId || '—'}</Text>
              <Meta label="Hold Reason" value={item.qaNotes || item.deviationNotes || '—'} />
              <Meta label="Timestamp" value={fmtTs(item.qaReviewedAt?.toMillis?.() || item.qaTimestamp?.toMillis?.())} />
              <Meta label="Reviewer" value={item.qaReviewedBy || '—'} />
              <Meta label="Current Department" value="QA Hold" />
              <Meta label="Next Step" value="Release Hold or Update Note" />
              <Meta label="From" value="QA" />
              <Meta label="To" value="QA Review" />
              <TextInput
                style={styles.noteInput}
                value={noteById[item.id] ?? ''}
                onChangeText={(v) => setNoteById((m) => ({ ...m, [item.id]: v }))}
                placeholder="Hold update note"
                placeholderTextColor={C3S_COLORS.textMuted}
              />
              <View style={styles.actions}>
                <Pressable style={styles.secondaryBtn} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}`)}><Text style={styles.secondaryBtnText}>Open Batch</Text></Pressable>
                {canReview ? <Pressable style={styles.primaryBtn} disabled={workingId === item.id} onPress={() => onReleaseHold(item)}>
                  <Text style={styles.primaryBtnText}>Release Hold</Text>
                </Pressable> : null}
                {canReview ? <Pressable style={styles.secondaryBtn} disabled={workingId === item.id} onPress={() => onAddNote(item)}>
                  <Text style={styles.secondaryBtnText}>Update Note</Text>
                </Pressable> : null}
              </View>
            </C3SCard>
          ))}

          <C3SDisclosure title="History" count={released.length + deviationNotes.length}>
          <Text style={styles.sectionTitle}>Released to Packaging</Text>
          {released.length === 0 ? <Empty text="No items released to packaging yet." /> : null}
          {released.map((item) => (
            <C3SCard key={item.id} borderColor={C3S_COLORS.success}>
              <Text style={styles.itemTitle}>{item.productName || item.prepQueueId || '—'}</Text>
              <Meta label="Released Time" value={fmtTs(item.qaReviewedAt?.toMillis?.() || item.qaTimestamp?.toMillis?.())} />
              <Meta label="Reviewer" value={item.qaReviewedBy || '—'} />
              <Meta label="Destination" value="Packaging" />
              <Meta label="Release Notes" value={item.qaNotes || '—'} />
              <Meta label="Current Department" value="Packaging Queue" />
              <Meta label="Next Step" value="Start Packaging" />
              <Meta label="From" value="QA" />
              <Meta label="To" value="Packaging" />
              <Pressable style={styles.secondaryBtn} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}`)}><Text style={styles.secondaryBtnText}>Open History</Text></Pressable>
            </C3SCard>
          ))}

          <Text style={styles.sectionTitle}>Deviation Notes</Text>
          {deviationNotes.length === 0 ? <Empty text="No QA deviation notes currently." /> : null}
          {deviationNotes.map((item) => (
            <C3SCard key={`dev-${item.id}`} borderColor={C3S_COLORS.danger}>
              <Text style={styles.itemTitle}>{item.productName || item.prepQueueId || '—'}</Text>
              <Meta label="Timestamp" value={fmtTs(item.qaReviewedAt?.toMillis?.() || item.qaTimestamp?.toMillis?.())} />
              <Meta label="Reviewer" value={item.qaReviewedBy || '—'} />
              <Meta label="Note" value={item.qaNotes || item.deviationNotes || '—'} />
            </C3SCard>
          ))}
          </C3SDisclosure>
        </ScrollView>
      </C3SPage>
    </C3SScreen>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value || '—'}</Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 8, paddingBottom: 24 },
  refreshBtn: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshText: { color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  reviewerRow: { marginBottom: 8, gap: 4 },
  reviewerLabel: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '800' },
  reviewerInput: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: C3S_COLORS.textPrimary,
    fontSize: 15,
  },
  sectionTitle: { color: C3S_COLORS.textStrong, fontSize: 19, fontWeight: '900', marginTop: 8 },
  itemTitle: { color: C3S_COLORS.textStrong, fontSize: 18, fontWeight: '900', marginBottom: 7 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  metaLabel: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  metaValue: { color: C3S_COLORS.textPrimary, fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  noteInput: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    color: C3S_COLORS.textPrimary,
    fontSize: 14,
    marginTop: 6,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  primaryBtn: {
    borderWidth: 1,
    borderColor: C3S_COLORS.accent,
    backgroundColor: C3S_COLORS.accent,
    borderRadius: 11,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  warnBtn: {
    borderWidth: 1,
    borderColor: C3S_COLORS.danger,
    backgroundColor: C3S_COLORS.dangerSoft,
    borderRadius: 11,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  warnBtnText: { color: C3S_COLORS.danger, fontSize: 14, fontWeight: '900' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panelAlt,
    borderRadius: 11,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  secondaryBtnText: { color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  emptyCard: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    borderRadius: 8,
    backgroundColor: C3S_COLORS.panelAlt,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  emptyText: { color: C3S_COLORS.textMuted, fontSize: 13 },
  info: { color: C3S_COLORS.accent, fontSize: 12, fontWeight: '700' },
  error: { color: C3S_COLORS.danger, fontSize: 12, fontWeight: '700' },
});
