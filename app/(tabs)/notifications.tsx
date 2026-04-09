import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { getStageDisplayLabel } from '@/constants/c3s';
import { useC3S } from '@/store/c3s-store';

type SeverityFilter = 'All' | 'Critical' | 'Warning' | 'Info';

const severityFilters: SeverityFilter[] = ['All', 'Critical', 'Warning', 'Info'];

const severityColors: Record<Exclude<SeverityFilter, 'All'>, string> = {
  Critical: '#EF5350',
  Warning: '#FFA726',
  Info: '#4FC3F7',
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { notifications, acknowledgeNotification, getBatch, getBatchFlowSnapshot, getBatchBlockedReasons } = useC3S();
  const [filter, setFilter] = useState<SeverityFilter>('All');

  const filtered = useMemo(() => {
    if (filter === 'All') {
      return notifications;
    }

    return notifications.filter((item) => item.severity === filter);
  }, [filter, notifications]);

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader title="Alerts" subtitle="Flow exceptions tied to batch ownership, location, and next action" />

        <View style={styles.filterRow}>
          {severityFilters.map((option) => {
            const active = option === filter;
            return (
              <Pressable
                key={option}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setFilter(option)}>
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {filtered.map((item) => (
            <C3SCard key={item.id} borderColor={item.acknowledged ? undefined : '#EF5350'}>
              <View style={styles.topRow}>
                <View style={[styles.severityPill, { backgroundColor: severityColors[item.severity] }]}>
                  <Text style={styles.severityText}>
                    {item.severity === 'Critical' ? 'Action Required' : item.severity === 'Warning' ? 'Needs Attention' : 'Info'}
                  </Text>
                </View>
                <Text style={styles.timeText}>{item.timestamp}</Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Type</Text>
                <Text style={styles.metaValue}>{item.type}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Batch ID</Text>
                <Text style={styles.metaValue}>{item.batchId ?? '--'}</Text>
              </View>
              {item.batchId ? (
                (() => {
                  const batch = getBatch(item.batchId);
                  if (!batch) return null;
                  const flow = getBatchFlowSnapshot(batch.id);
                  return (
                    <>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Product</Text>
                        <Text style={styles.metaValue}>{batch.product}</Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Stage</Text>
                        <Text style={styles.metaValue}>{getStageDisplayLabel(batch.stage)}</Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Owner</Text>
                        <Text style={styles.metaValue}>{flow?.currentOwner ?? '--'}</Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Location</Text>
                        <Text style={styles.metaValue}>{flow?.currentLocation ?? '--'}</Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Next Action</Text>
                        <Text style={styles.metaValue}>{flow?.nextValidAction ?? 'Review message'}</Text>
                      </View>
                      {getBatchBlockedReasons(batch).length > 0 ? (
                        <View style={styles.messageWrap}>
                          <Text style={styles.messageLabel}>Waiting On</Text>
                          <Text style={[styles.messageText, { color: '#EF9A9A' }]}>
                            {getBatchBlockedReasons(batch).join(' | ')}
                          </Text>
                        </View>
                      ) : null}
                    </>
                  );
                })()
              ) : null}
              <View style={styles.messageWrap}>
                <Text style={styles.messageLabel}>Message</Text>
                <Text style={styles.messageText}>{item.message}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Acknowledged</Text>
                <Text style={[styles.metaValue, { color: item.acknowledged ? '#66BB6A' : '#EF5350' }]}>
                  {item.acknowledged ? 'Yes' : 'No'}
                </Text>
              </View>

              <View style={styles.actionsRow}>
                <Pressable
                  style={[styles.actionButton, styles.ackButton, item.acknowledged && styles.disabledButton]}
                  disabled={item.acknowledged}
                  onPress={() => acknowledgeNotification(item.id)}>
                  <Text style={styles.actionButtonText}>{item.acknowledged ? 'Acknowledged' : 'Acknowledge'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionButton, styles.jumpButton, !item.batchId && styles.disabledButton]}
                  disabled={!item.batchId}
                  onPress={() =>
                    item.batchId &&
                    router.push({
                      pathname: '/batch-timeline',
                      params: { batchId: item.batchId },
                    })
                  }>
                  <Text style={styles.actionButtonText}>Jump to Batch</Text>
                </Pressable>
              </View>
            </C3SCard>
          ))}

          {filtered.length === 0 ? (
            <C3SCard>
              <Text style={styles.emptyText}>No Active Alerts</Text>
            </C3SCard>
          ) : null}
        </ScrollView>
      </C3SPage>
    </C3SScreen>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0D1117',
  },
  page: {
    flex: 1,
    backgroundColor: '#0D1117',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    color: '#E6EDF3',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  subTitle: {
    color: '#8B949E',
    fontSize: 18,
    marginTop: 2,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
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
  listContent: {
    gap: 10,
    paddingBottom: 20,
  },
  card: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 12,
    padding: 12,
  },
  cardUnacked: {
    borderColor: '#EF5350',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  severityPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 24,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  severityText: {
    color: '#0D1117',
    fontSize: 12,
    fontWeight: '800',
  },
  timeText: {
    color: '#9DA7B1',
    fontSize: 12,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 10,
  },
  metaLabel: {
    color: '#8B949E',
    fontSize: 14,
    fontWeight: '600',
  },
  metaValue: {
    color: '#E6EDF3',
    fontSize: 14,
    fontWeight: '700',
  },
  messageWrap: {
    marginTop: 6,
    marginBottom: 4,
  },
  messageLabel: {
    color: '#8B949E',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  messageText: {
    color: '#E6EDF3',
    fontSize: 14,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ackButton: {
    backgroundColor: '#2E7D32',
  },
  jumpButton: {
    backgroundColor: '#1565C0',
  },
  disabledButton: {
    backgroundColor: '#455A64',
  },
  actionButtonText: {
    color: '#F0F6FC',
    fontSize: 14,
    fontWeight: '800',
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 12,
    padding: 14,
  },
  emptyText: {
    color: '#9DA7B1',
    fontSize: 14,
    fontWeight: '700',
  },
});
