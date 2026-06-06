import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Timestamp } from 'firebase/firestore';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import { normalizePrepStatus, prepStatusLabel } from '@/lib/flow/status';
import {
  getActiveProductProfiles,
  type ProductProfile,
} from '@/lib/products';
import {
  getSmokehouses,
  createPrepQueueItem,
  deletePrepQueueItem,
  markPrepQueueItemReady,
  markReadyForThermal,
  movePrepDownstream,
  startPrep,
  holdPrepItem,
  getWeeklyPlanItems,
  type SmokehouseItem,
  type WeeklyPlanItem,
} from '@/lib/firebase/repository';
import {
  getOperationalItems,
  oItemAdvanceRTCStatus,
  oItemCreateManual,
  type OItemItem,
} from '@/lib/operational-items';

// Session-level operator identity cache
let _sessionCreatedBy = '';

const statusColors: Record<string, string> = {
  staging: '#90A4AE',
  ready: '#66BB6A',
  assigned: '#42A5F5',
  cooking: '#FB8C00',
  awaiting_chill: '#26A69A',
  staged: '#90A4AE',
  prepping: '#FFB74D',
  ready_for_thermal: '#66BB6A',
  in_thermal: '#42A5F5',
  moved_downstream: '#29B6F6',
  hold: '#EF5350',
  complete: '#43A047',
  packaging_complete: '#43A047',
};

function prepDisplayName(item: OItemItem) {
  return item.productNameSnapshot || item.productName || 'Unknown Product';
}

function statusLabel(status: OItemItem['status']) {
  const legacy = status as
    | 'staging' | 'staged' | 'prepping' | 'ready' | 'ready_for_thermal'
    | 'in_thermal' | 'moved_downstream' | 'assigned' | 'cooking'
    | 'awaiting_chill' | 'hold';
  if ([
    'staging', 'staged', 'prepping', 'ready', 'ready_for_thermal',
    'in_thermal', 'moved_downstream', 'assigned', 'cooking', 'awaiting_chill', 'hold',
  ].includes(status)) {
    return prepStatusLabel(legacy);
  }
  return status.replace(/_/g, ' ');
}

const rtcTrailSteps = ['Planning', 'RTC', 'Prep', 'Ready for Thermal', 'Thermal'] as const;

function rtcTrailActiveStep(status: OItemItem['status']): number {
  if (status === 'staged' || status === 'staging') return 1;
  if (status === 'prepping') return 2;
  if (status === 'ready_for_thermal' || status === 'ready') return 3;
  if (status === 'assigned' || status === 'cooking' || status === 'in_thermal' || status === 'moved_downstream' || status === 'awaiting_chill') return 4;
  if (status === 'hold') return 2;
  return 1;
}

