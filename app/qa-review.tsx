import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader, C3SSectionTitle } from '@/components/c3s-ui';
import {
  BATCH_STATUS_COLORS,
  QA_STATUSES,
  STAGE_COLORS,
  getStageDisplayLabel,
  type QAStatus,
} from '@/constants/c3s';
import { useC3S } from '@/store/c3s-store';

type QADecision =
  | (typeof QA_STATUSES.PASS)
  | (typeof QA_STATUSES.CONDITIONAL_PASS)
  | (typeof QA_STATUSES.HOLD)
  | (typeof QA_STATUSES.FAIL);

function getParamString(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }
  return value ?? fallback;
}

function normalizeQADecision(status: QAStatus): QADecision | 'Not set' {
  if (
    status === QA_STATUSES.PASS ||
    status === QA_STATUSES.CONDITIONAL_PASS ||
    status === QA_STATUSES.HOLD ||
    status === QA_STATUSES.FAIL
  ) {
    return status;
  }
  return 'Not set';
}

export default function QAReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { getBatch, submitQADecision, releaseToPackaging, getBatchFlowSnapshot, canViewBatchInArea } = useC3S();

  const batchId = getParamString(params.batchId, '');
  const batch = batchId ? getBatch(batchId) : undefined;
  const flow = batch ? getBatchFlowSnapshot(batch.id) : undefined;
  const visibleToQA = batch ? canViewBatchInArea('qa', batch.id) : false;

  const currentDecision = useMemo(() => (batch ? normalizeQADecision(batch.qaStatus) : 'Not set'), [batch]);
  const canSubmitDecision = batch?.stage === 'QA' && visibleToQA;
  const canRelease = batch?.qaStatus === QA_STATUSES.PASS && batch?.stage === 'QA' && visibleToQA;

  if (!batch || !visibleToQA) {
    return (
      <C3SScreen>
        <C3SPage>
          <C3SScreenHeader title="QA Review" />
          <Text style={styles.metaLabel}>No batch currently owned by QA for review.</Text>
        </C3SPage>
      </C3SScreen>
    );
  }

  const confirmDecision = (nextDecision: QADecision) => {
    if (!canSubmitDecision) return;

    Alert.alert('Confirm QA Decision', `Apply ${nextDecision} to ${batch.id}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: 'default',
        onPress: () => {
          submitQADecision(batch.id, nextDecision);
          Alert.alert('QA Action Saved', `${nextDecision} recorded for ${batch.id}`);
        },
      },
    ]);
  };

  const release = () => {
    if (!canRelease) {
      Alert.alert('Validation', 'Release is only allowed after QA Pass on a QA-stage batch.');
      return;
    }

    const released = releaseToPackaging(batch.id);
    if (released) {
      Alert.alert('Released', `${batch.id} released to packaging.`);
      return;
    }

    Alert.alert('Validation', 'Release could not be completed. Verify RTE cooler readiness.');
  };

  return (
    <C3SScreen>
      <C3SPage>
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.screenTitle}>QA Review</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <C3SCard>
            <View style={styles.headerTopRow}>
              <Text style={styles.batchId}>{batch.id}</Text>
              <View style={[styles.statusPill, { backgroundColor: BATCH_STATUS_COLORS[batch.status] }]}>
                <Text style={styles.statusPillText}>{batch.status}</Text>
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
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Next Action</Text>
                  <Text style={styles.metaValue}>{flow.nextValidAction}</Text>
                </View>
              </>
            ) : null}
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Current Status</Text>
              <Text style={styles.metaValue}>{batch.status}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>ETA</Text>
              <Text style={styles.etaValue}>{batch.eta}</Text>
            </View>
          </C3SCard>

          <C3SCard>
            <C3SSectionTitle title="Operator Actions" />
            <Text style={styles.helperText}>Quick-action mode: select one QA decision and confirm.</Text>
            <Text style={styles.currentDecision}>Current Decision: {currentDecision}</Text>
            {!canSubmitDecision ? (
              <Text style={styles.blockedText}>QA decisions are only available when batch stage is QA.</Text>
            ) : null}

            <View style={styles.actionsGrid}>
              <Pressable
                style={[styles.actionButton, styles.passButton, !canSubmitDecision && styles.disabledButton]}
                disabled={!canSubmitDecision}
                onPress={() => confirmDecision(QA_STATUSES.PASS)}>
                <Text style={styles.actionText}>Pass</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.conditionalButton, !canSubmitDecision && styles.disabledButton]}
                disabled={!canSubmitDecision}
                onPress={() => confirmDecision(QA_STATUSES.CONDITIONAL_PASS)}>
                <Text style={styles.actionText}>Conditional Pass</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.holdButton, !canSubmitDecision && styles.disabledButton]}
                disabled={!canSubmitDecision}
                onPress={() => confirmDecision(QA_STATUSES.HOLD)}>
                <Text style={styles.actionText}>Hold</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.failButton, !canSubmitDecision && styles.disabledButton]}
                disabled={!canSubmitDecision}
                onPress={() => confirmDecision(QA_STATUSES.FAIL)}>
                <Text style={styles.actionText}>Fail</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.releaseButton, !canRelease && styles.releaseButtonDisabled, styles.fullWidth]}
                onPress={release}>
                <Text style={styles.actionText}>Release to Packaging</Text>
              </Pressable>
            </View>
          </C3SCard>
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
    backgroundColor: '#30363D',
    borderRadius: 10,
    minHeight: 46,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: '#F0F6FC',
    fontSize: 15,
    fontWeight: '800',
  },
  screenTitle: {
    color: '#E6EDF3',
    fontSize: 32,
    fontWeight: '800',
  },
  content: {
    paddingBottom: 20,
    gap: 12,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  batchId: {
    color: '#F0F6FC',
    fontSize: 22,
    fontWeight: '800',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusPillText: {
    color: '#0D1117',
    fontSize: 13,
    fontWeight: '800',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  metaLabel: {
    color: '#9DA7B1',
    fontSize: 16,
    fontWeight: '600',
  },
  metaValue: {
    color: '#E6EDF3',
    fontSize: 17,
    fontWeight: '700',
  },
  etaValue: {
    color: '#A5D6A7',
    fontSize: 20,
    fontWeight: '800',
  },
  helperText: {
    color: '#9DA7B1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  currentDecision: {
    color: '#E6EDF3',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 8,
  },
  blockedText: {
    color: '#EF9A9A',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    minHeight: 50,
    borderRadius: 12,
    flexBasis: '49%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  actionText: {
    color: '#F0F6FC',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  passButton: {
    backgroundColor: '#2E7D32',
  },
  conditionalButton: {
    backgroundColor: '#1976D2',
  },
  holdButton: {
    backgroundColor: '#EF6C00',
  },
  failButton: {
    backgroundColor: '#C62828',
  },
  releaseButton: {
    backgroundColor: '#00897B',
  },
  releaseButtonDisabled: {
    backgroundColor: '#455A64',
  },
  disabledButton: {
    opacity: 0.45,
  },
  fullWidth: {
    flexBasis: '100%',
  },
});
