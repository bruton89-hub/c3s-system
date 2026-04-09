import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C3SBlockedChips, C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { PREP_STATUSES, PREP_STATUS_COLORS, PRIORITY_COLORS, getPrepStageDisplayLabel } from '@/constants/c3s';
import { useC3S, type WorkflowState } from '@/store/c3s-store';

type SummaryCard = {
  label: string;
  value: number;
  color: string;
};

const workflowColors: Record<WorkflowState, string> = {
  ready: '#66BB6A',
  waiting: '#4FC3F7',
  blocked: '#EF5350',
  assigned: '#AB47BC',
  running: '#FFA726',
};

export default function PrepQueueScreen() {
  const router = useRouter();
  const {
    prepTickets,
    createPrep,
    markPrepRTCReady,
    setPrepQAPreOp,
    markPrepReady,
    createBatchFromPrep,
    getPrepHandoffLabel,
    getPrepBlockedReasons,
    getPrepWorkflowState,
  } = useC3S();

  const summaryCards = useMemo<SummaryCard[]>(
    () => [
      {
        label: 'In Prep',
        value: prepTickets.filter((ticket) => ticket.status === PREP_STATUSES.IN_PREP).length,
        color: PREP_STATUS_COLORS[PREP_STATUSES.IN_PREP],
      },
      {
        label: 'Waiting QA',
        value: prepTickets.filter((ticket) => ticket.status === PREP_STATUSES.WAITING_QA_PRE_OP).length,
        color: PREP_STATUS_COLORS[PREP_STATUSES.WAITING_QA_PRE_OP],
      },
      {
        label: 'Ready for Thermal',
        value: prepTickets.filter((ticket) => ticket.status === PREP_STATUSES.RTC_READY).length,
        color: PREP_STATUS_COLORS[PREP_STATUSES.RTC_READY],
      },
      {
        label: 'Awaiting Assignment',
        value: prepTickets.filter((ticket) => ticket.status === PREP_STATUSES.READY_TO_LOAD).length,
        color: PREP_STATUS_COLORS[PREP_STATUSES.READY_TO_LOAD],
      },
      {
        label: 'Assigned / Ready',
        value: prepTickets.filter((ticket) => ticket.status === PREP_STATUSES.ASSIGNED_TO_SMOKEHOUSE).length,
        color: PREP_STATUS_COLORS[PREP_STATUSES.ASSIGNED_TO_SMOKEHOUSE],
      },
    ],
    [prepTickets],
  );

  const runNextPrepAction = (prepId: string) => {
    const ticket = prepTickets.find((item) => item.id === prepId);
    if (!ticket) return;

    if (ticket.linkedBatchId) {
      router.push({ pathname: '/batch-timeline', params: { batchId: ticket.linkedBatchId } });
      return;
    }

    if (ticket.qaPreOpStatus !== 'Passed') {
      setPrepQAPreOp(prepId, 'Passed');
      return;
    }

    if (!ticket.stagingAreaReady || !ticket.rtcEquipmentReady) {
      markPrepRTCReady(prepId);
      return;
    }

    if (!ticket.awaitingThermalAssignment && !ticket.readyToLoad) {
      markPrepReady(prepId);
      return;
    }
    if (ticket.awaitingThermalAssignment) {
      Alert.alert('Thermal Assignment Pending', `${ticket.id} is waiting in Thermal Assignment Queue.`);
      return;
    }

    const batchId = createBatchFromPrep(prepId);
    if (!batchId) {
      Alert.alert('Load Blocked', 'RTC ticket must be fully ready to load before creating batch.');
      return;
    }

    router.push({ pathname: '/batch-timeline', params: { batchId } });
  };

  const getNextPrepActionLabel = (prepId: string) => {
    const ticket = prepTickets.find((item) => item.id === prepId);
    if (!ticket) return 'Unavailable';
    if (ticket.linkedBatchId) return 'Open Linked Batch';
    if (ticket.qaPreOpStatus !== 'Passed') return 'Mark QA Pre-Op Passed';
    if (!ticket.stagingAreaReady || !ticket.rtcEquipmentReady) return 'Confirm RTC Ready';
    if (!ticket.awaitingThermalAssignment && !ticket.readyToLoad) return 'Mark Ready for Thermal';
    if (ticket.awaitingThermalAssignment) return 'Waiting on Thermal Assignment';
    return 'Load & Create Batch';
  };

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader title="RTC Queue" subtitle="Batch-first RTC prep and thermal handoff" />

        <View style={styles.summaryRow}>
          {summaryCards.map((item) => (
            <View key={item.label} style={styles.summaryCard}>
              <View style={[styles.summaryAccent, { backgroundColor: item.color }]} />
              <Text style={styles.summaryValue}>{item.value}</Text>
              <Text style={styles.summaryLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <Pressable
          style={[styles.actionButton, styles.newPrepButton]}
          onPress={() => {
            const prep = createPrep();
            Alert.alert('RTC Ticket Created', `${prep.id} added to RTC Queue.`);
          }}>
          <Text style={styles.actionButtonText}>New RTC Ticket</Text>
        </Pressable>

        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {prepTickets.map((ticket) => {
            const blockedReasons = getPrepBlockedReasons(ticket);
            const handoffLabel = getPrepHandoffLabel(ticket);
            const workflowState = getPrepWorkflowState(ticket);
            const nextActionLabel = getNextPrepActionLabel(ticket.id);

            return (
              <C3SCard key={ticket.id} borderColor={workflowColors[workflowState]}>
                <View style={styles.cardTopRow}>
                  <View>
                    <Text style={styles.productText}>{ticket.product}</Text>
                    <Text style={styles.ticketId}>{ticket.id}</Text>
                  </View>
                  <View style={styles.cardTopBadges}>
                    <View style={[styles.badge, { backgroundColor: workflowColors[workflowState] }]}>
                      <Text style={styles.badgeText}>{workflowState.toUpperCase()}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: PRIORITY_COLORS[ticket.priority] }]}>
                      <Text style={styles.badgeText}>{ticket.priority}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Stage</Text>
                  <Text style={styles.value}>{getPrepStageDisplayLabel(ticket.status)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Owner</Text>
                  <Text style={styles.value}>RTC</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Location</Text>
                  <Text style={styles.value}>
                    {ticket.assignedSmokehouse !== '--' ? `Smokehouse ${ticket.assignedSmokehouse}` : 'Staging Area'}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Waiting On</Text>
                  <Text style={[styles.value, { color: workflowColors[workflowState] }]}>{handoffLabel}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Status</Text>
                  <View style={[styles.badge, { backgroundColor: PREP_STATUS_COLORS[ticket.status] }]}>
                    <Text style={styles.badgeText}>{ticket.status}</Text>
                  </View>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Requested Start</Text>
                  <Text style={styles.value}>{ticket.requestedStart}</Text>
                </View>

                <View style={styles.readinessRow}>
                  <Text style={styles.readinessText}>QA Pre-Op: {ticket.qaPreOpStatus}</Text>
                  <Text style={styles.readinessText}>Staging: {ticket.stagingAreaReady ? 'Ready' : 'Not Ready'}</Text>
                  <Text style={styles.readinessText}>Equipment: {ticket.rtcEquipmentReady ? 'Ready' : 'Not Ready'}</Text>
                  <Text style={styles.readinessText}>Ready to Load: {ticket.readyToLoad ? 'Yes' : 'No'}</Text>
                </View>

                <C3SBlockedChips reasons={blockedReasons} />

                <View style={styles.actionRow}>
                  <Text style={styles.nextActionLabel}>Next Action</Text>
                  <Pressable
                    style={[
                      styles.actionButton,
                      styles.createBatchButton,
                      ticket.awaitingThermalAssignment && styles.pendingActionButton,
                    ]}
                    disabled={ticket.awaitingThermalAssignment}
                    onPress={() => runNextPrepAction(ticket.id)}>
                    <Text style={styles.actionButtonText}>{nextActionLabel}</Text>
                  </Pressable>
                </View>
              </C3SCard>
            );
          })}
        </ScrollView>
      </C3SPage>
    </C3SScreen>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    paddingVertical: 8,
    paddingHorizontal: 8,
    minHeight: 80,
  },
  summaryAccent: {
    height: 3,
    width: 36,
    borderRadius: 8,
    marginBottom: 6,
  },
  summaryValue: {
    color: '#F0F6FC',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 28,
  },
  summaryLabel: {
    color: '#9DA7B1',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  listContent: {
    gap: 10,
    paddingBottom: 18,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardTopBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  ticketId: {
    color: '#9DA7B1',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  productText: {
    color: '#F0F6FC',
    fontSize: 20,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  label: {
    color: '#9DA7B1',
    fontSize: 14,
    fontWeight: '600',
    minWidth: 116,
  },
  value: {
    color: '#E6EDF3',
    fontSize: 15,
    fontWeight: '700',
    marginRight: 6,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 26,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#0D1117',
    fontSize: 12,
    fontWeight: '800',
  },
  readinessRow: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2A313A',
    borderRadius: 10,
    padding: 8,
    gap: 2,
    backgroundColor: '#131820',
  },
  readinessText: {
    color: '#C9D1D9',
    fontSize: 13,
    fontWeight: '700',
  },
  actionRow: {
    marginTop: 10,
    gap: 6,
  },
  nextActionLabel: {
    color: '#9DA7B1',
    fontSize: 12,
    fontWeight: '700',
  },
  actionButton: {
    minHeight: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  actionButtonText: {
    color: '#F0F6FC',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  newPrepButton: {
    backgroundColor: '#1F6FEB',
    marginBottom: 12,
    minHeight: 40,
    width: 170,
    alignSelf: 'flex-start',
  },
  createBatchButton: {
    backgroundColor: '#1565C0',
  },
  pendingActionButton: {
    backgroundColor: '#455A64',
  },
});
