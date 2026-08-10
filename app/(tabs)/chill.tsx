import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { C3SDisclosure, C3SOperatorFocus } from '@/components/operator-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import {
  getChillLogs,
  getChillers,
  ensureChillerDoc,
  type ChillLogItem,
  type ChillerItem,
} from '@/lib/firebase/repository';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import {
  getOperationalItems,
  oItemAssignChiller,
  oItemFinishChill,
  oItemFlagChillDeviation,
  oItemResolveChillDeviation,
  type OItemItem,
} from '@/lib/operational-items';
import { toMillis, toSafeDate } from '@/lib/utils/dates';

// Session-level operator identity cache
let _sessionOnDutyAs = '';

const THEME_BORDER = C3S_COLORS.accent;
const THEME_PILL_BG = C3S_COLORS.accentSoft;
const THEME_PILL_BORDER = C3S_COLORS.accent;
const THEME_PILL_TEXT = C3S_COLORS.accent;
const CANONICAL_CHILLER_NAMES = [
  'Chiller 4', 'Chiller 5', 'Chiller 6', 'Chiller 7', 'Chiller 8', 'Chiller 9',
  'Chiller 10', 'Chiller 11', 'Chiller 12', 'Chiller 13', 'Chiller 14', 'Chiller 15', 'Chiller 16',
] as const;

/** Post-chill storage coolers — separate from process chillers (4–16).
 *  Selected at sign-out to record where product is moved for holding. */
const STORAGE_COOLER_NAMES = ['Cooler 18', 'Cooler 18A', 'Cooler 18B', 'Cooler 29', 'Cooler 67'] as const;

function elapsedMinutes(ts: unknown): number | null {
  const ms = toMillis(ts);
  if (ms == null) return null;
  return Math.floor((Date.now() - ms) / 60000);
}

