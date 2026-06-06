/**
 * Product Intelligence — master list / editor screen.
 *
 * UI goals:
 *   - dense MES-style table layout (no flashy cards)
 *   - fast scan: code | name | section | cook | chill | blast | racks
 *   - inline edit of the operational fields most likely to change
 *   - filterable by production section
 *
 * Route: /products (registered in root _layout)
 */
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, router } from 'expo-router';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { C3S_COLORS, C3S_RADIUS, C3S_SPACING, C3S_TYPE } from '@/constants/c3s-ui';
import {
  PRODUCTION_SECTION_LABELS,
  PRODUCTION_SECTION_ORDER,
  formatHours,
  getAllProductProfiles,
  updateProductProfile,
  type ProductProfile,
  type ProductionSection,
} from '@/lib/products';

type Filter = 'all' | ProductionSection;
type SpeciesFilter = 'all' | ProductProfile['species'];
type ProcessFilter = 'all' | ProductProfile['processType'];
type ActiveFilter = 'all' | 'active' | 'inactive';

export default function ProductsScreen() {
  const [profiles, setProfiles] = useState<ProductProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState<SpeciesFilter>('all');
  const [processFilter, setProcessFilter] = useState<ProcessFilter>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<ProductProfile>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await getAllProductProfiles();
      setProfiles(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load product profiles');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter((p) => {
      if (filter !== 'all' && p.productionSection !== filter) return false;
      if (speciesFilter !== 'all' && p.species !== speciesFilter) return false;
      if (processFilter !== 'all' && p.processType !== processFilter) return false;
      if (activeFilter === 'active' && !p.active) return false;
      if (activeFilter === 'inactive' && p.active) return false;
      if (!q) return true;
      return (
        p.productName.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q)
      );
    });
  }, [profiles, filter, speciesFilter, processFilter, activeFilter, query]);

  function beginEdit(p: ProductProfile) {
    setEditingId(p.id);
    setEditDraft({
      productName: p.productName,
      estimatedCookTimeHours: p.estimatedCookTimeHours,
      estimatedChillTimeHours: p.estimatedChillTimeHours,
      estimatedBlastCellHours: p.estimatedBlastCellHours,
      rackCapacity: p.rackCapacity,
      probeOutTemp: p.probeOutTemp,
      shelfLifeDays: p.shelfLifeDays,
    });
  }

  async function commitEdit(p: ProductProfile) {
    if (!editingId) return;
    try {
      await updateProductProfile(editingId, editDraft);
      setEditingId(null);
      setEditDraft({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  }

  return (
    <C3SScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <C3SPage>
        <C3SScreenHeader
          title="Product Intelligence"
          subtitle="Operational rules engine — cook, chill, blast cell, capacity"
          right={
            <Pressable style={styles.backBtn} onPress={() => router.back()}>
              <Text style={styles.backBtnText}>Back</Text>
            </Pressable>
          }
        />

        {/* Filter / search bar */}
        <View style={styles.toolbar}>
          <View style={styles.filterRow}>
            <FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
            {PRODUCTION_SECTION_ORDER.map((s) => (
              <FilterChip
                key={s}
                label={PRODUCTION_SECTION_LABELS[s]}
                active={filter === s}
                onPress={() => setFilter(s)}
              />
            ))}
          </View>
          <View style={styles.filterRow}>
            <FilterChip label="All Species" active={speciesFilter === 'all'} onPress={() => setSpeciesFilter('all')} />
            <FilterChip label="Pork" active={speciesFilter === 'pork'} onPress={() => setSpeciesFilter('pork')} />
            <FilterChip label="Beef" active={speciesFilter === 'beef'} onPress={() => setSpeciesFilter('beef')} />
            <FilterChip label="Poultry" active={speciesFilter === 'poultry'} onPress={() => setSpeciesFilter('poultry')} />
            <FilterChip label="Mixed" active={speciesFilter === 'mixed'} onPress={() => setSpeciesFilter('mixed')} />
          </View>
          <View style={styles.filterRow}>
            <FilterChip label="All Process" active={processFilter === 'all'} onPress={() => setProcessFilter('all')} />
            <FilterChip label="Cured" active={processFilter === 'cured'} onPress={() => setProcessFilter('cured')} />
            <FilterChip label="Uncured" active={processFilter === 'uncured'} onPress={() => setProcessFilter('uncured')} />
            <FilterChip label="All Active" active={activeFilter === 'all'} onPress={() => setActiveFilter('all')} />
            <FilterChip label="Active" active={activeFilter === 'active'} onPress={() => setActiveFilter('active')} />
            <FilterChip label="Inactive" active={activeFilter === 'inactive'} onPress={() => setActiveFilter('inactive')} />
          </View>
          <TextInput
            placeholder="Search code or name…"
            placeholderTextColor={C3S_COLORS.textMuted}
            value={query}
            onChangeText={setQuery}
            style={styles.search}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isLoading ? (
          <View style={styles.center}><ActivityIndicator color={C3S_COLORS.accent} /></View>
        ) : filtered.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.empty}>
              No product profiles yet. Run `npm run seed:product-profiles` to load the master list.
            </Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24, gap: 6 }}>
            {/* Column header */}
            <View style={[styles.row, styles.headerRow]}>
              <Text style={[styles.cellCode, styles.headerCell]}>CODE</Text>
              <Text style={[styles.cellName, styles.headerCell]}>PRODUCT</Text>
              <Text style={[styles.cellSm, styles.headerCell]}>SECTION</Text>
              <Text style={[styles.cellSm, styles.headerCell]}>COOK</Text>
              <Text style={[styles.cellSm, styles.headerCell]}>CHILL</Text>
              <Text style={[styles.cellSm, styles.headerCell]}>BLAST</Text>
              <Text style={[styles.cellXs, styles.headerCell]}>RACKS</Text>
              <Text style={[styles.cellXs, styles.headerCell]}>SHELF</Text>
              <Text style={[styles.cellXs, styles.headerCell]}>PROBE</Text>
            </View>

            {filtered.map((p) => {
              const isEditing = editingId === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => (isEditing ? null : beginEdit(p))}
                  style={[styles.row, !p.active && styles.rowInactive]}>
                  <Text style={styles.cellCode}>{p.productCode}</Text>
                  <Text style={styles.cellName} numberOfLines={1}>{p.productName}</Text>
                  <Text style={styles.cellSm}>
                    {p.productionSection ? PRODUCTION_SECTION_LABELS[p.productionSection] : '—'}
                  </Text>
                  {isEditing ? (
                    <>
                      <CellInput
                        value={String(editDraft.estimatedCookTimeHours ?? '')}
                        onChange={(v) => setEditDraft((d) => ({ ...d, estimatedCookTimeHours: Number(v) || 0 }))}
                      />
                      <CellInput
                        value={String(editDraft.estimatedChillTimeHours ?? '')}
                        onChange={(v) => setEditDraft((d) => ({ ...d, estimatedChillTimeHours: Number(v) || 0 }))}
                      />
                      <CellInput
                        value={String(editDraft.estimatedBlastCellHours ?? '')}
                        onChange={(v) => setEditDraft((d) => ({ ...d, estimatedBlastCellHours: Number(v) || 0 }))}
                      />
                      <CellInput
                        value={String(editDraft.rackCapacity ?? '')}
                        onChange={(v) => setEditDraft((d) => ({ ...d, rackCapacity: Number(v) || 0 }))}
                        narrow
                      />
                      <CellInput
                        value={String(editDraft.shelfLifeDays ?? '')}
                        onChange={(v) => setEditDraft((d) => ({ ...d, shelfLifeDays: Number(v) || 0 }))}
                        narrow
                      />
                      <CellInput
                        value={String(editDraft.probeOutTemp ?? '')}
                        onChange={(v) => setEditDraft((d) => ({ ...d, probeOutTemp: Number(v) || 0 }))}
                        narrow
                      />
                    </>
                  ) : (
                    <>
                      <Text style={styles.cellSm}>{formatHours(p.estimatedCookTimeHours)}</Text>
                      <Text style={styles.cellSm}>
                        {p.estimatedChillTimeHours > 0 ? formatHours(p.estimatedChillTimeHours) : 'NA'}
                      </Text>
                      <Text style={styles.cellSm}>
                        {p.estimatedBlastCellHours > 0 ? formatHours(p.estimatedBlastCellHours) : 'NA'}
                      </Text>
                      <Text style={styles.cellXs}>{p.rackCapacity || '—'}</Text>
                      <Text style={styles.cellXs}>{p.shelfLifeDays}d</Text>
                      <Text style={styles.cellXs}>{p.probeOutTemp}°</Text>
                    </>
                  )}
                  {isEditing && (
                    <View style={styles.editActions}>
                      <Pressable style={[styles.miniBtn, styles.miniBtnPrimary]} onPress={() => commitEdit(p)}>
                        <Text style={styles.miniBtnText}>Save</Text>
                      </Pressable>
                      <Pressable
                        style={styles.miniBtn}
                        onPress={() => { setEditingId(null); setEditDraft({}); }}>
                        <Text style={styles.miniBtnText}>Cancel</Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </C3SPage>
    </C3SScreen>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CellInput({ value, onChange, narrow }: { value: string; onChange: (v: string) => void; narrow?: boolean }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      keyboardType="numeric"
      style={[styles.cellInput, narrow && styles.cellInputNarrow]}
    />
  );
}

const styles = StyleSheet.create({
  backBtn: {
    backgroundColor: C3S_COLORS.panelAlt,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    borderRadius: C3S_RADIUS.button,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtnText: { color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '700' },
  toolbar: {
    gap: 8,
    marginBottom: 10,
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: C3S_RADIUS.chip,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
  },
  chipActive: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  chipText: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: C3S_COLORS.textStrong },
  search: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    color: C3S_COLORS.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: C3S_RADIUS.button,
    fontSize: 14,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  empty: { color: C3S_COLORS.textMuted, fontSize: 13, textAlign: 'center', maxWidth: 380 },
  error: { color: C3S_COLORS.danger, fontSize: 13, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: C3S_COLORS.border,
    gap: 4,
    flexWrap: 'wrap',
  },
  rowInactive: { opacity: 0.4 },
  headerRow: {
    borderBottomWidth: 2,
    borderBottomColor: C3S_COLORS.accent,
    backgroundColor: C3S_COLORS.panelAlt,
  },
  headerCell: {
    color: C3S_COLORS.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cellCode: { width: 70, color: C3S_COLORS.textStrong, fontFamily: 'Menlo', fontSize: 12, fontWeight: '700' },
  cellName: { flex: 1, minWidth: 140, color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
  cellSm: { width: 90, color: C3S_COLORS.textPrimary, fontSize: 12 },
  cellXs: { width: 56, color: C3S_COLORS.textPrimary, fontSize: 12 },
  cellInput: {
    width: 90,
    borderWidth: 1,
    borderColor: C3S_COLORS.accent,
    color: C3S_COLORS.textStrong,
    backgroundColor: C3S_COLORS.bg,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
    fontSize: 12,
  },
  cellInputNarrow: { width: 56 },
  editActions: { flexDirection: 'row', gap: 6, marginTop: 6, width: '100%' },
  miniBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panelAlt,
  },
  miniBtnPrimary: { backgroundColor: '#1565C0', borderColor: '#1565C0' },
  miniBtnText: { color: C3S_COLORS.textStrong, fontSize: 12, fontWeight: '700' },
});
