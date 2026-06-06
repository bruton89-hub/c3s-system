import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import {
  getChillLogs,
  getPackagingLogs,
  getPrepQueueItems,
  getQAChecks,
  type ChillLogItem,
  type PackagingLogItem,
  type PrepQueueItem,
  type QACheckItem,
} from '@/lib/firebase/repository';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import {
  getOperationalItems,
  oItemAppendPackagingNote,
  oItemCompletePackaging,
  oItemHoldPackaging,
  oItemResumePackaging,
  oItemStartPackaging,
  type OItemItem,
} from '@/lib/operational-items';

function fmtTs(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

function elapsedText(startMs?: number, endMs?: number) {
  if (!startMs || !Number.isFinite(startMs)) return '—';
  const to = endMs && Number.isFinite(endMs) ? endMs : Date.now();
  const m = Math.floor((to - startMs) / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function PackagingScreen() {
  const [oItems, setOItems] = useState<OItemItem[]>([]);
  const [qaChecks, setQaChecks] = useState<QACheckItem[]>([]);
  const [preps, setPreps] = useState<PrepQueueItem[]>([]);
  const [chillLogs, setChillLogs] = useState<ChillLogItem[]>([]);
  const [packagingLogs, setPackagingLogs] = useState<PackagingLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const [holdReasonByLogId, setHoldReasonByLogId] = useState<Record<string, string>>({});
  const [noteByLogId, setNoteByLogId] = useState<Record<string, string>>({});
  const [casesByLogId, setCasesByLogId] = useState<Record<string, string>>({});
  const [unitsByLogId, setUnitsByLogId] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const results = await Promise.allSettled([
      getOperationalItems(),
      getQAChecks(),
      getPrepQueueItems(),
      getChillLogs(),
      getPackagingLogs(),
    ]);
    const [oR, qR, pR, chR, logsR] = results;
    if (oR.status === 'fulfilled') setOItems(oR.value);
    if (qR.status === 'fulfilled') setQaChecks(qR.value);
    if (pR.status === 'fulfilled') setPreps(pR.value);
    if (chR.status === 'fulfilled') setChillLogs(chR.value);
    if (logsR.status === 'fulfilled') setPackagingLogs(logsR.value);
    const firstFail = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstFail) {
      logFirebaseError('Packaging', 'operational_items/qa_checks/prep_queue/chill_logs/packaging_logs', firstFail.reason);
      setLoadError(toOperatorMessage(firstFail.reason, 'Failed to load packaging data.'));
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

  const packagingStageItems = useMemo(
    () => oItems.filter(
      (item) =>
        item.stage === 'packaging' ||
        item.status === 'ready_for_packaging' ||  // stage='qa' but cleared by QA — ready to package
        item.status === 'packaging_complete' ||
        item.status === 'complete',
    ),
    [oItems],
  );

  const readyForPackaging = useMemo(
    () => packagingStageItems.filter((item) => item.status === 'ready_for_packaging'),
    [packagingStageItems],
  );

  const inProgress = useMemo(
    () => packagingStageItems.filter((item) => item.status === 'packaging_in_progress'),
    [packagingStageItems],
  );

  const packaged = useMemo(
    () => packagingStageItems.filter((item) => item.status === 'packaging_complete' || item.status === 'complete'),
    [packagingStageItems],
  );

  const holdDelay = useMemo(
    () => packagingStageItems.filter((item) => item.packagingLogStatus === 'deviation' || item.hasDeviation),
    [packagingStageItems],
  );

  async function onStartPackaging(item: OItemItem) {
    if (!item.qaCheckId) {
      setActionMsg('Missing QA check linkage.');
      return;
    }
    try {
      setWorkingId(item.id);
      await oItemStartPackaging(item.id, item.stage, item.status, item.qaCheckId);
      setActionMsg(`Started packaging for ${item.productName || item.id}.`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to start packaging.'));
    } finally {
      setWorkingId(null);
    }
  }

  async function onMarkPackaged(item: OItemItem) {
    const cases = Number(casesByLogId[item.id] ?? '1');
    const units = Number(unitsByLogId[item.id] ?? '1');
    if (!item.packagingLogId) {
      setActionMsg('Missing packaging log linkage.');
      return;
    }
    if (!Number.isFinite(cases) || cases <= 0 || !Number.isFinite(units) || units <= 0) {
      setActionMsg('Cases/units must be positive numbers.');
      return;
    }
    try {
      setWorkingId(item.id);
      await oItemCompletePackaging(item.id, item.stage, item.status, item.packagingLogId, {
        casesProduced: cases,
        unitsProduced: units,
        yieldPercent: null,
        notes: noteByLogId[item.id] ?? '',
        packagingLine: '',
        packagedBy: 'Packaging Operator',
      });
      setActionMsg(`Marked packaged: ${item.productName}.`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to mark packaged.'));
    } finally {
      setWorkingId(null);
    }
  }

  async function onPlaceHold(item: OItemItem) {
    const reason = (holdReasonByLogId[item.id] ?? '').trim();
    if (!item.packagingLogId) {
      setActionMsg('Missing packaging log linkage.');
      return;
    }
    if (!reason) {
      setActionMsg('Hold reason is required.');
      return;
    }
    try {
      setWorkingId(item.id);
      await oItemHoldPackaging(item.id, item.packagingLogId, reason);
      setActionMsg(`Placed hold on ${item.productName}.`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to place hold.'));
    } finally {
      setWorkingId(null);
    }
  }

  async function onResume(item: OItemItem) {
    if (!item.packagingLogId) {
      setActionMsg('Missing packaging log linkage.');
      return;
    }
    try {
      setWorkingId(item.id);
      await oItemResumePackaging(item.id, item.packagingLogId);
      setActionMsg(`Resumed packaging for ${item.productName}.`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to resume packaging.'));
    } finally {
      setWorkingId(null);
    }
  }

  async function onUpdateNote(item: OItemItem) {
    const note = (noteByLogId[item.id] ?? '').trim();
    if (!item.packagingLogId) {
      setActionMsg('Missing packaging log linkage.');
      return;
    }
    if (!note) {
      setActionMsg('Note is required.');
      return;
    }
    try {
      setWorkingId(item.id);
      await oItemAppendPackagingNote(item.id, item.packagingLogId, note);
      setActionMsg(`Updated note for ${item.productName}.`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to update note.'));
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader
          title="Packaging"
          subtitle={`Ready for Packaging: ${readyForPackaging.length}`}
          right={<Pressable style={styles.refreshBtn} onPress={load}><Text style={styles.refreshText}>Refresh</Text></Pressable>}
        />

        <ScrollView contentContainerStyle={styles.content}>
          {isLoading ? <Text style={styles.info}>Loading packaging execution data...</Text> : null}
          {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
          {actionMsg ? <Text style={styles.info}>{actionMsg}</Text> : null}

          <Text style={styles.sectionTitle}>Ready for Packaging</Text>
          {readyForPackaging.length === 0 ? <Empty text="No products ready to package." /> : null}
          {readyForPackaging.map((item) => {
            const prep = item.prepQueueId ? prepById[item.prepQueueId] : null;
            const chill = item.chillLogId ? chillById[item.chillLogId] : null;
            const qa = item.qaCheckId ? qaChecks.find((q) => q.id === item.qaCheckId) : null;
            return (
              <C3SCard key={item.id} borderColor="#2F6D8A">
                <Text style={styles.itemTitle}>{item.productName || prep?.productNameSnapshot || '—'}</Text>
                <Meta label="Product Code" value={prep?.productCodeSnapshot ?? prep?.productCode ?? '—'} />
                <Meta label="Cases / Racks" value={`${prep?.cases ?? '—'} / ${item.racks ?? prep?.racks ?? '—'}`} />
                <Meta label="Source QA Release Time" value={fmtTs(item.qaReviewedAt?.toMillis?.() || qa?.reviewedAt?.toMillis?.())} />
                <Meta label="Source Chiller" value={chill?.chillerId ?? '—'} />
                <Meta label="Expected Packaging ETA" value={prep?.packagingReadyETA ?? '—'} />
                <Meta label="Current Department" value="Packaging Queue" />
                <Meta label="Next Step" value="Start Packaging" />
                <Meta label="From" value="QA" />
                <Meta label="To" value="Packaging" />
                <Pressable style={styles.primaryBtn} disabled={workingId === item.id} onPress={() => onStartPackaging(item)}>
                  <Text style={styles.primaryBtnText}>{workingId === item.id ? 'Starting...' : 'Start Packaging'}</Text>
                </Pressable>
              </C3SCard>
            );
          })}

          <Text style={styles.sectionTitle}>Packaging In Progress</Text>
          {inProgress.length === 0 ? <Empty text="No product currently being packaged." /> : null}
          {inProgress.map((item) => {
            const startMs = item.packagingStartedAt?.toMillis?.();
            const prep = item.prepQueueId ? prepById[item.prepQueueId] : null;
            const expectedFinish = prep?.expectedPackMinutes && startMs
              ? new Date(startMs + prep.expectedPackMinutes * 60000).toLocaleString()
              : '—';
            return (
              <C3SCard key={item.id} borderColor="#FFA726">
                <Text style={styles.itemTitle}>{item.productName || prep?.productNameSnapshot || '—'}</Text>
                <Meta label="Start Time" value={fmtTs(startMs)} />
                <Meta label="Elapsed Time" value={elapsedText(startMs)} />
                <Meta label="Expected Finish" value={expectedFinish} />
                <Meta label="Current Department" value="Packaging" />
                <Meta label="Next Step" value="Mark Packaged or Place Hold" />
                <Meta label="From" value="QA" />
                <Meta label="To" value="Complete" />
                <View style={styles.rowInput}>
                  <TextInput style={styles.input} placeholder="Cases" placeholderTextColor="#6E7681" keyboardType="numeric" value={casesByLogId[item.id] ?? ''} onChangeText={(v) => setCasesByLogId((m) => ({ ...m, [item.id]: v }))} />
                  <TextInput style={styles.input} placeholder="Units" placeholderTextColor="#6E7681" keyboardType="numeric" value={unitsByLogId[item.id] ?? ''} onChangeText={(v) => setUnitsByLogId((m) => ({ ...m, [item.id]: v }))} />
                </View>
                <TextInput style={styles.noteInput} placeholder="Packaging note" placeholderTextColor="#6E7681" value={noteByLogId[item.id] ?? ''} onChangeText={(v) => setNoteByLogId((m) => ({ ...m, [item.id]: v }))} />
                <TextInput style={styles.noteInput} placeholder="Hold reason" placeholderTextColor="#6E7681" value={holdReasonByLogId[item.id] ?? ''} onChangeText={(v) => setHoldReasonByLogId((m) => ({ ...m, [item.id]: v }))} />
                <View style={styles.actions}>
                  <Pressable style={styles.primaryBtn} disabled={workingId === item.id} onPress={() => onMarkPackaged(item)}><Text style={styles.primaryBtnText}>Mark Packaged</Text></Pressable>
                  <Pressable style={styles.warnBtn} disabled={workingId === item.id} onPress={() => onPlaceHold(item)}><Text style={styles.warnBtnText}>Place Hold</Text></Pressable>
                  <Pressable style={styles.secondaryBtn} disabled={workingId === item.id} onPress={() => onUpdateNote(item)}><Text style={styles.secondaryBtnText}>Add/Update Note</Text></Pressable>
                </View>
              </C3SCard>
            );
          })}

          <Text style={styles.sectionTitle}>Packaged</Text>
          {packaged.length === 0 ? <Empty text="No completed packaging logs." /> : null}
          {packaged.map((item) => (
            <C3SCard key={item.id} borderColor="#66BB6A">
              <Text style={styles.itemTitle}>{item.productName}</Text>
              <Meta label="Completed Time" value={fmtTs(item.packagingCompletedAt?.toMillis?.())} />
              <Meta label="Total Elapsed" value={elapsedText(item.packagingStartedAt?.toMillis?.(), item.packagingCompletedAt?.toMillis?.())} />
              <Meta label="Notes" value={item.packagingNotes || '—'} />
            </C3SCard>
          ))}

          <Text style={styles.sectionTitle}>Hold / Delay</Text>
          {holdDelay.length === 0 ? <Empty text="No packaging hold/delay items." /> : null}
          {holdDelay.map((item) => (
            <C3SCard key={item.id} borderColor="#EF5350">
              <Text style={styles.itemTitle}>{item.productName}</Text>
              <Meta label="Reason" value={item.deviationNotes || '—'} />
              <Meta label="Timestamp" value={fmtTs(item.deviationAt?.toMillis?.())} />
              <Meta label="Source Product" value={item.productName || '—'} />
              <TextInput style={styles.noteInput} placeholder="Update note" placeholderTextColor="#6E7681" value={noteByLogId[item.id] ?? ''} onChangeText={(v) => setNoteByLogId((m) => ({ ...m, [item.id]: v }))} />
              <View style={styles.actions}>
                <Pressable style={styles.primaryBtn} disabled={workingId === item.id} onPress={() => onResume(item)}><Text style={styles.primaryBtnText}>Resume Packaging</Text></Pressable>
                <Pressable style={styles.secondaryBtn} disabled={workingId === item.id} onPress={() => onUpdateNote(item)}><Text style={styles.secondaryBtnText}>Update Note</Text></Pressable>
              </View>
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
  sectionTitle: { color: '#8AB4F8', fontSize: 13, fontWeight: '800', marginTop: 4 },
  itemTitle: { color: '#E6EDF3', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  metaLabel: { color: '#8B949E', fontSize: 11, fontWeight: '700' },
  metaValue: { color: '#C9D1D9', fontSize: 11, fontWeight: '600' },
  rowInput: { flexDirection: 'row', gap: 8, marginTop: 6 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#0D1117',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    color: '#E6EDF3',
    fontSize: 12,
  },
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
