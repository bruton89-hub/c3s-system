import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { CHILLERS, PRODUCT_PROFILES, SMOKEHOUSES, getChillerCapacity } from '@/constants/c3s';
import { type PlanDay, type PlanShift, useC3S } from '@/store/c3s-store';

const dayOrder: PlanDay[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const shiftOrder: PlanShift[] = ['Day', 'Night'];
const shiftMinutes = 8 * 60;

type ForecastCard = {
  title: string;
  value: string;
  subline: string;
  risk?: string;
};

function getProfile(productName: string) {
  return (
    PRODUCT_PROFILES[productName] ?? {
      productName,
      cookType: 'steam' as const,
      estimatedCookMinutes: 110,
      estimatedChillMinutes: 90,
      rackType: 'Standard Rack',
      averageRackCount: 8,
      averagePackagingMinutes: 60,
    }
  );
}

export default function WeeklyPlanningScreen() {
  const { plannedRuns, addPlannedRun } = useC3S();
  const [selectedDay, setSelectedDay] = useState<PlanDay>('Mon');

  const daySummary = useMemo(
    () =>
      dayOrder.map((day) => {
        const runs = plannedRuns.filter((run) => run.targetDay === day);
        const racks = runs.reduce((sum, run) => sum + run.rackCount, 0);
        const cookMin = runs.reduce((sum, run) => sum + Math.round(run.estimatedCookHours * 60), 0);
        const chillMin = runs.reduce((sum, run) => sum + Math.round(run.estimatedChillHours * 60), 0);
        const packMin = runs.reduce((sum, run) => sum + getProfile(run.productName).averagePackagingMinutes, 0);
        return { day, runs: runs.length, racks, cookMin, chillMin, packMin };
      }),
    [plannedRuns],
  );

  const selectedRuns = useMemo(
    () =>
      plannedRuns
        .filter((run) => run.targetDay === selectedDay)
        .sort((a, b) => {
          if (a.targetShift !== b.targetShift) return a.targetShift === 'Day' ? -1 : 1;
          return a.runId.localeCompare(b.runId);
        }),
    [plannedRuns, selectedDay],
  );

  const smokehousePerShift = SMOKEHOUSES.length;
  const chillerRackPerShift = CHILLERS.reduce((sum, ch) => sum + getChillerCapacity(ch), 0);

  const selectedDayByShift = useMemo(
    () =>
      shiftOrder.map((shift) => {
        const runs = selectedRuns.filter((run) => run.targetShift === shift);
        const rackCount = runs.reduce((sum, run) => sum + run.rackCount, 0);
        const cookMinutes = runs.reduce((sum, run) => sum + Math.round(run.estimatedCookHours * 60), 0);
        const chillMinutes = runs.reduce((sum, run) => sum + Math.round(run.estimatedChillHours * 60), 0);
        const packagingMinutes = runs.reduce((sum, run) => sum + getProfile(run.productName).averagePackagingMinutes, 0);
        return { shift, runs, rackCount, cookMinutes, chillMinutes, packagingMinutes };
      }),
    [selectedRuns],
  );

  const forecastCards = useMemo<ForecastCard[]>(() => {
    const totalRuns = selectedRuns.length;
    const totalRacks = selectedRuns.reduce((sum, run) => sum + run.rackCount, 0);
    const thermalMin = selectedRuns.reduce((sum, run) => sum + Math.round(run.estimatedCookHours * 60), 0);
    const chillMin = selectedRuns.reduce((sum, run) => sum + Math.round(run.estimatedChillHours * 60), 0);
    const packagingMin = selectedRuns.reduce((sum, run) => sum + getProfile(run.productName).averagePackagingMinutes, 0);

    return [
      {
        title: 'Thermal Demand',
        value: `${totalRuns} loads`,
        subline: `${totalRacks} racks | ${thermalMin} cook min`,
        risk: selectedDayByShift.some((row) => row.runs.length > smokehousePerShift)
          ? 'Potential smokehouse overload'
          : undefined,
      },
      {
        title: 'Chill Demand',
        value: `${totalRacks} racks`,
        subline: `${chillMin} chill min projected`,
        risk: selectedDayByShift.some((row) => row.rackCount > chillerRackPerShift)
          ? 'Potential chiller rack overload'
          : undefined,
      },
      {
        title: 'Packaging Demand',
        value: `${packagingMin} pack min`,
        subline: selectedRuns.length
          ? `${Math.round(packagingMin / selectedRuns.length)} min avg/run`
          : 'No packaging demand for selected day',
        risk: selectedDayByShift.some((row) => row.packagingMinutes > shiftMinutes)
          ? 'Potential packaging shift overload'
          : undefined,
      },
    ];
  }, [selectedRuns, selectedDayByShift, smokehousePerShift, chillerRackPerShift]);

  const planningConflicts = useMemo(() => {
    const conflicts: string[] = [];

    selectedDayByShift.forEach((row) => {
      if (row.runs.length > smokehousePerShift) {
        conflicts.push(`${row.shift}: Thermal demand exceeds smokehouse lanes (${row.runs.length}/${smokehousePerShift}).`);
      }
      if (row.rackCount > chillerRackPerShift) {
        conflicts.push(`${row.shift}: Chill rack demand exceeds chiller capacity (${row.rackCount}/${chillerRackPerShift}).`);
      }
      if (row.packagingMinutes > shiftMinutes) {
        conflicts.push(`${row.shift}: Packaging demand exceeds one shift (${row.packagingMinutes} min > ${shiftMinutes} min).`);
      }
    });

    selectedRuns.forEach((run) => {
      const profile = getProfile(run.productName);
      if (!run.packagingLine || run.packagingLine.trim().length === 0) {
        conflicts.push(`${run.runId}: Packaging line not assigned.`);
      }
      if (run.rackCount > profile.averageRackCount * 1.5) {
        conflicts.push(`${run.runId}: Rack count above profile average (${run.rackCount}/${profile.averageRackCount}).`);
      }
    });

    return conflicts;
  }, [selectedRuns, selectedDayByShift, smokehousePerShift, chillerRackPerShift]);

  const weeklySummary = useMemo(() => {
    const totalRuns = plannedRuns.length;
    const totalRacks = plannedRuns.reduce((sum, run) => sum + run.rackCount, 0);
    const totalCookMin = plannedRuns.reduce((sum, run) => sum + Math.round(run.estimatedCookHours * 60), 0);
    const totalChillMin = plannedRuns.reduce((sum, run) => sum + Math.round(run.estimatedChillHours * 60), 0);
    const totalPackMin = plannedRuns.reduce((sum, run) => sum + getProfile(run.productName).averagePackagingMinutes, 0);

    return { totalRuns, totalRacks, totalCookMin, totalChillMin, totalPackMin };
  }, [plannedRuns]);

  const seedMoreRuns = () => {
    const seed = [
      {
        runId: 'B-WR-010',
        productName: 'Smoked Sausage',
        productCategory: 'Sausage' as const,
        cookMethod: 'smoke' as const,
        recipeProfile: 'Sausage Smoke 95',
        rackCount: 9,
        pieceCount: 300,
        priority: 'normal' as const,
        targetDay: 'Wed' as const,
        targetShift: 'Day' as const,
        estimatedCookHours: 1.6,
        estimatedChillHours: 1.2,
        packagingLine: '8600',
      },
      {
        runId: 'B-WR-011',
        productName: 'Turkey Breast',
        productCategory: 'Poultry' as const,
        cookMethod: 'steam' as const,
        recipeProfile: 'Turkey Core Temp 105',
        rackCount: 7,
        pieceCount: 210,
        priority: 'normal' as const,
        targetDay: 'Thu' as const,
        targetShift: 'Night' as const,
        estimatedCookHours: 1.8,
        estimatedChillHours: 1.3,
        packagingLine: 'SL-1 -> 8600',
      },
    ];

    const existing = new Set(plannedRuns.map((run) => run.runId));
    let added = 0;
    seed.forEach((item) => {
      if (!existing.has(item.runId)) {
        addPlannedRun(item);
        added += 1;
      }
    });
    Alert.alert('Demo Seed', added > 0 ? `${added} mock weekly run(s) added.` : 'All demo runs already loaded.');
  };

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader
          title="Weekly Run Planner / Cook Forecast"
          subtitle="Manager view (Demo) for weekly load, projected demand, and planning conflicts"
        />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.weeklyHeader}>
            {[
              { label: 'Weekly Runs', value: weeklySummary.totalRuns },
              { label: 'Weekly Racks', value: weeklySummary.totalRacks },
              { label: 'Cook Min', value: weeklySummary.totalCookMin },
              { label: 'Chill Min', value: weeklySummary.totalChillMin },
              { label: 'Pack Min', value: weeklySummary.totalPackMin },
            ].map((item) => (
              <View key={item.label} style={styles.metricCard}>
                <Text style={styles.metricValue}>{item.value}</Text>
                <Text style={styles.metricLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.daySelectorRow}>
            {dayOrder.map((day) => (
              <Pressable
                key={day}
                style={[styles.dayChip, selectedDay === day && styles.dayChipActive]}
                onPress={() => setSelectedDay(day)}>
                <Text style={[styles.dayChipText, selectedDay === day && styles.dayChipTextActive]}>{day}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.seedButton} onPress={seedMoreRuns}>
              <Text style={styles.seedButtonText}>Seed Demo Runs</Text>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dailyStrip}>
            {daySummary.map((item) => (
              <View key={item.day} style={[styles.daySummaryCard, selectedDay === item.day && styles.daySummaryCardActive]}>
                <Text style={styles.daySummaryTitle}>{item.day}</Text>
                <Text style={styles.daySummaryText}>{item.runs} runs</Text>
                <Text style={styles.daySummaryText}>{item.racks} racks</Text>
                <Text style={styles.daySummaryText}>{item.cookMin + item.chillMin + item.packMin} total min</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.forecastRow}>
            {forecastCards.map((card) => (
              <C3SCard key={card.title}>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.cardValue}>{card.value}</Text>
                <Text style={styles.cardSubline}>Projected: {card.subline}</Text>
                {card.risk ? <Text style={styles.cardRisk}>Needs Attention: {card.risk}</Text> : null}
              </C3SCard>
            ))}
          </View>

          <C3SCard>
            <Text style={styles.sectionTitle}>{selectedDay} Planned Runs</Text>
            {selectedRuns.length === 0 ? <Text style={styles.emptyText}>No planned runs for {selectedDay}.</Text> : null}
            {selectedRuns.map((run) => {
              const profile = getProfile(run.productName);
              const estimatedPackagingMinutes = profile.averagePackagingMinutes;

              return (
                <View key={run.id} style={styles.runRow}>
                  <Text style={styles.runTitle}>{run.productName}</Text>
                  <Text style={styles.runText}>Run ID: {run.runId}</Text>
                  <Text style={styles.runText}>Stage / Planning Status: {run.planningStatus}</Text>
                  <Text style={styles.runText}>Cook Type: {run.cookMethod.toUpperCase()} | Shift: {run.targetShift} | Racks: {run.rackCount}</Text>
                  <Text style={styles.runText}>Estimated Cook: {Math.round(run.estimatedCookHours * 60)} min | Estimated Chill: {Math.round(run.estimatedChillHours * 60)} min | Estimated Pack: {estimatedPackagingMinutes} min</Text>
                  <Text style={styles.runText}>Rack Type: {profile.rackType} | Expected Racks: {profile.averageRackCount}</Text>
                  <Text style={styles.runText}>Packaging Destination: {run.packagingLine ?? '--'} (Projected)</Text>
                </View>
              );
            })}
          </C3SCard>

          <C3SCard>
            <Text style={styles.sectionTitle}>Needs Attention / Planning Conflicts</Text>
            {planningConflicts.length === 0 ? <Text style={styles.okText}>No major planning conflicts for {selectedDay}.</Text> : null}
            {planningConflicts.map((item) => (
              <Text key={item} style={styles.conflictText}>{`• ${item}`}</Text>
            ))}
          </C3SCard>
        </ScrollView>
      </C3SPage>
    </C3SScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 10,
    paddingBottom: 20,
  },
  weeklyHeader: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 10,
    minHeight: 78,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  metricValue: {
    color: '#F0F6FC',
    fontSize: 22,
    fontWeight: '800',
  },
  metricLabel: {
    color: '#9DA7B1',
    fontSize: 11,
    fontWeight: '700',
  },
  daySelectorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  dayChip: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  dayChipActive: {
    borderColor: '#4FC3F7',
    backgroundColor: '#13314A',
  },
  dayChipText: {
    color: '#AAB4BE',
    fontSize: 12,
    fontWeight: '800',
  },
  dayChipTextActive: {
    color: '#E6EDF3',
  },
  seedButton: {
    minHeight: 36,
    borderRadius: 8,
    backgroundColor: '#1565C0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  seedButtonText: {
    color: '#F0F6FC',
    fontSize: 12,
    fontWeight: '800',
  },
  dailyStrip: {
    gap: 8,
    paddingRight: 8,
  },
  daySummaryCard: {
    width: 130,
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 10,
    padding: 8,
    gap: 2,
  },
  daySummaryCardActive: {
    borderColor: '#4FC3F7',
  },
  daySummaryTitle: {
    color: '#E6EDF3',
    fontSize: 12,
    fontWeight: '800',
  },
  daySummaryText: {
    color: '#AAB4BE',
    fontSize: 11,
    fontWeight: '700',
  },
  forecastRow: {
    gap: 8,
  },
  cardTitle: {
    color: '#E6EDF3',
    fontSize: 14,
    fontWeight: '800',
  },
  cardValue: {
    color: '#F0F6FC',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  cardSubline: {
    color: '#9DA7B1',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  cardRisk: {
    color: '#FFCDD2',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4,
  },
  sectionTitle: {
    color: '#E6EDF3',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  runRow: {
    borderWidth: 1,
    borderColor: '#2B323A',
    backgroundColor: '#10161D',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    gap: 2,
  },
  runTitle: {
    color: '#E6EDF3',
    fontSize: 14,
    fontWeight: '800',
  },
  runText: {
    color: '#AAB4BE',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    color: '#9DA7B1',
    fontSize: 13,
    fontWeight: '700',
  },
  okText: {
    color: '#A5D6A7',
    fontSize: 13,
    fontWeight: '800',
  },
  conflictText: {
    color: '#FFCDD2',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
});