export default function PrepQueueScreen() {
  const [oItems, setOItems] = useState<OItemItem[]>([]);
  const [smokehouses, setSmokehouses] = useState<SmokehouseItem[]>([]);
  const [profiles, setProfiles] = useState<ProductProfile[]>([]);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlanItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Actions feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [markingReadyId, setMarkingReadyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Create Prep form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [createRacks, setCreateRacks] = useState('1');
  const [createPieces, setCreatePieces] = useState('1');
  const [createPoNumber, setCreatePoNumber] = useState('');
  const [createMakeDate, setCreateMakeDate] = useState('');
  const [createDeliveryDate, setCreateDeliveryDate] = useState('');
  const [createBy, setCreateBy] = useState(_sessionCreatedBy);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const results = await Promise.allSettled([
      getOperationalItems(),
      getSmokehouses(),
      getActiveProductProfiles(),
      getWeeklyPlanItems(),
    ]);
    const [oR, shR, profR, planR] = results;
    if (oR.status === 'fulfilled') {
      // Show RTC + thermal items (thermal items appear in "Moved Downstream" section)
      const visible = oR.value.filter(
        (i) => i.stage === 'rtc' || i.stage === 'thermal',
      );
      setOItems(visible);
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[RTC] loaded operational_items (rtc+thermal)', visible.map((i) => ({
          id: i.id, prepQueueId: i.prepQueueId, stage: i.stage, status: i.status,
          productName: i.productName,
        })));
      }
    }
    if (shR.status === 'fulfilled') setSmokehouses(shR.value);
    if (profR.status === 'fulfilled') setProfiles(profR.value);
    if (planR.status === 'fulfilled') setWeeklyPlans(planR.value);
    const firstFail = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstFail) {
      logFirebaseError('RTCQueue', 'operational_items/smokehouses/product_profiles/weekly_plan', firstFail.reason);
      setLoadError(toOperatorMessage(firstFail.reason, 'Unable to load RTC queue data from Firestore.'));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const smokehouseByName = useMemo(
    () => smokehouses.reduce<Record<string, SmokehouseItem>>((map, s) => { map[s.name] = s; return map; }, {}),
    [smokehouses],
  );

  // With operational_items, items in downstream stages won't appear here.
  // The only "locked" items are those whose stage has advanced beyond thermal.
  const downstreamLockedPrepIds = useMemo(() => new Set<string>(), []);

  const orderedPrepItems = useMemo(
    () => [...oItems].sort(
      (a, b) => (b.startTime?.toMillis?.() ?? 0) - (a.startTime?.toMillis?.() ?? 0),
    ),
    [oItems],
  );

  const selectedProduct = profiles.find((p) => p.id === selectedProductId) ?? null;
  const filteredProfiles = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => `${p.productCode} ${p.productName}`.toLowerCase().includes(q));
  }, [profiles, productSearch]);
  const planById = useMemo(
    () => weeklyPlans.reduce<Record<string, WeeklyPlanItem>>((map, p) => { map[p.id] = p; return map; }, {}),
    [weeklyPlans],
  );
  // Alias helper: resolve plan by weeklyPlanId (OItemDoc) or sourcePlanId (legacy compat)
  function getPlanForItem(item: OItemItem) {
    return (item.weeklyPlanId ? planById[item.weeklyPlanId] : undefined)
        ?? (item.sourcePlanId ? planById[item.sourcePlanId] : undefined);
  }

  // ── Mark Ready ──
  async function onMarkReady(item: OItemItem) {
    setActionError(null);
    setActionSuccess(null);
    try {
      setMarkingReadyId(item.id);
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[RTC->Thermal][MarkReady] start', {
          oItemId: item.id,
          prepQueueId: item.prepQueueId ?? null,
          currentStage: item.stage,
          currentStatus: item.status,
          nextStage: 'thermal',
          nextStatus: 'ready_for_thermal',
        });
      }
      const prepId = item.prepQueueId;
      if (prepId) {
        if (item.status === 'staging' || item.status === 'staged') await markPrepQueueItemReady(prepId);
        else await markReadyForThermal(prepId);
      }
      await oItemAdvanceRTCStatus(item.id, item.stage, item.status, 'ready_for_thermal');
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[RTC->Thermal][MarkReady] success', {
          oItemId: item.id,
          prepQueueId: item.prepQueueId ?? null,
          finalStage: 'thermal',
          finalStatus: 'ready_for_thermal',
        });
      }
      setActionSuccess(`${prepDisplayName(item)} marked Ready for Thermal.`);
      await loadData();
    } catch (error) {
      if (__DEV__) {
        const e = error as { code?: string; message?: string };
        // eslint-disable-next-line no-console
        console.error('[RTC->Thermal][MarkReady] failed', {
          oItemId: item.id,
          prepQueueId: item.prepQueueId ?? null,
          currentStage: item.stage,
          currentStatus: item.status,
          nextStage: 'thermal',
          nextStatus: 'ready_for_thermal',
          firebaseCode: e?.code ?? null,
          firebaseMessage: e?.message ?? String(error),
        });
      }
      setActionError(toOperatorMessage(error, 'Failed to mark prep item ready.'));
    } finally {
      setMarkingReadyId(null);
    }
  }

  async function onStartPrep(item: OItemItem) {
    setActionError(null);
    setActionSuccess(null);
    try {
      if (item.prepQueueId) await startPrep(item.prepQueueId);
      await oItemAdvanceRTCStatus(item.id, item.stage, item.status, 'prepping');
      setActionSuccess(`${prepDisplayName(item)} moved to In Prep.`);
      await loadData();
    } catch (error) {
      setActionError(toOperatorMessage(error, 'Failed to start prep.'));
    }
  }

  async function onMoveDownstream(item: OItemItem) {
    setActionError(null);
    setActionSuccess(null);
    try {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[RTC->Thermal][MovedDownstream] start', {
          oItemId: item.id,
          prepQueueId: item.prepQueueId ?? null,
          currentStage: item.stage,
          currentStatus: item.status,
          nextStage: 'thermal',
          nextStatus: 'ready_for_thermal',
        });
      }
      // Legacy compatibility: promote prep_queue row into thermal-ready state.
      // This keeps old queries consistent and avoids invalid OItem transition prep->moved_downstream.
      if (item.prepQueueId) {
        await markReadyForThermal(item.prepQueueId);
      } else {
        throw new Error('Missing prepQueueId for downstream handoff.');
      }
      await oItemAdvanceRTCStatus(item.id, item.stage, item.status, 'ready_for_thermal');
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[RTC->Thermal][MovedDownstream] success', {
          oItemId: item.id,
          prepQueueId: item.prepQueueId ?? null,
          finalStage: 'thermal',
          finalStatus: 'ready_for_thermal',
        });
      }
      setActionSuccess(`${prepDisplayName(item)} moved to Thermal queue.`);
      await loadData();
    } catch (error) {
      if (__DEV__) {
        const e = error as { code?: string; message?: string };
        // eslint-disable-next-line no-console
        console.error('[RTC->Thermal][MovedDownstream] failed', {
          oItemId: item.id,
          prepQueueId: item.prepQueueId ?? null,
          currentStage: item.stage,
          currentStatus: item.status,
          nextStage: 'thermal',
          nextStatus: 'ready_for_thermal',
          firebaseCode: e?.code ?? null,
          firebaseMessage: e?.message ?? String(error),
        });
      }
      setActionError(toOperatorMessage(error, 'Failed to move item downstream.'));
    }
  }

  async function onHold(item: OItemItem) {
    setActionError(null);
    setActionSuccess(null);
    try {
      if (item.prepQueueId) await holdPrepItem(item.prepQueueId, 'Placed on hold by RTC');
      await oItemAdvanceRTCStatus(item.id, item.stage, item.status, 'hold');
      setActionSuccess(`${prepDisplayName(item)} placed on hold.`);
      await loadData();
    } catch (error) {
      setActionError(toOperatorMessage(error, 'Failed to hold prep item.'));
    }
  }

  // ── Delete / Remove ──
  function onDeleteTap(item: OItemItem) {
    Alert.alert(
      'Remove Prep Item',
      `Remove "${prepDisplayName(item)}" from the queue?\n\nThis is permanent and cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setActionError(null);
            setActionSuccess(null);
            setDeletingId(item.id);
            try {
              if (item.prepQueueId) await deletePrepQueueItem(item.prepQueueId);
              setActionSuccess(`${prepDisplayName(item)} removed from queue.`);
              await loadData();
            } catch (error) {
              setActionError(toOperatorMessage(error, 'Failed to remove prep item.'));
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
  }

  // ── Create Prep ──
  async function onCreatePrep() {
    setCreateError(null);
    const trimBy = createBy.trim() || 'RTC Operator';
    const trimPo = createPoNumber.trim();
    const trimMake = createMakeDate.trim();
    const trimDelivery = createDeliveryDate.trim();
    const parsedRacks = parseInt(createRacks, 10);
    const parsedPieces = parseInt(createPieces, 10);

    if (!selectedProduct) { setCreateError('Select a product.'); return; }
    if (!trimPo) { setCreateError('PO number is required.'); return; }
    if (!trimMake) { setCreateError('Make date is required (e.g. 2026-05-01).'); return; }
    if (!trimDelivery) { setCreateError('Delivery date is required.'); return; }
    if (isNaN(parsedRacks) || parsedRacks < 1) { setCreateError('Racks must be a positive number.'); return; }
    if (isNaN(parsedPieces) || parsedPieces < 1) { setCreateError('Pieces must be a positive number.'); return; }

    setIsCreating(true);
    try {
      const newPrepId = await createPrepQueueItem({
        productId: selectedProduct.id,
        productName: selectedProduct.productName,
        productNameSnapshot: selectedProduct.productName,
        productCodeSnapshot: selectedProduct.productCode,
        productCode: selectedProduct.productCode,
        processOrder: trimPo,
        racks: parsedRacks,
        pieces: parsedPieces,
        plannedDate: trimMake,
        poNumber: trimPo,
        deliveryDate: trimDelivery,
        makeDate: trimMake,
        status: 'staged',
        startTime: Timestamp.now(),
        createdBy: trimBy,
        assignedSmokehouse: null,
        cookType: selectedProduct.processType,
        targetTemp: 0,
        expectedCookMinutes: Math.round(selectedProduct.estimatedCookTimeHours * 60),
        expectedChillMinutes: Math.round(selectedProduct.estimatedChillTimeHours * 60),
        expectedPackMinutes: 30,
        rackType: 'Standard',
        species: selectedProduct.species,
        criticalLimit: selectedProduct.criticalLimit,
        expectedCookComplete: '',
        expectedChillComplete: '',
        expectedBlastCellComplete: '',
        packagingReadyETA: '',
        packagingType: 'Standard',
        thermalOwner: '',
        department: 'manual',
      });
      // Also create an operational_items doc for this manually-entered prep.
      // oItemCreateManual reads the prep doc and builds the OItem record.
      await oItemCreateManual(newPrepId);

      // Reset form
      setSelectedProductId('');
      setProductSearch('');
      setCreateRacks('1');
      setCreatePieces('1');
      setCreatePoNumber('');
      setCreateMakeDate('');
      setCreateDeliveryDate('');
      setShowCreateForm(false);
      setActionSuccess('Prep item created and added to staging queue.');
      await loadData();
    } catch (error) {
      setCreateError(toOperatorMessage(error, 'Failed to create prep item.'));
    } finally {
      setIsCreating(false);
    }
  }

  const sectionedItems = useMemo(() => {
    const prep = orderedPrepItems.filter((i) => i.status === 'prepping');
    const ready = orderedPrepItems.filter((i) => i.status === 'ready_for_thermal' || i.status === 'ready');
    const hold = orderedPrepItems.filter((i) => i.status === 'hold');
    const moved = orderedPrepItems.filter((i) => i.status === 'moved_downstream' || i.status === 'in_thermal' || i.status === 'assigned' || i.status === 'cooking' || i.status === 'awaiting_chill');

    const assignedElsewhere = new Set<string>([
      ...prep.map((i) => i.id),
      ...ready.map((i) => i.id),
      ...hold.map((i) => i.id),
      ...moved.map((i) => i.id),
    ]);

    // Planning-origin/staged items should surface in "Sent from Planning"
    // even when legacy docs have inconsistent stage/status combinations.
    const sent = orderedPrepItems.filter((i) => {
      if (assignedElsewhere.has(i.id)) return false;
      return i.status === 'staged' || i.status === 'staging' || i.stage === 'rtc' || Boolean(i.sourcePlanId);
    });

    const assignedIds = new Set<string>([
      ...assignedElsewhere,
      ...sent.map((i) => i.id),
    ]);
    const uncategorized = orderedPrepItems.filter((i) => !assignedIds.has(i.id));

    return { sent, prep, ready, hold, moved, uncategorized };
  }, [orderedPrepItems]);
  const stagingCount = sectionedItems.sent.length;
  const prepCount = sectionedItems.prep.length;
  const readyCount = sectionedItems.ready.length;
  const movedCount = sectionedItems.moved.length;
  const holdCount = sectionedItems.hold.length;

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader
          title="RTC Queue"
          subtitle={`Sent from Planning: ${stagingCount}`}
          right={(
            <Pressable style={styles.refreshBtn} onPress={loadData}>
              <Text style={styles.refreshBtnText}>Refresh</Text>
            </Pressable>
          )}
        />

        {/* ── Summary Pills ── */}
        <View style={styles.summaryRow}>
          <View style={[styles.summaryPill, { borderColor: '#90A4AE' }]}>
            <Text style={[styles.summaryCount, { color: '#CFD8DC' }]}>{stagingCount}</Text>
            <Text style={[styles.summaryLabel, { color: '#90A4AE' }]}>Sent from Planning</Text>
          </View>
          <View style={[styles.summaryPill, { borderColor: '#66BB6A' }]}>
            <Text style={[styles.summaryCount, { color: '#FFD180' }]}>{prepCount}</Text>
            <Text style={[styles.summaryLabel, { color: '#FFB74D' }]}>In Prep</Text>
          </View>
          <View style={[styles.summaryPill, { borderColor: '#FB8C00' }]}>
            <Text style={[styles.summaryCount, { color: '#A5D6A7' }]}>{readyCount}</Text>
            <Text style={[styles.summaryLabel, { color: '#66BB6A' }]}>Ready for Thermal</Text>
          </View>
          <View style={[styles.summaryPill, { borderColor: '#29B6F6' }]}>
            <Text style={[styles.summaryCount, { color: '#81D4FA' }]}>{movedCount}</Text>
            <Text style={[styles.summaryLabel, { color: '#29B6F6' }]}>Moved Downstream</Text>
          </View>
          <View style={[styles.summaryPill, { borderColor: '#EF5350' }]}>
            <Text style={[styles.summaryCount, { color: '#FFAB91' }]}>{holdCount}</Text>
            <Text style={[styles.summaryLabel, { color: '#EF5350' }]}>Hold</Text>
          </View>
        </View>

        {/* ── Create Prep Toggle ── */}
        <View style={styles.createToggleRow}>
          <Text style={styles.createToggleLabel}>Manual Prep Entry (Secondary)</Text>
          <Pressable
            style={[styles.createToggleButton, showCreateForm && styles.createToggleButtonActive]}
            onPress={() => {
              setCreateError(null);
              setShowCreateForm((v) => !v);
            }}>
            <Text style={styles.createToggleText}>{showCreateForm ? '✕ Close' : '+ Open Manual Prep Entry'}</Text>
          </Pressable>
        </View>

        {/* ── Create Prep Form ── */}
        {showCreateForm ? (
          <C3SCard borderColor="#42A5F5">
            <Text style={styles.formTitle}>Manual Prep Entry</Text>

            {/* Creator */}
            <Text style={styles.fieldLabel}>Created By</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="Your name"
              placeholderTextColor="#6E7681"
              value={createBy}
              onChangeText={(v) => { setCreateBy(v); _sessionCreatedBy = v; }}
              autoCorrect={false}
              autoCapitalize="words"
            />

            {/* Product selection */}
            <Text style={styles.fieldLabel}>Product</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="Search product code or name"
              placeholderTextColor="#6E7681"
              value={productSearch}
              onChangeText={setProductSearch}
              autoCorrect={false}
            />
            {profiles.length === 0 ? (
              <Text style={styles.fieldHint}>No products loaded. Run npm run seed:product-profiles.</Text>
            ) : (
              <View style={styles.chipWrap}>
                {filteredProfiles.map((p) => {
                  const active = selectedProductId === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setSelectedProductId(p.id)}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.productCode} {p.productName}</Text>
                      {active ? (
                        <Text style={styles.chipDetailText}>
                          {p.species} · {p.processType} · CL {p.criticalLimit}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
            {selectedProduct ? (
              <Text style={styles.fieldHint}>
                Rack Cap {selectedProduct.rackCapacity} · Cook {selectedProduct.estimatedCookTimeHours}h · Chill {selectedProduct.estimatedChillTimeHours}h · Blast {selectedProduct.estimatedBlastCellHours}h
              </Text>
            ) : null}

            {/* PO / Dates */}
            <Text style={styles.fieldLabel}>PO Number</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. PO-20260501"
              placeholderTextColor="#6E7681"
              value={createPoNumber}
              onChangeText={setCreatePoNumber}
              autoCorrect={false}
              autoCapitalize="characters"
            />

            <View style={styles.inlineRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Make Date</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#6E7681"
                  value={createMakeDate}
                  onChangeText={setCreateMakeDate}
                  keyboardType="numbers-and-punctuation"
                  autoCorrect={false}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Delivery Date</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#6E7681"
                  value={createDeliveryDate}
                  onChangeText={setCreateDeliveryDate}
                  keyboardType="numbers-and-punctuation"
                  autoCorrect={false}
                />
              </View>
            </View>

            <View style={styles.inlineRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Racks</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="1"
                  placeholderTextColor="#6E7681"
                  value={createRacks}
                  onChangeText={setCreateRacks}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Pieces</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="1"
                  placeholderTextColor="#6E7681"
                  value={createPieces}
                  onChangeText={setCreatePieces}
                  keyboardType="numeric"
                />
              </View>
            </View>

            {createError ? <Text style={styles.errorText}>{createError}</Text> : null}

            <Pressable
              style={[styles.createSubmitButton, isCreating && styles.createSubmitDisabled]}
              disabled={isCreating}
              onPress={onCreatePrep}>
              <Text style={styles.createSubmitText}>{isCreating ? 'Creating…' : 'Create Prep Item'}</Text>
            </Pressable>
          </C3SCard>
        ) : null}

        {/* ── Action feedback ── */}
        {actionSuccess ? (
          <C3SCard borderColor="#66BB6A">
            <Text style={styles.successText}>{actionSuccess}</Text>
          </C3SCard>
        ) : null}
        {actionError ? (
          <C3SCard borderColor="#EF5350">
            <Text style={styles.errorText}>{actionError}</Text>
          </C3SCard>
        ) : null}

        {/* ── Queue List ── */}
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <C3SCard>
              <Text style={styles.infoText}>Loading Firestore prep queue…</Text>
            </C3SCard>
          ) : loadError ? (
            <C3SCard borderColor="#EF5350">
              <Text style={styles.errorText}>{loadError}</Text>
              <Pressable style={styles.retryButton} onPress={loadData}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </C3SCard>
          ) : orderedPrepItems.length === 0 ? (
            <C3SCard>
              <Text style={styles.emptyTitle}>No Prep Items</Text>
              <Text style={styles.emptySub}>Create the first prep item using the button above.</Text>
            </C3SCard>
          ) : null}

          {!isLoading && !loadError
            ? ([
              { key: 'sent', title: 'Sent from Planning', items: sectionedItems.sent },
              { key: 'prep', title: 'In Prep', items: sectionedItems.prep },
              { key: 'ready', title: 'Ready for Thermal', items: sectionedItems.ready },
              { key: 'hold', title: 'Hold', items: sectionedItems.hold },
              { key: 'moved', title: 'Moved Downstream', items: sectionedItems.moved },
              ...(__DEV__ ? [{ key: 'uncategorized', title: 'Uncategorized RTC Items (DEV)', items: sectionedItems.uncategorized }] : []),
            ] as const).map((section) => (
              <View key={section.key} style={{ gap: 8 }}>
                <Text style={styles.sectionLabel}>{section.title}</Text>
                {section.items.length === 0 ? <Text style={styles.emptySub}>—</Text> : null}
                {section.items.map((item) => {
                const linkedSmokehouse = item.assignedSmokehouse
                  ? smokehouseByName[item.assignedSmokehouse] ?? null
                  : null;
                const isDownstreamLocked = downstreamLockedPrepIds.has(item.id);
                const plan = getPlanForItem(item);
                const sourceLabel = (item.weeklyPlanId || item.sourcePlanId) ? 'From Weekly Plan' : 'Manual Entry';
                const activeTrailStep = rtcTrailActiveStep(item.status);

                let nextAction = 'Monitor stage progress.';
                if (isDownstreamLocked) {
                  nextAction = 'Moved downstream — no RTC action required.';
                } else if (item.status === 'staging') {
                  nextAction = 'Mark Ready for Thermal when RTC prep checks are complete.';
                } else if (item.status === 'ready') {
                  nextAction = 'Ready for Thermal — assign smokehouse on the Thermal tab.';
                } else if (item.status === 'assigned') {
                  nextAction = 'Awaiting Cook Start — start cook on the Thermal tab.';
                } else if (item.status === 'cooking') {
                  nextAction = 'Cook In Progress — monitor on Thermal tab.';
                } else if (item.status === 'awaiting_chill') {
                  nextAction = 'Cook Complete — assign to chiller on the Chill tab.';
                }

                const isStaging = item.status === 'staging' || item.status === 'staged';
                const isPrepping = normalizePrepStatus(item.status as 'staging' | 'staged' | 'prepping' | 'ready' | 'ready_for_thermal' | 'in_thermal' | 'moved_downstream' | 'assigned' | 'cooking' | 'awaiting_chill' | 'hold') === 'prepping';
                const canMarkReady = (isStaging || isPrepping) && !isDownstreamLocked;
                const canDelete = isStaging && !isDownstreamLocked;

                return (
                  <C3SCard key={item.id} borderColor={statusColors[item.status]}>
                    <View style={styles.cardTopRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.productText}>{prepDisplayName(item)}</Text>
                        <Text style={styles.sourceTag}>{sourceLabel}</Text>
                        {item.hasDeviation ? <Text style={styles.emptySub}>⚠ Deviation Recorded</Text> : null}
                      </View>
                      <View style={[styles.badge, { backgroundColor: statusColors[item.status] }]}>
                        <Text style={styles.badgeText}>{statusLabel(item.status)}</Text>
                      </View>
                    </View>

                    <View style={styles.row}><Text style={styles.label}>PO Number</Text><Text style={styles.value}>{item.poNumber}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Product Code</Text><Text style={styles.value}>{item.productCodeSnapshot ?? item.productCode ?? '—'}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Process Order</Text><Text style={styles.value}>{item.processOrder ?? item.poNumber ?? '—'}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Cases</Text><Text style={styles.value}>{item.cases ?? 0}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Racks / Pieces</Text><Text style={styles.value}>{item.racks} racks / {item.pieces} pcs</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Planned Date</Text><Text style={styles.value}>{item.plannedDate ?? item.makeDate ?? '—'}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Department</Text><Text style={styles.value}>{item.department ?? 'RTC'}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Target Smokehouse</Text><Text style={styles.value}>{item.targetSmokehouseId ?? item.assignedSmokehouse ?? '—'}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Target Chiller</Text><Text style={styles.value}>{item.targetChillerId ?? '—'}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Forecast Cook Complete</Text><Text style={styles.value}>{item.expectedCookComplete || '—'}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Forecast Chill Complete</Text><Text style={styles.value}>{item.expectedChillComplete || '—'}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Packaging ETA</Text><Text style={styles.value}>{item.packagingReadyETA || '—'}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Linked Plan Status</Text><Text style={styles.value}>{plan?.status ?? '—'}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Make Date</Text><Text style={styles.value}>{item.makeDate}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Delivery Date</Text><Text style={styles.value}>{item.deliveryDate}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Cook Type</Text><Text style={styles.value}>{item.cookType}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Target Temp</Text><Text style={styles.value}>{item.targetTemp}°F</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Expected Cook</Text><Text style={styles.value}>{item.expectedCookMinutes} min</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Smokehouse</Text><Text style={styles.value}>{item.assignedSmokehouse ?? 'Unassigned'}{linkedSmokehouse ? ` [${linkedSmokehouse.status}]` : ''}</Text></View>
                    <View style={styles.row}><Text style={styles.label}>Next Step</Text><Text style={[styles.value, { color: '#81D4FA' }]}>{nextAction}</Text></View>
                    <View style={styles.trailRow}>
                      {rtcTrailSteps.map((step, idx) => {
                        const active = idx <= activeTrailStep;
                        return (
                          <View key={`${item.id}-${step}`} style={[styles.trailChip, active && styles.trailChipActive]}>
                            <Text style={[styles.trailChipText, active && styles.trailChipTextActive]}>{step}</Text>
                          </View>
                        );
                      })}
                    </View>

                    {/* Actions */}
                    {canMarkReady || canDelete || isStaging || isPrepping ? (
                      <View style={styles.actionsRow}>
                        {isStaging ? (
                          <Pressable style={[styles.actionButton, styles.readyButton]} onPress={() => onStartPrep(item)}>
                            <Text style={styles.actionButtonText}>Start Prep</Text>
                          </Pressable>
                        ) : null}
                        {canMarkReady ? (
                          <Pressable
                            style={[styles.actionButton, styles.readyButton, markingReadyId === item.id && styles.disabledButton]}
                            disabled={markingReadyId === item.id}
                            onPress={() => onMarkReady(item)}>
                            <Text style={styles.actionButtonText}>
                              {markingReadyId === item.id ? 'Marking…' : 'Mark Ready'}
                            </Text>
                          </Pressable>
                        ) : null}
                        {canDelete ? (
                          <Pressable
                            style={[styles.actionButton, styles.deleteButton, deletingId === item.id && styles.disabledButton]}
                            disabled={deletingId === item.id}
                            onPress={() => onDeleteTap(item)}>
                            <Text style={styles.actionButtonText}>
                              {deletingId === item.id ? 'Removing…' : 'Remove'}
                            </Text>
                          </Pressable>
                        ) : null}
                        <Pressable style={[styles.actionButton, styles.deleteButton]} onPress={() => onHold(item)}>
                          <Text style={styles.actionButtonText}>Hold</Text>
                        </Pressable>
                        <Pressable style={[styles.actionButton, styles.readyButton]} onPress={() => onMoveDownstream(item)}>
                          <Text style={styles.actionButtonText}>Moved Downstream</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </C3SCard>
                );
              })}
              </View>
            ))
            : null}

          <View style={{ height: 30 }} />
        </ScrollView>
      </C3SPage>
    </C3SScreen>
  );
}

const styles = StyleSheet.create({
  refreshBtn: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshBtnText: { color: '#E6EDF3', fontSize: 12, fontWeight: '700' },
  // Summary
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  summaryPill: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#151A21',
  },
  summaryCount: {
    fontSize: 22,
    fontWeight: '800',
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionLabel: {
    color: '#8AB4F8',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 8,
  },

  // Create toggle
  createToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  createToggleLabel: {
    color: '#8B949E',
    fontSize: 13,
    fontWeight: '700',
  },
  createToggleButton: {
    borderWidth: 1,
    borderColor: '#2F6D8A',
    backgroundColor: '#13314A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  createToggleButtonActive: {
    borderColor: '#455A64',
    backgroundColor: '#1A2430',
  },
  createToggleText: {
    color: '#E6EDF3',
    fontSize: 13,
    fontWeight: '700',
  },

  // Create form
  formTitle: {
    color: '#81D4FA',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 10,
  },
  fieldLabel: {
    color: '#8B949E',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
    marginTop: 10,
  },
  fieldHint: {
    color: '#6E7681',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 8,
    color: '#E6EDF3',
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 42,
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#151A21',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: {
    borderColor: '#42A5F5',
    backgroundColor: '#0D2040',
  },
  chipText: {
    color: '#AAB4BE',
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#90CAF9',
  },
  chipDetailText: {
    color: '#42A5F5',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  sourceTag: {
    color: '#8B949E',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  trailRow: {
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  trailChip: {
    borderWidth: 1,
    borderColor: '#30363D',
    backgroundColor: '#0D1117',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  trailChipActive: {
    borderColor: '#2F6D8A',
    backgroundColor: '#13314A',
  },
  trailChipText: {
    color: '#6E7681',
    fontSize: 10,
    fontWeight: '700',
  },
  trailChipTextActive: {
    color: '#CDE8FF',
  },
  createSubmitButton: {
    marginTop: 14,
    backgroundColor: '#1565C0',
    borderRadius: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createSubmitDisabled: {
    backgroundColor: '#37474F',
  },
  createSubmitText: {
    color: '#E6EDF3',
    fontSize: 15,
    fontWeight: '800',
  },

  // Action feedback
  successText: {
    color: '#7EE787',
    fontSize: 13,
    fontWeight: '700',
  },
  errorText: {
    color: '#FF7B72',
    fontSize: 13,
    fontWeight: '700',
  },
  infoText: {
    color: '#8B949E',
    fontSize: 13,
    fontWeight: '700',
  },

  // List
  listContent: {
    gap: 10,
    paddingBottom: 18,
  },

  // Cards
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  productText: {
    color: '#F0F6FC',
    fontSize: 18,
    fontWeight: '800',
  },
  ticketId: {
    color: '#9DA7B1',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 26,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  badgeText: {
    color: '#0D1117',
    fontSize: 11,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
    gap: 8,
  },
  label: {
    color: '#9DA7B1',
    fontSize: 13,
    fontWeight: '600',
    minWidth: 120,
  },
  value: {
    color: '#E6EDF3',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyButton: {
    backgroundColor: '#1B5E20',
    borderWidth: 1,
    borderColor: '#2E7D32',
  },
  deleteButton: {
    backgroundColor: '#37474F',
    borderWidth: 1,
    borderColor: '#546E7A',
  },
  disabledButton: {
    opacity: 0.5,
  },
  actionButtonText: {
    color: '#E6EDF3',
    fontSize: 13,
    fontWeight: '800',
  },

  // Empty / retry
  emptyTitle: {
    color: '#E6EDF3',
    fontSize: 15,
    fontWeight: '800',
  },
  emptySub: {
    color: '#9DA7B1',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: '#1E3A5F',
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  retryText: {
    color: '#81D4FA',
    fontSize: 13,
    fontWeight: '800',
  },
});
