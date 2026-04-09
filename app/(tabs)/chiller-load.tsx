import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import {
  BATCH_STAGES,
  BATCH_STATUS_COLORS,
  SMOKEHOUSES,
  STAGE_COLORS,
  getPrepStageDisplayLabel,
  getStageDisplayLabel,
} from '@/constants/c3s';
import { useC3S, type BatchRecord } from '@/store/c3s-store';

type CheckpointState = {
  fiftyReached?: boolean;
  oneThirtyReached?: boolean;
  criticalReached?: boolean;
  issueFlagged?: boolean;
};
type AttentionSeverity = 'warning' | 'urgent';
type ThermalViewMode = 'batch' | 'equipment';

const thermalStages = [
  BATCH_STAGES.COOK,
  BATCH_STAGES.SHOWER,
  BATCH_STAGES.EVACUATE,
  BATCH_STAGES.CHILL,
  BATCH_STAGES.THERMAL_COOLER,
] as const;

const stageOrder: Record<string, number> = {
  [BATCH_STAGES.COOK]: 0,
  [BATCH_STAGES.SHOWER]: 1,
  [BATCH_STAGES.EVACUATE]: 2,
  [BATCH_STAGES.CHILL]: 3,
  [BATCH_STAGES.THERMAL_COOLER]: 4,
};

