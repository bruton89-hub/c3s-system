import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { C3SDisclosure, C3SOperatorFocus } from '@/components/operator-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import {
  getChillers,
  getChillLogs,
  getPrepQueueItems,
  getQAChecks,
  type ChillerItem,
  type ChillLogItem,
  type PrepQueueItem,
  type QACheckItem,
} from '@/lib/firebase/repository';
import { getOperationalItems, oItemAssignChiller, oItemFinishChill, oItemRecordChillCheck, placeOperationalItemOnHold, type OItemItem } from '@/lib/operational-items';

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
  const [operationalItems, setOperationalItems] = useState<OItemItem[]>([]);
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
      const [p, c, ch, q, items] = await Promise.all([
        getPrepQueueItems(),
        getChillLogs(),
        getChillers(),
        getQAChecks(),
        getOperationalItems(),
      ]);
      setPreps(p);
      setChillLogs(c);
      setChillers(ch);
      setQaChecks(q);
      setOperationalItems(items);
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
      const unavailable = item?.status === 'cleaning' || !['idle', 'chilling'].includes(item?.status ?? '');
      const state = item?.status === 'cleaning' ? 'Cleaning' : unavailable ? 'Unavailable' : load >= cap ? 'Full' : load > 0 ? 'Partially Loaded' : 'Available';
      return { name, item, load, cap, overload: load > cap, state, spaces: Math.max(0, cap - load) };
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
      const item = operationalItems.find((entry) => entry.chillLogId === log.id);
      if (!item) throw new Error('Canonical production item was not found. Refresh and try again.');
      await oItemAssignChiller(item.id, item.stage, item.status, log.id, chillerId);
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
      const item = operationalItems.find((entry) => entry.chillLogId === log.id);
      if (!item) throw new Error('Canonical production item was not found. Refresh and try again.');
      await oItemRecordChillCheck(item.id, log.id, type === '50' ? { timeTo50F: value } : { timeTo40F: value });
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
      const item = operationalItems.find((entry) => entry.chillLogId === log.id);
      if (!item) throw new Error('Canonical production item was not found. Refresh and try again.');
      await oItemFinishChill(item.id, item.stage, item.status, log.id, {
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
      const item = operationalItems.find((entry) => entry.chillLogId === log.id);
      if (!item) throw new Error('Canonical production item was not found. Refresh and try again.');
      await placeOperationalItemOnHold({ itemId: item.id, reasonKey: 'process_deviation', reasonLabel: 'Process Deviation', notes: 'Marked from Chiller Load hold/deviation review.', actorName: 'Chill operator' });
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
        <C3SOperatorFocus
          status={`${awaitingAssignment.length} waiting • ${running.length} chilling`}
          action={holdDeviation.length > 0 ? 'Resolve Hold' : checkDue.length > 0 ? 'Record Check' : awaitingAssignment.length > 0 ? 'Start Chill' : readyForQa.length > 0 ? 'Send to QA' : 'No Action Required'}
          detail="Capacity and available equipment are shown before assignment."
          tone={holdDeviation.length > 0 ? 'critical' : awaitingAssignment.length + running.length > 0 ? 'active' : 'complete'}
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
                <Text style={styles.stripState}>{c.overload ? 'OVERLOAD' : c.state}</Text>
                <Text style={styles.stripState}>{c.spaces} spaces available</Text>
              </View>
            ))}
          </ScrollView>

          <Text style={styles.sectionTitle}>Awaiting Chiller Assignment</Text>
          {awaitingAssignment.length === 0 ? <Empty text="No items awaiting chiller assignment." /> : null}
          {awaitingAssignment.map((log) => {
            const prep = prepById[log.prepId] ?? null;
            return (
              <C3SCard key={log.id} borderColor={C3S_COLORS.accent}>
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
                    <Text style={styles.primaryBtnText}>{workingId === log.id ? 'Starting...' : 'Start Chill'}</Text>
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
              <C3SCard key={log.id} borderColor={C3S_COLORS.accent}>
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
                    placeholderTextColor={C3S_COLORS.textMuted}
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
              <C3SCard key={`due-${log.id}`} borderColor={C3S_COLORS.warning}>
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
                    placeholderTextColor={C3S_COLORS.textMuted}
                    keyboardType="numeric"
                  />
                  <Pressable style={styles.primaryBtn} disabled={workingId === log.id} onPress={() => onRecordCheck(log)}>
                    <Text style={styles.primaryBtnText}>{workingId === log.id ? 'Saving...' : 'Record Check'}</Text>
                  </Pressable>
                </View>
              </C3SCard>
            );
          })}

          <C3SDisclosure title="Ready for QA" count={readyForQa.length}>
          {readyForQa.length === 0 ? <Empty text="No products waiting for QA." /> : null}
          {readyForQa.map((q) => (
            <C3SCard key={q.id} borderColor={C3S_COLORS.success}>
              <Text style={styles.itemTitle}>{q.productName || q.prepId || '—'}</Text>
              <Meta label="Status" value="Ready for QA" />
              <Meta label="Timestamp" value={fmtTs(q.timestamp?.toMillis?.())} />
              <Pressable style={styles.secondaryBtn} onPress={() => router.push('/qa-review')}>
                <Text style={styles.secondaryBtnText}>Send to QA</Text>
              </Pressable>
            </C3SCard>
          ))}
          </C3SDisclosure>

          <Text style={styles.sectionTitle}>Hold / Deviation</Text>
          {holdDeviation.length === 0 ? <Empty text="No chill hold/deviation items." /> : null}
          {holdDeviation.map((log) => (
            <C3SCard key={`hold-${log.id}`} borderColor={C3S_COLORS.danger}>
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
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshText: { color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  sectionTitle: { color: C3S_COLORS.textStrong, fontSize: 19, fontWeight: '900', marginTop: 8 },
  stripRow: { gap: 6 },
  stripCard: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 90,
  },
  stripOverload: { borderColor: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft },
  stripName: { color: C3S_COLORS.textStrong, fontSize: 11, fontWeight: '800' },
  stripValue: { color: C3S_COLORS.textMuted, fontSize: 11 },
  stripState: { color: C3S_COLORS.textMuted, fontSize: 10 },
  itemTitle: { color: C3S_COLORS.textStrong, fontSize: 18, fontWeight: '900', marginBottom: 7 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  metaLabel: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  metaValue: { color: C3S_COLORS.textPrimary, fontSize: 14, fontWeight: '700' },
  rowAction: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' },
  chips: { gap: 4 },
  chip: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panelAlt,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  chipActive: { borderColor: C3S_COLORS.accent, backgroundColor: C3S_COLORS.accentSoft },
  chipText: { color: C3S_COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: C3S_COLORS.textPrimary },
  input: {
    minWidth: 90,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: C3S_COLORS.textPrimary,
    fontSize: 14,
  },
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
  secondaryBtn: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panelAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  secondaryBtnText: { color: C3S_COLORS.textPrimary, fontSize: 11, fontWeight: '700' },
  emptyCard: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    borderRadius: 8,
    backgroundColor: C3S_COLORS.panel,
    padding: 10,
  },
  emptyText: { color: C3S_COLORS.textMuted, fontSize: 12 },
  info: { color: C3S_COLORS.textMuted, fontSize: 12 },
  error: { color: C3S_COLORS.danger, fontSize: 12, fontWeight: '700' },
});