function formatElapsed(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatChillerStatusLabel(status: ChillerItem['status']): string {
  if (status === 'cleaning') return 'Cleaning';
  if (status === 'chilling') return 'Chill Running';
  return 'Available';
}

export default function ChillScreen() {
  const params = useLocalSearchParams<{ itemId?: string }>();
  const targetItemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const [oItems, setOItems] = useState<OItemItem[]>([]);
  const [chillLogs, setChillLogs] = useState<ChillLogItem[]>([]);
  const [chillers, setChillers] = useState<ChillerItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Operator identity
  const [onDutyAs, setOnDutyAs] = useState(_sessionOnDutyAs);

  // Assign to Chiller / Start Chill
  const [selectedWaitingChillLogId, setSelectedWaitingChillLogId] = useState<string | null>(null);
  const [selectedChillerName, setSelectedChillerName] = useState<string | null>(null);
  const [isStartingChill, setIsStartingChill] = useState(false);
  const [startChillError, setStartChillError] = useState<string | null>(null);

  // Deviation — flag panel
  const [showDeviationPanelFor, setShowDeviationPanelFor] = useState<string | null>(null);
  const [deviationReasonInput, setDeviationReasonInput] = useState<Record<string, string>>({});
  const [flagDeviationError, setFlagDeviationError] = useState<Record<string, string>>({});
  const [flaggingDeviationLogId, setFlaggingDeviationLogId] = useState<string | null>(null);

  // Deviation — resolve panel
  const [showResolvePanelFor, setShowResolvePanelFor] = useState<string | null>(null);
  const [deviationResolutionInput, setDeviationResolutionInput] = useState<Record<string, string>>({});
  const [resolveDeviationError, setResolveDeviationError] = useState<Record<string, string>>({});
  const [resolvingDeviationLogId, setResolvingDeviationLogId] = useState<string | null>(null);

  // Running Chill inputs — keyed by chillLogId
  const [timeTo50FInput, setTimeTo50FInput] = useState<Record<string, string>>({});
  const [timeTo40FInput, setTimeTo40FInput] = useState<Record<string, string>>({});
  const [signOutTempInput, setSignOutTempInput] = useState<Record<string, string>>({});
  const [selectedStorageCooler, setSelectedStorageCooler] = useState<Record<string, string>>({});
  const [finishingChillLogId, setFinishingChillLogId] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const results = await Promise.allSettled([
      getOperationalItems(),
      getChillLogs(),
      getChillers(),
    ]);
    const [oR, logsR, chillersR] = results;
    if (oR.status === 'fulfilled') setOItems(oR.value);
    if (logsR.status === 'fulfilled') setChillLogs(logsR.value);
    if (chillersR.status === 'fulfilled') setChillers(chillersR.value);
    const firstFail = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstFail) {
      logFirebaseError('Chill', 'operational_items/chill_logs/chillers', firstFail.reason);
      setLoadError(toOperatorMessage(firstFail.reason, 'Failed to load chill data.'));
    }
    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  // Derived
  const oItemByChillLogId = useMemo(
    () => oItems.reduce<Record<string, OItemItem>>((map, item) => {
      if (item.chillLogId) map[item.chillLogId] = item;
      return map;
    }, {}),
    [oItems],
  );
  const chillOItems = useMemo(
    () =>
      oItems.filter((item) =>
        item.stage === 'chill' ||
        item.status === 'awaiting_chill' ||
        item.status === 'in_chill' ||
        item.status === 'chill_complete' ||
        item.status === 'ready_for_qa',
      ),
    [oItems],
  );
  const waitingQueue = useMemo(
    () => chillLogs.filter((log) => oItemByChillLogId[log.id]?.status === 'awaiting_chill').sort((a, b) => Number(oItemByChillLogId[b.id]?.id === targetItemId) - Number(oItemByChillLogId[a.id]?.id === targetItemId)),
    [chillLogs, oItemByChillLogId, targetItemId],
  );
  const runningLogs = useMemo(
    () => chillLogs.filter((log) => oItemByChillLogId[log.id]?.status === 'in_chill').sort((a, b) => Number(oItemByChillLogId[b.id]?.id === targetItemId) - Number(oItemByChillLogId[a.id]?.id === targetItemId)),
    [chillLogs, oItemByChillLogId, targetItemId],
  );
  const deviationLogs = useMemo(
    () => chillLogs.filter((log) => {
      const item = oItemByChillLogId[log.id];
      return (item?.chillLogStatus === 'deviation') || log.hasDeviation;
    }),
    [chillLogs, oItemByChillLogId],
  );
  const completedCount = useMemo(
    () => chillOItems.filter((item) => item.status === 'ready_for_qa').length,
    [chillOItems],
  );

  const chillerById = useMemo(() => {
    const map: Record<string, ChillerItem> = {};
    chillers.forEach((c) => { map[c.id] = c; });
    return map;
  }, [chillers]);
  const chillerByName = useMemo(() => {
    const map: Record<string, ChillerItem> = {};
    chillers.forEach((c) => { map[c.name] = c; });
    return map;
  }, [chillers]);
  const assignmentChillers = useMemo(
    () =>
      CANONICAL_CHILLER_NAMES.map((name) => {
        const existing = chillerByName[name];
        return {
          key: name,
          name,
          status: existing?.status ?? 'idle',
          currentLoadId: existing?.currentLoadId ?? null,
          chillerId: existing?.id ?? null,
          existsInFirestore: Boolean(existing),
        };
      }),
    [chillerByName],
  );

  const selectedWaitingLog = waitingQueue.find((log) => log.id === selectedWaitingChillLogId) ?? null;
  const selectedChiller = assignmentChillers.find((c) => c.name === selectedChillerName) ?? null;

  // ── Assign to Chiller / Start Chill ──
  async function onStartChillSubmit() {
    if (!selectedWaitingChillLogId || !selectedChillerName) {
      setStartChillError('Select a handoff item and a chiller.');
      return;
    }
    setIsStartingChill(true);
    setStartChillError(null);
    try {
      const ensuredChiller = await ensureChillerDoc(selectedChillerName);
      const selectedLog = waitingQueue.find((log) => log.id === selectedWaitingChillLogId);
      const oItem = selectedLog ? oItemByChillLogId[selectedLog.id] : null;
      if (!oItem || !oItem.chillLogId) throw new Error('Selected handoff is missing chill log linkage.');
      await oItemAssignChiller(
        oItem.id,
        oItem.stage,
        oItem.status,
        oItem.chillLogId,
        ensuredChiller.id,
      );
      setSelectedWaitingChillLogId(null);
      setSelectedChillerName(null);
      await loadData();
    } catch (err) {
      setStartChillError(toOperatorMessage(err, 'Failed to start chill.'));
    } finally {
      setIsStartingChill(false);
    }
  }

  // ── Finish Chill / Send to QA ──
  async function onFinishChillSubmit(log: ChillLogItem) {
    const oItem = oItemByChillLogId[log.id];
    if (!oItem || !oItem.chillLogId) {
      setSignOutError((prev) => ({ ...prev, [log.id]: 'Missing chill log linkage.' }));
      return;
    }
    const rawTemp = signOutTempInput[log.id];
    const rawTo50 = timeTo50FInput[log.id];
    const rawTo40 = timeTo40FInput[log.id];
    const signedOutTemp = rawTemp ? parseFloat(rawTemp) : undefined;
    const timeTo50F = rawTo50 ? parseInt(rawTo50, 10) : undefined;
    const timeTo40F = rawTo40 ? parseInt(rawTo40, 10) : undefined;

    if (signedOutTemp === undefined || isNaN(signedOutTemp)) {
      setSignOutError((prev) => ({ ...prev, [log.id]: 'Sign-out temp is required.' }));
      return;
    }
    if (signedOutTemp > 40) {
      setSignOutError((prev) => ({
        ...prev,
        [log.id]: `${signedOutTemp}°F exceeds 40°F maximum. Product must be ≤ 40°F before sign-out.`,
      }));
      return;
    }

    setFinishingChillLogId(log.id);
    setSignOutError((prev) => ({ ...prev, [log.id]: '' }));
    try {
      await oItemFinishChill(oItem.id, oItem.stage, oItem.status, oItem.chillLogId, {
        signedOutTemp,
        coolerId: selectedStorageCooler[log.id] || undefined,
        timeTo50F,
        timeTo40F,
      });
      await loadData();
    } catch (err) {
      setSignOutError((prev) => ({ ...prev, [log.id]: toOperatorMessage(err, 'Failed to complete chill.') }));
    } finally {
      setFinishingChillLogId(null);
    }
  }

  // ── Flag Deviation ──
  async function onFlagDeviation(log: ChillLogItem) {
    const oItem = oItemByChillLogId[log.id];
    if (!oItem || !oItem.chillLogId) return;
    const reason = deviationReasonInput[log.id] ?? '';
    if (!reason.trim()) {
      setFlagDeviationError((prev) => ({ ...prev, [log.id]: 'Describe the deviation before flagging.' }));
      return;
    }
    setFlaggingDeviationLogId(log.id);
    setFlagDeviationError((prev) => ({ ...prev, [log.id]: '' }));
    try {
      await oItemFlagChillDeviation(oItem.id, oItem.chillLogId, reason);
      setShowDeviationPanelFor(null);
      await loadData();
    } catch (err) {
      setFlagDeviationError((prev) => ({ ...prev, [log.id]: toOperatorMessage(err, 'Failed to flag deviation.') }));
    } finally {
      setFlaggingDeviationLogId(null);
    }
  }

  // ── Resolve Deviation ──
  async function onResolveDeviation(log: ChillLogItem) {
    const oItem = oItemByChillLogId[log.id];
    if (!oItem || !oItem.chillLogId) return;
    const note = deviationResolutionInput[log.id] ?? '';
    if (!note.trim()) {
      setResolveDeviationError((prev) => ({ ...prev, [log.id]: 'Describe the corrective action taken.' }));
      return;
    }
    setResolvingDeviationLogId(log.id);
    setResolveDeviationError((prev) => ({ ...prev, [log.id]: '' }));
    try {
      await oItemResolveChillDeviation(oItem.id, oItem.chillLogId, note);
      setShowResolvePanelFor(null);
      await loadData();
    } catch (err) {
      setResolveDeviationError((prev) => ({ ...prev, [log.id]: toOperatorMessage(err, 'Failed to resolve deviation.') }));
    } finally {
      setResolvingDeviationLogId(null);
    }
  }

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader title="Chill" subtitle="Post-cook cooling — bring product to ≤ 40°F before QA handoff" />

        <C3SOperatorFocus
          status={`${runningLogs.length} chilling • ${waitingQueue.length} waiting`}
          action={deviationLogs.length > 0 ? 'Resolve Hold' : runningLogs.length > 0 ? 'Record Check' : waitingQueue.length > 0 ? 'Start Chill' : completedCount > 0 ? 'Send to QA' : 'No Action Required'}
          detail={deviationLogs.length > 0 ? `${deviationLogs.length} deviation${deviationLogs.length === 1 ? '' : 's'} must be resolved before QA handoff.` : 'Temperature validation and required milestones remain unchanged.'}
          tone={deviationLogs.length > 0 ? 'critical' : runningLogs.length + waitingQueue.length > 0 ? 'active' : 'complete'}
        />

        {/* ── On Duty Banner ── */}
        <C3SCard borderColor={onDutyAs.trim() ? THEME_BORDER : C3S_COLORS.border}>
          <Text style={styles.onDutyLabel}>Chill Operator — On Duty As</Text>
          <TextInput
            style={styles.onDutyInput}
            placeholder="Enter your name"
            placeholderTextColor={C3S_COLORS.textMuted}
            value={onDutyAs}
            onChangeText={(v) => {
              setOnDutyAs(v);
              _sessionOnDutyAs = v;
            }}
            autoCorrect={false}
            autoCapitalize="words"
          />
        </C3SCard>

        {/* ── Summary Pills ── */}
        <View style={styles.summaryRow}>
          <View style={[styles.summaryPill, { borderColor: C3S_COLORS.success, backgroundColor: C3S_COLORS.successSoft }]}>
            <Text style={[styles.summaryCount, { color: C3S_COLORS.success }]}>{waitingQueue.length}</Text>
            <Text style={[styles.summaryLabel, { color: C3S_COLORS.success }]}>Awaiting Chiller Assignment</Text>
          </View>
          <View style={[styles.summaryPill, { borderColor: THEME_BORDER, backgroundColor: THEME_PILL_BG }]}>
            <Text style={[styles.summaryCount, { color: THEME_PILL_TEXT }]}>{runningLogs.length}</Text>
            <Text style={[styles.summaryLabel, { color: THEME_PILL_TEXT }]}>Running Chill</Text>
          </View>
          <View style={[styles.summaryPill, { borderColor: C3S_COLORS.success, backgroundColor: C3S_COLORS.successSoft }]}>
            <Text style={[styles.summaryCount, { color: C3S_COLORS.success }]}>{completedCount}</Text>
            <Text style={[styles.summaryLabel, { color: C3S_COLORS.success }]}>Ready for QA</Text>
          </View>
          {deviationLogs.length > 0 ? (
            <View style={[styles.summaryPill, { borderColor: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft }]}>
              <Text style={[styles.summaryCount, { color: C3S_COLORS.danger }]}>{deviationLogs.length}</Text>
              <Text style={[styles.summaryLabel, { color: C3S_COLORS.danger }]}>Deviations</Text>
            </View>
          ) : null}
        </View>

        {isLoading ? (
          <C3SCard>
            <Text style={styles.loadingText}>Loading chill data…</Text>
          </C3SCard>
        ) : loadError ? (
          <C3SCard borderColor={C3S_COLORS.danger}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable style={styles.retryButton} onPress={loadData}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </C3SCard>
        ) : (
          <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>

            {/* ══════════════════════════════════════════
                SECTION 1 · Post-Cook Handoff Queue
            ══════════════════════════════════════════ */}
            <C3SDisclosure title="Incoming handoffs" count={waitingQueue.length}>

            {waitingQueue.length === 0 ? (
              <C3SCard>
                <Text style={styles.emptyTitle}>No Handoffs Waiting</Text>
                <Text style={styles.emptySub}>Items appear here after Thermal operators finish cook.</Text>
              </C3SCard>
            ) : (
              waitingQueue.map((log) => (
                <C3SCard key={log.id} borderColor={log.thermalDeviationCount || log.hasDeviation ? C3S_COLORS.danger : C3S_COLORS.success}>
                  <View style={styles.topRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.productName}>{log.productName}</Text>
                    </View>
                    {log.thermalDeviationCount || log.hasDeviation ? (
                      <View style={[styles.statusPill, { backgroundColor: C3S_COLORS.dangerSoft, borderColor: C3S_COLORS.danger, marginRight: 6 }]}>
                        <Text style={[styles.statusPillText, { color: C3S_COLORS.warning }]}>⚠ DEVIATION</Text>
                      </View>
                    ) : null}
                    <View style={[styles.statusPill, { backgroundColor: C3S_COLORS.accentSoft, borderColor: C3S_COLORS.accent }]}>
                      <Text style={[styles.statusPillText, { color: C3S_COLORS.accent }]}>AWAITING CHILLER ASSIGNMENT</Text>
                    </View>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Cook Type</Text>
                    <Text style={styles.metaValue}>{log.cookType ?? '—'}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Target Temp</Text>
                    <Text style={styles.metaValue}>{log.targetTemp != null ? `${log.targetTemp}°F` : '—'}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Expected Cook</Text>
                    <Text style={styles.metaValue}>{log.expectedCookMinutes != null ? `${log.expectedCookMinutes} min` : '—'}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Make Date</Text>
                    <Text style={styles.metaValue}>{log.makeDate ?? '—'}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Delivery Date</Text>
                    <Text style={styles.metaValue}>{log.deliveryDate ?? '—'}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Next Step</Text>
                    <Text style={[styles.metaValue, { color: C3S_COLORS.success }]}>→ Assign to Chiller and Start Chill in Section 2</Text>
                  </View>
                </C3SCard>
              ))
            )}
            </C3SDisclosure>

            {/* ══════════════════════════════════════════
                SECTION 2 · Assign to Chiller / Start Chill
            ══════════════════════════════════════════ */}
            <Text style={styles.sectionTitle}>Start Chill</Text>
            <Text style={styles.sectionSub}>Select a handoff and a chiller, then start the chill cycle</Text>

            {waitingQueue.length === 0 ? (
              <C3SCard>
                <Text style={styles.emptyTitle}>No Items Waiting</Text>
                <Text style={styles.emptySub}>Finish a cook in Thermal to create a chill handoff.</Text>
              </C3SCard>
            ) : (
              <C3SCard borderColor={THEME_BORDER}>
                <Text style={styles.assignLabel}>Select Handoff</Text>
                <View style={styles.chipWrap}>
                  {waitingQueue.map((log) => {
                    const active = selectedWaitingChillLogId === log.id;
                    return (
                      <Pressable
                        key={log.id}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setSelectedWaitingChillLogId(log.id)}
                        disabled={isStartingChill}>
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {log.productName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.assignLabel, { marginTop: 12 }]}>Select Chiller</Text>
                <View style={styles.chillerGrid}>
                  {assignmentChillers.map((chiller) => {
                    const active = selectedChillerName === chiller.name;
                    const isBusy = chiller.status === 'chilling' || chiller.status === 'cleaning';
                    return (
                      <Pressable
                        key={chiller.key}
                        style={[styles.chillerChip, active && styles.chillerChipActive, isBusy && styles.chillerChipBusy]}
                        onPress={() => !isBusy && setSelectedChillerName(chiller.name)}
                        disabled={isStartingChill || isBusy}>
                        <Text style={[styles.chillerChipName, active && styles.chillerChipNameActive, isBusy && styles.chillerChipNameBusy]}>
                          {chiller.name}
                        </Text>
                        <Text style={[styles.chillerChipStatus, active && styles.chillerChipStatusActive]}>
                          {isBusy ? (chiller.status === 'cleaning' ? 'cleaning' : 'chill running') : 'available'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={[styles.metaRow, { marginTop: 12 }]}>
                  <Text style={styles.metaLabel}>Selected Handoff</Text>
                  <Text style={styles.metaValue}>
                    {selectedWaitingLog ? `${selectedWaitingLog.productName}` : 'None'}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Selected Chiller</Text>
                  <Text style={styles.metaValue}>
                    {selectedChiller ? `${selectedChiller.name} [${formatChillerStatusLabel(selectedChiller.status)}]` : 'None'}
                  </Text>
                </View>
                {selectedWaitingLog && oItemByChillLogId[selectedWaitingLog.id] ? <Pressable style={styles.openBatchButton} onPress={() => router.push(`/production-item?id=${encodeURIComponent(oItemByChillLogId[selectedWaitingLog.id].id)}`)}><Text style={styles.openBatchText}>Open Batch</Text></Pressable> : null}

                {startChillError ? (
                  <Text style={styles.execError}>{startChillError}</Text>
                ) : null}

                <Pressable
                  style={[
                    styles.primaryAction,
                    (!selectedWaitingChillLogId || !selectedChillerName || isStartingChill) && styles.primaryActionDisabled,
                  ]}
                  disabled={!selectedWaitingChillLogId || !selectedChillerName || isStartingChill}
                  onPress={onStartChillSubmit}>
                  <Text style={styles.primaryActionText}>
                    {isStartingChill ? 'Starting Chill…' : 'Start Chill'}
                  </Text>
                </Pressable>
              </C3SCard>
            )}

            {/* ══════════════════════════════════════════
                SECTION 3 · Running Chill
            ══════════════════════════════════════════ */}
            <Text style={styles.sectionTitle}>Chill Running</Text>
            <Text style={styles.sectionSub}>Active chill cycles — record temp milestones, sign out when product is ≤ 40°F</Text>

            {runningLogs.length === 0 ? (
              <C3SCard>
                <Text style={styles.emptyTitle}>No Running Chill Items</Text>
                <Text style={styles.emptySub}>Start chill in Section 2 above to see items here.</Text>
              </C3SCard>
            ) : (
              runningLogs.map((log) => {
                const linkedChiller = log.chillerId ? chillerById[log.chillerId] ?? null : null;
                const chillElapsed = elapsedMinutes(log.createdAt);
                const equipmentOk =
                  linkedChiller &&
                  (!linkedChiller.currentLoadId || linkedChiller.currentLoadId === log.prepId);
                const canFinishChill = !!equipmentOk;

                return (
                  <C3SCard key={log.id} borderColor={log.thermalDeviationCount || log.hasDeviation ? C3S_COLORS.danger : THEME_BORDER}>
                    <View style={styles.topRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.productName}>{log.productName}</Text>
                      </View>
                      {log.thermalDeviationCount || log.hasDeviation ? (
                        <View style={[styles.statusPill, { backgroundColor: C3S_COLORS.dangerSoft, borderColor: C3S_COLORS.danger, marginRight: 6 }]}>
                          <Text style={[styles.statusPillText, { color: C3S_COLORS.warning }]}>⚠ DEVIATION</Text>
                        </View>
                      ) : null}
                      <View style={[styles.statusPill, { backgroundColor: THEME_PILL_BG, borderColor: THEME_PILL_BORDER }]}>
                        <Text style={[styles.statusPillText, { color: THEME_PILL_TEXT }]}>CHILL RUNNING</Text>
                      </View>
                    </View>

                    {/* Elapsed time banner */}
                    {log.createdAt ? (
                      <View style={styles.chillTimerBanner}>
                        <Text style={styles.chillTimerText}>
                          ❄️ Chill Running · {formatElapsed(chillElapsed)}
                        </Text>
                        <Text style={styles.chillTimerSub}>
                          Started {toSafeDate(log.createdAt)?.toLocaleTimeString() ?? '—'} · Goal: ≤ 40°F sign-out
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Chiller</Text>
                      <Text style={styles.metaValue}>
                        {linkedChiller ? `${linkedChiller.name} (${formatChillerStatusLabel(linkedChiller.status)})` : 'Unassigned'}
                      </Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Cook Snapshot</Text>
                      <Text style={styles.metaValue}>
                        {log.cookType ?? '—'} · {log.targetTemp != null ? `${log.targetTemp}°F` : '—'}
                        {log.expectedCookMinutes != null ? ` · ${log.expectedCookMinutes}m cook` : ''}
                      </Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Delivery Date</Text>
                      <Text style={styles.metaValue}>{log.deliveryDate ?? '—'}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Racks</Text>
                      <Text style={styles.metaValue}>{log.racks != null ? `${log.racks} racks` : '—'}</Text>
                    </View>

                    {!equipmentOk ? (
                      <Text style={styles.execError}>
                        ⚠ Equipment linkage issue — chiller may be assigned to a different load.
                      </Text>
                    ) : null}
                    {oItemByChillLogId[log.id] ? <Pressable style={styles.openBatchButton} onPress={() => router.push(`/production-item?id=${encodeURIComponent(oItemByChillLogId[log.id].id)}`)}><Text style={styles.openBatchText}>Open Batch</Text></Pressable> : null}

                    {/* Temp Milestones */}
                    <Text style={styles.stepHeader}>Chill Temp Milestones</Text>
                    <Text style={styles.stepHint}>Enter time (minutes from chill start) when product reached each temp</Text>
                    <View style={styles.inputRow}>
                      <TextInput
                        style={styles.execInput}
                        placeholder="Mins to 50°F"
                        placeholderTextColor={C3S_COLORS.textMuted}
                        keyboardType="numeric"
                        value={timeTo50FInput[log.id] ?? ''}
                        onChangeText={(v) => setTimeTo50FInput((prev) => ({ ...prev, [log.id]: v }))}
                      />
                      <TextInput
                        style={styles.execInput}
                        placeholder="Mins to 40°F"
                        placeholderTextColor={C3S_COLORS.textMuted}
                        keyboardType="numeric"
                        value={timeTo40FInput[log.id] ?? ''}
                        onChangeText={(v) => setTimeTo40FInput((prev) => ({ ...prev, [log.id]: v }))}
                      />
                    </View>

                    {/* Sign-Out */}
                    <Text style={styles.stepHeader}>Sign Out — Product Must Be ≤ 40°F Before QA Handoff</Text>
                    <TextInput
                      style={styles.execInput}
                      placeholder="Sign-out temp (°F) — must be ≤ 40°F"
                      placeholderTextColor={C3S_COLORS.textMuted}
                      keyboardType="numeric"
                      value={signOutTempInput[log.id] ?? ''}
                      onChangeText={(v) => {
                        setSignOutTempInput((prev) => ({ ...prev, [log.id]: v }));
                        setSignOutError((prev) => ({ ...prev, [log.id]: '' }));
                      }}
                    />

                    {/* Move to Storage Cooler */}
                    <Text style={styles.stepHeader}>Move to Storage Cooler (optional)</Text>
                    <Text style={styles.stepHint}>Post-chill storage location after chill is complete</Text>
                    <View style={styles.chipWrap}>
                      {STORAGE_COOLER_NAMES.map((name) => {
                        const active = selectedStorageCooler[log.id] === name;
                        return (
                          <Pressable
                            key={name}
                            style={[styles.chip, active && styles.chipActive]}
                            onPress={() =>
                              setSelectedStorageCooler((prev) => ({
                                ...prev,
                                [log.id]: prev[log.id] === name ? '' : name,
                              }))
                            }
                            disabled={finishingChillLogId === log.id}>
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>
                              {name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {signOutError[log.id] ? (
                      <Text style={styles.execError}>{signOutError[log.id]}</Text>
                    ) : null}

                    <Pressable
                      style={[
                        styles.finishAction,
                        (finishingChillLogId === log.id || !canFinishChill) && styles.primaryActionDisabled,
                      ]}
                      disabled={finishingChillLogId === log.id || !canFinishChill}
                      onPress={() => onFinishChillSubmit(log)}>
                        <Text style={styles.finishActionText}>
                        {finishingChillLogId === log.id ? 'Completing Chill…' : 'Complete Chill'}
                      </Text>
                    </Pressable>

                    {/* Flag Deviation */}
                    {showDeviationPanelFor !== log.id ? (
                      <Pressable style={styles.deviationFlagButton} onPress={() => setShowDeviationPanelFor(log.id)}>
                        <Text style={styles.deviationFlagText}>⚠ Flag Deviation</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.deviationPanel}>
                        <Text style={styles.deviationPanelTitle}>Describe the Deviation</Text>
                        <TextInput
                          style={[styles.execInput, { minHeight: 56 }]}
                          placeholder="e.g. Chiller malfunction, unexpected temp spike, equipment issue..."
                          placeholderTextColor={C3S_COLORS.textMuted}
                          value={deviationReasonInput[log.id] ?? ''}
                          onChangeText={(v) => setDeviationReasonInput((prev) => ({ ...prev, [log.id]: v }))}
                          multiline
                        />
                        {flagDeviationError[log.id] ? <Text style={styles.execError}>{flagDeviationError[log.id]}</Text> : null}
                        <View style={styles.inputRow}>
                          <Pressable style={[styles.chip, { flex: 1, justifyContent: 'center' }]}
                            onPress={() => setShowDeviationPanelFor(null)}
                            disabled={flaggingDeviationLogId === log.id}>
                            <Text style={[styles.chipText, { textAlign: 'center' }]}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.deviationConfirmButton, { flex: 2, opacity: flaggingDeviationLogId === log.id ? 0.5 : 1 }]}
                            disabled={flaggingDeviationLogId === log.id}
                            onPress={() => onFlagDeviation(log)}>
                            <Text style={styles.deviationConfirmText}>
                              {flaggingDeviationLogId === log.id ? 'Flagging...' : 'Confirm — Flag Deviation'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </C3SCard>
                );
              })
            )}

            {/* ══════════════════════════════════════════
                SECTION 4 · Chill Deviations
            ══════════════════════════════════════════ */}
            {deviationLogs.length > 0 ? (
              <>
                <Text style={[styles.sectionTitle, { color: C3S_COLORS.danger }]}>⚠ Chill Deviations</Text>
                <Text style={styles.sectionSub}>Flagged items — resolve with corrective action before QA handoff</Text>
                {deviationLogs.map((log) => (
                  <C3SCard key={log.id} borderColor={C3S_COLORS.danger}>
                    <View style={styles.topRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.productName}>{log.productName}</Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: C3S_COLORS.dangerSoft, borderColor: C3S_COLORS.danger }]}>
                        <Text style={[styles.statusPillText, { color: C3S_COLORS.danger }]}>DEVIATION</Text>
                      </View>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Reason</Text>
                      <Text style={[styles.metaValue, { color: C3S_COLORS.danger, textAlign: 'left', flex: 2 }]}>{log.deviationReason ?? '—'}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Flagged At</Text>
                      <Text style={styles.metaValue}>{toSafeDate(log.deviationAt)?.toLocaleString() ?? '—'}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Chiller</Text>
                      <Text style={styles.metaValue}>{log.chillerId ? (chillerById[log.chillerId]?.name ?? 'Assigned') : '—'}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Delivery Date</Text>
                      <Text style={styles.metaValue}>{log.deliveryDate ?? '—'}</Text>
                    </View>

                    {/* Resolve Deviation panel */}
                    {showResolvePanelFor !== log.id ? (
                      <Pressable style={styles.resolveDeviationButton} onPress={() => setShowResolvePanelFor(log.id)}>
                        <Text style={styles.resolveDeviationText}>✓ Resolve Deviation — Resume Chill</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.deviationPanel}>
                        <Text style={styles.deviationPanelTitle}>Corrective Action Taken</Text>
                        <TextInput
                          style={[styles.execInput, { minHeight: 56 }]}
                          placeholder="Describe what was done to correct the issue..."
                          placeholderTextColor={C3S_COLORS.textMuted}
                          value={deviationResolutionInput[log.id] ?? ''}
                          onChangeText={(v) => setDeviationResolutionInput((prev) => ({ ...prev, [log.id]: v }))}
                          multiline
                        />
                        {resolveDeviationError[log.id] ? <Text style={styles.execError}>{resolveDeviationError[log.id]}</Text> : null}
                        <View style={styles.inputRow}>
                          <Pressable style={[styles.chip, { flex: 1, justifyContent: 'center' }]}
                            onPress={() => setShowResolvePanelFor(null)}
                            disabled={resolvingDeviationLogId === log.id}>
                            <Text style={[styles.chipText, { textAlign: 'center' }]}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.finishAction, { flex: 2, marginTop: 0, minHeight: 40, opacity: resolvingDeviationLogId === log.id ? 0.5 : 1 }]}
                            disabled={resolvingDeviationLogId === log.id}
                            onPress={() => onResolveDeviation(log)}>
                            <Text style={styles.finishActionText}>
                              {resolvingDeviationLogId === log.id ? 'Resolving...' : 'Mark Resolved'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </C3SCard>
                ))}
              </>
            ) : null}

            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </C3SPage>
    </C3SScreen>
  );
}

const styles = StyleSheet.create({
  // On Duty
  onDutyLabel: {
    color: C3S_COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  onDutyInput: {
    color: C3S_COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    borderBottomWidth: 1,
    borderBottomColor: C3S_COLORS.accent,
    paddingVertical: 4,
  },

  // Summary pills
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  summaryPill: {
    flex: 1,
    minWidth: 100,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  summaryCount: {
    fontSize: 22,
    fontWeight: '800',
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
  },

  // List content
  listContent: {
    gap: 10,
    paddingBottom: 20,
  },

  // Section headers
  sectionTitle: {
    color: C3S_COLORS.textStrong,
    fontSize: 19,
    fontWeight: '900',
    marginTop: 6,
    marginBottom: 2,
  },
  sectionSub: {
    color: C3S_COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },

  // Cards — top row
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  productName: {
    color: C3S_COLORS.textStrong,
    fontSize: 18,
    fontWeight: '900',
  },
  subId: {
    color: C3S_COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // Meta rows
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 8,
  },
  metaLabel: {
    color: C3S_COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  metaValue: {
    color: C3S_COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },

  // Assign card
  assignLabel: {
    color: C3S_COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },

  // Chips
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  chipActive: {
    borderColor: C3S_COLORS.accent,
    backgroundColor: C3S_COLORS.accentSoft,
  },
  chipBusy: {
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    opacity: 0.6,
  },
  chipText: {
    color: C3S_COLORS.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextActive: {
    color: C3S_COLORS.accent,
  },
  chipTextBusy: {
    color: C3S_COLORS.textMuted,
  },
  chipSub: {
    color: C3S_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  chipSubActive: {
    color: C3S_COLORS.info,
  },
  chillerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chillerChip: {
    width: 118,
    minHeight: 84,
    borderWidth: 1.5,
    borderColor: C3S_COLORS.border,
    borderRadius: 12,
    backgroundColor: C3S_COLORS.panel,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  chillerChipActive: {
    borderColor: C3S_COLORS.accent,
    backgroundColor: C3S_COLORS.accentSoft,
    shadowColor: C3S_COLORS.accent,
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  chillerChipBusy: {
    backgroundColor: C3S_COLORS.panelAlt,
    borderColor: C3S_COLORS.border,
    opacity: 0.6,
  },
  chillerChipName: {
    color: C3S_COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  chillerChipNameActive: {
    color: C3S_COLORS.accent,
  },
  chillerChipNameBusy: {
    color: C3S_COLORS.textMuted,
  },
  chillerChipStatus: {
    color: C3S_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 6,
  },
  chillerChipStatusActive: {
    color: C3S_COLORS.textPrimary,
  },

  // Chill timer banner (elapsed time display)
  chillTimerBanner: {
    backgroundColor: C3S_COLORS.panelAlt,
    borderWidth: 1,
    borderColor: C3S_COLORS.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  chillTimerText: { color: C3S_COLORS.accent, fontSize: 16, fontWeight: '800' },
  chillTimerSub: { color: C3S_COLORS.info, fontSize: 12, fontWeight: '700', marginTop: 2 },

  // Step headers within running chill card
  stepHeader: {
    color: C3S_COLORS.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
  },
  stepHint: {
    color: C3S_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
  },

  // Inputs
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  execInput: {
    flex: 1,
    backgroundColor: C3S_COLORS.panel,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    borderRadius: 8,
    color: C3S_COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 42,
  },

  // Error / locked text
  execError: {
    color: C3S_COLORS.danger,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
  },
  execLocked: {
    color: C3S_COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },

  // Primary action (Start Chill)
  primaryAction: {
    marginTop: 14,
    backgroundColor: C3S_COLORS.accent,
    borderRadius: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionDisabled: {
    backgroundColor: C3S_COLORS.textMuted,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },

  // Finish chill action (teal/green)
  finishAction: {
    marginTop: 14,
    backgroundColor: C3S_COLORS.success,
    borderRadius: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishActionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  openBatchButton: { minHeight: 46, marginTop: 8, borderWidth: 1, borderColor: C3S_COLORS.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  openBatchText: { color: C3S_COLORS.accent, fontSize: 14, fontWeight: '900' },

  // Deviation flag / resolve
  deviationFlagButton: {
    marginTop: 10, borderWidth: 1, borderColor: C3S_COLORS.warning,
    backgroundColor: C3S_COLORS.warningSoft, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center',
  },
  deviationFlagText: { color: C3S_COLORS.warning, fontSize: 13, fontWeight: '800' },
  deviationPanel: {
    marginTop: 10, backgroundColor: C3S_COLORS.dangerSoft, borderWidth: 1,
    borderColor: C3S_COLORS.danger, borderRadius: 8, padding: 10, gap: 8,
  },
  deviationPanelTitle: {
    color: C3S_COLORS.danger, fontSize: 11, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2,
  },
  deviationConfirmButton: {
    backgroundColor: C3S_COLORS.danger, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  deviationConfirmText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  resolveDeviationButton: {
    marginTop: 10, borderWidth: 1, borderColor: C3S_COLORS.success,
    backgroundColor: C3S_COLORS.successSoft, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center',
  },
  resolveDeviationText: { color: C3S_COLORS.success, fontSize: 13, fontWeight: '800' },

  // Empty states
  emptyTitle: {
    color: C3S_COLORS.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  emptySub: {
    color: C3S_COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },

  // Loading / Error
  loadingText: {
    color: C3S_COLORS.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: C3S_COLORS.danger,
    fontSize: 14,
    fontWeight: '700',
  },
  retryButton: {
    marginTop: 10,
    backgroundColor: C3S_COLORS.accentSoft,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  retryButtonText: {
    color: C3S_COLORS.accent,
    fontSize: 14,
    fontWeight: '800',
  },
});
