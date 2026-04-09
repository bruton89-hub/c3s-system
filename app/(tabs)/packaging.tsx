import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C3SBlockedChips, C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { BATCH_STATUSES, RTE_COOLER, getStageDisplayLabel } from '@/constants/c3s';
import { type PackagingLineId, type SlicingLineId, type WorkflowState, useC3S } from '@/store/c3s-store';

type FilterKey = 'all' | 'next2' | 'next4';

type SelectedAsset =
  | { kind: 'slicing'; id: SlicingLineId }
  | { kind: 'packaging'; id: PackagingLineId }
  | null;

const filters: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All Queue' },
  { key: 'next2', label: 'Next 2 Hours' },
  { key: 'next4', label: 'Next 4 Hours' },
];

const workflowColors: Record<WorkflowState, string> = {
  ready: '#66BB6A',
  waiting: '#4FC3F7',
  blocked: '#EF5350',
  assigned: '#AB47BC',
  running: '#FFA726',
};

function formatLineType(type: string) {
  if (type === 'combo') return 'Combo';
  if (type === 'standard') return 'Standard';
  if (type === 'slicing') return 'Slicing';
  return type;
}
function hashFromText(value: string) {
  return value.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

export default function PackagingScreen() {
  const {
    batches,
    rteCooler,
    slicingLines,
    packagingLines,
    markSlicingLineClean,
    setSlicingLineQAPreOp,
    markSlicingLineReady,
    assignBatchToSlicingLine,
    markPackagingLineClean,
    setPackagingLineQAPreOp,
    markPackagingLineReady,
    assignBatchToPackagingLine,
    getBatchHandoffLabel,
    getBatchBlockedReasons,
    getBatchWorkflowState,
    getBatchFlowSnapshot,
    canViewBatchInArea,
  } = useC3S();

  const [selected, setSelected] = useState<SelectedAsset>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  const waitingInRTE = useMemo(
    () =>
      batches.filter(
        (batch) =>
          canViewBatchInArea('packaging', batch.id) &&
          batch.packagingStatus === 'Waiting' &&
          batch.rteCoolerId === RTE_COOLER,
      ),
    [batches, canViewBatchInArea],
  );

  const assignedBatches = useMemo(
    () =>
      batches.filter(
        (batch) =>
          canViewBatchInArea('packaging', batch.id) &&
          (batch.packagingStatus === 'Assigned' || batch.slicingStatus === 'Assigned'),
      ),
    [batches, canViewBatchInArea],
  );

  const runningBatches = useMemo(
    () => batches.filter((batch) => canViewBatchInArea('packaging', batch.id) && batch.packagingStatus === 'Running'),
    [batches, canViewBatchInArea],
  );

  const delayedBatches = useMemo(
    () => batches.filter((batch) => canViewBatchInArea('packaging', batch.id) && batch.status === BATCH_STATUSES.DELAYED),
    [batches, canViewBatchInArea],
  );

  const lineIssuesCount = useMemo(() => {
    const slicingIssues = slicingLines.filter(
      (line) => !line.cleanStatus || !line.ready || line.qaPreOpStatus !== 'Passed',
    ).length;
    const packagingIssues = packagingLines.filter(
      (line) => !line.cleanStatus || !line.readyStatus || line.qaPreOpStatus !== 'Passed',
    ).length;
    const coolerIssue = !rteCooler.cleanStatus || !rteCooler.readyStatus || rteCooler.qaPreOpStatus !== 'Passed' ? 1 : 0;
    return slicingIssues + packagingIssues + coolerIssue;
  }, [slicingLines, packagingLines, rteCooler]);

  const queueCandidates = useMemo(
    () =>
      batches.filter(
        (batch) =>
          canViewBatchInArea('packaging', batch.id) &&
          (batch.packagingStatus === 'Waiting' || batch.packagingStatus === 'Assigned' || batch.packagingStatus === 'Running'),
      ),
    [batches, canViewBatchInArea],
  );

  const queue = useMemo(() => {
    if (activeFilter === 'next2') {
      return queueCandidates.filter((batch) => batch.minutesToReady > 0 && batch.minutesToReady <= 120);
    }
    if (activeFilter === 'next4') {
      return queueCandidates.filter((batch) => batch.minutesToReady > 0 && batch.minutesToReady <= 240);
    }
    return queueCandidates;
  }, [activeFilter, queueCandidates]);

  const selectedSlicing = selected?.kind === 'slicing' ? slicingLines.find((line) => line.id === selected.id) : undefined;
  const selectedPackaging =
    selected?.kind === 'packaging' ? packagingLines.find((line) => line.id === selected.id) : undefined;
  const selectedBatchId = selectedSlicing?.assignedBatchId ?? selectedPackaging?.assignedBatchId;
  const selectedBatch = selectedBatchId ? batches.find((batch) => batch.id === selectedBatchId) : undefined;
  const selectedPrimaryAction = useMemo(() => {
    if (!selected) return null;

    if (selected.kind === 'slicing' && selectedSlicing) {
      if (!selectedSlicing.cleanStatus) {
        return { label: 'Mark Clean', onPress: () => markSlicingLineClean(selectedSlicing.id) };
      }
      if (selectedSlicing.qaPreOpStatus !== 'Passed') {
        return {
          label: 'Mark QA Pre-Op Passed',
          onPress: () => setSlicingLineQAPreOp(selectedSlicing.id, 'Passed'),
        };
      }
      if (!selectedSlicing.ready) {
        return { label: 'Mark Ready', onPress: () => markSlicingLineReady(selectedSlicing.id) };
      }
      return {
        label: selectedSlicing.assignedBatchId ? 'Complete Slicing Run' : 'Assign Batch',
        onPress: () => assignBatchToSlicingLine(selectedSlicing.id),
      };
    }

    if (selected.kind === 'packaging' && selectedPackaging) {
      if (!selectedPackaging.cleanStatus) {
        return { label: 'Mark Clean', onPress: () => markPackagingLineClean(selectedPackaging.id) };
      }
      if (selectedPackaging.qaPreOpStatus !== 'Passed') {
        return {
          label: 'Mark QA Pre-Op Passed',
          onPress: () => setPackagingLineQAPreOp(selectedPackaging.id, 'Passed'),
        };
      }
      if (!selectedPackaging.readyStatus) {
        return { label: 'Mark Ready', onPress: () => markPackagingLineReady(selectedPackaging.id) };
      }
      const lineBatch = selectedPackaging.assignedBatchId
        ? batches.find((batch) => batch.id === selectedPackaging.assignedBatchId)
        : undefined;
      const lineActionLabel =
        lineBatch?.packagingStatus === 'Assigned'
          ? 'Start Packaging Run'
          : lineBatch?.packagingStatus === 'Running'
            ? 'Complete Packaging Run'
            : 'Assign Batch';
      return {
        label: lineActionLabel,
        onPress: () => assignBatchToPackagingLine(selectedPackaging.id),
      };
    }

    return null;
  }, [
    selected,
    selectedPackaging,
    selectedSlicing,
    batches,
    markSlicingLineClean,
    setSlicingLineQAPreOp,
    markSlicingLineReady,
    assignBatchToSlicingLine,
    markPackagingLineClean,
    setPackagingLineQAPreOp,
    markPackagingLineReady,
    assignBatchToPackagingLine,
  ]);

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader
          title="Packaging Operations"
          subtitle={`Batch-first packaging flow with RTE Cooler ${RTE_COOLER} and line readiness`}
        />

        <View style={styles.kpiRow}>
          {[
            { label: 'Waiting in RTE', value: waitingInRTE.length },
            { label: 'Assigned', value: assignedBatches.length },
            { label: 'Running', value: runningBatches.length },
            { label: 'Delayed', value: delayedBatches.length },
            { label: 'Line Issues', value: lineIssuesCount },
          ].map((kpi) => (
            <View key={kpi.label} style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{kpi.value}</Text>
              <Text style={styles.kpiLabel}>{kpi.label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>RTE Cooler</Text>
        <C3SCard>
          <View style={styles.cardHead}>
            <Text style={styles.assetId}>Cooler {rteCooler.id}</Text>
            <Text style={styles.assetType}>Packaging Operations</Text>
          </View>
          <Text style={[styles.assetMeta, { color: rteCooler.cleanStatus ? '#66BB6A' : '#EF5350' }]}>
            Clean: {rteCooler.cleanStatus ? 'Yes' : 'No'}
          </Text>
          <Text style={[styles.assetMeta, { color: rteCooler.qaPreOpStatus === 'Passed' ? '#66BB6A' : '#FFA726' }]}>
            QA Pre-Op: {rteCooler.qaPreOpStatus}
          </Text>
          <Text style={[styles.assetMeta, { color: rteCooler.readyStatus ? '#66BB6A' : '#EF5350' }]}>
            Ready: {rteCooler.readyStatus ? 'Yes' : 'No'}
          </Text>
          <Text style={styles.assetMeta}>Stored Batches: {waitingInRTE.length}</Text>
          <View style={styles.storedList}>
            {waitingInRTE.length === 0 ? <Text style={styles.assetMeta}>No batches waiting in cooler 67.</Text> : null}
            {waitingInRTE.map((batch) => (
              <Text key={batch.id} style={styles.assetMeta}>
                {batch.id} | {batch.product} | ETA {batch.eta}
              </Text>
            ))}
          </View>
        </C3SCard>

        <Text style={styles.sectionTitle}>Slicing Line</Text>
        <View style={styles.cardGrid}>
          {slicingLines.map((line) => (
            <Pressable
              key={line.id}
              style={[styles.assetCard, slicingLines.length === 1 && styles.singleSlicingCard]}
              onPress={() => setSelected({ kind: 'slicing', id: line.id })}>
              <View style={styles.cardHead}>
                <Text style={styles.assetId}>{line.id}</Text>
                <Text style={styles.assetType}>Slicing Line</Text>
              </View>
              <Text style={[styles.assetMeta, { color: line.cleanStatus ? '#66BB6A' : '#EF5350' }]}>Clean: {line.cleanStatus ? 'Yes' : 'No'}</Text>
              <Text style={[styles.assetMeta, { color: line.qaPreOpStatus === 'Passed' ? '#66BB6A' : '#FFA726' }]}>QA: {line.qaPreOpStatus}</Text>
              <Text style={[styles.assetMeta, { color: line.ready ? '#66BB6A' : '#EF5350' }]}>Ready: {line.ready ? 'Yes' : 'No'}</Text>
              <Text style={styles.assetMeta}>Assigned: {line.assignedBatchId ?? '--'}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Packaging Lines</Text>
        <View style={styles.cardGrid}>
          {packagingLines.map((line) => (
            <Pressable
              key={line.id}
              style={styles.assetCard}
              onPress={() => setSelected({ kind: 'packaging', id: line.id })}>
              <View style={styles.cardHead}>
                <Text style={styles.assetId}>{line.id}</Text>
                <Text style={styles.assetType}>
                  {formatLineType(line.type)}
                </Text>
              </View>
              <Text style={[styles.assetMeta, { color: line.cleanStatus ? '#66BB6A' : '#EF5350' }]}>Clean: {line.cleanStatus ? 'Yes' : 'No'}</Text>
              <Text style={[styles.assetMeta, { color: line.qaPreOpStatus === 'Passed' ? '#66BB6A' : '#FFA726' }]}>QA: {line.qaPreOpStatus}</Text>
              <Text style={[styles.assetMeta, { color: line.readyStatus ? '#66BB6A' : '#EF5350' }]}>Ready: {line.readyStatus ? 'Yes' : 'No'}</Text>
              <Text style={styles.assetMeta}>Assigned: {line.assignedBatchId ?? '--'}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Packaging Queue / Forecast</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={styles.filterRowScroll}>
          {filters.map((filter) => {
            const active = filter.key === activeFilter;
            return (
              <Pressable
                key={filter.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setActiveFilter(filter.key)}>
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{filter.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView contentContainerStyle={styles.queueList}>
          {queue.length === 0 ? <Text style={styles.emptyText}>No batches in this Packaging Operations forecast window.</Text> : null}
          {queue.map((batch) => {
            const flow = getBatchFlowSnapshot(batch.id);
            const hash = hashFromText(batch.id);
            const expectedPackMinutes = batch.productProfile.averagePackagingMinutes;
            const elapsedPackMinutes =
              batch.packagingStatus === 'Running'
                ? Math.max(10, Math.round(expectedPackMinutes * (0.7 + ((hash % 45) / 100))))
                : batch.packagingStatus === 'Assigned'
                  ? Math.max(8, Math.round(expectedPackMinutes * 0.35))
                  : batch.packagingStatus === 'Completed'
                    ? expectedPackMinutes
                    : undefined;
            const packNeedsAttention =
              elapsedPackMinutes !== undefined && elapsedPackMinutes > expectedPackMinutes;
            const packActionRequired =
              elapsedPackMinutes !== undefined && elapsedPackMinutes > Math.round(expectedPackMinutes * 1.25);
            const stageLabel =
              batch.packagingStatus === 'Completed'
                ? 'Packaging: Complete'
                : batch.packagingStatus === 'Assigned' || batch.packagingStatus === 'Running'
                  ? 'Packaging: On Line'
                  : batch.stage === 'PACKAGING'
                    ? 'Packaging: Ready for Line'
                    : getStageDisplayLabel(batch.stage);
            const locationLabel =
              flow?.currentLocation ??
              (batch.rteCoolerId
                ? `RTE Cooler ${batch.rteCoolerId}`
                : batch.packagingLineId
                  ? `Packaging Line ${batch.packagingLineId}`
                  : batch.slicingLineId
                    ? `Slicing Line ${batch.slicingLineId}`
                    : `RTE Cooler ${RTE_COOLER}`);
            return (
            <C3SCard key={batch.id}>
              <View style={styles.queueTopRow}>
                <View>
                  <Text style={styles.queueProduct}>{batch.product}</Text>
                  <Text style={styles.queueId}>{batch.id}</Text>
                </View>
                <View style={[styles.workflowBadge, { backgroundColor: workflowColors[getBatchWorkflowState(batch)] }]}>
                  <Text style={styles.workflowBadgeText}>{getBatchWorkflowState(batch).toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.queueMeta}>Stage: {stageLabel}</Text>
              <Text style={styles.queueMeta}>Owner: {flow?.currentOwner ?? 'Packaging'}</Text>
              <Text style={styles.queueMeta}>Location: {locationLabel}</Text>
              <Text style={styles.queueMeta}>Waiting On: {flow?.waitingOn ?? getBatchHandoffLabel(batch)}</Text>
              <Text style={styles.queueMeta}>Next Action: {flow?.nextValidAction ?? 'Monitor'}</Text>
              <C3SBlockedChips reasons={getBatchBlockedReasons(batch)} />
              <Text style={styles.queueForecast}>Forecast Ready: {batch.eta}</Text>
              <Text style={styles.queueMeta}>
                Estimated Pack: {expectedPackMinutes}m
                {elapsedPackMinutes !== undefined ? ` | Elapsed: ${elapsedPackMinutes}m` : ''}
              </Text>
              {packActionRequired ? <Text style={styles.queueRiskUrgent}>Action Required: pack time exceeded</Text> : null}
              {!packActionRequired && packNeedsAttention ? (
                <Text style={styles.queueRiskWarning}>Needs Attention: pack time above expected</Text>
              ) : null}
              <Text style={styles.queueMeta}>
                Racks {batch.rackCount} | Slicing: {batch.slicingStatus ?? '--'} | Packaging: {batch.packagingStatus ?? '--'}
              </Text>
            </C3SCard>
            );
          })}
        </ScrollView>
      </C3SPage>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelected(null)} />
          {selected ? (
            <View style={styles.modalCard}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>
                  {selected.kind === 'slicing' ? `Slicing ${selected.id}` : `Packaging ${selected.id}`}
                </Text>
                <Pressable style={styles.closeButton} onPress={() => setSelected(null)}>
                  <Text style={styles.closeText}>Close</Text>
                </Pressable>
              </View>

              {selected.kind === 'slicing' && selectedSlicing ? (
                <>
                  <Text style={styles.modalMeta}>Clean: {selectedSlicing.cleanStatus ? 'Yes' : 'No'}</Text>
                  <Text style={styles.modalMeta}>QA Pre-Op: {selectedSlicing.qaPreOpStatus}</Text>
                  <Text style={styles.modalMeta}>Ready: {selectedSlicing.ready ? 'Yes' : 'No'}</Text>
                  <Text style={styles.modalMeta}>Assigned Batch: {selectedSlicing.assignedBatchId ?? '--'}</Text>
                </>
              ) : null}
              {selected.kind === 'packaging' && selectedPackaging ? (
                <>
                  <Text style={styles.modalMeta}>Type: {selectedPackaging.type}</Text>
                  <Text style={styles.modalMeta}>Clean: {selectedPackaging.cleanStatus ? 'Yes' : 'No'}</Text>
                  <Text style={styles.modalMeta}>QA Pre-Op: {selectedPackaging.qaPreOpStatus}</Text>
                  <Text style={styles.modalMeta}>Ready: {selectedPackaging.readyStatus ? 'Yes' : 'No'}</Text>
                  <Text style={styles.modalMeta}>Assigned Batch: {selectedPackaging.assignedBatchId ?? '--'}</Text>
                </>
              ) : null}
              {selectedBatch ? (
                <Text style={styles.modalMeta}>
                  Batch: {selectedBatch.id} | Slicing {selectedBatch.slicingStatus ?? '--'} | Packaging{' '}
                  {selectedBatch.packagingStatus ?? '--'}
                </Text>
              ) : null}

              <View style={styles.modalActions}>
                <Text style={styles.nextActionLabel}>Next Action</Text>
                {selectedPrimaryAction ? (
                  <Pressable style={[styles.actionButton, styles.assignButton]} onPress={selectedPrimaryAction.onPress}>
                    <Text style={styles.actionText}>{selectedPrimaryAction.label}</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.modalMeta}>No action available.</Text>
                )}
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </C3SScreen>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0D1117' },
  page: { flex: 1, backgroundColor: '#0D1117', paddingHorizontal: 20, paddingTop: 10 },
  header: { marginBottom: 12 },
  title: { color: '#E6EDF3', fontSize: 34, fontWeight: '800', letterSpacing: 0.2 },
  subTitle: { color: '#8B949E', fontSize: 18, marginTop: 2, fontWeight: '600' },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 12,
    paddingVertical: 10,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiValue: { color: '#F0F6FC', fontSize: 24, fontWeight: '800' },
  kpiLabel: { color: '#9DA7B1', fontSize: 12, fontWeight: '700' },
  sectionTitle: { color: '#E6EDF3', fontSize: 22, fontWeight: '800', marginTop: 4, marginBottom: 8 },
  coolerCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  storedList: { marginTop: 6, gap: 2 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  assetCard: {
    width: 220,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 12,
    padding: 10,
    minHeight: 126,
  },
  singleSlicingCard: {
    width: 320,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  assetId: { color: '#F0F6FC', fontSize: 18, fontWeight: '800' },
  assetType: { color: '#9DA7B1', fontSize: 12, fontWeight: '700' },
  assetMeta: { color: '#C9D1D9', fontSize: 12, fontWeight: '700', marginTop: 2 },
  filterRowScroll: { marginBottom: 10, maxHeight: 56 },
  filterRow: { gap: 8, paddingRight: 8 },
  filterChip: {
    minHeight: 42,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: {
    borderColor: '#4FC3F7',
    backgroundColor: '#13314A',
  },
  filterChipText: {
    color: '#AAB4BE',
    fontSize: 14,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#E6EDF3',
  },
  queueList: { gap: 8, paddingBottom: 16 },
  queueCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 10,
    padding: 10,
  },
  queueTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  workflowBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    minHeight: 24,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workflowBadgeText: {
    color: '#0D1117',
    fontSize: 11,
    fontWeight: '800',
  },
  queueId: { color: '#F0F6FC', fontSize: 16, fontWeight: '800' },
  queueProduct: { color: '#E6EDF3', fontSize: 15, fontWeight: '700', marginTop: 3 },
  queueMeta: { color: '#9DA7B1', fontSize: 13, fontWeight: '700', marginTop: 2 },
  queueForecast: { color: '#A5D6A7', fontSize: 14, fontWeight: '800', marginTop: 3 },
  queueRiskWarning: { color: '#FFE082', fontSize: 12, fontWeight: '800', marginTop: 2 },
  queueRiskUrgent: { color: '#FFCDD2', fontSize: 12, fontWeight: '800', marginTop: 2 },
  emptyText: { color: '#9DA7B1', fontSize: 14, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 780,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: '#E6EDF3', fontSize: 24, fontWeight: '800' },
  closeButton: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#0D1117',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  closeText: { color: '#E6EDF3', fontSize: 13, fontWeight: '700' },
  modalMeta: { color: '#C9D1D9', fontSize: 14, fontWeight: '700' },
  modalActions: { gap: 8, marginTop: 4 },
  nextActionLabel: { color: '#9DA7B1', fontSize: 12, fontWeight: '700' },
  actionButton: {
    width: '100%',
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  assignButton: { backgroundColor: '#4E342E' },
  actionText: { color: '#F0F6FC', fontSize: 13, fontWeight: '800' },
});
