import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import {
  assignChillLogToChiller,
  finishChillLog,
  flagChillLogDeviation,
  getChillers,
  getChillLogs,
  getPrepQueueItems,
  getQAChecks,
  recordChillCheck,
  type ChillerItem,
  type ChillLogItem,
  type PrepQueueItem,
  type QACheckItem,
} from '@/lib/firebase/repository';

function toOperatorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  const lowered = error.message.toLowerCase();
  if (lowered.includes('permission')) return 'Action blocked by access rules.';
  if (lowered.includes('network') || lowered.includes('offline') || lowered.includes('unavailable')) return 'Unable to reach Firestore.';
  return error.message;
}

function prepNameFrom(log: ChillLogItem, prep?: PrepQueueItem | null) {
  return log.productName || prep?.productNameSnapshot || prep?.productName || log.prepId || '—';
}

function fmtTs(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

function elapsedText(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return '—';
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function chillerCapacity(label: string) {
  const m = label.match(/(\d+)/);
  const n = m ? Number(m[1]) : NaN;
  if (n === 8) return 10;
  return 18;
}

export default function ChillerLoadScreen() {
  const [preps, setPreps] = useState<PrepQueueItem[]>([]);
  const [chillLogs, setChillLogs] = useState<ChillLogItem[]>([]);
  const [chillers, setChillers] = useState<ChillerItem[]>([]);
  const [qaChecks, setQaChecks] = useState<QACheckItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const [selectedChillerByLogId, setSelectedChillerByLogId] = useState<Record<string, string>>({});
  const [checkMinutesByLogId, setCheckMinutesByLogId] = useState<Record<string, string>>({});
  const [checkTypeByLogId, setCheckTypeByLogId] = useState<Record<string, '50' | '40'>>({});
  const [signoutTempByLogId, setSignoutTempByLogId] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const [p, c, ch, q] = await Promise.all([
        getPrepQueueItems(),
        getChillLogs(),
        getChillers(),
        getQAChecks(),
      ]);
      setPreps(p);
      setChillLogs(c);
      setChillers(ch);
      setQaChecks(q);
    } catch (e) {
      setLoadError(toOperatorMessage(e, 'Failed to load chill data.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const prepById = useMemo(
    () => preps.reduce<Record<string, PrepQueueItem>>((map, p) => { map[p.id] = p; return map; }, {}),
    [preps],
  );

  const awaitingAssignment = useMemo(
    () => chillLogs.filter((l) => l.status === 'waiting'),
    [chillLogs],
  );

  const running = useMemo(
    () => chillLogs.filter((l) => l.status === 'running'),
    [chillLogs],
  );

  const checkDue = useMemo(
    () => running.filter((l) => l.timeTo50F == null || l.timeTo40F == null),
    [running],
  );

  const readyForQa = useMemo(
    () => qaChecks.filter((q) => q.status === 'ready_for_qa'),
    [qaChecks],
  );

  const holdDeviation = useMemo(
    () => chillLogs.filter((l) => l.status === 'deviation' || l.hasDeviation),
    [chillLogs],
  );

  const chillerStrip = useMemo(() => {
    const byName = chillers.reduce<Record<string, ChillerItem>>((m, c) => { m[c.name] = c; return m; }, {});
    return Array.from({ length: 13 }, (_, idx) => String(idx + 4)).map((n) => {
      const name = `Chiller ${n}`;
      const item = byName[name] ?? null;
      const load = running
        .filter((log) => {
          const assigned = log.chillerId ? chillers.find((c) => c.id === log.chillerId)?.name : null;
          return assigned === name;
        })
        .reduce((sum, log) => sum + (log.racks ?? 0), 0);
      const cap = chillerCapacity(name);
      return { name, item, load, cap, overload: load > cap };
    });
  }, [chillers, running]);

  async function onAssign(log: ChillLogItem) {
    const chillerId = selectedChillerByLogId[log.id];
    if (!chillerId) {
      setActionMsg('Select a chiller before assigning.');
      return;
    }
    try {
      setWorkingId(log.id);
      await assignChillLogToChiller(log.id, chillerId);
      setActionMsg(`Assigned ${prepNameFrom(log, prepById[log.prepId])} to selected chiller.`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to assign chiller.'));
    } finally {
      setWorkingId(null);
    }
  }

  async function onRecordCheck(log: ChillLogItem) {
    const raw = checkMinutesByLogId[log.id] ?? '';
    const value = Number(raw);
    const type = checkTypeByLogId[log.id] ?? (log.timeTo50F == null ? '50' : '40');
    if (!Number.isFinite(value) || value <= 0) {
      setActionMsg('Enter valid minutes for chill check.');
      return;
    }
    try {
      setWorkingId(log.id);
      await recordChillCheck(log.id, type === '50' ? { timeTo50F: value } : { timeTo40F: value });
      setActionMsg(`Recorded ${type}°F chill check for ${prepNameFrom(log, prepById[log.prepId])}.`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to record chill check.'));
    } finally {
      setWorkingId(null);
    }
  }

  async function onSendToQa(log: ChillLogItem) {
    const tempRaw = signoutTempByLogId[log.id] ?? '40';
    const temp = Number(tempRaw);
    if (!Number.isFinite(temp) || temp <= 0) {
      setActionMsg('Enter valid sign-out temp.');
      return;
    }
    try {
      setWorkingId(log.id);
      await finishChillLog(log.id, {
        signedOutTemp: temp,
        timeTo50F: log.timeTo50F ?? undefined,
        timeTo40F: log.timeTo40F ?? undefined,
      });
      setActionMsg(`Marked ready for QA: ${prepNameFrom(log, prepById[log.prepId])}.`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to send to QA.'));
    } finally {
      setWorkingId(null);
    }
  }

  async function onFlagDeviation(log: ChillLogItem) {
    try {
      setWorkingId(log.id);
      await flagChillLogDeviation(log.id, 'Marked from Chiller Load hold/deviation review.');
      setActionMsg(`Flagged deviation for ${prepNameFrom(log, prepById[log.prepId])}.`);
      await load();
    } catch (e) {
      setActionMsg(toOperatorMessage(e, 'Failed to flag deviation.'));
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader
          title="Chiller Load"
          subtitle={`Awaiting Chiller Assignment: ${awaitingAssignment.length}`}
          right={<Pressable style={styles.refreshBtn} onPress={load}><Text style={styles.refreshText}>Refresh</Text></Pressable>}
        />

        <ScrollView contentContainerStyle={styles.content}>
          {isLoading ? <Text style={styles.info}>Loading chill execution data...</Text> : null}
          {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
          {actionMsg ? <Text style={styles.info}>{actionMsg}</Text> : null}

          <Text style={styles.sectionTitle}>Chiller Capacity Strip (4–16)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripRow}>
            {chillerStrip.map((c) => (
              <View key={c.name} style={[styles.stripCard, c.overload && styles.stripOverload]}>
                <Text style={styles.stripName}>{c.name.replace('Chiller ', 'CH-')}</Text>
                <Text style={styles.stripValue}>{c.load}/{c.cap} racks</Text>
                <Text style={styles.stripState}>{c.overload ? 'OVERLOAD' : c.item?.status || 'idle'}</Text>
              </View>
            ))}
          </ScrollView>

          <Text style={styles.sectionTitle}>Awaiting Chiller Assignment</Text>
          {awaitingAssignment.length === 0 ? <Empty text="No items awaiting chiller assignment." /> : null}
          {awaitingAssignment.map((log) => {
            const prep = prepById[log.prepId] ?? null;
            return (
              <C3SCard key={log.id} borderColor="#42A5F5">
                <Text style={styles.itemTitle}>{prepNameFrom(log, prep)}</Text>
                <Meta label="Racks / Cases" value={`${log.racks ?? prep?.racks ?? '—'} / ${prep?.cases ?? '—'}`} />
                <Meta label="Source Smokehouse" value={prep?.assignedSmokehouse ?? '—'} />
                <Meta label="Cook Complete Time" value={fmtTs(prep?.evacuationCompletedAt?.toMillis?.())} />
                <Meta label="Expected Chill Time" value={prep?.expectedChillMinutes != null ? `${prep.expectedChillMinutes} min` : '—'} />
                <View style={styles.rowAction}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                    {chillers.map((c) => {
                      const selected = selectedChillerByLogId[log.id] === c.id;
                      return (
                        <Pressable key={c.id} style={[styles.chip, selected && styles.chipActive]} onPress={() => setSelectedChillerByLogId((m) => ({ ...m, [log.id]: c.id }))}>
                          <Text style={[styles.chipText, selected && styles.chipTextActive]}>{c.name}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <Pressable style={styles.primaryBtn} disabled={workingId === log.id} onPress={() => onAssign(log)}>
                    <Text style={styles.primaryBtnText}>{workingId === log.id ? 'Assigning...' : 'Assign Chiller'}</Text>
                  </Pressable>
                </View>
              </C3SCard>
            );
          })}

          <Text style={styles.sectionTitle}>Chill Running</Text>
          {running.length === 0 ? <Empty text="No products currently chilling." /> : null}
          {running.map((log) => {
            const prep = prepById[log.prepId] ?? null;
            const assignedChiller = log.chillerId ? chillers.find((c) => c.id === log.chillerId)?.name : '—';
            const startMs = log.createdAt?.toMillis?.();
            const expectedEnd = prep?.expectedChillMinutes && startMs
              ? new Date(startMs + prep.expectedChillMinutes * 60000).toLocaleString()
              : '—';
            const nextCheck = log.timeTo50F == null ? 'Record 50°F milestone' : log.timeTo40F == null ? 'Record 40°F milestone' : 'Checks complete';
            return (
              <C3SCard key={log.id} borderColor="#29B6F6">
                <Text style={styles.itemTitle}>{prepNameFrom(log, prep)}</Text>
                <Meta label="Assigned Chiller" value={assignedChiller || '—'} />
                <Meta label="Chill Start" value={fmtTs(startMs)} />
                <Meta label="Elapsed" value={elapsedText(startMs)} />
                <Meta label="Expected Chill Complete" value={expectedEnd} />
                <Meta label="Next Required Check" value={nextCheck} />
                <View style={styles.rowAction}>
                  <TextInput
                    style={styles.input}
                    value={signoutTempByLogId[log.id] ?? ''}
                    onChangeText={(v) => setSignoutTempByLogId((m) => ({ ...m, [log.id]: v }))}
                    placeholder="Sign-out temp °F"
                    placeholderTextColor="#6E7681"
                    keyboardType="numeric"
                  />
                  <Pressable style={styles.primaryBtn} disabled={workingId === log.id} onPress={() => onSendToQa(log)}>
                    <Text style={styles.primaryBtnText}>{workingId === log.id ? 'Saving...' : 'Send to QA'}</Text>
                  </Pressable>
                </View>
              </C3SCard>
            );
          })}

          <Text style={styles.sectionTitle}>Chill Check Due</Text>
          {checkDue.length === 0 ? <Empty text="No chill checks currently due." /> : null}
          {checkDue.map((log) => {
            const prep = prepById[log.prepId] ?? null;
            const defaultType: '50' | '40' = log.timeTo50F == null ? '50' : '40';
            const selectedType = checkTypeByLogId[log.id] ?? defaultType;
            return (
              <C3SCard key={`due-${log.id}`} borderColor="#FFA726">
                <Text style={styles.itemTitle}>{prepNameFrom(log, prep)}</Text>
                <Meta label="Target/Check" value={selectedType === '50' ? '50°F milestone' : '40°F milestone'} />
                <View style={styles.rowAction}>
                  <Pressable style={[styles.chip, selectedType === '50' && styles.chipActive]} onPress={() => setCheckTypeByLogId((m) => ({ ...m, [log.id]: '50' }))}>
                    <Text style={[styles.chipText, selectedType === '50' && styles.chipTextActive]}>50°F</Text>
                  </Pressable>
                  <Pressable style={[styles.chip, selectedType === '40' && styles.chipActive]} onPress={() => setCheckTypeByLogId((m) => ({ ...m, [log.id]: '40' }))}>
                    <Text style={[styles.chipText, selectedType === '40' && styles.chipTextActive]}>40°F</Text>
                  </Pressable>
                  <TextInput
                    style={styles.input}
                    value={checkMinutesByLogId[log.id] ?? ''}
                    onChangeText={(v) => setCheckMinutesByLogId((m) => ({ ...m, [log.id]: v }))}
                    placeholder="Minutes"
                    placeholderTextColor="#6E7681"
                    keyboardType="numeric"
                  />
                  <Pressable style={styles.primaryBtn} disabled={workingId === log.id} onPress={() => onRecordCheck(log)}>
                    <Text style={styles.primaryBtnText}>{workingId === log.id ? 'Saving...' : 'Record Chill Check'}</Text>
                  </Pressable>
                </View>
              </C3SCard>
            );
          })}

          <Text style={styles.sectionTitle}>Ready for QA</Text>
          {readyForQa.length === 0 ? <Empty text="No products waiting for QA." /> : null}
          {readyForQa.map((q) => (
            <C3SCard key={q.id} borderColor="#66BB6A">
              <Text style={styles.itemTitle}>{q.productName || q.prepId || '—'}</Text>
              <Meta label="Status" value="Ready for QA" />
              <Meta label="Timestamp" value={fmtTs(q.timestamp?.toMillis?.())} />
              <Pressable style={styles.secondaryBtn} onPress={() => router.push('/qa-review')}>
                <Text style={styles.secondaryBtnText}>Go to QA / Mark Ready for QA</Text>
              </Pressable>
            </C3SCard>
          ))}

          <Text style={styles.sectionTitle}>Hold / Deviation</Text>
          {holdDeviation.length === 0 ? <Empty text="No chill hold/deviation items." /> : null}
          {holdDeviation.map((log) => (
            <C3SCard key={`hold-${log.id}`} borderColor="#EF5350">
              <Text style={styles.itemTitle}>{log.productName || log.prepId || '—'}</Text>
              <Meta label="Reason" value={log.deviationReason || log.deviationNotes || '—'} />
              <Meta label="Timestamp" value={fmtTs(log.deviationAt?.toMillis?.())} />
              <Pressable style={styles.secondaryBtn} disabled={workingId === log.id} onPress={() => onFlagDeviation(log)}>
                <Text style={styles.secondaryBtnText}>{workingId === log.id ? 'Saving...' : 'Re-Flag Deviation'}</Text>
              </Pressable>
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
  stripRow: { gap: 6 },
  stripCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 90,
  },
  stripOverload: { borderColor: '#C62828', backgroundColor: '#2A1414' },
  stripName: { color: '#E6EDF3', fontSize: 11, fontWeight: '800' },
  stripValue: { color: '#AAB4BE', fontSize: 11 },
  stripState: { color: '#8B949E', fontSize: 10 },
  itemTitle: { color: '#E6EDF3', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  metaLabel: { color: '#8B949E', fontSize: 11, fontWeight: '700' },
  metaValue: { color: '#C9D1D9', fontSize: 11, fontWeight: '600' },
  rowAction: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' },
  chips: { gap: 4 },
  chip: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#0D1117',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  chipActive: { borderColor: '#2F6D8A', backgroundColor: '#13314A' },
  chipText: { color: '#8B949E', fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: '#CDE8FF' },
  input: {
    minWidth: 90,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#0D1117',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: '#E6EDF3',
    fontSize: 12,
  },
  primaryBtn: {
    borderWidth: 1,
    borderColor: '#2F6D8A',
    backgroundColor: '#13314A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  primaryBtnText: { color: '#E6EDF3', fontSize: 11, fontWeight: '700' },
  secondaryBtn: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#455A64',
    backgroundColor: '#1A2430',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  secondaryBtnText: { color: '#C9D1D9', fontSize: 11, fontWeight: '700' },
  emptyCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 8,
    backgroundColor: '#151A21',
    padding: 10,
  },
  emptyText: { color: '#8B949E', fontSize: 12 },
  info: { color: '#8B949E', fontSize: 12 },
  error: { color: '#FF7B72', fontSize: 12, fontWeight: '700' },
});
