import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { C3SBrandHeader } from '@/components/c3s-brand';
import { ProductionItemCard } from '@/components/production-item-card';
import { C3SPage, C3SScreen } from '@/components/c3s-ui';
import { C3S_COLORS } from '@/constants/c3s-ui';
import { getOperationalItems, type OItemItem, type OItemStage } from '@/lib/operational-items';
import { PRODUCTION_FLOW } from '@/lib/production/presentation';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import { matchesProductionSearch, sortProduction, type ProductionSort } from '@/lib/operations/summary';
import { isHeldStatus } from '@/lib/holds/core';
import { StressScenarioBanner } from '@/components/stress-scenario-banner';
import { DataFreshness } from '@/components/data-freshness';

type Filter = 'All' | 'Prep' | 'RTC' | 'Thermal' | 'Chill' | 'QA' | 'Packaging' | 'Held' | 'Complete';
const filters: Filter[] = ['All', ...PRODUCTION_FLOW.slice(0, -1), 'Held', 'Complete'];
const stageForFilter: Partial<Record<Filter, OItemStage>> = {
  Prep: 'planning', RTC: 'rtc', Thermal: 'thermal', Chill: 'chill', QA: 'qa', Packaging: 'packaging', Complete: 'complete',
};

export default function ProductionScreen() {
  const [items, setItems] = useState<OItemItem[]>([]);
  const [filter, setFilter] = useState<Filter>('All');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProductionSort>('priority');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await getOperationalItems()); setRefreshedAt(Date.now()); }
    catch (err) { logFirebaseError('Production', 'operational_items', err); setError(toOperatorMessage(err, 'Production could not be loaded.')); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const visible = useMemo(() => {
    const withoutParents = items.filter((item) => item.status !== 'split_parent');
    const selected = filter === 'All' ? withoutParents.filter((item) => item.stage !== 'complete') : filter === 'Held' ? withoutParents.filter((item) => isHeldStatus(item.status)) : withoutParents.filter((item) => item.stage === stageForFilter[filter]);
    return sortProduction(selected.filter((item) => matchesProductionSearch(item, search)), sort);
  }, [filter, items, search, sort]);

  return (
    <C3SScreen><C3SPage>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C3S_COLORS.accent} />}
        contentContainerStyle={styles.content}>
        <C3SBrandHeader title="Production" subtitle="Follow every batch from prep to complete" />
        <StressScenarioBanner />
        <DataFreshness refreshedAt={refreshedAt} failed={Boolean(error)} />

        <View style={styles.flow}>
          {PRODUCTION_FLOW.map((stage, index) => <View key={stage} style={styles.flowPart}><Text style={styles.flowLabel}>{stage}</Text>{index < PRODUCTION_FLOW.length - 1 ? <Text style={styles.arrow}>→</Text> : null}</View>)}
        </View>

        <View style={styles.filters}>
          {filters.map((option) => {
            const selected = option === filter;
            return <Pressable key={option} style={[styles.filter, selected && styles.filterSelected]} onPress={() => setFilter(option)}><Text style={[styles.filterText, selected && styles.filterTextSelected]}>{option}</Text></Pressable>;
          })}
        </View>

        <TextInput
          accessibilityLabel="Search production"
          value={search}
          onChangeText={setSearch}
          placeholder="Search batch, product, or equipment"
          placeholderTextColor={C3S_COLORS.textMuted}
          style={styles.search}
        />
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort</Text>
          {(['priority', 'stage', 'oldest', 'newest', 'deadline'] as ProductionSort[]).map((option) => <Pressable key={option} style={[styles.sortChip, sort === option && styles.sortChipSelected]} onPress={() => setSort(option)}><Text style={[styles.sortText, sort === option && styles.sortTextSelected]}>{option === 'deadline' ? 'Closest deadline' : option[0].toUpperCase() + option.slice(1)}</Text></Pressable>)}
        </View>

        <View style={styles.countRow}><Text style={styles.count}>{visible.length} {filter === 'All' ? 'active' : filter.toLowerCase()}</Text><Text style={styles.hint}>Tap an item for its next action</Text></View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {visible.map((item) => <ProductionItemCard key={item.id} item={item} />)}
        {!loading && visible.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Nothing here right now</Text><Text style={styles.emptyText}>Pull down to refresh or choose another stage.</Text></View> : null}
      </ScrollView>
    </C3SPage></C3SScreen>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 1080, alignSelf: 'center', gap: 11, paddingBottom: 32 },
  flow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', backgroundColor: C3S_COLORS.navy, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 10 },
  flowPart: { flexDirection: 'row', alignItems: 'center' },
  flowLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  arrow: { color: '#64A7FF', fontSize: 17, fontWeight: '900', marginHorizontal: 6 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 2 },
  filter: { minWidth: 76, flexGrow: 1, minHeight: 44, borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel, borderRadius: 999, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  filterSelected: { backgroundColor: C3S_COLORS.accent, borderColor: C3S_COLORS.accent },
  filterText: { color: C3S_COLORS.textMuted, fontSize: 14, fontWeight: '800' },
  filterTextSelected: { color: '#FFFFFF' },
  search: { minHeight: 48, borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel, color: C3S_COLORS.textStrong, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, fontWeight: '700' },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  sortLabel: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '900', marginRight: 2 },
  sortChip: { minHeight: 40, borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel, borderRadius: 999, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  sortChipSelected: { backgroundColor: C3S_COLORS.navy, borderColor: C3S_COLORS.navy },
  sortText: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '800' },
  sortTextSelected: { color: '#FFFFFF' },
  countRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, marginTop: 5 },
  count: { color: C3S_COLORS.textStrong, fontSize: 20, fontWeight: '900' },
  hint: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', backgroundColor: C3S_COLORS.panel, borderWidth: 1, borderColor: C3S_COLORS.border, borderRadius: 14, padding: 26 },
  emptyTitle: { color: C3S_COLORS.textStrong, fontSize: 17, fontWeight: '900' },
  emptyText: { color: C3S_COLORS.textMuted, fontSize: 14, fontWeight: '600', marginTop: 4 },
  error: { color: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft, borderRadius: 10, padding: 12, fontSize: 14, fontWeight: '700' },
});
