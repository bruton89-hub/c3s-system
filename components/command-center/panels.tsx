import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  BATCH_STATUSES,
  BATCH_STATUS_COLORS,
  BATCH_STAGES,
  SMOKEHOUSES,
  STAGE_COLORS,
  getStageDisplayLabel,
  isThermalStage,
  type ChillerNumber,
  type SmokehouseCode,
} from '@/constants/c3s';
import {
  type BatchActionType,
  type BatchRecord,
  type ChillerLoad,
  type EquipmentReadiness,
  type StartCookInput,
  type WorkflowState,
} from '@/store/c3s-store';

type NavItem = {
  label: string;
  onPress: () => void;
};

type QuickStat = {
  label: string;
  value: number;
};

type AlertItem = {
  id: string;
  level: 'Critical' | 'Warning' | 'Info';
  text: string;
  time: string;
  handoff?: string;
  blocked?: string;
};
type FlowState = 'ready' | 'waiting' | 'blocked' | 'active';
type FlowStep = {
  label: string;
  count?: number;
  state: FlowState;
};

const workflowColors: Record<WorkflowState, string> = {
  ready: '#66BB6A',
  waiting: '#4FC3F7',
  blocked: '#EF5350',
  assigned: '#AB47BC',
  running: '#FFA726',
};
const flowStateColors: Record<FlowState, string> = {
  ready: '#66BB6A',
  waiting: '#4FC3F7',
  blocked: '#EF5350',
  active: '#FFA726',
};

