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
  getQAChecks,
  type ChillLogItem,
  type PrepQueueItem,
  type QACheckItem,
} from '@/lib/firebase/repository';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import {
  getOperationalItems,
  oItemAppendPackagingNote,
  oItemCompletePackaging,
  oItemResumePackaging,
  oItemStartPackaging,
  type OItemItem,
} from '@/lib/operational-items';
import { useAuth } from '@/lib/auth/context';

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
  const { profile } = useAuth();
  const canPackage = Boolean(profile?.active && ['admin', 'supervisor', 'packaging'].includes(profile.role));
  const params = useLocalSearchParams<{ itemId?: string }>();
  const targetItemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const [oItems, setOItems] = useState<OItemItem[]>([]);
  const [qaChecks, setQaChecks] = useState<QACheckItem[]>([]);
  const [preps, setPreps] = useState<PrepQueueItem[]>([]);
  const [chillLogs, setChillLogs] = useState<ChillLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

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
    ]);
    const [oR, qR, pR, chR] = results;
    if (oR.status === 'fulfilled') setOItems(oR.value);
    if (qR.status === 'fulfilled') setQaChecks(qR.value);
    if (pR.status === 'fulfilled') setPreps(pR.value);
    if (chR.status === 'fulfilled') setChillLogs(chR.value);
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
    () => packagingStageItems.filter((item) => item.status === 'ready_for_packaging').sort((a, b) => Number(b.id === targetItemId) - Number(a.id === targetItemId)),
    [packagingStageItems, targetItemId],
  );

  const inProgress = useMemo(
    () => packagingStageItems.filter((item) => item.status === 'packaging_in_progress').sort((a, b) => Number(b.id === targetItemId) - Number(a.id === targetItemId)),
    [packagingStageItems, targetItemId],
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
        <C3SOperatorFocus
          status={`${inProgress.length} packaging • ${readyForPackaging.length} ready`}
          action={holdDelay.length > 0 ? 'Resolve Hold' : inProgress.length > 0 ? 'Complete Batch' : readyForPackaging.length > 0 ? 'Start Packaging' : 'No Action Required'}
          detail={holdDelay.length > 0 ? `${holdDelay.length} held batch${holdDelay.length === 1 ? '' : 'es'} require review.` : 'Enter final counts only when completing the active batch.'}
          tone={holdDelay.length > 0 ? 'critical' : inProgress.length + readyForPackaging.length > 0 ? 'active' : 'complete'}
        />
        {!canPackage ? <Text style={styles.info}>Packaging actions are read-only for your current role.</Text> : null}

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
              <C3SCard key={item.id} borderColor={C3S_COLORS.accent}>
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
                <View style={styles.actions}><Pressable style={styles.secondaryBtn} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}`)}><Text style={styles.secondaryBtnText}>Open Batch</Text></Pressable>{canPackage ? <Pressable style={styles.primaryBtn} disabled={workingId === item.id} onPress={() => onStartPackaging(item)}><Text style={styles.primaryBtnText}>{workingId === item.id ? 'Starting...' : 'Start Packaging'}</Text></Pressable> : null}</View>
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
              <C3SCard key={item.id} borderColor={C3S_COLORS.warning}>
                <Text style={styles.itemTitle}>{item.productName || prep?.productNameSnapshot || '—'}</Text>
                <Meta label="Start Time" value={fmtTs(startMs)} />
                <Meta label="Elapsed Time" value={elapsedText(startMs)} />
                <Meta label="Expected Finish" value={expectedFinish} />
                <Meta label="Current Department" value="Packaging" />
                <Meta label="Next Step" value="Mark Packaged or Place Hold" />
                <Meta label="From" value="QA" />
                <Meta label="To" value="Complete" />
                <View style={styles.rowInput}>
                  <TextInput style={styles.input} placeholder="Cases" placeholderTextColor={C3S_COLORS.textMuted} keyboardType="numeric" value={casesByLogId[item.id] ?? ''} onChangeText={(v) => setCasesByLogId((m) => ({ ...m, [item.id]: v }))} />
                  <TextInput style={styles.input} placeholder="Units" placeholderTextColor={C3S_COLORS.textMuted} keyboardType="numeric" value={unitsByLogId[item.id] ?? ''} onChangeText={(v) => setUnitsByLogId((m) => ({ ...m, [item.id]: v }))} />
                </View>
                <TextInput style={styles.noteInput} placeholder="Packaging note" placeholderTextColor={C3S_COLORS.textMuted} value={noteByLogId[item.id] ?? ''} onChangeText={(v) => setNoteByLogId((m) => ({ ...m, [item.id]: v }))} />
                <View style={styles.actions}>
                  <Pressable style={styles.secondaryBtn} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}`)}><Text style={styles.secondaryBtnText}>Open Batch</Text></Pressable>
                  {canPackage ? <Pressable style={styles.primaryBtn} disabled={workingId === item.id} onPress={() => onMarkPackaged(item)}><Text style={styles.primaryBtnText}>Complete Batch</Text></Pressable> : null}
                  {canPackage ? <Pressable style={styles.warnBtn} disabled={workingId === item.id} onPress={() => router.push(`/hold?itemId=${encodeURIComponent(item.id)}&mode=place`)}><Text style={styles.warnBtnText}>Place on Hold</Text></Pressable> : null}
                  {canPackage ? <Pressable style={styles.secondaryBtn} disabled={workingId === item.id} onPress={() => onUpdateNote(item)}><Text style={styles.secondaryBtnText}>Add/Update Note</Text></Pressable> : null}
                </View>
              </C3SCard>
            );
          })}

          <C3SDisclosure title="Completed batches" count={packaged.length}>
          <Text style={styles.sectionTitle}>Packaged</Text>
          {packaged.length === 0 ? <Empty text="No completed packaging logs." /> : null}
          {packaged.map((item) => (
            <C3SCard key={item.id} borderColor={C3S_COLORS.success}>
              <Text style={styles.itemTitle}>{item.productName}</Text>
              <Meta label="Completed Time" value={fmtTs(item.packagingCompletedAt?.toMillis?.())} />
              <Meta label="Total Elapsed" value={elapsedText(item.packagingStartedAt?.toMillis?.(), item.packagingCompletedAt?.toMillis?.())} />
              <Meta label="Notes" value={item.packagingNotes || '—'} />
              <Pressable style={styles.secondaryBtn} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}`)}><Text style={styles.secondaryBtnText}>Open History</Text></Pressable>
            </C3SCard>
          ))}
          </C3SDisclosure>

          <Text style={styles.sectionTitle}>Hold / Delay</Text>
          {holdDelay.length === 0 ? <Empty text="No packaging hold/delay items." /> : null}
          {holdDelay.map((item) => (
            <C3SCard key={item.id} borderColor={C3S_COLORS.danger}>
              <Text style={styles.itemTitle}>{item.productName}</Text>
              <Meta label="Reason" value={item.deviationNotes || '—'} />
              <Meta label="Timestamp" value={fmtTs(item.deviationAt?.toMillis?.())} />
              <Meta label="Source Product" value={item.productName || '—'} />
              <TextInput style={styles.noteInput} placeholder="Update note" placeholderTextColor={C3S_COLORS.textMuted} value={noteByLogId[item.id] ?? ''} onChangeText={(v) => setNoteByLogId((m) => ({ ...m, [item.id]: v }))} />
              <View style={styles.actions}>
                {canPackage ? <Pressable style={styles.primaryBtn} disabled={workingId === item.id} onPress={() => onResume(item)}><Text style={styles.primaryBtnText}>Resume Packaging</Text></Pressable> : null}
                {canPackage ? <Pressable style={styles.secondaryBtn} disabled={workingId === item.id} onPress={() => onUpdateNote(item)}><Text style={styles.secondaryBtnText}>Update Note</Text></Pressable> : null}
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
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshText: { color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  sectionTitle: { color: C3S_COLORS.textStrong, fontSize: 19, fontWeight: '900', marginTop: 8 },
  itemTitle: { color: C3S_COLORS.textStrong, fontSize: 18, fontWeight: '900', marginBottom: 7 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  metaLabel: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  metaValue: { color: C3S_COLORS.textPrimary, fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  rowInput: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  input: {
    flex: 1,
    minWidth: 120,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    color: C3S_COLORS.textPrimary,
    fontSize: 14,
  },
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
    flexGrow: 1,
    minWidth: 130,
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
    flexGrow: 1,
    minWidth: 130,
    borderWidth: 1,
    borderColor: C3S_COLORS.danger,
    backgroundColor: C3S_COLORS.dangerSoft,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  warnBtnText: { color: C3S_COLORS.danger, fontSize: 11, fontWeight: '700' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panelAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  secondaryBtnText: { color: C3S_COLORS.textPrimary, fontSize: 11, fontWeight: '700' },
  emptyCard: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    borderRadius: 8,
    backgroundColor: C3S_COLORS.panelAlt,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  emptyText: { color: C3S_COLORS.textMuted, fontSize: 12 },
  info: { color: C3S_COLORS.accent, fontSize: 12, fontWeight: '700' },
  error: { color: C3S_COLORS.danger, fontSize: 12, fontWeight: '700' },
});
