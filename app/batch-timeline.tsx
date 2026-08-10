import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader, C3SSectionTitle } from '@/components/c3s-ui';
import { BATCH_STATUS_COLORS, STAGE_COLORS, getStageDisplayLabel } from '@/constants/c3s';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { useC3S, type BatchTimelineAction } from '@/store/c3s-store';

function getParamString(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }
  return value ?? fallback;
}

const actionPriority: BatchTimelineAction[] = [
  'Start Shower',
  'Complete Shower',
  'Assign Chiller',
  'Start Chill',
  'Complete Chill',
  'Send to QA',
];

export default function BatchTimelineScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { eventsByBatch, runTimelineAction, getEnabledTimelineActions, getBatchThermalPath, getBatch, getBatchFlowSnapshot } = useC3S();

  const batchId = getParamString(params.batchId, '');
  const batch = useMemo(() => (batchId ? getBatch(batchId) : undefined), [getBatch, batchId]);
  const flow = batch ? getBatchFlowSnapshot(batch.id) : undefined;

  const events = batch ? eventsByBatch[batch.id] ?? [] : [];
  const enabledActions = batch ? getEnabledTimelineActions(batch.id) : [];
  const primaryAction = actionPriority.find((action) => enabledActions.includes(action)) ?? null;
  const canLogDelay = enabledActions.includes('Log Delay');
  const thermalPath = batch ? getBatchThermalPath(batch.id).join(' -> ') : '';

  if (!batch) {
    return (
      <C3SScreen>
        <C3SPage>
          <C3SScreenHeader title="Batch Timeline" />
          <Text style={styles.metaLabel}>No batch found.</Text>
        </C3SPage>
      </C3SScreen>
    );
  }

  const runPrimaryAction = () => {
    if (!primaryAction) return;
    runTimelineAction(batch.id, primaryAction);
    if (primaryAction === 'Send to QA') {
      router.push({ pathname: '/qa-review', params: { batchId: batch.id } });
    }
  };

  return (
    <C3SScreen>
      <C3SPage>
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.screenTitle}>Batch Timeline</Text>
        </View>

        <C3SCard>
          <View style={styles.headerTopRow}>
            <Text style={styles.batchId}>{batch.id}</Text>
            <View style={[styles.statusPill, { backgroundColor: BATCH_STATUS_COLORS[batch.status] }]}>
              <Text style={styles.statusText}>{batch.status}</Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Product</Text>
            <Text style={styles.metaValue}>{batch.product}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Smokehouse</Text>
            <Text style={styles.metaValue}>{batch.smokehouse}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Rack Count</Text>
            <Text style={styles.metaValue}>{batch.rackCount}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Stage</Text>
            <Text style={[styles.metaValue, { color: STAGE_COLORS[batch.stage] }]}>{getStageDisplayLabel(batch.stage)}</Text>
          </View>
          {flow ? (
            <>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Owner</Text>
                <Text style={styles.metaValue}>{flow.currentOwner}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Location</Text>
                <Text style={styles.metaValue}>{flow.currentLocation}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Waiting On</Text>
                <Text style={styles.metaValue}>{flow.waitingOn}</Text>
              </View>
            </>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>ETA</Text>
            <Text style={styles.etaValue}>{batch.eta}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Thermal Path</Text>
            <Text style={styles.metaValue}>{thermalPath}</Text>
          </View>
        </C3SCard>

        <C3SSectionTitle title="Next Action" />
        <View style={styles.actionsGrid}>
          {primaryAction ? (
            <Pressable style={[styles.actionButton, styles.blueAction, styles.fullWidth]} onPress={runPrimaryAction}>
              <Text style={styles.actionText}>{primaryAction}</Text>
            </Pressable>
          ) : (
            <Text style={styles.noActionText}>No stage action available for current state.</Text>
          )}
          {canLogDelay ? (
            <Pressable style={[styles.actionButton, styles.orangeAction, styles.fullWidth]} onPress={() => runTimelineAction(batch.id, 'Log Delay')}>
              <Text style={styles.actionText}>Log Delay</Text>
            </Pressable>
          ) : null}
        </View>

        <C3SSectionTitle title="Event Timeline" />
        <ScrollView style={styles.timeline} contentContainerStyle={styles.timelineContent}>
          {events.map((event) => (
            <View key={event.id} style={styles.eventCard}>
              <View style={styles.eventDot} />
              <View style={styles.eventContent}>
                <Text style={styles.eventTime}>{event.time}</Text>
                <Text style={styles.eventTitle}>{event.title}</Text>
                <Text style={styles.eventDetail}>{event.detail}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </C3SPage>
    </C3SScreen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  backButton: {
    backgroundColor: C3S_COLORS.panel,
    borderWidth: 1,
    borderColor: C3S_COLORS.accent,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: C3S_COLORS.accent,
    fontSize: 15,
    fontWeight: '800',
  },
  screenTitle: {
    color: C3S_COLORS.textStrong,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  batchId: {
    color: C3S_COLORS.textStrong,
    fontSize: 22,
    fontWeight: '800',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  metaLabel: {
    color: C3S_COLORS.textMuted,
    fontSize: 16,
    fontWeight: '600',
  },
  metaValue: {
    color: C3S_COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  etaValue: {
    color: C3S_COLORS.success,
    fontSize: 20,
    fontWeight: '800',
  },
  timeline: {
    flexGrow: 0,
    maxHeight: 280,
    marginBottom: 12,
  },
  timelineContent: {
    gap: 8,
    paddingBottom: 6,
  },
  eventCard: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: 12,
    padding: 12,
    minHeight: 76,
  },
  eventDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
    backgroundColor: C3S_COLORS.info,
  },
  eventContent: {
    flex: 1,
  },
  eventTime: {
    color: C3S_COLORS.textMuted,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 1,
  },
  eventTitle: {
    color: C3S_COLORS.textStrong,
    fontSize: 17,
    fontWeight: '800',
  },
  eventDetail: {
    color: C3S_COLORS.textMuted,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 1,
  },
  actionsGrid: {
    gap: 8,
    marginBottom: 12,
  },
  actionButton: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  actionText: {
    color: '#F0F6FC',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  noActionText: {
    color: C3S_COLORS.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  blueAction: {
    backgroundColor: C3S_COLORS.accent,
  },
  orangeAction: {
    backgroundColor: C3S_COLORS.warning,
  },
  fullWidth: {
    flexBasis: '100%',
  },
});
