import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BATCH_STAGES, BATCH_STATUSES, PREP_STATUSES, QA_STATUSES } from '@/constants/c3s';
import { type DemoScenario, useC3S } from '@/store/c3s-store';

const scenarios: DemoScenario[] = ['Normal Shift', 'Capacity Risk', 'QA Hold'];

type StageRoute = '/prep-queue' | '/chiller-load' | '/qa-review' | '/packaging' | '/notifications';

type StageCard = {
  id: string;
  title: string;
  activeLabel: string;
  activeCount: number;
  waitingLabel: string;
  waitingCount: number;
  riskCount: number;
  statusLine: string;
  nextLine: string;
  route: StageRoute;
};

type AttentionItem = {
  id: string;
  severity: 'Action Required' | 'Needs Attention';
  text: string;
  route: StageRoute;
};

function nextBatchLabel(batch?: { id: string; product: string; eta: string }) {
  if (!batch) return 'No item currently queued';
  return `${batch.id} (${batch.product}) ETA ${batch.eta}`;
}

export default function PlantOperationsQuickViewScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const columns = width < 900 ? 1 : width < 1400 ? 2 : 3;

  const {
    prepTickets,
    batches,
    notifications,
    demoScenario,
    setDemoScenario,
    getPrepWorkflowState,
    getChillerLoad,
  } = useC3S();

  const rtcPrep = useMemo(
    () => prepTickets.filter((prep) => prep.status !== PREP_STATUSES.LOADED),
    [prepTickets],
  );
  const thermalCook = useMemo(
    () => batches.filter((batch) => batch.stage === BATCH_STAGES.COOK),
    [batches],
  );
  const postCookChill = useMemo(
    () =>
      batches.filter(
        (batch) =>
          batch.stage === BATCH_STAGES.SHOWER ||
          batch.stage === BATCH_STAGES.EVACUATE ||
          batch.stage === BATCH_STAGES.CHILL,
      ),
    [batches],
  );
  const qaRelease = useMemo(
    () =>
      batches.filter(
        (batch) => batch.stage === BATCH_STAGES.THERMAL_COOLER || batch.stage === BATCH_STAGES.QA,
      ),
    [batches],
  );
  const packaging = useMemo(
    () => batches.filter((batch) => batch.stage === BATCH_STAGES.PACKAGING),
    [batches],
  );

  const prepStaged = useMemo(
    () => rtcPrep.filter((prep) => prep.status === PREP_STATUSES.READY_TO_LOAD),
    [rtcPrep],
  );
  const prepWaitingAssign = useMemo(
    () => rtcPrep.filter((prep) => prep.awaitingThermalAssignment),
    [rtcPrep],
  );
  const prepRisk = useMemo(
    () => rtcPrep.filter((prep) => getPrepWorkflowState(prep) === 'blocked'),
    [rtcPrep, getPrepWorkflowState],
  );

  const thermalWaitingStart = useMemo(
    () => thermalCook.filter((batch) => batch.minutesToReady >= batch.estimatedCookMinutes),
    [thermalCook],
  );
  const thermalRisk = useMemo(
    () => thermalCook.filter((batch) => batch.status === BATCH_STATUSES.DELAYED),
    [thermalCook],
  );

  const chillWaitingAssign = useMemo(
    () => postCookChill.filter((batch) => batch.stage === BATCH_STAGES.CHILL && !batch.assignedChiller),
    [postCookChill],
  );
  const chillRisk = useMemo(
    () =>
      postCookChill.filter(
        (batch) => batch.status === BATCH_STATUSES.DELAYED || (batch.stage === BATCH_STAGES.CHILL && !batch.assignedChiller),
      ),
    [postCookChill],
  );

  const qaWaiting = useMemo(
    () => qaRelease.filter((batch) => batch.qaStatus === QA_STATUSES.PENDING),
    [qaRelease],
  );
  const qaRisk = useMemo(
    () =>
      qaRelease.filter(
        (batch) =>
          batch.status === BATCH_STATUSES.QA_HOLD ||
          batch.qaStatus === QA_STATUSES.HOLD ||
          batch.qaStatus === QA_STATUSES.FAIL,
      ),
    [qaRelease],
  );

  const packagingWaitingLine = useMemo(
    () => packaging.filter((batch) => batch.packagingStatus === 'Waiting' || !batch.packagingLineId),
    [packaging],
  );
  const packagingRisk = useMemo(
    () => packaging.filter((batch) => batch.status === BATCH_STATUSES.DELAYED),
    [packaging],
  );

  const chillerIssues = useMemo(
    () =>
      getChillerLoad().filter(
        (row) => row.status === 'Near Full' || row.status === 'Full' || row.status === 'Out of Service',
      ),
    [getChillerLoad],
  );

  const unackedAlerts = useMemo(
    () => notifications.filter((note) => !note.acknowledged),
    [notifications],
  );
  const criticalAlerts = useMemo(
    () => unackedAlerts.filter((note) => note.severity === 'Critical'),
    [unackedAlerts],
  );

  const summaryItems = useMemo(
    () => [
      { label: 'RTC', value: rtcPrep.length },
      { label: 'Thermal', value: thermalCook.length },
      { label: 'Post-Cook / Chill', value: postCookChill.length },
      { label: 'QA Review / Signoff', value: qaRelease.length },
      { label: 'Packaging', value: packaging.length },
      { label: 'Needs Attention', value: criticalAlerts.length + prepRisk.length + chillRisk.length + qaRisk.length },
    ],
    [rtcPrep, thermalCook, postCookChill, qaRelease, packaging, criticalAlerts, prepRisk, chillRisk, qaRisk],
  );

  const flowSteps = useMemo(
    () => [
      { label: '1. RTC', count: rtcPrep.length },
      { label: '2. Thermal', count: thermalCook.length },
      { label: '3. Post-Cook / Chill', count: postCookChill.length },
      { label: '4. QA Review / Signoff', count: qaRelease.length },
      { label: '5. Packaging', count: packaging.length },
    ],
    [rtcPrep, thermalCook, postCookChill, qaRelease, packaging],
  );

  const stageCards = useMemo<StageCard[]>(
    () => [
      {
        id: 'rtc-prep',
        title: 'RTC',
        activeLabel: 'Open Tickets',
        activeCount: rtcPrep.length,
        waitingLabel: 'Staged / Ready',
        waitingCount: prepStaged.length,
        riskCount: prepRisk.length,
        statusLine:
          prepWaitingAssign.length > 0
            ? `${prepWaitingAssign.length} ticket(s) waiting smokehouse assignment`
            : 'Prep staging feeding thermal as expected',
        nextLine: rtcPrep[0] ? `${rtcPrep[0].id} next at ${rtcPrep[0].requestedStart}` : 'No RTC ticket awaiting handoff',
        route: '/prep-queue',
      },
      {
        id: 'thermal',
        title: 'Thermal',
        activeLabel: 'In Cook',
        activeCount: thermalCook.length,
        waitingLabel: 'Await Start / Verify',
        waitingCount: thermalWaitingStart.length,
        riskCount: thermalRisk.length,
        statusLine:
          thermalRisk.length > 0
            ? `${thermalRisk.length} cook batch(es) need attention vs recipe path`
            : 'Rack-tag verification and cook monitoring on track',
        nextLine: nextBatchLabel(thermalCook[0]),
        route: '/chiller-load',
      },
      {
        id: 'post-cook-chill',
        title: 'Post-Cook / Chill',
        activeLabel: 'In Transition/Chill',
        activeCount: postCookChill.length,
        waitingLabel: 'Waiting Chiller',
        waitingCount: chillWaitingAssign.length,
        riskCount: chillRisk.length + chillerIssues.length,
        statusLine:
          chillRisk.length > 0
            ? `${chillRisk.length} batch(es) need post-cook handoff attention`
            : 'Post-cook to chill handoffs flowing normally',
        nextLine: nextBatchLabel(postCookChill[0]),
        route: '/chiller-load',
      },
      {
        id: 'qa-release',
        title: 'QA Review / Signoff',
        activeLabel: 'Awaiting QA',
        activeCount: qaRelease.length,
        waitingLabel: 'Pending Review',
        waitingCount: qaWaiting.length,
        riskCount: qaRisk.length,
        statusLine:
          qaRisk.length > 0
            ? `${qaRisk.length} batch(es) blocked on QA disposition`
            : 'QA queue clear for release decisioning',
        nextLine: nextBatchLabel(qaRelease[0]),
        route: '/qa-review',
      },
      {
        id: 'packaging',
        title: 'Packaging',
        activeLabel: 'Released to Pack',
        activeCount: packaging.length,
        waitingLabel: 'Waiting Line',
        waitingCount: packagingWaitingLine.length,
        riskCount: packagingRisk.length,
        statusLine:
          packagingWaitingLine.length > 0
            ? `${packagingWaitingLine.length} batch(es) waiting line assignment`
            : 'Packaging line assignment flow stable',
        nextLine: nextBatchLabel(packaging[0]),
        route: '/packaging',
      },
    ],
    [
      rtcPrep,
      prepStaged,
      prepRisk,
      prepWaitingAssign,
      thermalCook,
      thermalWaitingStart,
      thermalRisk,
      postCookChill,
      chillWaitingAssign,
      chillRisk,
      chillerIssues,
      qaRelease,
      qaWaiting,
      qaRisk,
      packaging,
      packagingWaitingLine,
      packagingRisk,
    ],
  );

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    if (criticalAlerts.length > 0) {
      items.push({
        id: 'critical-alerts',
        severity: 'Action Required',
        text: `${criticalAlerts.length} critical alert(s) require immediate review`,
        route: '/notifications',
      });
    }
    if (prepRisk.length > 0) {
      items.push({
        id: 'prep-risk',
        severity: 'Needs Attention',
        text: `${prepRisk.length} prep ticket(s) blocked before thermal handoff`,
        route: '/prep-queue',
      });
    }
    if (thermalRisk.length > 0) {
      items.push({
        id: 'thermal-risk',
        severity: 'Needs Attention',
        text: `${thermalRisk.length} cook batch(es) delayed against CCP timeline`,
        route: '/chiller-load',
      });
    }
    if (chillWaitingAssign.length > 0) {
      items.push({
        id: 'chill-assign',
        severity: 'Needs Attention',
        text: `${chillWaitingAssign.length} chill batch(es) waiting chiller assignment`,
        route: '/chiller-load',
      });
    }
    if (qaRisk.length > 0) {
      items.push({
        id: 'qa-risk',
        severity: 'Needs Attention',
        text: `${qaRisk.length} batch(es) blocked in QA review/signoff`,
        route: '/qa-review',
      });
    }
    if (packagingWaitingLine.length > 0) {
      items.push({
        id: 'packaging-wait',
        severity: 'Needs Attention',
        text: `${packagingWaitingLine.length} released batch(es) waiting packaging line`,
        route: '/packaging',
      });
    }

    return items.slice(0, 8);
  }, [criticalAlerts, prepRisk, thermalRisk, chillWaitingAssign, qaRisk, packagingWaitingLine]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Plant Product Flow Quick View</Text>
            <Text style={styles.subTitle}>Live view of RTC → Thermal → Chill → QA Review / Signoff → Packaging</Text>
          </View>
        </View>

        <View style={styles.scenarioRow}>
          <Text style={styles.scenarioLabel}>Demo Scenario</Text>
          <View style={styles.scenarioChips}>
            {scenarios.map((scenario) => {
              const active = demoScenario === scenario;
              return (
                <Pressable
                  key={scenario}
                  style={[styles.scenarioChip, active && styles.scenarioChipActive]}
                  onPress={() => setDemoScenario(scenario)}>
                  <Text style={[styles.scenarioChipText, active && styles.scenarioChipTextActive]}>{scenario}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.summaryRow}>
          {summaryItems.map((item) => (
            <View key={item.label} style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{item.value}</Text>
              <Text style={styles.summaryLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.flowRail}>
          {flowSteps.map((step, index) => (
            <View key={step.label} style={styles.flowStepWrap}>
              <View style={styles.flowStep}>
                <Text style={styles.flowLabel}>{step.label}</Text>
                <Text style={styles.flowCount}>{step.count}</Text>
              </View>
              {index < flowSteps.length - 1 ? <Text style={styles.flowArrow}>→</Text> : null}
            </View>
          ))}
        </View>

        <ScrollView style={styles.mainScroll} contentContainerStyle={styles.mainContent}>
          <Text style={styles.sectionTitle}>Flow Stage Overview</Text>
          <View style={styles.cardGrid}>
            {stageCards.map((card) => (
              <Pressable
                key={card.id}
                style={[
                  styles.stageCard,
                  columns === 1 ? styles.stageCardOne : columns === 2 ? styles.stageCardTwo : styles.stageCardThree,
                ]}
                onPress={() => router.push(card.route)}>
                <View style={styles.stageHead}>
                  <Text style={styles.stageTitle}>{card.title}</Text>
                  <Text style={styles.openText}>Open</Text>
                </View>

                <View style={styles.metricRow}>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricValue}>{card.activeCount}</Text>
                    <Text style={styles.metricLabel}>{card.activeLabel}</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricValue}>{card.waitingCount}</Text>
                    <Text style={styles.metricLabel}>{card.waitingLabel}</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={[styles.metricValue, card.riskCount > 0 && styles.metricRisk]}>{card.riskCount}</Text>
                    <Text style={styles.metricLabel}>Needs Attention</Text>
                  </View>
                </View>

                <Text style={styles.statusLine}>{card.statusLine}</Text>
                <Text style={styles.nextLine}>Next: {card.nextLine}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Needs Attention Now</Text>
          <View style={styles.attentionCard}>
            {attentionItems.length === 0 ? (
              <Text style={styles.attentionEmpty}>No high-priority issues right now.</Text>
            ) : (
              attentionItems.map((item) => (
                <Pressable key={item.id} style={styles.attentionRow} onPress={() => router.push(item.route)}>
                  <View
                    style={[
                      styles.attentionBadge,
                      item.severity === 'Action Required' ? styles.attentionBadgeCritical : styles.attentionBadgeWarning,
                    ]}>
                    <Text style={styles.attentionBadgeText}>{item.severity}</Text>
                  </View>
                  <Text style={styles.attentionText}>{item.text}</Text>
                </Pressable>
              ))
            )}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
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
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  headerRow: {
    marginBottom: 10,
  },
  title: {
    color: '#E6EDF3',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  subTitle: {
    color: '#8B949E',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 3,
  },
  scenarioRow: {
    marginBottom: 10,
  },
  scenarioLabel: {
    color: '#9DA7B1',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  scenarioChips: {
    flexDirection: 'row',
    gap: 8,
  },
  scenarioChip: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scenarioChipActive: {
    borderColor: '#4FC3F7',
    backgroundColor: '#13314A',
  },
  scenarioChipText: {
    color: '#AAB4BE',
    fontSize: 13,
    fontWeight: '800',
  },
  scenarioChipTextActive: {
    color: '#E6EDF3',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  summaryCard: {
    minWidth: 132,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  summaryValue: {
    color: '#F0F6FC',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 24,
  },
  summaryLabel: {
    color: '#9DA7B1',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  flowRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  flowStepWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flowStep: {
    borderWidth: 1,
    borderColor: '#2F3D4A',
    backgroundColor: '#131A22',
    borderRadius: 10,
    minHeight: 34,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  flowLabel: {
    color: '#C9D1D9',
    fontSize: 12,
    fontWeight: '700',
  },
  flowCount: {
    color: '#4FC3F7',
    fontSize: 12,
    fontWeight: '800',
  },
  flowArrow: {
    color: '#8B949E',
    fontSize: 14,
    fontWeight: '800',
  },
  mainScroll: {
    flex: 1,
  },
  mainContent: {
    gap: 10,
    paddingBottom: 18,
  },
  sectionTitle: {
    color: '#E6EDF3',
    fontSize: 20,
    fontWeight: '800',
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  stageCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 12,
    padding: 12,
    minHeight: 190,
  },
  stageCardOne: {
    width: '100%',
  },
  stageCardTwo: {
    width: '49%',
  },
  stageCardThree: {
    width: '32.6%',
  },
  stageHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stageTitle: {
    color: '#E6EDF3',
    fontSize: 18,
    fontWeight: '800',
  },
  openText: {
    color: '#4FC3F7',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  metricBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2B323A',
    backgroundColor: '#10161D',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  metricValue: {
    color: '#F0F6FC',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 20,
  },
  metricRisk: {
    color: '#EF9A9A',
  },
  metricLabel: {
    color: '#9DA7B1',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  statusLine: {
    color: '#C9D1D9',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  nextLine: {
    color: '#8B949E',
    fontSize: 12,
    fontWeight: '700',
  },
  attentionCard: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  attentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#2B323A',
    backgroundColor: '#10161D',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  attentionBadge: {
    borderRadius: 999,
    minHeight: 22,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attentionBadgeCritical: {
    backgroundColor: '#EF5350',
  },
  attentionBadgeWarning: {
    backgroundColor: '#FFA726',
  },
  attentionBadgeText: {
    color: '#0D1117',
    fontSize: 10,
    fontWeight: '800',
  },
  attentionText: {
    flex: 1,
    color: '#E6EDF3',
    fontSize: 13,
    fontWeight: '700',
  },
  attentionEmpty: {
    color: '#9DA7B1',
    fontSize: 14,
    fontWeight: '700',
  },
});
