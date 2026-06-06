import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import {
  getChillLogs,
  getPrepQueueItems,
  getQAChecks,
  type ChillLogItem,
  type PrepQueueItem,
  type QACheckItem,
} from '@/lib/firebase/repository';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import {
  getOperationalItems,
  oItemAppendQANote,
  oItemQAResubmit,
  oItemQAReview,
  type OItemItem,
} from '@/lib/operational-items';

let _sessionReviewer = '';

function fmtTs(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

export default function QAReviewScreen() {
  const [oItems, setOItems] = useState<OItemItem[]>([]);
  const [qaChecks, setQaChecks] = useState<QACheckItem[]>([]);
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
      getQAChecks(),
      getPrepQueueItems(),
      getChillLogs(),
    ]);
    const [oR, qR, pR, cR] = results;
    if (oR.status === 'fulfilled') setOItems(oR.value);
    if (qR.status === 'fulfilled') setQaChecks(qR.value);
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
    () => qaStageItems.filter((item) => item.status === 'ready_for_qa'),
    [qaStageItems],
  );

  const qaHold = useMemo(
    () => qaStageItems.filter((item) => item.status === 'qa_hold' || item.status === 'qa_review_required' || item.status === 'hold'),
    [qaStageItems],
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
      });
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
      });
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
      await oItemQAResubmit(item.id, item.stage, item.status, item.qaCheckId, note);
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

        <View style={styles.reviewerRow}>
          <Text style={styles.reviewerLabel}>Reviewer</Text>
          <TextInput
            style={styles.reviewerInput}
            value={reviewer}
            onChangeText={(v) => { setReviewer(v); _sessionReviewer = v; }}
            placeholder="Reviewer name"
            placeholderTextColor="#6E7681"
            autoCorrect={false}
            autoCapitalize="words"
          />
        </View>

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
              <C3SCard key={item.id} borderColor="#2F6D8A">
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
                  placeholderTextColor="#6E7681"
                />
                <View style={styles.actions}>
                  <Pressable style={styles.primaryBtn} disabled={workingId === item.id} onPress={() => onApprove(item)}>
                    <Text style={styles.primaryBtnText}>{workingId === item.id ? 'Saving...' : 'Approve / Release to Packaging'}</Text>
                  </Pressable>
                  <Pressable style={styles.warnBtn} disabled={workingId === item.id} onPress={() => onHold(item)}>
                    <Text style={styles.warnBtnText}>Place QA Hold</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryBtn} disabled={workingId === item.id} onPress={() => onAddNote(item)}>
                    <Text style={styles.secondaryBtnText}>Add QA Note</Text>
                  </Pressable>
                </View>
              </C3SCard>
            );
          })}

          <Text style={styles.sectionTitle}>QA Hold</Text>
          {qaHold.length === 0 ? <Empty text="No items on QA hold." /> : null}
          {qaHold.map((item) => (
            <C3SCard key={item.id} borderColor="#C62828">
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
                placeholderTextColor="#6E7681"
              />
              <View style={styles.actions}>
                <Pressable style={styles.primaryBtn} disabled={workingId === item.id} onPress={() => onReleaseHold(item)}>
                  <Text style={styles.primaryBtnText}>Release Hold</Text>
                </Pressable>
                <Pressable style={styles.secondaryBtn} disabled={workingId === item.id} onPress={() => onAddNote(item)}>
                  <Text style={styles.secondaryBtnText}>Update Note</Text>
                </Pressable>
              </View>
            </C3SCard>
          ))}

          <Text style={styles.sectionTitle}>Released to Packaging</Text>
          {released.length === 0 ? <Empty text="No items released to packaging yet." /> : null}
          {released.map((item) => (
            <C3SCard key={item.id} borderColor="#66BB6A">
              <Text style={styles.itemTitle}>{item.productName || item.prepQueueId || '—'}</Text>
              <Meta label="Released Time" value={fmtTs(item.qaReviewedAt?.toMillis?.() || item.qaTimestamp?.toMillis?.())} />
              <Meta label="Reviewer" value={item.qaReviewedBy || '—'} />
              <Meta label="Destination" value="Packaging" />
              <Meta label="Release Notes" value={item.qaNotes || '—'} />
              <Meta label="Current Department" value="Packaging Queue" />
              <Meta label="Next Step" value="Start Packaging" />
              <Meta label="From" value="QA" />
              <Meta label="To" value="Packaging" />
            </C3SCard>
          ))}

          <Text style={styles.sectionTitle}>Deviation Notes</Text>
          {deviationNotes.length === 0 ? <Empty text="No QA deviation notes currently." /> : null}
          {deviationNotes.map((item) => (
            <C3SCard key={`dev-${item.id}`} borderColor="#EF5350">
              <Text style={styles.itemTitle}>{item.productName || item.prepQueueId || '—'}</Text>
              <Meta label="Timestamp" value={fmtTs(item.qaReviewedAt?.toMillis?.() || item.qaTimestamp?.toMillis?.())} />
              <Meta label="Reviewer" value={item.qaReviewedBy || '—'} />
              <Meta label="Note" value={item.qaNotes || item.deviationNotes || '—'} />
            </C3SCard>
          ))}
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
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshText: { color: '#E6EDF3', fontSize: 12, fontWeight: '700' },
  reviewerRow: { marginBottom: 8, gap: 4 },
  reviewerLabel: { color: '#8B949E', fontSize: 11, fontWeight: '700' },
  reviewerInput: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#0D1117',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#E6EDF3',
    fontSize: 13,
  },
  sectionTitle: { color: '#8AB4F8', fontSize: 13, fontWeight: '800', marginTop: 4 },
  itemTitle: { color: '#E6EDF3', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  metaLabel: { color: '#8B949E', fontSize: 11, fontWeight: '700' },
  metaValue: { color: '#C9D1D9', fontSize: 11, fontWeight: '600' },
  noteInput: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#0D1117',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    color: '#E6EDF3',
    fontSize: 12,
    marginTop: 6,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  primaryBtn: {
    borderWidth: 1,
    borderColor: '#2F6D8A',
    backgroundColor: '#13314A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  primaryBtnText: { color: '#E6EDF3', fontSize: 11, fontWeight: '700' },
  warnBtn: {
    borderWidth: 1,
    borderColor: '#C62828',
    backgroundColor: '#2A1414',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  warnBtnText: { color: '#FFB4B4', fontSize: 11, fontWeight: '700' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#455A64',
    backgroundColor: '#1A2430',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  secondaryBtnText: { color: '#CFD8DC', fontSize: 11, fontWeight: '700' },
  emptyCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 8,
    backgroundColor: '#11161D',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  emptyText: { color: '#8B949E', fontSize: 12 },
  info: { color: '#81D4FA', fontSize: 12, fontWeight: '700' },
  error: { color: '#FF8A80', fontSize: 12, fontWeight: '700' },
});