export function SidebarNav({ items, compact }: { items: NavItem[]; compact: boolean }) {
  return (
    <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
      <Text style={styles.sidebarTitle}>Navigation</Text>
      <View style={[styles.sidebarList, compact && styles.sidebarListCompact]}>
        {items.map((item) => (
          <Pressable key={item.label} style={styles.sidebarButton} onPress={item.onPress}>
            <Text style={styles.sidebarButtonText}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function TopBar({ userName }: { userName: string }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.topBar}>
      <View>
        <Text style={styles.title}>C3S Production Command Center</Text>
        <Text style={styles.subTitle}>C3S Operational Flow</Text>
      </View>

      <View style={styles.topBarRight}>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live</Text>
        </View>
        <Text style={styles.topMetaText}>
          {now.toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' })}{' '}
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
        </Text>
        <Text style={styles.topMetaText}>{userName}</Text>
      </View>
    </View>
  );
}

export function FlowIndicatorBar({ steps }: { steps: readonly FlowStep[] }) {
  return (
    <View style={styles.flowWrap}>
      {steps.map((step, index) => (
        <View key={step.label} style={styles.flowItemWrap}>
          <View style={[styles.flowItem, { borderColor: flowStateColors[step.state] }]}>
            <View style={[styles.flowDot, { backgroundColor: flowStateColors[step.state] }]} />
            <Text style={styles.flowLabel}>{step.label}</Text>
            {typeof step.count === 'number' ? <Text style={styles.flowCount}>{step.count}</Text> : null}
          </View>
          {index < steps.length - 1 ? <Text style={styles.flowArrow}>→</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function StartBatchPanel({ onStartCook }: { onStartCook: (input: StartCookInput) => string | null }) {
  const [product, setProduct] = useState('Honey Baked Ham');
  const [smokehouse, setSmokehouse] = useState<SmokehouseCode>('D');
  const [batchId, setBatchId] = useState('');
  const [rackCount, setRackCount] = useState('8');
  const [pieceCount, setPieceCount] = useState('320');
  const [checklist, setChecklist] = useState({
    smokehouseClean: false,
    sockChanged: false,
    generatorSetUp: false,
    productTagsVerified: false,
    temperatureBelow44F: false,
  });

  const toggleChecklist = (key: keyof typeof checklist) => {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Start New Batch / Prep Intake</Text>

      <View style={styles.inputGrid}>
        <Field label="Product" value={product} onChange={setProduct} />
        <Field label="Smokehouse" value={smokehouse} onChange={(v) => setSmokehouse((v || 'D') as SmokehouseCode)} />
        <Field label="Batch ID" value={batchId} onChange={setBatchId} placeholder="Auto if blank" />
        <Field label="Rack Count" value={rackCount} onChange={setRackCount} keyboardType="numeric" />
        <Field label="Piece Count" value={pieceCount} onChange={setPieceCount} keyboardType="numeric" />
      </View>

      <Text style={styles.panelSubTitle}>Pre-cook Checklist</Text>
      <View style={styles.checklistGrid}>
        <ChecklistPill
          label="Smokehouse Clean"
          checked={checklist.smokehouseClean}
          onPress={() => toggleChecklist('smokehouseClean')}
        />
        <ChecklistPill
          label="Sock Changed"
          checked={checklist.sockChanged}
          onPress={() => toggleChecklist('sockChanged')}
        />
        <ChecklistPill
          label="Generator Set Up"
          checked={checklist.generatorSetUp}
          onPress={() => toggleChecklist('generatorSetUp')}
        />
        <ChecklistPill
          label="Product Tags Verified"
          checked={checklist.productTagsVerified}
          onPress={() => toggleChecklist('productTagsVerified')}
        />
        <ChecklistPill
          label="Temperature Below 44°F"
          checked={checklist.temperatureBelow44F}
          onPress={() => toggleChecklist('temperatureBelow44F')}
        />
      </View>

      <Pressable
        style={styles.primaryButton}
        onPress={() =>
          onStartCook({
            product,
            smokehouse,
            batchId,
            rackCount: Number.parseInt(rackCount, 10) || 0,
            pieceCount: Number.parseInt(pieceCount, 10) || 0,
            checklist,
          })
        }>
        <Text style={styles.primaryButtonText}>Start Cook</Text>
      </Pressable>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#6E7681"
        keyboardType={keyboardType ?? 'default'}
      />
    </View>
  );
}

function ChecklistPill({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.checkPill, checked && styles.checkPillChecked]} onPress={onPress}>
      <Text style={[styles.checkPillText, checked && styles.checkPillTextChecked]}>{label}</Text>
    </Pressable>
  );
}

export function BatchActionsPanel({
  activeBatch,
  enabledActions,
  onAction,
}: {
  activeBatch: BatchRecord | undefined;
  enabledActions: BatchActionType[];
  onAction: (batchId: string, action: BatchActionType) => void;
}) {
  const actions: BatchActionType[] = [
    'Critical Temp',
    'Probe Confirm',
    'Start Shower',
    'End Shower',
    'Move to Chill',
    'Chill Check',
    'Log Delay',
  ];

  return (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Thermal Actions</Text>
      <Text style={styles.panelHint}>Active: {activeBatch?.id ?? 'None selected'}</Text>
      {activeBatch ? (
        <View style={styles.activeBatchContext}>
          <Text style={styles.activeBatchContextText}>
            {activeBatch.product} | SH {activeBatch.smokehouse} | {getStageDisplayLabel(activeBatch.stage)} |{' '}
            {activeBatch.status}
          </Text>
        </View>
      ) : (
        <View style={styles.noSelectionBox}>
          <Text style={styles.noSelectionText}>
            Select a batch in the Active Batches table to enable control actions.
          </Text>
        </View>
      )}
      <View style={styles.actionsGrid}>
        {actions.map((action) => (
          <Pressable
            key={action}
            style={[
              styles.actionButton,
              !(activeBatch && enabledActions.includes(action)) && styles.actionButtonDisabled,
            ]}
            disabled={!(activeBatch && enabledActions.includes(action))}
            onPress={() => activeBatch && onAction(activeBatch.id, action)}>
            <Text style={styles.actionButtonText}>{action}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ThermalProcessingPanel({
  batches,
  equipmentReadiness,
  chillerRows,
  onAssign,
  getBatchHandoffLabel,
  getBatchBlockedReasons,
  getBatchWorkflowState,
}: {
  batches: BatchRecord[];
  equipmentReadiness: EquipmentReadiness[];
  chillerRows: ChillerLoad[];
  onAssign: (chiller: ChillerNumber) => string | null;
  getBatchHandoffLabel: (batch: BatchRecord) => string;
  getBatchBlockedReasons: (batch: BatchRecord) => string[];
  getBatchWorkflowState: (batch: BatchRecord) => WorkflowState;
}) {
  const tiles = useMemo(
    () =>
      SMOKEHOUSES.map((house) => {
        const active = batches.find(
          (batch) =>
            batch.smokehouse === house &&
            (batch.stage === BATCH_STAGES.COOK ||
              batch.stage === BATCH_STAGES.SHOWER ||
              batch.stage === BATCH_STAGES.EVACUATE),
        );
        const readiness = equipmentReadiness.find((item) => item.id === `SH-${house}`);
        return {
          house,
          batch: active,
          isManual: house === 'E',
          ready: readiness?.ready ?? true,
          clean: readiness?.clean ?? true,
        };
      }),
    [batches, equipmentReadiness],
  );

  return (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Thermal Processing</Text>
      <Text style={styles.panelSubTitle}>Smokehouses (Cook)</Text>
      <View style={styles.tileGrid}>
        {tiles.map((tile) => (
          <View key={tile.house} style={styles.smokehouseTile}>
            <Text style={styles.smokehouseLabel}>SH {tile.house}</Text>
            <Text style={[styles.smokehouseStage, { color: tile.batch ? STAGE_COLORS[tile.batch.stage] : '#90A4AE' }]}>
              {tile.batch ? getStageDisplayLabel(tile.batch.stage) : 'Idle'}
            </Text>
            <Text style={styles.smokehouseMeta}>{tile.batch ? tile.batch.product : 'Ready'}</Text>
            <Text style={styles.smokehouseMeta}>{tile.batch ? tile.batch.eta : '--'}</Text>
            {tile.batch ? (
              <Text style={[styles.smokehouseMeta, { color: workflowColors[getBatchWorkflowState(tile.batch)] }]}>
                {getBatchHandoffLabel(tile.batch)}
              </Text>
            ) : null}
            {!tile.ready ? <Text style={styles.issueTag}>Not Ready</Text> : null}
            {!tile.clean ? <Text style={styles.issueTag}>Dirty</Text> : null}
            {tile.isManual ? <Text style={styles.manualTag}>Manual / 1-Rack</Text> : null}
          </View>
        ))}
      </View>

      <Text style={styles.panelSubTitle}>Chillers (Chill)</Text>
      <View style={styles.tableHeaderRow}>
        <Text style={styles.tableHeaderText}>Chiller</Text>
        <Text style={styles.tableHeaderText}>Capacity</Text>
        <Text style={styles.tableHeaderText}>Racks</Text>
        <Text style={styles.tableHeaderText}>Remaining</Text>
        <Text style={styles.tableHeaderText}>Status</Text>
      </View>
      {chillerRows.map((row) => (
        <View key={row.chillerNumber} style={styles.tableRow}>
          <Text style={styles.tableCell}>#{row.chillerNumber}</Text>
          <Text style={styles.tableCell}>{row.capacity}</Text>
          <Text style={styles.tableCell}>{row.currentAssignedRacks}</Text>
          <Text style={styles.tableCell}>{row.remainingCapacity}</Text>
          <Text
            style={[
              styles.tableCell,
              {
                color:
                  row.status === 'Available'
                    ? '#66BB6A'
                    : row.status === 'Near Full'
                      ? '#FFA726'
                      : row.status === 'Full'
                        ? '#EF5350'
                        : '#90A4AE',
              },
            ]}>
            {row.status}
          </Text>
          <Pressable style={styles.assignMiniButton} onPress={() => onAssign(row.chillerNumber)}>
            <Text style={styles.assignMiniButtonText}>Assign</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.panelSubTitle}>In-Process Batches</Text>
      <View style={styles.inProcessList}>
        {batches
          .filter((batch) => isThermalStage(batch.stage))
          .slice(0, 8)
          .map((batch) => (
            <Text key={batch.id} style={styles.inProcessText}>
              {batch.id} | SH {batch.smokehouse} | {getStageDisplayLabel(batch.stage)} | ETA {batch.eta} | Path:{' '}
              {batch.requiresShower && batch.requiresEvacuate
                ? 'Cook->Shower->Evacuate->Chill'
                : batch.requiresShower
                  ? 'Cook->Shower->Chill'
                  : batch.requiresEvacuate
                    ? 'Cook->Evacuate->Chill'
                    : 'Cook->Chill'}{' '}
              | CCP: {batch.ccpType} | Handoff: {getBatchHandoffLabel(batch)}
              {getBatchBlockedReasons(batch).length > 0 ? ` | Blocked: ${getBatchBlockedReasons(batch).join(' / ')}` : ''}
            </Text>
          ))}
      </View>
    </View>
  );
}

export function ChillerStatusPanel({
  rows,
  onAssign,
}: {
  rows: ChillerLoad[];
  onAssign: (chiller: ChillerNumber) => string | null;
}) {
  return (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Chiller Status</Text>
      <View style={styles.tableHeaderRow}>
        <Text style={styles.tableHeaderText}>Chiller</Text>
        <Text style={styles.tableHeaderText}>Capacity</Text>
        <Text style={styles.tableHeaderText}>Racks</Text>
        <Text style={styles.tableHeaderText}>Remaining</Text>
        <Text style={styles.tableHeaderText}>Status</Text>
      </View>
      {rows.map((row) => (
        <View key={row.chillerNumber} style={styles.tableRow}>
          <Text style={styles.tableCell}>#{row.chillerNumber}</Text>
          <Text style={styles.tableCell}>{row.capacity}</Text>
          <Text style={styles.tableCell}>{row.currentAssignedRacks}</Text>
          <Text style={styles.tableCell}>{row.remainingCapacity}</Text>
          <Text style={[styles.tableCell, { color: row.status === 'Available' ? '#66BB6A' : row.status === 'Near Full' ? '#FFA726' : row.status === 'Full' ? '#EF5350' : '#90A4AE' }]}>
            {row.status}
          </Text>
          <Pressable style={styles.assignMiniButton} onPress={() => onAssign(row.chillerNumber)}>
            <Text style={styles.assignMiniButtonText}>Assign</Text>
          </Pressable>
        </View>
      ))}
      {rows.length === 0 ? <Text style={styles.emptyText}>No chiller load data available.</Text> : null}
      <Text style={styles.ruleText}>Rule: Chiller 8 = 10 racks, others = 18</Text>
    </View>
  );
}

export function QuickStatsPanel({ stats }: { stats: QuickStat[] }) {
  return (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Quick Stats</Text>
      <View style={styles.quickStatsGrid}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.statCard}>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ActiveBatchesTable({
  batches,
  activeBatchId,
  onSelectBatch,
  getBatchHandoffLabel,
  getBatchBlockedReasons,
  getBatchWorkflowState,
}: {
  batches: BatchRecord[];
  activeBatchId?: string;
  onSelectBatch: (batchId: string) => void;
  getBatchHandoffLabel: (batch: BatchRecord) => string;
  getBatchBlockedReasons: (batch: BatchRecord) => string[];
  getBatchWorkflowState: (batch: BatchRecord) => WorkflowState;
}) {
  return (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Active Batches</Text>
      <View style={styles.tableHeaderRowWide}>
        <Text style={styles.tableHeaderTextWide}>Batch ID</Text>
        <Text style={styles.tableHeaderTextWide}>Product</Text>
        <Text style={styles.tableHeaderTextWide}>Smokehouse</Text>
        <Text style={styles.tableHeaderTextWide}>Racks</Text>
        <Text style={styles.tableHeaderTextWide}>Status</Text>
        <Text style={styles.tableHeaderTextWide}>Key Times</Text>
        <Text style={styles.tableHeaderTextWide}>Chiller</Text>
        <Text style={styles.tableHeaderTextWide}>Next Action</Text>
      </View>
      <ScrollView style={{ maxHeight: 260 }}>
        {batches.map((batch) => (
          <Pressable
            key={batch.id}
            style={[styles.batchRow, activeBatchId === batch.id && styles.batchRowActive]}
            onPress={() => onSelectBatch(batch.id)}>
            <Text style={styles.batchCell}>{batch.id}</Text>
            <Text style={styles.batchCell}>{batch.product}</Text>
            <Text style={styles.batchCell}>{batch.smokehouse}</Text>
            <Text style={styles.batchCell}>{batch.rackCount}</Text>
            <Text style={[styles.batchCell, { color: BATCH_STATUS_COLORS[batch.status] }]}>{batch.status}</Text>
            <Text style={styles.batchCell}>{batch.eta}</Text>
            <Text style={styles.batchCell}>{batch.assignedChiller ? `#${batch.assignedChiller}` : '--'}</Text>
            <View style={styles.batchCellStack}>
              <View style={[styles.batchStateBadge, { backgroundColor: workflowColors[getBatchWorkflowState(batch)] }]}>
                <Text style={styles.batchStateBadgeText}>{getBatchWorkflowState(batch).toUpperCase()}</Text>
              </View>
              <Text style={[styles.batchCell, { color: workflowColors[getBatchWorkflowState(batch)] }]}>
                {getBatchHandoffLabel(batch)}
              </Text>
              {getBatchBlockedReasons(batch).length > 0 ? (
                <Text style={[styles.batchCell, { color: '#EF9A9A' }]}>
                  {getBatchBlockedReasons(batch).join(' | ')}
                </Text>
              ) : (
                <Text style={styles.batchCell}>{nextActionFor(batch)}</Text>
              )}
            </View>
          </Pressable>
        ))}
        {batches.length === 0 ? <Text style={styles.emptyText}>No active batches currently on line.</Text> : null}
      </ScrollView>
    </View>
  );
}

function nextActionFor(batch: BatchRecord) {
  if (batch.status === BATCH_STATUSES.DELAYED || batch.status === BATCH_STATUSES.QA_HOLD) return 'Resolve Delay';
  if (batch.stage === BATCH_STAGES.COOK) {
    const chillRemainingBuffer =
      batch.estimatedChillMinutes + (batch.requiresShower ? 12 : 0) + (batch.requiresEvacuate ? 10 : 0);
    if (batch.minutesToReady > chillRemainingBuffer + 20) return `Monitor CCP (${batch.ccpType})`;
    if (batch.requiresShower) return `Start Shower (${batch.ccpType})`;
    if (batch.requiresEvacuate) return 'Move to Evacuate';
    return 'Move to Chill';
  }
  if (batch.stage === BATCH_STAGES.SHOWER) return batch.requiresEvacuate ? 'End Shower -> Evacuate' : 'End Shower -> Chill';
  if (batch.stage === BATCH_STAGES.EVACUATE) return 'Start Chill';
  if (batch.stage === BATCH_STAGES.CHILL) {
    const threshold = Math.max(20, Math.round(batch.estimatedChillMinutes * 0.5));
    return batch.minutesToReady > threshold ? 'Chill Check' : '80F Check';
  }
  if (batch.stage === BATCH_STAGES.THERMAL_COOLER) return 'Release to QA';
  if (batch.stage === BATCH_STAGES.QA) return 'QA Review';
  if (batch.stage === BATCH_STAGES.RTE) return 'Release / Ready';
  return 'Start Cook';
}

export function AlertsPanel({ alerts }: { alerts: AlertItem[] }) {
  return (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Alerts</Text>
      {alerts.length === 0 ? (
        <Text style={styles.emptyText}>No active alerts.</Text>
      ) : (
        alerts.map((alert) => (
          <View key={alert.id} style={styles.alertRow}>
            <View
              style={[
                styles.alertPill,
                {
                  backgroundColor:
                    alert.level === 'Critical' ? '#EF5350' : alert.level === 'Warning' ? '#FFA726' : '#4FC3F7',
                },
              ]}>
              <Text style={styles.alertPillText}>{alert.level}</Text>
            </View>
            <View style={styles.alertBody}>
              <Text style={styles.alertText}>{alert.text}</Text>
              {alert.handoff ? <Text style={styles.alertMeta}>Handoff: {alert.handoff}</Text> : null}
              {alert.blocked ? <Text style={[styles.alertMeta, { color: '#EF9A9A' }]}>Blocked: {alert.blocked}</Text> : null}
              <Text style={styles.alertTime}>{alert.time}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  title: {
    color: '#E6EDF3',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  subTitle: {
    color: '#8B949E',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 2,
  },
  topBarRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#13314A',
    borderWidth: 1,
    borderColor: '#4FC3F7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4FC3F7',
  },
  liveText: {
    color: '#E6EDF3',
    fontSize: 12,
    fontWeight: '800',
  },
  topMetaText: {
    color: '#AAB4BE',
    fontSize: 13,
    fontWeight: '700',
  },
  sidebar: {
    width: 190,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#12171E',
    borderRadius: 12,
    padding: 8,
    alignSelf: 'flex-start',
    opacity: 0.92,
  },
  sidebarCompact: {
    width: '100%',
  },
  sidebarTitle: {
    color: '#AAB4BE',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sidebarList: {
    gap: 8,
  },
  sidebarListCompact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  sidebarButton: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#161B22',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  sidebarButtonText: {
    color: '#D0D7DE',
    fontSize: 13,
    fontWeight: '700',
  },
  flowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  flowItemWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flowItem: {
    minHeight: 34,
    borderWidth: 1,
    backgroundColor: '#151A21',
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  flowLabel: {
    color: '#E6EDF3',
    fontSize: 12,
    fontWeight: '700',
  },
  flowCount: {
    color: '#AAB4BE',
    fontSize: 12,
    fontWeight: '800',
  },
  flowArrow: {
    color: '#8B949E',
    fontSize: 14,
    fontWeight: '800',
  },
  panelCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 12,
    padding: 12,
  },
  panelTitle: {
    color: '#E6EDF3',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  panelSubTitle: {
    color: '#AAB4BE',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 6,
  },
  panelHint: {
    color: '#9DA7B1',
    fontSize: 13,
    marginBottom: 8,
    fontWeight: '700',
  },
  activeBatchContext: {
    borderWidth: 1,
    borderColor: '#2B4258',
    backgroundColor: '#122230',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 8,
  },
  activeBatchContextText: {
    color: '#BBD7EE',
    fontSize: 12,
    fontWeight: '700',
  },
  noSelectionBox: {
    borderWidth: 1,
    borderColor: '#455A64',
    borderRadius: 8,
    backgroundColor: '#1A232C',
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 8,
  },
  noSelectionText: {
    color: '#AAB4BE',
    fontSize: 12,
    fontWeight: '700',
  },
  inputGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fieldWrap: {
    width: '48%',
  },
  fieldLabel: {
    color: '#9DA7B1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  fieldInput: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#0D1117',
    borderRadius: 8,
    color: '#E6EDF3',
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '700',
  },
  checklistGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  checkPill: {
    minHeight: 36,
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161B22',
  },
  checkPillChecked: {
    borderColor: '#66BB6A',
    backgroundColor: '#17311C',
  },
  checkPillText: {
    color: '#AAB4BE',
    fontSize: 12,
    fontWeight: '700',
  },
  checkPillTextChecked: {
    color: '#D7F5DE',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: '#1565C0',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  primaryButtonText: {
    color: '#F0F6FC',
    fontSize: 15,
    fontWeight: '800',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#1565C0',
    alignItems: 'center',
    justifyContent: 'center',
    flexBasis: '48%',
    paddingHorizontal: 8,
  },
  actionButtonDisabled: {
    backgroundColor: '#455A64',
  },
  actionButtonText: {
    color: '#F0F6FC',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smokehouseTile: {
    width: 112,
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 10,
    backgroundColor: '#161B22',
    padding: 8,
  },
  smokehouseLabel: {
    color: '#E6EDF3',
    fontSize: 13,
    fontWeight: '800',
  },
  smokehouseStage: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  smokehouseMeta: {
    color: '#9DA7B1',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  manualTag: {
    color: '#4FC3F7',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 3,
  },
  issueTag: {
    color: '#EF5350',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#30363D',
    paddingBottom: 5,
    alignItems: 'center',
  },
  tableHeaderText: {
    color: '#8B949E',
    fontSize: 11,
    fontWeight: '800',
    flex: 1,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#30363D',
    minHeight: 36,
    paddingVertical: 6,
  },
  tableCell: {
    color: '#E6EDF3',
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  assignMiniButton: {
    minHeight: 28,
    borderRadius: 6,
    backgroundColor: '#1565C0',
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignMiniButtonText: {
    color: '#F0F6FC',
    fontSize: 10,
    fontWeight: '800',
  },
  ruleText: {
    color: '#9DA7B1',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
  },
  inProcessList: {
    gap: 4,
    marginTop: 2,
  },
  inProcessText: {
    color: '#AAB4BE',
    fontSize: 11,
    fontWeight: '700',
  },
  quickStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    width: '48%',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 10,
    backgroundColor: '#161B22',
    minHeight: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    color: '#F0F6FC',
    fontSize: 23,
    fontWeight: '800',
  },
  statLabel: {
    color: '#9DA7B1',
    fontSize: 12,
    fontWeight: '700',
  },
  tableHeaderRowWide: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#30363D',
    paddingBottom: 5,
  },
  tableHeaderTextWide: {
    color: '#8B949E',
    fontSize: 11,
    fontWeight: '800',
    flex: 1,
  },
  batchRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#30363D',
    paddingVertical: 8,
    alignItems: 'center',
  },
  batchRowActive: {
    backgroundColor: '#1B2F42',
    borderLeftWidth: 3,
    borderLeftColor: '#4FC3F7',
  },
  batchCell: {
    color: '#E6EDF3',
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  batchCellStack: {
    flex: 1,
    gap: 2,
  },
  batchStateBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  batchStateBadgeText: {
    color: '#0D1117',
    fontSize: 9,
    fontWeight: '800',
  },
  alertRow: {
    flexDirection: 'row',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#30363D',
    paddingVertical: 8,
  },
  alertPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  alertPillText: {
    color: '#0D1117',
    fontSize: 10,
    fontWeight: '800',
  },
  alertBody: {
    flex: 1,
  },
  alertText: {
    color: '#E6EDF3',
    fontSize: 12,
    fontWeight: '700',
  },
  alertTime: {
    color: '#9DA7B1',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  alertMeta: {
    color: '#AAB4BE',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  emptyText: {
    color: '#9DA7B1',
    fontSize: 13,
    fontWeight: '600',
  },
});
