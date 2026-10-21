import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { C3S_COLORS as C } from '@/constants/c3s-ui';
import { getWeeklyPlanItems, type WeeklyPlanItem } from '@/lib/firebase/repository';
import { getActiveProductProfiles, type ProductProfile } from '@/lib/products';
import { formatForecastTime } from '@/lib/forecasting';
import { PLANNING_CHILLERS, PLANNING_HOUSES, houseAvailability, planReloads, summarizeDay, type ReloadOrder } from '@/lib/reload-planning/core';
import { toSafeDate } from '@/lib/utils/dates';

function monday(date: Date) { const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
function iso(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const time = (ms: number) => formatForecastTime(new Date(ms));

export default function ReloadPlanningScreen() {
  const params = useLocalSearchParams<{ week?: string }>();
  const [anchor, setAnchor] = useState(() => monday(params.week && /^\d{4}-\d{2}-\d{2}$/.test(params.week) ? new Date(`${params.week}T00:00:00`) : new Date()));
  const [items, setItems] = useState<WeeklyPlanItem[]>([]);
  const [profiles, setProfiles] = useState<ProductProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleanHours, setCleanHours] = useState('');
  const [transferMinutes, setTransferMinutes] = useState('0');
  const [reroute, setReroute] = useState(false);
  const [downHouses, setDownHouses] = useState<string[]>([]);
  const [downChillers, setDownChillers] = useState<number[]>([5]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [rows, products] = await Promise.all([getWeeklyPlanItems(), getActiveProductProfiles()]); setItems(rows); setProfiles(products); }
    catch (e) { setItems([]); setProfiles([]); setError(e instanceof Error ? e.message : 'Unable to load the weekly plan.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(anchor); d.setDate(d.getDate() + i); d.setHours(8, 0, 0, 0); return d; }), [anchor]);
  const prepared = useMemo(() => {
    const orders: ReloadOrder[] = [], issues: string[] = [];
    for (const item of items.filter(i => days.some(d => iso(d) === i.plannedDate))) {
      const p = profiles.find(p => p.id === item.productId) ?? profiles.find(p => p.productCode === item.productCodeSnapshot);
      if (!p) { issues.push(`${item.productName}: missing product profile.`); continue; }
      const ready = new Date(`${item.plannedDate}T08:00:00`).getTime();
      const explicit = toSafeDate(item.plannedStartAt)?.getTime();
      orders.push({
        id: item.id, productionDay: item.plannedDate, productName: item.productName,
        species: p.species, smoke: Boolean(p.smokeType),
        rackStyle: p.productCode === '51912' ? 'semi_whole' : p.productCode === '51913' ? 'semi_half' : 'standard',
        racks: item.plannedRacks, rackLimit: p.rackCapacity, cookHours: p.estimatedCookTimeHours,
        oldChillHours: p.estimatedChillTimeHours > 0 ? p.estimatedChillTimeHours : null,
        blastChillHours: p.estimatedBlastCellHours > 0 ? p.estimatedBlastCellHours : null,
        readyAt: Math.max(ready, explicit ?? ready), priority: item.priority,
      });
    }
    return { orders, issues };
  }, [items, profiles, days]);
  const settingsValid = cleanHours.trim() !== '' && Number.isFinite(Number(cleanHours)) && Number(cleanHours) > 0
    && transferMinutes.trim() !== '' && Number.isFinite(Number(transferMinutes)) && Number(transferMinutes) >= 0;
  const result = useMemo(() => !settingsValid || loading || error ? null : planReloads({
    orders: prepared.orders, startAt: days[0].getTime(),
    houses: PLANNING_HOUSES.map(h => ({ ...h, available: !downHouses.includes(h.id) })),
    chillers: PLANNING_CHILLERS.map(c => ({ ...c, available: !downChillers.includes(c.id) })),
    rules: { routineCleanHours: Number(cleanHours), speciesChangeHours: 2, windowHours: 24, transferHours: Number(transferMinutes) / 60, allowRerouting: reroute },
  }), [settingsValid, loading, error, prepared.orders, days, downHouses, downChillers, cleanHours, transferMinutes, reroute]);
  const shift = (n: number) => { const d = new Date(anchor); d.setDate(d.getDate() + n * 7); setAnchor(d); };
  const allIssues = [...prepared.issues, ...(result?.issues.map(i => i.message) ?? [])];
  const expectedRacks = items.filter(i => days.some(d => iso(d) === i.plannedDate)).reduce((n, i) => n + i.plannedRacks, 0);
  const plannedRacks = result?.loads.reduce((n, l) => n + l.racks, 0) ?? 0;
  return <C3SScreen><C3SPage>
    <C3SScreenHeader title="Reload planning" subtitle={`Week of ${iso(anchor)}`} right={<Pressable accessibilityRole="button" style={s.button} onPress={() => router.back()}><Text style={s.buttonText}>Back</Text></Pressable>} />
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.notice}>Weekly simulation assumes a clean, empty start at 8 a.m. It does not use live equipment occupancy or start production.</Text>
      <View style={s.row}>{[['Previous week', () => shift(-1)], ['Next week', () => shift(1)], ['Refresh', load]].map(([label, action]) => <Pressable key={String(label)} accessibilityRole="button" style={s.button} onPress={action as () => void}><Text style={s.buttonText}>{String(label)}</Text></Pressable>)}</View>
      <View style={s.card}>
        <Text style={s.heading}>Operating rules</Text>
        <Text style={s.body}>Two hours for species changes. A 24-hour window limits new starts. Reloads wait until the receiving chiller can clear before the cook finishes.</Text>
        <View style={s.row}><View><Text style={s.label}>Routine cleaning hours</Text><TextInput accessibilityLabel="Routine cleaning hours" style={s.input} value={cleanHours} onChangeText={setCleanHours} keyboardType="decimal-pad" placeholder="Enter duration" /></View><View><Text style={s.label}>Transfer allowance, minutes</Text><TextInput accessibilityLabel="Transfer allowance in minutes" style={s.input} value={transferMinutes} onChangeText={setTransferMinutes} keyboardType="decimal-pad" /></View></View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: reroute }} onPress={() => setReroute(!reroute)} style={s.button}><Text style={s.buttonText}>{reroute ? 'Rerouting enabled' : 'Paired chillers only'}</Text></Pressable>
        <Text style={s.body}>When enabled, rerouting is proposed only for an earlier start or an unavailable paired route. Blast 8 holds 10 racks, or 12 semi-whole racks.</Text>
      </View>
      <View style={s.card}><Text style={s.heading}>Equipment available for this scenario</Text><Text style={s.label}>Houses</Text><View style={s.row}>{PLANNING_HOUSES.map(h => <Pressable key={h.id} accessibilityRole="checkbox" accessibilityState={{ checked: !downHouses.includes(h.id) }} style={[s.button, downHouses.includes(h.id) && s.off]} onPress={() => setDownHouses(v => v.includes(h.id) ? v.filter(x => x !== h.id) : [...v, h.id])}><Text style={s.buttonText}>{h.id}{downHouses.includes(h.id) ? ' down' : ''}</Text></Pressable>)}</View><Text style={s.label}>Chillers</Text><View style={s.row}>{PLANNING_CHILLERS.map(c => <Pressable key={c.id} disabled={c.id === 5} accessibilityRole="checkbox" accessibilityState={{ checked: !downChillers.includes(c.id), disabled: c.id === 5 }} style={[s.button, downChillers.includes(c.id) && s.off]} onPress={() => setDownChillers(v => v.includes(c.id) ? v.filter(x => x !== c.id) : [...v, c.id])}><Text style={s.buttonText}>{c.id}{downChillers.includes(c.id) ? ' down' : ''}</Text></Pressable>)}</View><Text style={s.body}>House C and chiller 5 are excluded. Changes recalculate the proposal immediately.</Text></View>
      {loading ? <ActivityIndicator /> : error ? <Text style={s.warning}>{error}</Text> : !settingsValid ? <Text style={s.notice}>Enter the routine cleaning duration and a valid transfer allowance to calculate the plan.</Text> : <>
        <Text style={s.heading}>{result?.loads.length ?? 0} loads · {plannedRacks} of {expectedRacks} racks scheduled</Text>
        {allIssues.map((message, i) => <Text key={i} style={s.warning}>{message}</Text>)}
        {prepared.orders.length === 0 && <Text style={s.body}>No production rows for this week. Add products on the Production Board.</Text>}
        {days.map(day => {
          const date = iso(day), totals = summarizeDay(result?.loads ?? [], date, day.getTime());
          const available = houseAvailability(result?.loads ?? [], PLANNING_HOUSES.map(h => ({ ...h, available: !downHouses.includes(h.id) })), day.getTime());
          return <View key={date} style={s.card}><Text style={s.heading}>{day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</Text><Text style={s.body}>{totals.racks} racks · {totals.loads} loads · {totals.reloads} reloads</Text><Text style={s.body}>At 8 a.m.: {available.filter(h => h.status === 'Ready').length} ready · {totals.cookingAtStart} cooking · {totals.cleaningAtStart} cleaning</Text><Text style={s.body}>{available.map(h => `${h.house}: ${h.status}`).join(' · ')}</Text>{totals.startsAfterNextDay > 0 && <Text style={s.warning}>{totals.startsAfterNextDay} starts extend past the following 8 a.m.</Text>}{result?.loads.filter(l => l.productionDay === date).map(l => <View key={l.id} style={s.load}><Text style={s.label}>House {l.house} · {l.racks} racks · {l.productName}</Text><Text style={s.body}>{time(l.start)} → cook done {time(l.cookEnd)}</Text><Text style={s.body}>Chiller {l.chiller} clears {time(l.chillEnd)} · {l.reason}</Text>{l.cleanStart !== null && <Text style={s.body}>Clean {time(l.cleanStart)}–{time(l.cleanEnd!)}</Text>}<Text style={s.body}>New-start deadline {time(l.windowDeadline)}</Text>{!l.paired && <Text style={s.notice}>{l.rerouteSavedHours > 0 ? `Reroute advances start by ${l.rerouteSavedHours.toFixed(2)} hours.` : 'Reroute replaces an unavailable paired route.'}</Text>}</View>)}</View>;
        })}
      </>}
    </ScrollView>
  </C3SPage></C3SScreen>;
}
const s = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 48 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { padding: 16, gap: 10, backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 12 },
  heading: { fontSize: 19, fontWeight: '700', color: C.textPrimary }, label: { fontSize: 14, fontWeight: '700', color: C.textPrimary },
  body: { color: C.textMuted, fontSize: 14, lineHeight: 21 }, notice: { color: C.textPrimary, backgroundColor: C.panelAlt, padding: 10, lineHeight: 21 },
  warning: { color: C.danger, backgroundColor: C.dangerSoft, padding: 10 },
  button: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 12, backgroundColor: C.accentSoft, borderRadius: 8 },
  buttonText: { color: C.accent, fontWeight: '700' }, off: { opacity: 0.5 },
  input: { borderColor: C.border, borderWidth: 1, borderRadius: 8, padding: 10, minWidth: 160, minHeight: 44, color: C.textPrimary },
  load: { borderTopColor: C.border, borderTopWidth: 1, paddingTop: 12, gap: 4 },
});
