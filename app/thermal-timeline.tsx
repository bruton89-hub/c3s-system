/**
 * Thermal Timeline view.
 *
 * Industrial Gantt-style timeline:
 *   - Rows: smokehouses D…O, then chillers 4…16.
 *   - Columns: hours of a single day (default = today).
 *   - Bars: planned utilization (forecast-driven) per resource.
 *   - Highlights: overload / collision warnings inline.
 *
 * Built with primitive RN <View> blocks — no chart library — to keep the
 * visual MES-flat and ensure it works on iPad without animation overhead.
 */
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';

import { C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { C3SOperatorFocus } from '@/components/operator-ui';
import { C3S_COLORS, C3S_RADIUS } from '@/constants/c3s-ui';

import { getWeeklyPlanItems, type WeeklyPlanItem } from '@/lib/firebase/repository';
import { getActiveProductProfiles, type ProductProfile } from '@/lib/products';
import { forecastSchedule } from '@/lib/forecasting';
import {
  analyzeAll,
  CHILLER_IDS,
  CHILLERS,
  SMOKEHOUSE_IDS,
  SMOKEHOUSES,
  type UtilizationSlot,
} from '@/lib/capacity';
import { toSafeDate } from '@/lib/utils/dates';
import { getOperationalItems, type OItemItem } from '@/lib/operational-items';
import { getItemPresentation, itemBatch, itemName } from '@/lib/production/presentation';

const HOUR_WIDTH = 36;       // px per hour
const ROW_HEIGHT = 28;
const LABEL_WIDTH = 90;
const DAY_HOURS = 24;

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function fmt(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

export default function ThermalTimelineScreen() {
  const [anchorDay, setAnchorDay] = useState<Date>(() => startOfDay(new Date()));
  const [items, setItems] = useState<WeeklyPlanItem[]>([]);
  const [profiles, setProfiles] = useState<ProductProfile[]>([]);
  const [operationalItems, setOperationalItems] = useState<OItemItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const profileById = useMemo(() => {
    const map = new Map<string, ProductProfile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);
  const profileByCode = useMemo(() => {
    const map = new Map<string, ProductProfile>();
    profiles.forEach((p) => map.set(p.productCode, p));
    return map;
  }, [profiles]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, i, operational] = await Promise.all([
        getActiveProductProfiles(),
        getWeeklyPlanItems(),
        getOperationalItems(),
      ]);
      setProfiles(p);
      setItems(i);
      setOperationalItems(operational);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timeline');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Compute slots for the visible day.
  const { smokeByHouse, chillByChiller, warnings } = useMemo(() => {
    const smokeSlots: UtilizationSlot[] = [];
    const chillSlots: UtilizationSlot[] = [];

    const dayStart = anchorDay;
    const dayEnd = new Date(dayStart.getTime() + DAY_HOURS * 60 * 60 * 1000);

    for (const it of items) {
      const profile = profileById.get(it.productId) ?? profileByCode.get(it.productCodeSnapshot ?? '');
      if (!profile) continue;

      const planStart = toSafeDate(it.plannedStartAt) ?? new Date(`${it.plannedDate}T06:00:00`);
      const f = forecastSchedule({
        profile,
        rackCount: it.plannedRacks,
        plannedStart: planStart,
      });

      // Only include slots that intersect the visible day.
      if (it.assignedSmokehouse && f.cookEnd.getTime() > dayStart.getTime() && f.cookStart.getTime() < dayEnd.getTime()) {
        smokeSlots.push({
          resourceId: it.assignedSmokehouse,
          productCode: profile.productCode,
          productName: profile.productName,
          rackCount: it.plannedRacks,
          start: f.cookStart,
          end: f.cookEnd,
          sourceId: it.id,
        });
      }
      if (it.assignedChiller) {
        const chillStart = f.cookEnd;
        const chillEnd = f.postThermalEnd;
        if (chillEnd.getTime() > chillStart.getTime() && chillEnd.getTime() > dayStart.getTime() && chillStart.getTime() < dayEnd.getTime()) {
          chillSlots.push({
            resourceId: it.assignedChiller,
            productCode: profile.productCode,
            productName: profile.productName,
            rackCount: it.plannedRacks,
            start: chillStart,
            end: chillEnd,
            sourceId: it.id,
          });
        }
      }
    }

    const analyzed = analyzeAll(smokeSlots, chillSlots);
    return {
      smokeByHouse: analyzed.byHouse,
      chillByChiller: analyzed.byChiller,
      warnings: analyzed.warnings,
    };
  }, [items, profileById, profileByCode, anchorDay]);

  function slotToBar(slot: UtilizationSlot, dayStart: Date) {
    const dayMs = dayStart.getTime();
    const dayEndMs = dayMs + DAY_HOURS * 3600 * 1000;
    const start = Math.max(slot.start.getTime(), dayMs);
    const end = Math.min(slot.end.getTime(), dayEndMs);
    const offsetHours = (start - dayMs) / 3600000;
    const widthHours = Math.max(0.25, (end - start) / 3600000);
    return { left: offsetHours * HOUR_WIDTH, width: widthHours * HOUR_WIDTH };
  }

  function shiftDay(delta: number) {
    setAnchorDay((d) => new Date(d.getTime() + delta * 24 * 3600 * 1000));
  }

  const timelineLoadCount = Object.values(smokeByHouse).reduce((sum, group) => sum + group.length, 0);
  const activeCooks = useMemo(() => operationalItems.filter((item) => item.stage === 'thermal' && ['assigned', 'cooking'].includes(item.status)).sort((a, b) => {
    const aa = a.expectedCookComplete ? new Date(a.expectedCookComplete).getTime() : Number.MAX_SAFE_INTEGER;
    const bb = b.expectedCookComplete ? new Date(b.expectedCookComplete).getTime() : Number.MAX_SAFE_INTEGER;
    return aa - bb;
  }), [operationalItems]);

  return (
    <C3SScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <C3SPage>
        <C3SScreenHeader
          title="Thermal Timeline"
          subtitle={`${fmt(anchorDay)} — smokehouse + chiller utilization`}
          right={
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pressable style={styles.navBtn} onPress={() => shiftDay(-1)}>
                <Text style={styles.navBtnText}>‹</Text>
              </Pressable>
              <Pressable style={styles.navBtn} onPress={() => setAnchorDay(startOfDay(new Date()))}>
                <Text style={styles.navBtnText}>Today</Text>
              </Pressable>
              <Pressable style={styles.navBtn} onPress={() => shiftDay(1)}>
                <Text style={styles.navBtnText}>›</Text>
              </Pressable>
              <Pressable style={[styles.navBtn, styles.navBtnAccent]} onPress={() => router.back()}>
                <Text style={styles.navBtnText}>Back</Text>
              </Pressable>
            </View>
          }
        />
        <C3SOperatorFocus
          status={`${timelineLoadCount} scheduled loads`}
          action={warnings.length > 0 ? 'Review Capacity Risk' : 'Review Thermal Schedule'}
          detail="Use the timeline to identify equipment overlap; production actions remain in Thermal and Chill."
          tone={warnings.length > 0 ? 'critical' : timelineLoadCount > 0 ? 'active' : 'complete'}
        />

        <View style={styles.events}><Text style={styles.eventsTitle}>Active Cooks & Upcoming Actions</Text>{activeCooks.slice(0, 8).map((item) => { const info = getItemPresentation(item); return <Pressable key={item.id} style={styles.eventRow} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}`)}><View style={{ flex: 1 }}><Text style={styles.eventTitle}>{item.assignedSmokehouse || 'Unassigned oven'} • Batch {itemBatch(item)}</Text><Text style={styles.eventText}>{itemName(item)} • {info.nextAction}{item.expectedCookComplete ? ` • expected ${new Date(item.expectedCookComplete).toLocaleTimeString()}` : ''}</Text></View><Text style={styles.eventArrow}>›</Text></Pressable>; })}{!activeCooks.length ? <Text style={styles.eventText}>No active cooks or pending cook starts.</Text> : null}</View>

        {warnings.length > 0 && (
          <View style={styles.warnings}>
            <Text style={styles.warningsTitle}>{warnings.length} warning(s)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {warnings.slice(0, 10).map((w, i) => (
                <View key={i} style={styles.warningChip}>
                  <Text style={styles.warningChipText}>{w.message}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={C3S_COLORS.accent} /></View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                {/* Hour axis */}
                <View style={styles.axisRow}>
                  <View style={{ width: LABEL_WIDTH }} />
                  {Array.from({ length: DAY_HOURS }, (_, h) => (
                    <View key={h} style={[styles.hourTick, { width: HOUR_WIDTH }]}>
                      <Text style={styles.hourTickText}>{String(h).padStart(2, '0')}</Text>
                    </View>
                  ))}
                </View>

                {/* Smokehouses section */}
                <SectionTitle title="SMOKEHOUSES" />
                {SMOKEHOUSE_IDS.map((id) => {
                  const slots = smokeByHouse[id] ?? [];
                  return (
                    <View key={id} style={styles.row}>
                      <View style={[styles.labelCell, { width: LABEL_WIDTH }]}>
                        <Text style={styles.labelText}>{SMOKEHOUSES[id].label}</Text>
                        <Text style={styles.labelSub}>cap {SMOKEHOUSES[id].rackCapacity}</Text>
                      </View>
                      <View style={[styles.lane, { width: HOUR_WIDTH * DAY_HOURS, height: ROW_HEIGHT }]}>
                        {/* Hour grid */}
                        {Array.from({ length: DAY_HOURS }).map((_, h) => (
                          <View key={h} style={[styles.gridCell, { left: h * HOUR_WIDTH, width: HOUR_WIDTH }]} />
                        ))}
                        {slots.map((s) => {
                          const bar = slotToBar(s, anchorDay);
                          const over = s.rackCount > SMOKEHOUSES[id].rackCapacity;
                          return (
                            <View key={s.sourceId ?? `${s.productCode}-${s.start.getTime()}`}
                              style={[
                                styles.bar,
                                { left: bar.left, width: bar.width },
                                over ? styles.barOver : styles.barOk,
                              ]}>
                              <Text style={styles.barText} numberOfLines={1}>
                                {s.productCode} · {s.rackCount}r
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}

                {/* Chillers section */}
                <SectionTitle title="CHILLERS" />
                {CHILLER_IDS.map((id) => {
                  const slots = chillByChiller[String(id)] ?? [];
                  return (
                    <View key={id} style={styles.row}>
                      <View style={[styles.labelCell, { width: LABEL_WIDTH }]}>
                        <Text style={styles.labelText}>{CHILLERS[id].label}</Text>
                        <Text style={styles.labelSub}>cap {CHILLERS[id].rackCapacity}</Text>
                      </View>
                      <View style={[styles.lane, { width: HOUR_WIDTH * DAY_HOURS, height: ROW_HEIGHT }]}>
                        {Array.from({ length: DAY_HOURS }).map((_, h) => (
                          <View key={h} style={[styles.gridCell, { left: h * HOUR_WIDTH, width: HOUR_WIDTH }]} />
                        ))}
                        {slots.map((s) => {
                          const bar = slotToBar(s, anchorDay);
                          // For chillers, overload is concurrent racks vs capacity;
                          // a single slot bar can be highlighted if it alone exceeds capacity.
                          const over = s.rackCount > CHILLERS[id].rackCapacity;
                          return (
                            <View key={s.sourceId ?? `${s.productCode}-${s.start.getTime()}`}
                              style={[
                                styles.bar,
                                { left: bar.left, width: bar.width },
                                over ? styles.barOver : styles.barChill,
                              ]}>
                              <Text style={styles.barText} numberOfLines={1}>
                                {s.productCode} · {s.rackCount}r
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </ScrollView>
        )}
      </C3SPage>
    </C3SScreen>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <View style={styles.sectionBar}>
      <Text style={styles.sectionBarText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  navBtn: {
    backgroundColor: C3S_COLORS.panelAlt,
    borderWidth: 1, borderColor: C3S_COLORS.border,
    borderRadius: C3S_RADIUS.button,
    paddingHorizontal: 10, paddingVertical: 8,
    minHeight: 36, justifyContent: 'center',
  },
  navBtnAccent: { backgroundColor: C3S_COLORS.accent, borderColor: C3S_COLORS.accent },
  navBtnText: { color: C3S_COLORS.textStrong, fontSize: 12, fontWeight: '700' },

  warnings: {
    borderWidth: 1, borderColor: C3S_COLORS.danger,
    backgroundColor: C3S_COLORS.dangerSoft,
    borderRadius: C3S_RADIUS.card,
    paddingHorizontal: 10, paddingVertical: 8,
    marginBottom: 8,
  },
  warningsTitle: { color: C3S_COLORS.danger, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  warningChip: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: C3S_COLORS.dangerSoft,
    borderWidth: 1, borderColor: C3S_COLORS.danger,
  },
  warningChipText: { color: C3S_COLORS.danger, fontSize: 11, fontWeight: '600' },
  events: { borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel, borderRadius: C3S_RADIUS.card, padding: 12, gap: 5, marginBottom: 8 },
  eventsTitle: { color: C3S_COLORS.textStrong, fontSize: 16, fontWeight: '900', marginBottom: 3 },
  eventRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C3S_COLORS.border, paddingVertical: 7 },
  eventTitle: { color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '900' },
  eventText: { color: C3S_COLORS.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '600', marginTop: 2 },
  eventArrow: { color: C3S_COLORS.accent, fontSize: 25, marginLeft: 8 },

  error: { color: C3S_COLORS.danger, fontSize: 12, marginBottom: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  axisRow: { flexDirection: 'row', height: 22, alignItems: 'center' },
  hourTick: { height: 22, justifyContent: 'center', alignItems: 'center', borderLeftWidth: 1, borderLeftColor: C3S_COLORS.border },
  hourTickText: { color: C3S_COLORS.textMuted, fontSize: 9, fontWeight: '700' },

  sectionBar: {
    backgroundColor: C3S_COLORS.panelAlt,
    paddingHorizontal: 8, paddingVertical: 4,
    borderTopWidth: 2, borderTopColor: C3S_COLORS.accent,
    marginTop: 8,
  },
  sectionBarText: { color: C3S_COLORS.textPrimary, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: C3S_COLORS.border,
  },
  labelCell: { justifyContent: 'center', paddingHorizontal: 6, backgroundColor: C3S_COLORS.panel },
  labelText: { color: C3S_COLORS.textPrimary, fontSize: 11, fontWeight: '700' },
  labelSub: { color: C3S_COLORS.textMuted, fontSize: 9, fontWeight: '600' },

  lane: { position: 'relative', backgroundColor: C3S_COLORS.bg },
  gridCell: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 1, borderLeftColor: C3S_COLORS.border },
  bar: {
    position: 'absolute',
    top: 3, bottom: 3,
    borderRadius: 3,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  barOk: { backgroundColor: C3S_COLORS.warning },      // smokehouse OK (orange)
  barChill: { backgroundColor: C3S_COLORS.info },   // chiller OK (blue)
  barOver: { backgroundColor: C3S_COLORS.danger, borderWidth: 1, borderColor: '#fff' },
  barText: { color: '#0D1117', fontSize: 9, fontWeight: '800' },
});