function hashFromText(value: string) {
  return value.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

function inferCookMethod(product: string): 'smoke' | 'steam' {
  const lower = product.toLowerCase();
  if (lower.includes('smoked') || lower.includes('bacon') || lower.includes('ham') || lower.includes('sausage')) {
    return 'smoke';
  }
  return 'steam';
}

function checkpointStyle(complete: boolean, late = false) {
  if (late) return { color: '#FFCDD2', borderColor: '#C62828', backgroundColor: '#3A1A1A' };
  if (complete) return { color: '#C8E6C9', borderColor: '#2E7D32', backgroundColor: '#1B3320' };
  return { color: '#E6EDF3', borderColor: '#455A64', backgroundColor: '#151A21' };
}

function getCheckpointSnapshot(batch: BatchRecord, marks: CheckpointState) {
  const hash = hashFromText(batch.id);
  const totalCookWindow = Math.max(batch.estimatedCookMinutes, 1);
  const elapsedCookMinutes =
    batch.stage === BATCH_STAGES.COOK
      ? Math.min(totalCookWindow + 120, Math.max(18, Math.round(totalCookWindow * (0.48 + ((hash % 25) / 100)))))
      : Math.max(45, Math.round(totalCookWindow * 0.92));

  const checkpoint50Reached = marks.fiftyReached || elapsedCookMinutes >= 45 || batch.stage !== BATCH_STAGES.COOK;
  const checkpoint130Reached =
    marks.oneThirtyReached || elapsedCookMinutes >= 260 || batch.stage !== BATCH_STAGES.COOK;
  const criticalReached =
    marks.criticalReached || batch.stage !== BATCH_STAGES.COOK || elapsedCookMinutes >= totalCookWindow;
  const expectedCookMinutes = batch.productProfile.estimatedCookMinutes;
  const cookNeedsAttention =
    (batch.stage === BATCH_STAGES.COOK || batch.stage === BATCH_STAGES.SHOWER || batch.stage === BATCH_STAGES.EVACUATE) &&
    elapsedCookMinutes > expectedCookMinutes;
  const cookActionRequired =
    (batch.stage === BATCH_STAGES.COOK || batch.stage === BATCH_STAGES.SHOWER || batch.stage === BATCH_STAGES.EVACUATE) &&
    elapsedCookMinutes > Math.round(expectedCookMinutes * 1.25);
  const chillProgressFactor = 0.55 + ((hash % 30) / 100);
  const elapsedChillMinutes =
    batch.stage === BATCH_STAGES.CHILL
      ? Math.max(12, Math.round(batch.productProfile.estimatedChillMinutes * chillProgressFactor))
      : batch.stage === BATCH_STAGES.THERMAL_COOLER
        ? batch.productProfile.estimatedChillMinutes + 10
        : undefined;
  const chillNeedsAttention =
    elapsedChillMinutes !== undefined && elapsedChillMinutes > batch.productProfile.estimatedChillMinutes;
  const chillActionRequired =
    elapsedChillMinutes !== undefined &&
    elapsedChillMinutes > Math.round(batch.productProfile.estimatedChillMinutes * 1.25);

  const approaching130Deadline = !checkpoint130Reached && elapsedCookMinutes >= 300 && elapsedCookMinutes <= 360;
  const missed130Deadline = !checkpoint130Reached && elapsedCookMinutes > 360;
  const delayedTransfer =
    batch.stage === BATCH_STAGES.CHILL &&
    (batch.status === 'Delayed' || batch.minutesToReady > batch.estimatedChillMinutes + 75);
  const smokeIssue =
    inferCookMethod(batch.product) === 'smoke' &&
    (marks.issueFlagged || (batch.stage === BATCH_STAGES.COOK && hash % 7 === 0));

  const attentionItems: { label: string; severity: AttentionSeverity }[] = [
    approaching130Deadline ? { label: 'Approaching 130F deadline', severity: 'warning' } : null,
    missed130Deadline ? { label: 'Missed 130F (6-hour rule)', severity: 'urgent' } : null,
    delayedTransfer ? { label: 'Transfer window exceeded', severity: 'urgent' } : null,
    smokeIssue
      ? {
          label: marks.issueFlagged ? 'Critical unresolved issue' : 'Smoke monitoring issue',
          severity: marks.issueFlagged ? 'urgent' : 'warning',
        }
      : null,
    cookActionRequired
      ? { label: 'Cook time significantly exceeded expected', severity: 'urgent' }
      : cookNeedsAttention
        ? { label: 'Cook elapsed above expected', severity: 'warning' }
        : null,
    chillActionRequired
      ? { label: 'Chill time significantly exceeded expected', severity: 'urgent' }
      : chillNeedsAttention
        ? { label: 'Chill elapsed above expected', severity: 'warning' }
        : null,
  ].filter((item): item is { label: string; severity: AttentionSeverity } => !!item);

  const attentionSeverity: AttentionSeverity | null = attentionItems.some((item) => item.severity === 'urgent')
    ? 'urgent'
    : attentionItems.length > 0
      ? 'warning'
      : null;
  const attentionHeader =
    attentionSeverity === 'urgent' ? 'Action Required' : attentionSeverity === 'warning' ? 'Needs Attention' : null;

  return {
    elapsedCookMinutes,
    checkpoint50Reached,
    checkpoint130Reached,
    criticalReached,
    approaching130Deadline,
    missed130Deadline,
    attentionItems,
    attentionSeverity,
    attentionHeader,
    expectedCookMinutes,
    elapsedChillMinutes,
  };
}

function getSmokehouseNextCheckpoint(batch: BatchRecord, marks: CheckpointState, enabledTimelineActions: string[]) {
  const snapshot = getCheckpointSnapshot(batch, marks);
  if (batch.stage === BATCH_STAGES.COOK && !snapshot.checkpoint50Reached) return '50F checkpoint';
  if (batch.stage === BATCH_STAGES.COOK && !snapshot.checkpoint130Reached) return '130F checkpoint (6h)';
  if (batch.stage === BATCH_STAGES.COOK && !snapshot.criticalReached) return 'Critical temp confirm';
  if (enabledTimelineActions.includes('Start Shower')) return 'Start shower';
  if (enabledTimelineActions.includes('Complete Shower')) return 'Complete shower';
  if (enabledTimelineActions.includes('Start Chill')) return 'Move to chill';
  if (enabledTimelineActions.includes('Assign Chiller')) return 'Assign chiller';
  if (enabledTimelineActions.includes('Complete Chill')) return 'Complete chill';
  return 'Monitor';
}

export default function ChillerLoadScreen() {
  const router = useRouter();
  const {
    batches,
    prepTickets,
    equipmentReadiness,
    assignPrepSmokehouse,
    runTimelineAction,
    getEnabledTimelineActions,
    getChillerLoad,
    getBatchFlowSnapshot,
    canViewBatchInArea,
  } = useC3S();
  const [viewMode, setViewMode] = useState<ThermalViewMode>('batch');
  const [checkpointMarks, setCheckpointMarks] = useState<Record<string, CheckpointState>>({});
  const [assignmentRackCounts, setAssignmentRackCounts] = useState<Record<string, number>>({});

  const thermalBatches = useMemo(
    () =>
      batches
        .filter((batch) => canViewBatchInArea('thermal', batch.id))
        .filter((batch) => thermalStages.includes(batch.stage as (typeof thermalStages)[number]))
        .sort((a, b) => {
          const stageDelta = stageOrder[a.stage] - stageOrder[b.stage];
          if (stageDelta !== 0) return stageDelta;
          if (a.status === 'Delayed' && b.status !== 'Delayed') return -1;
          if (b.status === 'Delayed' && a.status !== 'Delayed') return 1;
          return a.id.localeCompare(b.id);
        }),
    [batches, canViewBatchInArea],
  );

  const thermalAssignmentQueue = useMemo(
    () =>
      prepTickets
        .filter((ticket) => ticket.awaitingThermalAssignment && !ticket.linkedBatchId)
        .sort((a, b) => a.requestedStart.localeCompare(b.requestedStart)),
    [prepTickets],
  );

  const smokehouseRows = useMemo(
    () =>
      SMOKEHOUSES.map((smokehouseId) => {
        const loadedBatch = thermalBatches.find(
          (batch) =>
            batch.smokehouse === smokehouseId &&
            (batch.stage === BATCH_STAGES.COOK ||
              batch.stage === BATCH_STAGES.SHOWER ||
              batch.stage === BATCH_STAGES.EVACUATE),
        );
        const readiness = equipmentReadiness.find((item) => item.id === `SH-${smokehouseId}`);
        const status = loadedBatch ? 'Loaded' : !readiness?.ready || !readiness.clean ? 'Cleaning' : 'Available';
        const marks = loadedBatch ? checkpointMarks[loadedBatch.id] ?? {} : {};
        const enabledActions = loadedBatch ? getEnabledTimelineActions(loadedBatch.id) : [];

        return {
          smokehouseId,
          status,
          loadedBatch,
          elapsedMinutes: loadedBatch ? getCheckpointSnapshot(loadedBatch, marks).elapsedCookMinutes : null,
          nextCheckpoint: loadedBatch ? getSmokehouseNextCheckpoint(loadedBatch, marks, enabledActions) : null,
        };
      }),
    [thermalBatches, equipmentReadiness, checkpointMarks, getEnabledTimelineActions],
  );

  const chillerRows = useMemo(() => {
    const chillerLoad = getChillerLoad();
    return chillerLoad.map((load) => {
      const occupiedBatch =
        load.assignedBatchIds.length > 0 ? batches.find((batch) => batch.id === load.assignedBatchIds[0]) : null;
      const snapshot = occupiedBatch ? getCheckpointSnapshot(occupiedBatch, checkpointMarks[occupiedBatch.id] ?? {}) : null;
      const nextCheck =
        occupiedBatch && occupiedBatch.stage === BATCH_STAGES.CHILL
          ? 'Scheduled chill temp check'
          : occupiedBatch && occupiedBatch.stage === BATCH_STAGES.THERMAL_COOLER
            ? 'Thermal sign-out / QA handoff'
            : null;

      return {
        chillerId: `CH-${load.chillerNumber}`,
        status: load.status,
        occupiedBatch,
        timeInChill: snapshot?.elapsedChillMinutes ?? null,
        nextCheck,
      };
    });
  }, [getChillerLoad, batches, checkpointMarks]);

  const updateCheckpoint = (batchId: string, update: Partial<CheckpointState>) => {
    setCheckpointMarks((prev) => ({
      ...prev,
      [batchId]: {
        ...prev[batchId],
        ...update,
      },
    }));
  };

  const confirmAction = (title: string, message: string, action: () => void) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'default', onPress: action },
    ]);
  };

  const adjustAssignmentRacks = (prepId: string, base: number, delta: number) => {
    setAssignmentRackCounts((prev) => {
      const current = prev[prepId] ?? base;
      return { ...prev, [prepId]: Math.max(1, current + delta) };
    });
  };

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader
          title="Thermal Operations"
          subtitle="Operator-first thermal flow: cook checkpoints, risk flags, and next action"
        />

        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          <View style={styles.viewToggleRow}>
            <Pressable
              style={[styles.viewToggleButton, viewMode === 'batch' ? styles.viewToggleActive : styles.viewToggleInactive]}
              onPress={() => setViewMode('batch')}>
              <Text style={[styles.viewToggleText, viewMode === 'batch' ? styles.viewToggleTextActive : null]}>Batch View</Text>
            </Pressable>
            <Pressable
              style={[
                styles.viewToggleButton,
                viewMode === 'equipment' ? styles.viewToggleActive : styles.viewToggleInactive,
              ]}
              onPress={() => setViewMode('equipment')}>
              <Text style={[styles.viewToggleText, viewMode === 'equipment' ? styles.viewToggleTextActive : null]}>
                Equipment View
              </Text>
            </Pressable>
          </View>

          {viewMode === 'batch' ? (
            <>
              <Text style={styles.sectionTitle}>Thermal Assignment Queue</Text>
              {thermalAssignmentQueue.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>No Batches Awaiting Assignment</Text>
                  <Text style={styles.emptySub}>RTC-marked ready batches appear here for thermal smokehouse assignment.</Text>
                </View>
              ) : (
                thermalAssignmentQueue.map((ticket) => {
                  const rtcRackCount = ticket.rtcReadyRackCount ?? ticket.racks;
                  const thermalRackCount = assignmentRackCounts[ticket.id] ?? rtcRackCount;

                  return (
                    <C3SCard key={ticket.id} borderColor="#42A5F5">
                      <View style={styles.topRow}>
                        <View>
                          <Text style={styles.product}>{ticket.product}</Text>
                          <Text style={styles.batchId}>{ticket.id}</Text>
                        </View>
                        <View style={styles.queuePill}>
                          <Text style={styles.queuePillText}>Awaiting Assignment</Text>
                        </View>
                      </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Stage</Text>
                    <Text style={styles.metaValue}>{getPrepStageDisplayLabel(ticket.status)}</Text>
                    <Text style={styles.metaLabel}>Owner</Text>
                    <Text style={styles.metaValue}>Thermal</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Location</Text>
                    <Text style={styles.metaValue}>Staging Area</Text>
                    <Text style={styles.metaLabel}>RTC Rack Count</Text>
                    <Text style={styles.metaValue}>{rtcRackCount}</Text>
                    <Text style={styles.metaLabel}>Thermal Confirmed</Text>
                    <Text style={styles.metaValue}>{thermalRackCount}</Text>
                  </View>
                      <View style={styles.rackAdjustRow}>
                        <Pressable
                          style={styles.adjustButton}
                          onPress={() => adjustAssignmentRacks(ticket.id, rtcRackCount, -1)}>
                          <Text style={styles.adjustButtonText}>-</Text>
                        </Pressable>
                        <Pressable
                          style={styles.adjustButton}
                          onPress={() => adjustAssignmentRacks(ticket.id, rtcRackCount, 1)}>
                          <Text style={styles.adjustButtonText}>+</Text>
                        </Pressable>
                      </View>
                      <Text style={styles.nextActionLabel}>Next Action</Text>
                      <Pressable
                        style={styles.primaryAction}
                        onPress={() =>
                          confirmAction(
                            'Assign Smokehouse',
                            `Assign smokehouse for ${ticket.id} with ${thermalRackCount} racks?`,
                            () => assignPrepSmokehouse(ticket.id, thermalRackCount),
                          )
                        }>
                        <Text style={styles.primaryActionText}>Assign Smokehouse</Text>
                      </Pressable>
                    </C3SCard>
                  );
                })
              )}

              <Text style={styles.sectionTitle}>Thermal Live Execution</Text>
              {thermalBatches.map((batch) => {
                const marks = checkpointMarks[batch.id] ?? {};
                const enabledTimelineActions = getEnabledTimelineActions(batch.id);
                const snapshot = getCheckpointSnapshot(batch, marks);
                const flow = getBatchFlowSnapshot(batch.id);

                const stageAction =
                  batch.stage === BATCH_STAGES.COOK && !snapshot.checkpoint50Reached
                    ? {
                        label: 'Mark 50F Reached',
                        onPress: () =>
                          confirmAction('Confirm 50F', `Confirm 50F checkpoint for ${batch.id}?`, () =>
                            updateCheckpoint(batch.id, { fiftyReached: true }),
                          ),
                      }
                    : batch.stage === BATCH_STAGES.COOK && !snapshot.checkpoint130Reached
                      ? {
                          label: 'Mark 130F Reached',
                          onPress: () =>
                            confirmAction('Confirm 130F', `Confirm 130F checkpoint for ${batch.id}?`, () =>
                              updateCheckpoint(batch.id, { oneThirtyReached: true }),
                            ),
                        }
                      : batch.stage === BATCH_STAGES.COOK && !snapshot.criticalReached
                        ? {
                            label: 'Confirm Critical Temp',
                            onPress: () =>
                              confirmAction('Confirm Critical Temp', `Confirm critical temp for ${batch.id}?`, () =>
                                updateCheckpoint(batch.id, { criticalReached: true }),
                              ),
                          }
                        : enabledTimelineActions.includes('Start Shower')
                          ? {
                              label: 'Start Shower',
                              onPress: () => runTimelineAction(batch.id, 'Start Shower'),
                            }
                          : enabledTimelineActions.includes('Complete Shower')
                            ? {
                                label: 'Complete Shower',
                                onPress: () => runTimelineAction(batch.id, 'Complete Shower'),
                              }
                            : enabledTimelineActions.includes('Start Chill')
                              ? {
                                  label: 'Move to Chill',
                                  onPress: () => runTimelineAction(batch.id, 'Start Chill'),
                                }
                              : enabledTimelineActions.includes('Assign Chiller')
                                ? {
                                    label: 'Assign Chiller',
                                    onPress: () => runTimelineAction(batch.id, 'Assign Chiller'),
                                  }
                                : enabledTimelineActions.includes('Complete Chill')
                                  ? {
                                      label: 'Complete Chill',
                                      onPress: () => runTimelineAction(batch.id, 'Complete Chill'),
                                    }
                                  : enabledTimelineActions.includes('Send to QA')
                                    ? {
                                        label: 'Send to QA',
                                        onPress: () => runTimelineAction(batch.id, 'Send to QA'),
                                      }
                                    : null;

                return (
                  <C3SCard key={batch.id} borderColor={snapshot.attentionItems.length > 0 ? '#C62828' : '#30363D'}>
                    <View style={styles.topRow}>
                      <View>
                        <Text style={styles.product}>{batch.product}</Text>
                        <Text style={styles.batchId}>{batch.id}</Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: BATCH_STATUS_COLORS[batch.status] }]}>
                        <Text style={styles.statusText}>{batch.status}</Text>
                      </View>
                    </View>

                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Smokehouse</Text>
                      <Text style={styles.metaValue}>{batch.smokehouse}</Text>
                      <Text style={styles.metaLabel}>Cook Type</Text>
                      <Text style={styles.metaValue}>{batch.productProfile.cookType.toUpperCase()}</Text>
                    </View>

                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Stage</Text>
                      <Text style={[styles.stageText, { color: STAGE_COLORS[batch.stage] }]}>{getStageDisplayLabel(batch.stage)}</Text>
                      <Text style={styles.metaLabel}>Elapsed</Text>
                      <Text style={styles.elapsedValue}>{snapshot.elapsedCookMinutes} min</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Cook Expected / Elapsed</Text>
                      <Text style={styles.metaValue}>
                        {snapshot.expectedCookMinutes}m / {snapshot.elapsedCookMinutes}m
                      </Text>
                      <Text style={styles.metaLabel}>Rack Type / Expected</Text>
                      <Text style={styles.metaValue}>
                        {batch.productProfile.rackType} / {batch.productProfile.averageRackCount}
                      </Text>
                    </View>
                    {snapshot.elapsedChillMinutes !== undefined ? (
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Chill Expected / Elapsed</Text>
                        <Text style={styles.metaValue}>
                          {batch.productProfile.estimatedChillMinutes}m / {snapshot.elapsedChillMinutes}m
                        </Text>
                      </View>
                    ) : null}
                    {flow ? (
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Owner</Text>
                        <Text style={styles.metaValue}>{flow.currentOwner}</Text>
                        <Text style={styles.metaLabel}>Location</Text>
                        <Text style={styles.metaValue}>{flow.currentLocation}</Text>
                      </View>
                    ) : null}

                    <View style={styles.checkpointRow}>
                      <View style={[styles.checkpointChip, checkpointStyle(snapshot.checkpoint50Reached)]}>
                        <Text style={styles.checkpointText}>50F</Text>
                      </View>
                      <View
                        style={[
                          styles.checkpointChip,
                          checkpointStyle(snapshot.checkpoint130Reached, snapshot.missed130Deadline),
                        ]}>
                        <Text style={styles.checkpointText}>130F (6h)</Text>
                      </View>
                      <View style={[styles.checkpointChip, checkpointStyle(snapshot.criticalReached)]}>
                        <Text style={styles.checkpointText}>Critical Temp</Text>
                      </View>
                    </View>

                    {snapshot.attentionItems.length > 0 ? (
                      <View
                        style={[
                          styles.attentionPanel,
                          snapshot.attentionSeverity === 'urgent' ? styles.attentionPanelUrgent : styles.attentionPanelWarning,
                        ]}>
                        <Text
                          style={[
                            styles.attentionTitle,
                            snapshot.attentionSeverity === 'urgent' ? styles.attentionTitleUrgent : styles.attentionTitleWarning,
                          ]}>
                          {snapshot.attentionHeader}
                        </Text>
                        {snapshot.attentionItems.map((issue) => (
                          <Text
                            key={issue.label}
                            style={[
                              styles.attentionItem,
                              snapshot.attentionSeverity === 'urgent' ? styles.attentionItemUrgent : styles.attentionItemWarning,
                            ]}>{`• ${issue.label}`}</Text>
                        ))}
                      </View>
                    ) : null}

                    <Text style={styles.nextActionLabel}>Next Action</Text>
                    {stageAction ? (
                      <Pressable style={styles.primaryAction} onPress={stageAction.onPress}>
                        <Text style={styles.primaryActionText}>{stageAction.label}</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.noActionText}>No stage-valid action available.</Text>
                    )}
                    {flow ? (
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Waiting On</Text>
                        <Text style={styles.metaValue}>{flow.waitingOn}</Text>
                      </View>
                    ) : null}

                    <View style={styles.secondaryRow}>
                      <Pressable
                        style={styles.secondaryAction}
                        onPress={() =>
                          confirmAction('Flag Issue', `Flag monitoring issue for ${batch.id}?`, () =>
                            updateCheckpoint(batch.id, { issueFlagged: true }),
                          )
                        }>
                        <Text style={styles.secondaryActionText}>Flag Issue</Text>
                      </Pressable>
                      <Pressable
                        style={styles.secondaryAction}
                        onPress={() => router.push({ pathname: '/batch-timeline', params: { batchId: batch.id } })}>
                        <Text style={styles.secondaryActionText}>View Details</Text>
                      </Pressable>
                    </View>
                  </C3SCard>
                );
              })}

              {thermalBatches.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>No Active Thermal Batches</Text>
                  <Text style={styles.emptySub}>Batches will appear here once loaded into thermal flow.</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Smokehouses</Text>
              {smokehouseRows.map((smokehouse) => (
                <Pressable
                  key={smokehouse.smokehouseId}
                  style={styles.equipmentCard}
                  onPress={() =>
                    smokehouse.loadedBatch
                      ? router.push({ pathname: '/batch-timeline', params: { batchId: smokehouse.loadedBatch.id } })
                      : undefined
                  }>
                  <View style={styles.topRow}>
                    <View>
                      <Text style={styles.product}>{`Smokehouse ${smokehouse.smokehouseId}`}</Text>
                      <Text style={styles.batchId}>
                        {smokehouse.loadedBatch
                          ? `${smokehouse.loadedBatch.product} · ${getStageDisplayLabel(smokehouse.loadedBatch.stage)}`
                          : 'No active load'}
                      </Text>
                    </View>
                    <View style={styles.queuePill}>
                      <Text style={styles.queuePillText}>{smokehouse.status}</Text>
                    </View>
                  </View>
                  {smokehouse.loadedBatch ? (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Elapsed</Text>
                      <Text style={styles.metaValue}>{smokehouse.elapsedMinutes} min</Text>
                      <Text style={styles.metaLabel}>Waiting On</Text>
                      <Text style={styles.metaValue}>{smokehouse.nextCheckpoint}</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}

              <Text style={styles.sectionTitle}>Chillers</Text>
              {chillerRows.map((chiller) => (
                <Pressable
                  key={chiller.chillerId}
                  style={styles.equipmentCard}
                  onPress={() =>
                    chiller.occupiedBatch
                      ? router.push({ pathname: '/batch-timeline', params: { batchId: chiller.occupiedBatch.id } })
                      : undefined
                  }>
                  <View style={styles.topRow}>
                    <View>
                      <Text style={styles.product}>{chiller.chillerId}</Text>
                      <Text style={styles.batchId}>{chiller.occupiedBatch ? chiller.occupiedBatch.product : 'No occupied batch'}</Text>
                    </View>
                    <View style={styles.queuePill}>
                      <Text style={styles.queuePillText}>{chiller.status}</Text>
                    </View>
                  </View>
                  {chiller.occupiedBatch ? (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Time in Chill</Text>
                      <Text style={styles.metaValue}>{chiller.timeInChill ?? 0} min</Text>
                      <Text style={styles.metaLabel}>Waiting On</Text>
                      <Text style={styles.metaValue}>{chiller.nextCheck ?? 'Monitor'}</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      </C3SPage>
    </C3SScreen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    gap: 10,
    paddingBottom: 24,
  },
  viewToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  viewToggleButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  viewToggleActive: {
    borderColor: '#42A5F5',
    backgroundColor: '#143A5E',
  },
  viewToggleInactive: {
    borderColor: '#30363D',
    backgroundColor: '#151A21',
  },
  viewToggleText: {
    color: '#9DA7B1',
    fontSize: 13,
    fontWeight: '800',
  },
  viewToggleTextActive: {
    color: '#E3F2FD',
  },
  sectionTitle: {
    color: '#E6EDF3',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  product: {
    color: '#F0F6FC',
    fontSize: 20,
    fontWeight: '800',
  },
  batchId: {
    color: '#9DA7B1',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    color: '#0D1117',
    fontSize: 12,
    fontWeight: '800',
  },
  queuePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#42A5F5',
    backgroundColor: '#143A5E',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  queuePillText: {
    color: '#E3F2FD',
    fontSize: 12,
    fontWeight: '800',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  metaLabel: {
    color: '#8B949E',
    fontSize: 12,
    fontWeight: '700',
  },
  metaValue: {
    color: '#E6EDF3',
    fontSize: 13,
    fontWeight: '700',
    marginRight: 10,
  },
  stageText: {
    fontSize: 18,
    fontWeight: '800',
    marginRight: 10,
  },
  elapsedValue: {
    color: '#E6EDF3',
    fontSize: 18,
    fontWeight: '800',
  },
  checkpointRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  checkpointChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  checkpointText: {
    fontSize: 12,
    fontWeight: '800',
  },
  attentionPanel: {
    marginTop: 10,
    borderRadius: 10,
    padding: 8,
    gap: 2,
  },
  attentionPanelWarning: {
    borderWidth: 1,
    borderColor: '#F9A825',
    backgroundColor: '#332710',
  },
  attentionPanelUrgent: {
    borderWidth: 1,
    borderColor: '#C62828',
    backgroundColor: '#2E1414',
  },
  attentionTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  attentionTitleWarning: {
    color: '#FFE082',
  },
  attentionTitleUrgent: {
    color: '#FFCDD2',
  },
  attentionItem: {
    fontSize: 12,
    fontWeight: '700',
  },
  attentionItemWarning: {
    color: '#FFE0B2',
  },
  attentionItemUrgent: {
    color: '#FFCDD2',
  },
  nextActionLabel: {
    color: '#9DA7B1',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 4,
  },
  primaryAction: {
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: '#1565C0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  primaryActionText: {
    color: '#F0F6FC',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  noActionText: {
    color: '#9DA7B1',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  rackAdjustRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  adjustButton: {
    minHeight: 34,
    minWidth: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustButtonText: {
    color: '#E6EDF3',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryAction: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  secondaryActionText: {
    color: '#E6EDF3',
    fontSize: 12,
    fontWeight: '700',
  },
  equipmentCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 12,
    backgroundColor: '#151A21',
    padding: 14,
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 12,
    backgroundColor: '#151A21',
    padding: 14,
  },
  emptyTitle: {
    color: '#E6EDF3',
    fontSize: 16,
    fontWeight: '800',
  },
  emptySub: {
    color: '#9DA7B1',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },
});
