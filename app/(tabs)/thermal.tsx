import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { C3SCard, C3SPage, C3SScreen, C3SScreenHeader } from '@/components/c3s-ui';
import { C3SDisclosure, C3SOperatorFocus } from '@/components/operator-ui';
import { StressScenarioBanner } from '@/components/stress-scenario-banner';
import { C3S_COLORS } from '@/constants/c3s-ui';
import {
  getSmokehouses,
  repairStaleSmokehouseOccupancy,
  type SmokehouseItem,
  type ThermalDeviationInput,
} from '@/lib/firebase/repository';
import { logFirebaseError, toOperatorMessage } from '@/lib/auth/diagnostics';
import {
  getOperationalItems,
  oItemAssignAndStartCook,
  oItemAllocateSmokehouseLoad,
  oItemVerifyLoad,
  oItemRecord50Cut,
  oItemRecord130Cut,
  oItemRecordCriticalTemp,
  oItemRecordDuration,
  oItemEvacuateToChill,
  resolveSmokehouseDuplicates,
  type OItemItem,
} from '@/lib/operational-items';
import { toMillis, toSafeDate } from '@/lib/utils/dates';

/** All smokehouse names in the plant. These always render in the grid
 *  regardless of what is seeded in Firestore. */
const ALL_SMOKEHOUSE_NAMES = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'] as const;

// Session-level operator identity cache
let _sessionOnDutyAs = '';

const STATUS_COLOR_READY = C3S_COLORS.success;
const STATUS_COLOR_ASSIGNED = C3S_COLORS.warning;
const STATUS_COLOR_COOKING = C3S_COLORS.danger;
const ACTIVE_SMOKEHOUSE_STATUSES: readonly string[] = [
  'awaiting_cook_start',
  'cooking',
  'cook_in_progress',
  'probe',
  'hold',
];
const COMPRESSION_CAPACITY = 18;
const TREE_CAPACITY = 12;

function smokehouseSetupType(input: SmokehouseItem | null | undefined): 'compression' | 'tree' {
  return input?.setupType === 'tree' ? 'tree' : 'compression';
}

function smokehouseRackCapacity(input: SmokehouseItem | null | undefined): number {
  return smokehouseSetupType(input) === 'tree' ? TREE_CAPACITY : COMPRESSION_CAPACITY;
}

function prepDisplayName(item: OItemItem) {
  return item.productNameSnapshot || item.productName || 'Unknown Product';
}

function elapsedMinutes(ts: unknown): number | null {
  const ms = toMillis(ts);
  if (ms == null) return null;
  return Math.floor((Date.now() - ms) / 60000);
}

function fmtElapsed(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 60) return `${minutes} min elapsed`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m elapsed`;
}

function expectedProgress(elapsedMin: number | null, expectedMin: number): string {
  if (elapsedMin === null || expectedMin <= 0) return '';
  const pct = Math.min(100, Math.round((elapsedMin / expectedMin) * 100));
  return `${pct}% of expected ${expectedMin}m`;
}

function getActiveStep(item: OItemItem): number {
  if (!item.cut50At) return 3;
  if (!item.cut130At) return 4;
  if (!item.criticalTempReachedAt) return 5;
  if (!item.durationRequiredAt) return 6;
  if (!item.evacuationCompletedAt) return 7;
  return 8; // all steps done — evacuation triggers chill handoff
}

function matchesLoadIdentity(currentLoadId: string | null | undefined, item: OItemItem): boolean {
  if (!currentLoadId) return false;
  return currentLoadId === item.id || (item.prepQueueId ? currentLoadId === item.prepQueueId : false);
}

/**
 * True if this item is a staged rack-pool parent that needs splitting into
 * per-smokehouse loads.  A parent is any item whose total racks exceed a
 * single compression house (18), OR that already has partial allocations
 * recorded (allocatedRackCount > 0).
 */
function isRackPoolParent(item: OItemItem): boolean {
  const original = item.originalRackCount ?? item.racks ?? 0;
  const allocated = item.allocatedRackCount ?? 0;
  return original > COMPRESSION_CAPACITY || allocated > 0;
}

export default function ThermalScreen() {
  const params = useLocalSearchParams<{ itemId?: string }>();
  const targetItemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const [oItems, setOItems] = useState<OItemItem[]>([]);
  const [smokehouses, setSmokehouses] = useState<SmokehouseItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Operator identity
  const [onDutyAs, setOnDutyAs] = useState(_sessionOnDutyAs);
  function handleOnDutyChange(v: string) { setOnDutyAs(v); _sessionOnDutyAs = v; }

  // DEV: duplicate cleanup / occupancy repair in-flight flags
  const [resolvingDuplicates, setResolvingDuplicates] = useState(false);
  const [repairingOccupancy, setRepairingOccupancy] = useState(false);

  // Assignment — inline panel (new Assign & Start Cook flow)
  const [expandedAssignPrepId, setExpandedAssignPrepId] = useState<string | null>(null);
  const [assignPanelTemp, setAssignPanelTemp] = useState<Record<string, string>>({});
  const [assignPanelProductTemp, setAssignPanelProductTemp] = useState<Record<string, string>>({});
  const [assignAndStartError, setAssignAndStartError] = useState<Record<string, string>>({});
  const [assignAndStartingId, setAssignAndStartingId] = useState<string | null>(null);
  const [allocatingLoadId, setAllocatingLoadId] = useState<string | null>(null);

  // Assignment — legacy (kept for Section 2 fallback)
  const [selectedSmokeByPrep, setSelectedSmokeByPrep] = useState<Record<string, string>>({});

  // Verify Load
  const [verifyLoadBy, setVerifyLoadBy] = useState<Record<string, string>>({});
  const [verifyLoadError, setVerifyLoadError] = useState<Record<string, string>>({});
  const [verifyingLoadId, setVerifyingLoadId] = useState<string | null>(null);

  // Start Cook
  const [startingTempInput, setStartingTempInput] = useState<Record<string, string>>({});
  const [startCookError, setStartCookError] = useState<Record<string, string>>({});
  const [startingPrepId, setStartingPrepId] = useState<string | null>(null);

  // Cook steps — 50°F Cut inline panel
  const [cut50PanelOpenId, setCut50PanelOpenId] = useState<string | null>(null);
  const [cut50TempInput, setCut50TempInput] = useState<Record<string, string>>({});
  const [cut50Error, setCut50Error] = useState<Record<string, string>>({});
  const [cut50LoadingId, setCut50LoadingId] = useState<string | null>(null);
  // Cook steps — 130°F Cut inline panel
  const [cut130PanelOpenId, setCut130PanelOpenId] = useState<string | null>(null);
  const [cut130TempInput, setCut130TempInput] = useState<Record<string, string>>({});
  const [cut130Error, setCut130Error] = useState<Record<string, string>>({});
  const [cut130LoadingId, setCut130LoadingId] = useState<string | null>(null);
  // Cook steps — duration hold decision
  const [durationLoadingId, setDurationLoadingId] = useState<string | null>(null);
  const [durationError, setDurationError] = useState<Record<string, string>>({});
  // Chill handoff status (evacuation triggers handoff)
  const [handoffError, setHandoffError] = useState<Record<string, string>>({});
  // 3-probe inputs — each item has an array of 3 readings
  const [probeInputs, setProbeInputs] = useState<Record<string, string[]>>({});
  const [critTempVerifiedBy, setCritTempVerifiedBy] = useState<Record<string, string>>({});
  const [critTempError, setCritTempError] = useState<Record<string, string>>({});
  const [recordingCritTempId, setRecordingCritTempId] = useState<string | null>(null);
  const [evacuationError, setEvacuationError] = useState<Record<string, string>>({});
  const [evacuatingPrepId, setEvacuatingPrepId] = useState<string | null>(null);

  // ── Deviation panels ───────────────────────────────────────────────────────
  // Key format: `${prepId}:cut50` | `${prepId}:cut130` | `${prepId}:critical_temp`
  // Deviation mode activates when a step's validation fails — shows an inline panel
  // that requires notes + supervisor before the step is recorded with deviation flag.
  const [deviationModeKey, setDeviationModeKey] = useState<string | null>(null);
  const [deviationNotes, setDeviationNotes] = useState<Record<string, string>>({});
  const [deviationSupervisor, setDeviationSupervisor] = useState<Record<string, string>>({});
  const [deviationSubmitting, setDeviationSubmitting] = useState<Record<string, boolean>>({});
  const [deviationError, setDeviationError] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const results = await Promise.allSettled([getOperationalItems({ stage: 'thermal' }), getSmokehouses()]);
    const [oR, smokeR] = results;
    let thermalItems: OItemItem[] = [];

    if (oR.status === 'fulfilled') thermalItems = oR.value;

    setOItems(thermalItems);
    if (smokeR.status === 'fulfilled') setSmokehouses(smokeR.value);

    const stages = Array.from(new Set(thermalItems.map((x) => x.stage ?? '—')));
    const statuses = Array.from(new Set(thermalItems.map((x) => x.status ?? '—')));
    if (__DEV__) {
      console.log('[THERMAL_LOAD]', {
        totalItems: thermalItems.length,
        matchedItems: thermalItems.filter((x) => x.stage === 'thermal' && x.status === 'ready_for_thermal').length,
        stages,
        statuses,
      });
    }

    const firstFail = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstFail) {
      logFirebaseError('Thermal', 'operational_items/smokehouses', firstFail.reason);
      if (__DEV__) {
        const err = firstFail.reason as { code?: string; message?: string; stack?: string };
        console.error('[THERMAL_LOAD_FAILED]', {
          code: err?.code ?? 'unknown',
          message: err?.message ?? String(firstFail.reason),
          stack: err?.stack,
        });
      }
      const hasDataViaFallback = thermalItems.length > 0 || oR.status === 'fulfilled';
      if (!hasDataViaFallback || smokeR.status === 'rejected') {
        setLoadError(toOperatorMessage(firstFail.reason, 'Unable to load thermal data.'));
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const smokehouseByName = useMemo(
    () => smokehouses.reduce<Record<string, SmokehouseItem>>((map, s) => { map[s.name] = s; return map; }, {}),
    [smokehouses],
  );

  /** Full canonical grid — always 12 entries (D–O).
   *  Entries with no Firestore record fall back to idle / available. */
  const smokehouseGrid = useMemo(
    () => ALL_SMOKEHOUSE_NAMES.map((name) => {
      const firestoreEntry = smokehouseByName[name];
      return {
        name,
        status: (firestoreEntry?.status ?? 'idle') as 'idle' | 'cooking' | 'cleaning',
        currentLoadId: firestoreEntry?.currentLoadId ?? null,
      };
    }),
    [smokehouseByName],
  );

  // DEV: detect duplicate active children in the same smokehouse.
  // Shows a warning banner in Section 2 so operators know stale data needs
  // cleanup. Duplicates should never occur after the Blocker 2 fix, but this
  // catches any pre-existing bad state in Firestore.
  const smokehouseDuplicates = useMemo(() => {
    const bySmokehouse: Record<string, OItemItem[]> = {};
    oItems.forEach((x) => {
      if ((x.status === 'assigned' || x.status === 'cooking') && x.assignedSmokehouse) {
        const key = x.assignedSmokehouse;
        if (!bySmokehouse[key]) bySmokehouse[key] = [];
        bySmokehouse[key].push(x);
      }
    });
    // Only keep smokehouses with more than one active load
    return Object.fromEntries(
      Object.entries(bySmokehouse).filter(([, items]) => items.length > 1),
    );
  }, [oItems]);

  // operational_items already filtered to stage='thermal' in loadData.
  // Sub-filter by status for each section.
  const readyForAssignment = useMemo(
    () => oItems
      .filter((p) => p.status === 'ready' || p.status === 'ready_for_thermal')
      .sort((a, b) => Number(b.id === targetItemId) - Number(a.id === targetItemId) || (toMillis(a.startTime) ?? 0) - (toMillis(b.startTime) ?? 0)),
    [oItems, targetItemId],
  );
  const assignedQueue = useMemo(
    () => oItems
      .filter((p) => p.status === 'assigned')
      .sort((a, b) => Number(b.id === targetItemId) - Number(a.id === targetItemId) || (toMillis(a.startTime) ?? 0) - (toMillis(b.startTime) ?? 0)),
    [oItems, targetItemId],
  );
  const liveExecution = useMemo(
    () => oItems
      .filter((p) => p.status === 'cooking')
      .sort((a, b) => Number(b.id === targetItemId) - Number(a.id === targetItemId) || (toMillis(a.startTime) ?? 0) - (toMillis(b.startTime) ?? 0)),
    [oItems, targetItemId],
  );

  function effectiveName(perBatch: string | undefined) {
    return (perBatch ?? '').trim() || onDutyAs.trim();
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  // Combined Assign + Start Cook — used by Section 1 inline panel
  async function onAssignAndStartCook(item: OItemItem) {
    const smokeName = selectedSmokeByPrep[item.id] ?? '';
    const rawTemp = assignPanelTemp[item.id] ?? '';
    const parsedTemp = parseFloat(rawTemp);
    const rawProductTemp = assignPanelProductTemp[item.id] ?? '';
    const parsedProductTemp = rawProductTemp.trim() ? parseFloat(rawProductTemp) : null;
    if (!smokeName) {
      setAssignAndStartError((prev) => ({ ...prev, [item.id]: 'Select a smokehouse first.' }));
      return;
    }
    const selected = smokehouseByName[smokeName] ?? null;
    const capacity = smokehouseRackCapacity(selected);
    if ((item.racks ?? 0) > capacity) {
      setAssignAndStartError((prev) => ({
        ...prev,
        [item.id]: `This load exceeds smokehouse capacity. Split into ${Math.ceil((item.racks ?? 0) / capacity)} cook loads.`,
      }));
      return;
    }
    if (!rawTemp.trim() || !Number.isFinite(parsedTemp) || parsedTemp < 50 || parsedTemp > 600) {
      setAssignAndStartError((prev) => ({ ...prev, [item.id]: 'Chamber temp must be between 50–600°F (e.g. 165°F). This is the smokehouse temperature, not the product temp.' }));
      return;
    }
    if (parsedProductTemp !== null && (!Number.isFinite(parsedProductTemp) || parsedProductTemp < 30 || parsedProductTemp > 60)) {
      setAssignAndStartError((prev) => ({ ...prev, [item.id]: 'Product temp must be between 30–60°F, or leave blank.' }));
      return;
    }
    setAssignAndStartError((prev) => ({ ...prev, [item.id]: '' }));
    setActionSuccess(null); setActionError(null);
    try {
      setAssignAndStartingId(item.id);
      if (item.prepQueueId) {
        await oItemAssignAndStartCook(item.id, item.stage, item.status, item.prepQueueId, smokeName, {
          startingTemp: parsedTemp,
          ...(parsedProductTemp !== null ? { startingProductTemp: parsedProductTemp } : {}),
        });
      }
      setActionSuccess(`${prepDisplayName(item)} assigned to Smokehouse ${smokeName} — cook started at ${parsedTemp}°F.`);
      setExpandedAssignPrepId(null);
      await loadData();
    } catch (error) {
      setAssignAndStartError((prev) => ({ ...prev, [item.id]: toOperatorMessage(error, 'Failed to assign and start cook.') }));
    } finally {
      setAssignAndStartingId(null);
    }
  }

  async function onAllocateSmokehouseLoad(item: OItemItem) {
    const smokeName = selectedSmokeByPrep[item.id] ?? '';
    if (!smokeName) {
      setAssignAndStartError((prev) => ({ ...prev, [item.id]: 'Select a smokehouse first.' }));
      return;
    }
    setAssignAndStartError((prev) => ({ ...prev, [item.id]: '' }));
    setActionSuccess(null); setActionError(null);
    try {
      setAllocatingLoadId(item.id);
      const selected = smokehouseByName[smokeName] ?? null;
      const setup = smokehouseSetupType(selected);
      const result = await oItemAllocateSmokehouseLoad(item.id, smokeName, setup);
      setActionSuccess(
        `Loaded ${result.assignedRackCount} rack(s) to Smokehouse ${smokeName}. Remaining on parent: ${result.remainingRackCount}.`,
      );
      await loadData();
    } catch (error) {
      setAssignAndStartError((prev) => ({ ...prev, [item.id]: toOperatorMessage(error, 'Failed to allocate smokehouse load.') }));
    } finally {
      setAllocatingLoadId(null);
    }
  }

  async function onVerifyLoad(item: OItemItem) {
    const by = effectiveName(verifyLoadBy[item.id]);
    if (!by) {
      setVerifyLoadError((prev) => ({ ...prev, [item.id]: 'Enter your name or set On Duty As above.' }));
      return;
    }
    setVerifyLoadError((prev) => ({ ...prev, [item.id]: '' }));
    setActionSuccess(null); setActionError(null);
    try {
      setVerifyingLoadId(item.id);
      if (item.prepQueueId) await oItemVerifyLoad(item.id, item.prepQueueId, by);
      setActionSuccess(`Load verified for ${prepDisplayName(item)}.`);
      await loadData();
    } catch (error) {
      setVerifyLoadError((prev) => ({ ...prev, [item.id]: toOperatorMessage(error, 'Failed to verify load.') }));
    } finally {
      setVerifyingLoadId(null);
    }
  }

  async function onStartCook(item: OItemItem) {
    const rawTemp = startingTempInput[item.id] ?? '';
    const parsedTemp = parseFloat(rawTemp);
    if (!rawTemp.trim()) {
      setStartCookError((prev) => ({ ...prev, [item.id]: 'Starting chamber temp is required.' }));
      return;
    }
    if (!Number.isFinite(parsedTemp) || parsedTemp < 50 || parsedTemp > 600) {
      setStartCookError((prev) => ({ ...prev, [item.id]: 'Temp must be between 50°F and 600°F.' }));
      return;
    }
    setStartCookError((prev) => ({ ...prev, [item.id]: '' }));
    setActionSuccess(null); setActionError(null);
    try {
      setStartingPrepId(item.id);
      if (!item.assignedSmokehouse) throw new Error('Smokehouse assignment is required.');
      if (item.prepQueueId) {
        await oItemAssignAndStartCook(item.id, item.stage, item.status, item.prepQueueId, item.assignedSmokehouse, { startingTemp: parsedTemp });
      }
      setActionSuccess(`Cook started for ${prepDisplayName(item)}.`);
      await loadData();
    } catch (error) {
      setStartCookError((prev) => ({ ...prev, [item.id]: toOperatorMessage(error, 'Failed to start cook.') }));
    } finally {
      setStartingPrepId(null);
    }
  }

  function onSendBackToRtc(item: OItemItem) {
    router.push(`/hold?itemId=${encodeURIComponent(item.id)}&mode=place`);
  }

  /** DEV-only: resolve duplicate active child loads assigned to the same smokehouse. */
  async function onResolveSmokehouseDuplicates() {
    setResolvingDuplicates(true);
    setActionSuccess(null);
    setActionError(null);
    try {
      const result = await resolveSmokehouseDuplicates();
      if (result.errors.length > 0) {
        setActionError(
          `Partial cleanup: ${result.cancelled.length} duplicate(s) put on hold, ` +
          `${result.errors.length} error(s). Check console logs.`,
        );
      } else {
        setActionSuccess(
          `Cleanup complete: ${result.resolved} smokehouse(s) resolved, ` +
          `${result.cancelled.length} duplicate(s) put on hold. Parent rack counts updated.`,
        );
      }
      await loadData();
    } catch (error) {
      setActionError(toOperatorMessage(error, 'Failed to resolve duplicate loads.'));
    } finally {
      setResolvingDuplicates(false);
    }
  }

  /** DEV-only: scan all smokehouses and clear stale currentLoadId values. */
  async function onRepairSmokehouseOccupancy() {
    setRepairingOccupancy(true);
    setActionSuccess(null);
    setActionError(null);
    try {
      const result = await repairStaleSmokehouseOccupancy();
      if (result.errors.length > 0) {
        setActionError(
          `Repair partial: ${result.repaired.length} fixed, ${result.errors.length} error(s). Check logs.`,
        );
      } else if (result.repaired.length === 0) {
        setActionSuccess('Repair complete: no stale occupancy found — all smokehouses are clean.');
      } else {
        setActionSuccess(
          `Repair complete: cleared stale occupancy on Smokehouse${result.repaired.length > 1 ? 'es' : ''} ${result.repaired.join(', ')}.`,
        );
      }
      await loadData();
    } catch (error) {
      setActionError(toOperatorMessage(error, 'Failed to repair smokehouse occupancy.'));
    } finally {
      setRepairingOccupancy(false);
    }
  }

  async function do50Cut(item: OItemItem) {
    const raw = cut50TempInput[item.id] ?? '';
    const parsed = parseFloat(raw);
    if (!raw.trim() || !Number.isFinite(parsed)) {
      setCut50Error((prev) => ({ ...prev, [item.id]: 'Enter the observed product temp before confirming.' }));
      return;
    }
    if (parsed < 45 || parsed > 55) {
      // Out-of-range — activate deviation mode instead of blocking.
      setCut50Error((prev) => ({ ...prev, [item.id]: `${parsed}°F is outside the 45–55°F range. Record a deviation with supervisor approval to proceed.` }));
      setDeviationModeKey(`${item.id}:cut50`);
      return;
    }
    // Normal path — temp is in range.
    setCut50Error((prev) => ({ ...prev, [item.id]: '' }));
    setDeviationModeKey(null);
    setActionSuccess(null); setActionError(null);
    try {
      setCut50LoadingId(item.id);
      if (item.prepQueueId) await oItemRecord50Cut(item.id, item.prepQueueId, { observedTemp: parsed });
      setCut50PanelOpenId(null);
      setActionSuccess(`50°F cut recorded for ${prepDisplayName(item)} — observed ${parsed}°F.`);
      await loadData();
    } catch (error) {
      setCut50Error((prev) => ({ ...prev, [item.id]: toOperatorMessage(error, 'Failed to record 50°F cut.') }));
    } finally {
      setCut50LoadingId(null);
    }
  }

  async function do130Cut(item: OItemItem) {
    const raw = cut130TempInput[item.id] ?? '';
    const parsed = parseFloat(raw);
    const cut50Ms = toMillis(item.cut50At);
    const hoursFrom50 = cut50Ms !== null ? (Date.now() - cut50Ms) / (1000 * 60 * 60) : null;
    const isOver6h = hoursFrom50 !== null && hoursFrom50 > 6;

    if (!raw.trim() || !Number.isFinite(parsed)) {
      setCut130Error((prev) => ({ ...prev, [item.id]: 'Enter observed product temp before confirming.' }));
      return;
    }
    if (isOver6h) {
      // 6-hour window exceeded — activate deviation mode.
      setCut130Error((prev) => ({ ...prev, [item.id]: `6-hour window exceeded (${hoursFrom50!.toFixed(1)}h since 50°F cut). Record a deviation with supervisor approval to proceed.` }));
      setDeviationModeKey(`${item.id}:cut130`);
      return;
    }
    if (parsed < 125 || parsed > 135) {
      // Out-of-range — activate deviation mode.
      setCut130Error((prev) => ({ ...prev, [item.id]: `${parsed}°F is outside the 125–135°F range. Record a deviation with supervisor approval to proceed.` }));
      setDeviationModeKey(`${item.id}:cut130`);
      return;
    }
    // Normal path — temp in range and within 6h window.
    setCut130Error((prev) => ({ ...prev, [item.id]: '' }));
    setDeviationModeKey(null);
    setActionSuccess(null); setActionError(null);
    try {
      setCut130LoadingId(item.id);
      if (item.prepQueueId) await oItemRecord130Cut(item.id, item.prepQueueId, { observedTemp: parsed });
      setCut130PanelOpenId(null);
      setActionSuccess(`130°F cut recorded for ${prepDisplayName(item)} — observed ${parsed}°F.`);
      await loadData();
    } catch (error) {
      setCut130Error((prev) => ({ ...prev, [item.id]: toOperatorMessage(error, 'Failed to record 130°F cut.') }));
    } finally {
      setCut130LoadingId(null);
    }
  }

  async function onCriticalTemp(item: OItemItem) {
    const probes = probeInputs[item.id] ?? ['', '', ''];
    const parsed = probes.map((v) => parseFloat(v));
    const target = item.targetTemp ?? 0;
    const allEntered = parsed.every((v) => Number.isFinite(v) && v > 0);
    const allPass = allEntered && parsed.every((v) => v >= target);
    const minTemp = allEntered ? Math.min(...parsed) : NaN;
    const by = effectiveName(critTempVerifiedBy[item.id]);
    if (!allEntered) {
      setCritTempError((prev) => ({ ...prev, [item.id]: 'Enter all 3 probe readings before recording.' }));
      return;
    }
    if (!by) {
      setCritTempError((prev) => ({ ...prev, [item.id]: 'Enter verified-by name or set On Duty As.' }));
      return;
    }
    if (!allPass) {
      // Probes entered but one or more below target — activate deviation mode instead of blocking.
      const failures = parsed.filter((v) => v < target).length;
      setCritTempError((prev) => ({ ...prev, [item.id]: `${failures} probe(s) below ${target}°F target. Record a deviation with supervisor approval to proceed.` }));
      setDeviationModeKey(`${item.id}:critical_temp`);
      return;
    }
    // Normal path — all probes pass.
    setCritTempError((prev) => ({ ...prev, [item.id]: '' }));
    setDeviationModeKey(null);
    setActionSuccess(null); setActionError(null);
    try {
      setRecordingCritTempId(item.id);
      if (item.prepQueueId) await oItemRecordCriticalTemp(item.id, item.prepQueueId, minTemp, by, { probeTemps: parsed });
      setActionSuccess(`All 3 probes passed — min ${minTemp}°F recorded for ${prepDisplayName(item)}.`);
      await loadData();
    } catch (error) {
      setCritTempError((prev) => ({ ...prev, [item.id]: toOperatorMessage(error, 'Failed to record probe temp.') }));
    } finally {
      setRecordingCritTempId(null);
    }
  }

  async function onEvacuation(item: OItemItem, method: 'dry_vac' | 'cold_shower') {
    setEvacuationError((prev) => ({ ...prev, [item.id]: '' }));
    setHandoffError((prev) => ({ ...prev, [item.id]: '' }));
    setActionSuccess(null); setActionError(null);
    try {
      setEvacuatingPrepId(item.id);
      if (item.prepQueueId) {
        await oItemEvacuateToChill(item.id, item.stage, item.status, item.prepQueueId, method);
      }
      setActionSuccess(`Evacuate / Cold Shower recorded for ${prepDisplayName(item)}. Hand off to Chill complete.`);
      await loadData();
    } catch (error) {
      const msg = toOperatorMessage(error, 'Failed to record evacuation and handoff.');
      setEvacuationError((prev) => ({ ...prev, [item.id]: msg }));
      setHandoffError((prev) => ({ ...prev, [item.id]: msg }));
    } finally {
      setEvacuatingPrepId(null);
    }
  }

  /** Submit a deviation and proceed with the step.
   *  Called from the deviation panel inside any of Steps 3, 4, or 5. */
  async function submitDeviation(item: OItemItem, stepType: 'cut50' | 'cut130' | 'critical_temp') {
    const key = `${item.id}:${stepType}`;
    const notes = (deviationNotes[key] ?? '').trim();
    const supervisor = (deviationSupervisor[key] ?? '').trim();
    if (!notes) {
      setDeviationError((prev) => ({ ...prev, [key]: 'Reason / notes are required.' }));
      return;
    }
    if (!supervisor) {
      setDeviationError((prev) => ({ ...prev, [key]: 'Supervisor name or initials are required.' }));
      return;
    }
    setDeviationError((prev) => ({ ...prev, [key]: '' }));
    setDeviationSubmitting((prev) => ({ ...prev, [key]: true }));
    setActionSuccess(null); setActionError(null);
    try {
      const cut50Ms = toMillis(item.cut50At);
      const hoursFrom50 = cut50Ms !== null ? (Date.now() - cut50Ms) / (1000 * 60 * 60) : null;
      const prepId = item.prepQueueId;

      if (stepType === 'cut50') {
        const raw = cut50TempInput[item.id] ?? '';
        const parsed = parseFloat(raw);
        const obsVal = Number.isFinite(parsed) ? parsed : undefined;
        const devType = parsed < 45 ? 'cut50_temp_low' : 'cut50_temp_high';
        const deviation: ThermalDeviationInput = { type: devType, notes, supervisorName: supervisor, observedValue: obsVal };
        if (prepId) await oItemRecord50Cut(item.id, prepId, { observedTemp: obsVal, deviation });
        setDeviationModeKey(null);
        setCut50PanelOpenId(null);
        setActionSuccess(`50°F cut recorded with deviation for ${prepDisplayName(item)}.`);

      } else if (stepType === 'cut130') {
        const raw = cut130TempInput[item.id] ?? '';
        const parsed = parseFloat(raw);
        const obsVal = Number.isFinite(parsed) ? parsed : undefined;
        const isOver6h = hoursFrom50 !== null && hoursFrom50 > 6;
        const devType = isOver6h ? 'cut130_6h_window' : (parsed < 125 ? 'cut130_temp_low' : 'cut130_temp_high');
        const deviation: ThermalDeviationInput = { type: devType, notes, supervisorName: supervisor, observedValue: obsVal };
        if (prepId) await oItemRecord130Cut(item.id, prepId, { observedTemp: obsVal, deviation });
        setDeviationModeKey(null);
        setCut130PanelOpenId(null);
        setActionSuccess(`130°F cut recorded with deviation for ${prepDisplayName(item)}.`);

      } else {
        // critical_temp — all 3 probes are guaranteed entered (deviation only activates after allEntered check)
        const probes = probeInputs[item.id] ?? ['', '', ''];
        const parsed = probes.map((v) => parseFloat(v));
        const minTemp = Math.min(...parsed.filter((v) => Number.isFinite(v) && v > 0));
        const by = effectiveName(critTempVerifiedBy[item.id]);
        if (!by) {
          setDeviationError((prev) => ({ ...prev, [key]: 'Verified-by name is required.' }));
          setDeviationSubmitting((prev) => ({ ...prev, [key]: false }));
          return;
        }
        const deviation: ThermalDeviationInput = {
          type: 'critical_temp_below_target',
          notes,
          supervisorName: supervisor,
          observedValue: minTemp,
        };
        if (prepId) await oItemRecordCriticalTemp(item.id, prepId, minTemp, by, { probeTemps: parsed, deviation });
        setDeviationModeKey(null);
        setActionSuccess(`Probe completion recorded with deviation for ${prepDisplayName(item)}.`);
      }

      await loadData();
    } catch (error) {
      setDeviationError((prev) => ({ ...prev, [key]: toOperatorMessage(error, 'Failed to record deviation.') }));
    } finally {
      setDeviationSubmitting((prev) => ({ ...prev, [key]: false }));
    }
  }

  // ── Summary counts ─────────────────────────────────────────────────────────
  const summaryItems = [
    { label: 'Ready for Thermal', value: readyForAssignment.length, color: STATUS_COLOR_READY },
    { label: 'Awaiting Cook Start', value: assignedQueue.length, color: STATUS_COLOR_ASSIGNED },
    { label: 'Cook In Progress', value: liveExecution.length, color: STATUS_COLOR_COOKING },
  ];

  return (
    <C3SScreen>
      <C3SPage>
        <C3SScreenHeader
          title="Thermal Operations"
          subtitle={`Ready to Load: ${readyForAssignment.length}`}
          right={(
            <Pressable style={styles.refreshBtn} onPress={loadData}>
              <Text style={styles.refreshBtnText}>Refresh</Text>
            </Pressable>
          )}
        />
        <StressScenarioBanner />

        <C3SOperatorFocus
          status={`${liveExecution.length} cooking • ${assignedQueue.length} ready to start`}
          action={liveExecution.length > 0 ? 'Record Check' : assignedQueue.length > 0 ? 'Start Cook' : readyForAssignment.length > 0 ? 'Start Cook' : 'No Action Required'}
          detail={readyForAssignment.length > 0 ? `${readyForAssignment.length} batch${readyForAssignment.length === 1 ? '' : 'es'} need smokehouse assignment.` : 'Required thermal steps remain in their validated sequence.'}
          tone={liveExecution.some((item) => item.hasDeviation || item.status === 'hold') ? 'critical' : liveExecution.length + assignedQueue.length + readyForAssignment.length > 0 ? 'active' : 'complete'}
        />

        {/* On Duty As */}
        <View style={styles.onDutyRow}>
          <Text style={styles.onDutyLabel}>On Duty As</Text>
          <TextInput
            style={[styles.onDutyInput, !onDutyAs.trim() && styles.onDutyInputEmpty]}
            placeholder="Your name — pre-fills operator fields this session"
            placeholderTextColor={C3S_COLORS.textMuted}
            value={onDutyAs}
            onChangeText={handleOnDutyChange}
            autoCorrect={false}
            autoCapitalize="words"
          />
        </View>

        {/* Summary */}
        <View style={styles.summaryRow}>
          {summaryItems.map((item) => (
            <View key={item.label} style={styles.summaryCard}>
              <View style={[styles.summaryAccent, { backgroundColor: item.color }]} />
              <Text style={styles.summaryValue}>{item.value}</Text>
              <Text style={styles.summaryLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {isLoading ? <Text style={styles.infoText}>Loading thermal data...</Text> : null}
          {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
          {actionSuccess ? <Text style={styles.successText}>{actionSuccess}</Text> : null}
          {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

          {/* ── SECTION 1: AWAITING SMOKEHOUSE ASSIGNMENT ── */}
          <Text style={styles.sectionTitle}>1 · Ready for Thermal</Text>
          <Text style={styles.sectionSub}>Ready for Thermal from RTC — assign a smokehouse to proceed</Text>
          {!isLoading && !loadError && readyForAssignment.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No Batches Waiting Assignment</Text>
              <Text style={styles.emptySub}>Batches marked Ready by RTC appear here.</Text>
            </View>
          ) : null}
          {!isLoading && !loadError ? readyForAssignment.map((item) => {
            const itemIsParent = isRackPoolParent(item);
            const itemOriginalRacks = item.originalRackCount ?? item.racks ?? 0;
            const itemAllocatedRacks = item.allocatedRackCount ?? 0;
            const itemRemainingRacks = item.remainingRackCount ?? Math.max(0, itemOriginalRacks - itemAllocatedRacks);
            return (
            <C3SCard key={item.id} borderColor={itemIsParent ? C3S_COLORS.accent : STATUS_COLOR_READY}>
              {/* Rack-pool parent banner */}
              {itemIsParent ? (
                <View style={styles.rackPoolBanner}>
                  <Text style={styles.rackPoolBannerText}>
                    📦 STAGED RACK POOL · {itemRemainingRacks} of {itemOriginalRacks} racks remaining
                  </Text>
                </View>
              ) : null}
              <View style={styles.cardTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.product}>{prepDisplayName(item)}</Text>
                  {item.hasDeviation ? <Text style={styles.emptySub}>⚠ Deviation Recorded</Text> : null}
                </View>
                <View style={[styles.pill, { backgroundColor: itemIsParent ? C3S_COLORS.accentSoft : C3S_COLORS.successSoft, borderColor: itemIsParent ? C3S_COLORS.accent : C3S_COLORS.success }]}>
                  <Text style={[styles.pillText, { color: itemIsParent ? C3S_COLORS.accent : C3S_COLORS.success }]}>
                    {itemIsParent ? 'STAGED POOL' : 'READY FOR THERMAL'}
                  </Text>
                </View>
              </View>
              <C3SDisclosure>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Cook Profile</Text><Text style={styles.metaValue}>{item.cookType} · {item.targetTemp}°F target · {item.expectedCookMinutes}m expected</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Product Code</Text><Text style={styles.metaValue}>{item.productCodeSnapshot ?? item.productCode ?? '—'}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Process Order</Text><Text style={styles.metaValue}>{item.processOrder ?? item.poNumber ?? '—'}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Cases</Text><Text style={styles.metaValue}>{item.cases ?? 0}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Racks / Pieces</Text><Text style={styles.metaValue}>{item.racks} racks · {item.pieces} pcs</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Original Racks</Text><Text style={styles.metaValue}>{item.originalRackCount ?? item.racks ?? 0}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Allocated</Text><Text style={styles.metaValue}>{item.allocatedRackCount ?? 0}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Remaining</Text><Text style={styles.metaValue}>{item.remainingRackCount ?? item.racks ?? 0}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Planned Smokehouse</Text><Text style={styles.metaValue}>{item.targetSmokehouseId ?? item.assignedSmokehouse ?? '—'}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Critical Limit</Text><Text style={styles.metaValue}>{item.criticalLimit ?? '—'}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Probe-out Temp</Text><Text style={styles.metaValue}>{item.criticalTempValue ?? '—'}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>PO / Make Date</Text><Text style={styles.metaValue}>{item.poNumber} · {item.makeDate}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Delivery Date</Text><Text style={styles.metaValue}>{item.deliveryDate ?? '—'}</Text></View>
              </C3SDisclosure>
              <View style={styles.buttonRow}>
                <Pressable style={[styles.secondaryButton, { flex: 1 }]} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}`)}><Text style={styles.secondaryButtonText}>Open Batch</Text></Pressable>
                <Pressable style={[styles.secondaryButton, { flex: 1 }]} onPress={() => onSendBackToRtc(item)}>
                  <Text style={styles.secondaryButtonText}>Send Back / Hold</Text>
                </Pressable>
              </View>

              {/* Collapsed state: tap to open inline assign panel */}
              {expandedAssignPrepId !== item.id ? (
                <Pressable style={styles.assignSmokeButton} onPress={() => setExpandedAssignPrepId(item.id)}>
                  <Text style={styles.assignSmokeButtonText}>
                    {itemIsParent ? '📦 Allocate Rack Load →' : '🔥 Assign Smokehouse →'}
                  </Text>
                </Pressable>
              ) : (
                /* Expanded inline assign panel */
                <View style={styles.assignPanel}>
                  <Text style={styles.assignPanelTitle}>Select Smokehouse</Text>
                  <View style={styles.smokeGrid}>
                    {smokehouseGrid.map((s) => {
                      const hasAnyActiveLoad = oItems.some((x) => {
                        if (x.assignedSmokehouse !== s.name) return false;
                        if (!ACTIVE_SMOKEHOUSE_STATUSES.includes(x.status)) return false;
                        if (x.id === item.id) return false;
                        if (x.prepQueueId && x.prepQueueId === item.prepQueueId) return false;
                        return true;
                      });
                      const smokehouseDocOccupied = !!s.currentLoadId
                        && s.currentLoadId !== item.id
                        && s.currentLoadId !== (item.prepQueueId ?? '');
                      const isCleaning = s.status === 'cleaning';
                      const isBusy = hasAnyActiveLoad || smokehouseDocOccupied || s.status === 'cooking';
                      const isDisabled = isCleaning || isBusy || assignAndStartingId === item.id || allocatingLoadId === item.id;
                      const isActive = selectedSmokeByPrep[item.id] === s.name;
                      const statusLabel = isCleaning
                        ? 'cleaning'
                        : hasAnyActiveLoad
                          ? 'allocated'
                          : smokehouseDocOccupied || s.status === 'cooking'
                            ? 'occupied'
                            : 'available';
                      return (
                        <Pressable
                          key={s.name}
                          style={[
                            styles.smokeChip,
                            isActive && styles.smokeChipActive,
                            isBusy && styles.smokeChipBusy,
                            isCleaning && styles.smokeChipCleaning,
                          ]}
                          onPress={() => !isDisabled && setSelectedSmokeByPrep((prev) => ({ ...prev, [item.id]: s.name }))}
                          disabled={isDisabled}>
                          <Text style={[styles.smokeChipName, isActive && styles.smokeChipNameActive, isDisabled && styles.smokeChipNameDim]}>
                            {s.name}
                          </Text>
                          <Text style={styles.smokeChipStatus}>{statusLabel}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {(() => {
                    const selectedName = selectedSmokeByPrep[item.id] ?? '';
                    const selected = selectedName ? (smokehouseByName[selectedName] ?? null) : null;
                    const capacity = smokehouseRackCapacity(selected);
                    const originalRacks = item.originalRackCount ?? item.racks ?? 0;
                    const allocatedRacks = item.allocatedRackCount ?? 0;
                    const remainingRacks = item.remainingRackCount ?? Math.max(0, originalRacks - allocatedRacks);
                    const overCapacity = remainingRacks > capacity;
                    const allocRacks = Math.min(remainingRacks, capacity);
                    return (
                      <View style={{ marginTop: 8 }}>
                        {/* Rack pool breakdown — always show for parents or over-capacity */}
                        {(itemIsParent || overCapacity) ? (
                          <View style={styles.rackPoolInfoBox}>
                            <View style={styles.metaRow}>
                              <Text style={styles.metaLabel}>Original Racks</Text>
                              <Text style={styles.metaValue}>{originalRacks}</Text>
                            </View>
                            <View style={styles.metaRow}>
                              <Text style={styles.metaLabel}>Allocated Racks</Text>
                              <Text style={styles.metaValue}>{allocatedRacks}</Text>
                            </View>
                            <View style={styles.metaRow}>
                              <Text style={styles.metaLabel}>Remaining Racks</Text>
                              <Text style={[styles.metaValue, { color: C3S_COLORS.success }]}>{remainingRacks}</Text>
                            </View>
                          </View>
                        ) : null}

                        <Text style={[styles.metaValue, { marginTop: 6 }]}>
                          {selectedName
                            ? `Smokehouse ${selectedName} — ${smokehouseSetupType(selected) === 'tree' ? '12-rack capacity (Tree)' : '18-rack capacity (Compression)'}`
                            : 'Select a smokehouse above to see capacity'}
                        </Text>

                        {/* ── BRANCH A: Load exceeds capacity → show Load N racks button only ── */}
                        {overCapacity ? (
                          <>
                            {selectedName ? (
                              <View style={styles.loadPreviewBox}>
                                <Text style={styles.metaValue}>Selected Smokehouse: {selectedName}</Text>
                                <Text style={styles.metaValue}>Capacity: {capacity} racks</Text>
                                <Text style={styles.metaValue}>Racks to Load: {allocRacks}</Text>
                                <Text style={[styles.metaValue, { color: C3S_COLORS.success }]}>
                                  Remaining After Load: {remainingRacks - allocRacks}
                                </Text>
                              </View>
                            ) : null}
                            {assignAndStartError[item.id] ? (
                              <Text style={styles.errorText}>{assignAndStartError[item.id]}</Text>
                            ) : null}
                            <View style={styles.buttonRow}>
                              <Pressable
                                style={[styles.secondaryButton, { flex: 1 }]}
                                onPress={() => setExpandedAssignPrepId(null)}
                                disabled={allocatingLoadId === item.id}>
                                <Text style={styles.secondaryButtonText}>Cancel</Text>
                              </Pressable>
                              <Pressable
                                style={[
                                  styles.primaryAction,
                                  { flex: 2, opacity: !selectedName || allocatingLoadId === item.id ? 0.4 : 1 },
                                ]}
                                disabled={!selectedName || allocatingLoadId === item.id}
                                onPress={() => onAllocateSmokehouseLoad(item)}>
                                <Text style={styles.primaryActionText}>
                                  {allocatingLoadId === item.id
                                    ? 'Loading...'
                                    : selectedName
                                      ? `Load ${allocRacks} rack${allocRacks === 1 ? '' : 's'} into Smokehouse ${selectedName}`
                                      : 'Select a smokehouse first'}
                                </Text>
                              </Pressable>
                            </View>
                          </>
                        ) : (
                          /* ── BRANCH B: Fits in one house → Assign & Start Cook ── */
                          <>
                            <Text style={[styles.assignPanelTitle, { marginTop: 12 }]}>Starting Chamber Temp (°F) *</Text>
                            <Text style={styles.tempFieldHint}>Smokehouse temperature — not product temp</Text>
                            <TextInput
                              style={styles.input}
                              placeholder="e.g. 165°F — required to start cook"
                              placeholderTextColor={C3S_COLORS.textMuted}
                              keyboardType="numeric"
                              value={assignPanelTemp[item.id] ?? ''}
                              onChangeText={(v) => setAssignPanelTemp((prev) => ({ ...prev, [item.id]: v }))}
                            />
                            <Text style={[styles.assignPanelTitle, { marginTop: 10 }]}>Starting Product Temp (°F)</Text>
                            <Text style={styles.tempFieldHint}>Product surface/internal temp · optional · 30–60°F</Text>
                            <TextInput
                              style={styles.input}
                              placeholder="e.g. 38°F — leave blank if not recorded"
                              placeholderTextColor={C3S_COLORS.textMuted}
                              keyboardType="numeric"
                              value={assignPanelProductTemp[item.id] ?? ''}
                              onChangeText={(v) => setAssignPanelProductTemp((prev) => ({ ...prev, [item.id]: v }))}
                            />
                            {assignAndStartError[item.id] ? (
                              <Text style={styles.errorText}>{assignAndStartError[item.id]}</Text>
                            ) : null}
                            <View style={styles.buttonRow}>
                              <Pressable
                                style={[styles.secondaryButton, { flex: 1 }]}
                                onPress={() => setExpandedAssignPrepId(null)}
                                disabled={assignAndStartingId === item.id}>
                                <Text style={styles.secondaryButtonText}>Cancel</Text>
                              </Pressable>
                              <Pressable
                                style={[styles.primaryAction, { flex: 2, opacity: assignAndStartingId === item.id ? 0.5 : 1 }]}
                                disabled={assignAndStartingId === item.id}
                                onPress={() => onAssignAndStartCook(item)}>
                                <Text style={styles.primaryActionText}>
                                  {assignAndStartingId === item.id ? 'Starting Cook...' : 'Start Cook'}
                                </Text>
                              </Pressable>
                            </View>
                          </>
                        )}
                      </View>
                    );
                  })()}
                </View>
              )}
            </C3SCard>
            );
          }) : null}

          {/* ── SECTION 2: READY TO START COOK ── */}
          <Text style={styles.sectionTitle}>2 · Awaiting Cook Start</Text>
          <Text style={styles.sectionSub}>Smokehouse assigned — verify load then record starting temp to begin</Text>

          {/* DEV: repair stale smokehouse occupancy (always visible in DEV) */}
          {__DEV__ ? (
            <Pressable
              style={[
                styles.secondaryButton,
                {
                  marginBottom: 8,
                  borderColor: C3S_COLORS.accent,
                  backgroundColor: C3S_COLORS.accentSoft,
                  opacity: repairingOccupancy ? 0.5 : 1,
                },
              ]}
              onPress={onRepairSmokehouseOccupancy}
              disabled={repairingOccupancy}>
              <Text style={[styles.secondaryButtonText, { color: C3S_COLORS.accent, fontWeight: '700' }]}>
                {repairingOccupancy ? 'Repairing...' : '🔧 Repair Smokehouse Occupancy'}
              </Text>
            </Pressable>
          ) : null}

          {/* DEV: duplicate-child warning + one-tap cleanup */}
          {__DEV__ && Object.keys(smokehouseDuplicates).length > 0 ? (
            <View style={[styles.emptyCard, { borderColor: C3S_COLORS.danger, backgroundColor: C3S_COLORS.warningSoft }]}>
              <Text style={[styles.emptyTitle, { color: C3S_COLORS.warning }]}>
                ⚠ DEV: Duplicate Active Loads Detected
              </Text>
              {Object.entries(smokehouseDuplicates).map(([house, dupes]) => (
                <Text key={house} style={[styles.emptySub, { color: C3S_COLORS.warning }]}>
                  Smokehouse {house}: {dupes.length} active loads ({dupes.map((d) => d.id.slice(0, 6)).join(', ')})
                </Text>
              ))}
              <Pressable
                style={[
                  styles.secondaryButton,
                  {
                    marginTop: 10,
                    borderColor: C3S_COLORS.danger,
                    backgroundColor: C3S_COLORS.dangerSoft,
                    opacity: resolvingDuplicates ? 0.5 : 1,
                  },
                ]}
                onPress={onResolveSmokehouseDuplicates}
                disabled={resolvingDuplicates}>
                <Text style={[styles.secondaryButtonText, { color: C3S_COLORS.warning, fontWeight: '700' }]}>
                  {resolvingDuplicates ? 'Resolving...' : 'Resolve Duplicate Smokehouse Loads'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!isLoading && !loadError && assignedQueue.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No Batches Awaiting Cook Start</Text>
              <Text style={styles.emptySub}>Batches assigned to a smokehouse appear here.</Text>
            </View>
          ) : null}
          {!isLoading && !loadError ? assignedQueue.map((item) => {
            const smokehouse = item.assignedSmokehouse ? smokehouseByName[item.assignedSmokehouse] ?? null : null;
            const siblingConflict = oItems.find((x) => {
              if (x.id === item.id) return false;
              if (!item.assignedSmokehouse || x.assignedSmokehouse !== item.assignedSmokehouse) return false;
              if (!ACTIVE_SMOKEHOUSE_STATUSES.includes(x.status)) return false;
              return true;
            });
            let blocked = '';
            let blockReason = 'ok';
            if (!smokehouse) {
              blocked = 'No linked smokehouse';
              blockReason = 'missing-smokehouse';
            } else if (smokehouse.status === 'cleaning') {
              blocked = 'Smokehouse cleaning';
              blockReason = 'cleaning';
            } else if (smokehouse.currentLoadId && !matchesLoadIdentity(smokehouse.currentLoadId, item)) {
              blocked = 'Smokehouse has different active load';
              blockReason = 'currentLoadId-mismatch';
            } else if (siblingConflict) {
              blocked = 'Smokehouse has different active load';
              blockReason = `active-status-conflict:${siblingConflict.id}:${siblingConflict.status}`;
            }
            if (__DEV__) {

              console.log('[THERMAL_OCCUPANCY_CHECK]', {
                smokehouseName: item.assignedSmokehouse ?? null,
                currentLoadId: smokehouse?.currentLoadId ?? null,
                itemId: item.id,
                prepQueueId: item.prepQueueId ?? null,
                status: item.status,
                allowed: !blocked,
                reason: blockReason,
              });
            }

            const isChildLoad = !!item.parentLoadId;
            // Whether the smokehouse's currentLoadId matches this item's identity
            const smokehouseLoadMatch = smokehouse
              ? matchesLoadIdentity(smokehouse.currentLoadId, item)
              : false;
            // Smokehouse status label — show [stale occupancy] in DEV when
            // currentLoadId points to a different load than this item.
            const smokehouseStatusLabel = !smokehouse
              ? ''
              : (smokehouse.currentLoadId && !smokehouseLoadMatch)
                ? (__DEV__ ? ' [stale occupancy]' : ` [${smokehouse.status}]`)
                : ` [${smokehouse.status}]`;
            return (
              <C3SCard key={item.id} borderColor={isChildLoad ? C3S_COLORS.accent : STATUS_COLOR_ASSIGNED}>
                {/* Child load banner */}
                {isChildLoad ? (
                  <View style={styles.childLoadBanner}>
                    <Text style={styles.childLoadBannerText}>
                      🔗 Child Load {item.splitLoadIndex ?? '?'}{item.splitLoadCount ? ` of ${item.splitLoadCount}` : ''}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.cardTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.product}>{prepDisplayName(item)}</Text>
                    {item.hasDeviation ? <Text style={styles.emptySub}>⚠ Deviation Recorded</Text> : null}
                  </View>
                  <View style={[styles.pill, { backgroundColor: isChildLoad ? C3S_COLORS.accentSoft : C3S_COLORS.warningSoft, borderColor: isChildLoad ? C3S_COLORS.accent : C3S_COLORS.warning }]}>
                    <Text style={[styles.pillText, { color: isChildLoad ? C3S_COLORS.accent : C3S_COLORS.warning }]}>
                      {isChildLoad ? 'CHILD LOAD' : 'ASSIGNED'}
                    </Text>
                  </View>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Smokehouse</Text>
                  <Text style={[
                    styles.metaValue,
                    (smokehouse?.currentLoadId && !smokehouseLoadMatch) ? { color: C3S_COLORS.warning } : undefined,
                  ]}>
                    {item.assignedSmokehouse ?? 'Unassigned'}{smokehouseStatusLabel}
                  </Text>
                </View>
                {/* Child-specific meta */}
                {isChildLoad ? (
                  <>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Assigned Racks</Text>
                      <Text style={[styles.metaValue, { color: C3S_COLORS.success }]}>
                        {item.assignedRackCount ?? item.racks} rack{(item.assignedRackCount ?? item.racks ?? 1) === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Parent Load</Text>
                      <Text style={styles.metaValue}>{item.productName ?? '—'} · {(item.parentLoadId ?? '').slice(0, 8)}…</Text>
                    </View>
                  </>
                ) : null}
                <C3SDisclosure>
                <View style={styles.metaRow}><Text style={styles.metaLabel}>Cook Profile</Text><Text style={styles.metaValue}>{item.cookType} · {item.targetTemp}°F · {item.expectedCookMinutes}m expected</Text></View>
                {!isChildLoad ? <View style={styles.metaRow}><Text style={styles.metaLabel}>Racks / Pieces</Text><Text style={styles.metaValue}>{item.racks} racks · {item.pieces} pcs</Text></View> : null}
                <View style={styles.metaRow}><Text style={styles.metaLabel}>Delivery Date</Text><Text style={styles.metaValue}>{item.deliveryDate ?? '—'}</Text></View>
                </C3SDisclosure>
                <Pressable style={styles.secondaryButton} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}`)}><Text style={styles.secondaryButtonText}>Open Batch</Text></Pressable>
                {/* DEV: occupancy identity debug — shows IDs and currentLoadId match status */}
                {__DEV__ ? (
                  <View style={styles.devDebugBox}>
                    <Text style={styles.devDebugText}>OItem ID: {item.id.slice(0, 16)}</Text>
                    <Text style={styles.devDebugText}>
                      PrepQueue ID: {item.prepQueueId ? item.prepQueueId.slice(0, 16) : '—'}
                    </Text>
                    <Text style={styles.devDebugText}>
                      {'Smokehouse currentLoadId: '}
                      {smokehouse?.currentLoadId ?? 'null (available)'}
                    </Text>
                    <Text style={[
                      styles.devDebugText,
                      {
                        color: !smokehouse?.currentLoadId
                          ? C3S_COLORS.success
                          : smokehouseLoadMatch
                            ? C3S_COLORS.success
                            : C3S_COLORS.danger,
                      },
                    ]}>
                      {'Occupancy Match: '}
                      {!smokehouse?.currentLoadId
                        ? '✓ null — verify will claim it'
                        : smokehouseLoadMatch
                          ? '✓ matches this load'
                          : '✗ points to different load — use Repair button'}
                    </Text>
                  </View>
                ) : null}
                {blocked ? <Text style={styles.errorText}>⚠ Blocked: {blocked}</Text> : null}
                {!blocked ? <Text style={styles.nextStep}>→ Next: Verify Load, then record starting chamber temp</Text> : null}

                {/* Step 1 — Verify Load */}
                {item.loadedVerified ? (
                  <Text style={styles.stepDone}>✓ Step 1 — Load verified by {item.loadedVerifiedBy ?? '—'} at {toSafeDate(item.loadedVerifiedAt)?.toLocaleTimeString() ?? '—'}</Text>
                ) : (
                  <>
                    <Text style={styles.stepHeader}>Step 1 — Verify Load</Text>
                    <View style={styles.inputRow}>
                      <TextInput style={styles.input}
                        placeholder={onDutyAs.trim() ? `${onDutyAs} (tap to override)` : 'Your name'}
                        placeholderTextColor={onDutyAs.trim() ? C3S_COLORS.textMuted : C3S_COLORS.textMuted}
                        value={verifyLoadBy[item.id] ?? ''}
                        onChangeText={(v) => setVerifyLoadBy((prev) => ({ ...prev, [item.id]: v }))}
                        autoCorrect={false} autoCapitalize="words" />
                      <Pressable style={styles.stepButton} disabled={verifyingLoadId === item.id} onPress={() => onVerifyLoad(item)}>
                        <Text style={styles.stepButtonText}>{verifyingLoadId === item.id ? '...' : 'Verify Load'}</Text>
                      </Pressable>
                    </View>
                    {verifyLoadError[item.id] ? <Text style={styles.errorText}>{verifyLoadError[item.id]}</Text> : null}
                  </>
                )}

                {/* Step 2 — Start Cook */}
                <Text style={styles.stepHeader}>Step 2 — Start Cook</Text>
                <View style={styles.inputRow}>
                  <TextInput style={styles.input}
                    placeholder="Starting chamber temp (°F) — required"
                    placeholderTextColor={C3S_COLORS.textMuted}
                    keyboardType="numeric"
                    value={startingTempInput[item.id] ?? ''}
                    onChangeText={(v) => setStartingTempInput((prev) => ({ ...prev, [item.id]: v }))} />
                </View>
                {startCookError[item.id] ? <Text style={styles.errorText}>{startCookError[item.id]}</Text> : null}
                <Pressable style={[styles.primaryAction, { opacity: blocked || startingPrepId === item.id ? 0.4 : 1 }]}
                  disabled={!!blocked || startingPrepId === item.id}
                  onPress={() => onStartCook(item)}>
                  <Text style={styles.primaryActionText}>{startingPrepId === item.id ? 'Starting...' : 'Start Cook'}</Text>
                </Pressable>
              </C3SCard>
            );
          }) : null}

          {/* ── SECTION 3: LIVE EXECUTION ── */}
          <Text style={styles.sectionTitle}>3 · Cook In Progress</Text>
          <Text style={styles.sectionSub}>Complete all thermal steps in sequence before handoff</Text>
          {!isLoading && !loadError && liveExecution.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No Active Cooks</Text>
              <Text style={styles.emptySub}>Batches with status &quot;cooking&quot; appear here with step tracking.</Text>
            </View>
          ) : null}
          {!isLoading && !loadError ? liveExecution.map((item) => {
            const smokehouse = item.assignedSmokehouse ? smokehouseByName[item.assignedSmokehouse] ?? null : null;
            const blocked = smokehouse && smokehouse.currentLoadId !== item.prepQueueId ? 'Smokehouse load linkage mismatch' : '';
            const cut50Ms = toMillis(item.cut50At);
            const hoursFrom50 = cut50Ms ? (Date.now() - cut50Ms) / (1000 * 60 * 60) : null;
            const approaching6h = hoursFrom50 !== null && hoursFrom50 > 5;
            const exceeded6h = hoursFrom50 !== null && hoursFrom50 > 6;
            const activeStep = getActiveStep(item);
            const cookElapsed = elapsedMinutes(item.cookStartedAt);
            const stepsCompleted = activeStep - 3;
            const progressPct = expectedProgress(cookElapsed, item.expectedCookMinutes);

            const cookingIsChild = !!item.parentLoadId;
            return (
              <C3SCard key={item.id} borderColor={item.thermalDeviations?.length ? C3S_COLORS.danger : STATUS_COLOR_COOKING}>
                {/* Child load banner */}
                {cookingIsChild ? (
                  <View style={styles.childLoadBanner}>
                    <Text style={styles.childLoadBannerText}>
                      🔗 Child Load {item.splitLoadIndex ?? '?'}{item.splitLoadCount ? ` of ${item.splitLoadCount}` : ''} · Smokehouse {item.assignedSmokehouse ?? '—'}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.cardTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.product}>{prepDisplayName(item)}</Text>
                  </View>
                  {item.hasDeviation || item.thermalDeviations?.length ? (
                    <View style={styles.deviationBadge}>
                      <Text style={styles.deviationBadgeText}>⚠ DEVIATION</Text>
                    </View>
                  ) : null}
                  <View style={[styles.pill, { backgroundColor: C3S_COLORS.dangerSoft, borderColor: C3S_COLORS.danger }]}>
                    <Text style={[styles.pillText, { color: C3S_COLORS.danger }]}>COOK IN PROGRESS</Text>
                  </View>
                </View>

                {/* Cook timer banner */}
                {item.cookStartedAt ? (
                  <View style={styles.timerBanner}>
                    <Text style={styles.timerText}>
                      ⏱ {fmtElapsed(cookElapsed)}{progressPct ? `  ·  ${progressPct}` : ''}
                    </Text>
                    <Text style={styles.timerSub}>Step {Math.min(activeStep, 7)} of 7 · {stepsCompleted > 0 ? `${stepsCompleted} steps done` : 'starting'}</Text>
                  </View>
                ) : null}

                <C3SDisclosure>
                <View style={styles.metaRow}><Text style={styles.metaLabel}>Smokehouse</Text><Text style={styles.metaValue}>{item.assignedSmokehouse ?? '—'}</Text></View>
                {/* Child-specific cook metadata */}
                {cookingIsChild ? (
                  <>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Assigned Racks</Text>
                      <Text style={[styles.metaValue, { color: C3S_COLORS.success }]}>
                        {item.assignedRackCount ?? item.racks} rack{(item.assignedRackCount ?? item.racks ?? 1) === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Parent Load</Text>
                      <Text style={styles.metaValue}>{item.productName ?? '—'} · {(item.parentLoadId ?? '').slice(0, 8)}…</Text>
                    </View>
                  </>
                ) : null}
                <View style={styles.metaRow}><Text style={styles.metaLabel}>Cook Profile</Text><Text style={styles.metaValue}>{item.cookType} · {item.targetTemp}°F · {item.expectedCookMinutes}m expected</Text></View>
                <View style={styles.metaRow}><Text style={styles.metaLabel}>Racks / Pieces</Text><Text style={styles.metaValue}>{item.racks} racks · {item.pieces} pcs</Text></View>
                <View style={styles.metaRow}><Text style={styles.metaLabel}>Delivery Date</Text><Text style={styles.metaValue}>{item.deliveryDate ?? '—'}</Text></View>
                {item.startingTemp != null ? <View style={styles.metaRow}><Text style={styles.metaLabel}>Chamber Temp</Text><Text style={styles.metaValue}>{item.startingTemp}°F (smokehouse)</Text></View> : null}
                {item.startingProductTemp != null ? <View style={styles.metaRow}><Text style={styles.metaLabel}>Product Temp</Text><Text style={styles.metaValue}>{item.startingProductTemp}°F (product in)</Text></View> : null}
                </C3SDisclosure>
                <Pressable style={styles.secondaryButton} onPress={() => router.push(`/production-item?id=${encodeURIComponent(item.id)}`)}><Text style={styles.secondaryButtonText}>Open Batch</Text></Pressable>
                {blocked ? <Text style={styles.errorText}>⚠ Equipment: {blocked}</Text> : null}

                {/* Step 3 — 50°F Cut */}
                {item.cut50At ? (
                  <Text style={styles.stepDone}>
                    {'✓ Step 3 — 50°F Cut: '}
                    {toSafeDate(item.cut50At)?.toLocaleTimeString() ?? '—'}
                    {item.cut50ObservedTemp != null ? ` · observed ${item.cut50ObservedTemp}°F` : ''}
                  </Text>
                ) : activeStep === 3 ? (
                  <>
                    <Text style={styles.stepHeader}>Step 3 — 50°F Cut Time</Text>
                    <Text style={styles.stepHint}>Verify product surface temp, then confirm cut. Starts the 6-hour regulatory window.</Text>
                    {cut50PanelOpenId !== item.id ? (
                      <Pressable style={styles.stepButton} disabled={cut50LoadingId === item.id}
                        onPress={() => { setCut50Error((p) => ({ ...p, [item.id]: '' })); setCut50PanelOpenId(item.id); }}>
                        <Text style={styles.stepButtonText}>Record Check</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.cut50Panel}>
                        <Text style={styles.cut50PanelLabel}>Observed Product Temp (°F)</Text>
                        <Text style={styles.tempFieldHint}>Accepted range: 45–55°F · Out of range activates deviation flow</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="e.g. 50°F"
                          placeholderTextColor={C3S_COLORS.textMuted}
                          keyboardType="numeric"
                          autoFocus
                          value={cut50TempInput[item.id] ?? ''}
                          onChangeText={(v) => { setCut50TempInput((prev) => ({ ...prev, [item.id]: v })); setDeviationModeKey(null); }}
                        />
                        {cut50Error[item.id] ? <Text style={styles.errorText}>{cut50Error[item.id]}</Text> : null}
                        {/* Deviation panel — shown when temp is out of range */}
                        {deviationModeKey === `${item.id}:cut50` ? (
                          <View style={styles.deviationPanel}>
                            <Text style={styles.deviationPanelTitle}>⚠ Record Deviation to Proceed</Text>
                            <Text style={styles.deviationPanelHint}>Out-of-range temp recorded. Supervisor approval required to continue.</Text>
                            <TextInput style={styles.input} placeholder="Reason / notes (required)"
                              placeholderTextColor={C3S_COLORS.textMuted} multiline autoCorrect={false}
                              value={deviationNotes[`${item.id}:cut50`] ?? ''}
                              onChangeText={(v) => setDeviationNotes((prev) => ({ ...prev, [`${item.id}:cut50`]: v }))} />
                            <TextInput style={styles.input} placeholder="Supervisor name or initials (required)"
                              placeholderTextColor={C3S_COLORS.textMuted} autoCorrect={false} autoCapitalize="words"
                              value={deviationSupervisor[`${item.id}:cut50`] ?? ''}
                              onChangeText={(v) => setDeviationSupervisor((prev) => ({ ...prev, [`${item.id}:cut50`]: v }))} />
                            {deviationError[`${item.id}:cut50`] ? <Text style={styles.errorText}>{deviationError[`${item.id}:cut50`]}</Text> : null}
                            <View style={styles.buttonRow}>
                              <Pressable style={[styles.secondaryButton, { flex: 1 }]} onPress={() => setDeviationModeKey(null)}>
                                <Text style={styles.secondaryButtonText}>Back</Text>
                              </Pressable>
                              <Pressable style={[styles.deviationSubmitButton, { flex: 2, opacity: deviationSubmitting[`${item.id}:cut50`] ? 0.5 : 1 }]}
                                disabled={!!deviationSubmitting[`${item.id}:cut50`]}
                                onPress={() => submitDeviation(item, 'cut50')}>
                                <Text style={styles.deviationSubmitText}>{deviationSubmitting[`${item.id}:cut50`] ? 'Recording…' : 'Submit with Deviation'}</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <View style={styles.buttonRow}>
                            <Pressable style={[styles.secondaryButton, { flex: 1 }]}
                              onPress={() => setCut50PanelOpenId(null)}
                              disabled={cut50LoadingId === item.id}>
                              <Text style={styles.secondaryButtonText}>Cancel</Text>
                            </Pressable>
                            <Pressable
                              style={[styles.stepButton, { flex: 2, marginTop: 0, opacity: cut50LoadingId === item.id ? 0.5 : 1 }]}
                              disabled={cut50LoadingId === item.id}
                              onPress={() => do50Cut(item)}>
                              <Text style={styles.stepButtonText}>
                                {cut50LoadingId === item.id ? 'Recording...' : 'Record Check'}
                              </Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    )}
                    {cut50PanelOpenId !== item.id && cut50Error[item.id] ? <Text style={styles.errorText}>{cut50Error[item.id]}</Text> : null}
                  </>
                ) : null}

                {/* Step 4 — 130°F Cut */}
                {item.cut130At ? (
                  <Text style={styles.stepDone}>
                    ✓ Step 4 — 130°F Cut: {toSafeDate(item.cut130At)?.toLocaleTimeString() ?? '—'}
                    {item.cut130ObservedTemp != null ? ` · observed ${item.cut130ObservedTemp}°F` : ''}
                  </Text>
                ) : activeStep === 4 ? (
                  <>
                    <Text style={styles.stepHeader}>Step 4 — 130°F Cut Time</Text>
                    <Text style={styles.stepHint}>Verify observed product temp, then confirm cut.</Text>
                    {approaching6h && !exceeded6h ? <Text style={styles.warningText}>⚠ Approaching 6-hour window ({hoursFrom50?.toFixed(1)}h since 50°F cut)</Text> : null}
                    {exceeded6h ? <Text style={styles.errorText}>✗ 6-hour window exceeded — a deviation with supervisor approval is required to proceed</Text> : null}
                    {cut130PanelOpenId !== item.id ? (
                      <Pressable style={styles.stepButton} disabled={cut130LoadingId === item.id}
                        onPress={() => { setCut130Error((p) => ({ ...p, [item.id]: '' })); setCut130PanelOpenId(item.id); }}>
                        <Text style={styles.stepButtonText}>{exceeded6h ? '⚠ Record Deviation' : 'Record Check'}</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.cut50Panel}>
                        <Text style={styles.cut50PanelLabel}>Observed Product Temp (°F)</Text>
                        <Text style={styles.tempFieldHint}>Accepted range: 125–135°F · Out of range or 6h exceeded activates deviation flow</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="e.g. 130°F"
                          placeholderTextColor={C3S_COLORS.textMuted}
                          keyboardType="numeric"
                          autoFocus
                          value={cut130TempInput[item.id] ?? ''}
                          onChangeText={(v) => { setCut130TempInput((prev) => ({ ...prev, [item.id]: v })); setDeviationModeKey(null); }}
                        />
                        {cut130Error[item.id] ? <Text style={styles.errorText}>{cut130Error[item.id]}</Text> : null}
                        {/* Deviation panel — shown when out of range or 6h exceeded */}
                        {deviationModeKey === `${item.id}:cut130` ? (
                          <View style={styles.deviationPanel}>
                            <Text style={styles.deviationPanelTitle}>⚠ Record Deviation to Proceed</Text>
                            <Text style={styles.deviationPanelHint}>Out-of-range condition detected. Supervisor approval required to continue.</Text>
                            <TextInput style={styles.input} placeholder="Reason / notes (required)"
                              placeholderTextColor={C3S_COLORS.textMuted} multiline autoCorrect={false}
                              value={deviationNotes[`${item.id}:cut130`] ?? ''}
                              onChangeText={(v) => setDeviationNotes((prev) => ({ ...prev, [`${item.id}:cut130`]: v }))} />
                            <TextInput style={styles.input} placeholder="Supervisor name or initials (required)"
                              placeholderTextColor={C3S_COLORS.textMuted} autoCorrect={false} autoCapitalize="words"
                              value={deviationSupervisor[`${item.id}:cut130`] ?? ''}
                              onChangeText={(v) => setDeviationSupervisor((prev) => ({ ...prev, [`${item.id}:cut130`]: v }))} />
                            {deviationError[`${item.id}:cut130`] ? <Text style={styles.errorText}>{deviationError[`${item.id}:cut130`]}</Text> : null}
                            <View style={styles.buttonRow}>
                              <Pressable style={[styles.secondaryButton, { flex: 1 }]} onPress={() => setDeviationModeKey(null)}>
                                <Text style={styles.secondaryButtonText}>Back</Text>
                              </Pressable>
                              <Pressable style={[styles.deviationSubmitButton, { flex: 2, opacity: deviationSubmitting[`${item.id}:cut130`] ? 0.5 : 1 }]}
                                disabled={!!deviationSubmitting[`${item.id}:cut130`]}
                                onPress={() => submitDeviation(item, 'cut130')}>
                                <Text style={styles.deviationSubmitText}>{deviationSubmitting[`${item.id}:cut130`] ? 'Recording…' : 'Submit with Deviation'}</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <View style={styles.buttonRow}>
                            <Pressable style={[styles.secondaryButton, { flex: 1 }]}
                              onPress={() => setCut130PanelOpenId(null)}
                              disabled={cut130LoadingId === item.id}>
                              <Text style={styles.secondaryButtonText}>Cancel</Text>
                            </Pressable>
                            <Pressable
                              style={[styles.stepButton, { flex: 2, marginTop: 0, opacity: cut130LoadingId === item.id ? 0.5 : 1 }]}
                              disabled={cut130LoadingId === item.id}
                              onPress={() => do130Cut(item)}>
                              <Text style={styles.stepButtonText}>
                                {cut130LoadingId === item.id ? 'Recording...' : 'Record Check'}
                              </Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    )}
                    {cut130PanelOpenId !== item.id && cut130Error[item.id] ? <Text style={styles.errorText}>{cut130Error[item.id]}</Text> : null}
                  </>
                ) : null}

                {/* Step 5 — Probe Out / Critical Temp (3 probes) */}
                {item.criticalTempReachedAt ? (
                  <Text style={styles.stepDone}>✓ Step 5 — Probe Completion: min {item.criticalTempValue}°F (all 3 probes) — {item.criticalTempVerifiedBy ?? '—'} at {toSafeDate(item.criticalTempReachedAt)?.toLocaleTimeString() ?? '—'}</Text>
                ) : activeStep === 5 ? (() => {
                  const probes = probeInputs[item.id] ?? ['', '', ''];
                  const parsedProbes = probes.map((v) => parseFloat(v));
                  const target = item.targetTemp ?? 0;
                  const allEntered = parsedProbes.every((v) => Number.isFinite(v) && v > 0);
                  const allPass = allEntered && parsedProbes.every((v) => v >= target);
                  const minProbeTemp = allEntered ? Math.min(...parsedProbes) : NaN;
                  return (
                    <>
                      <Text style={styles.stepHeader}>Step 5 — Probe Out / Critical Temp</Text>
                      <Text style={styles.stepHint}>Enter 3 probe readings. All must reach {target}°F or above. Minimum reading is stored.</Text>
                      <View style={styles.probeGrid}>
                        {([0, 1, 2] as const).map((i) => {
                          const val = parsedProbes[i];
                          const entered = (probes[i] ?? '').trim() !== '';
                          const passes = entered && Number.isFinite(val) && val >= target;
                          const fails = entered && !passes;
                          return (
                            <TextInput
                              key={i}
                              style={[styles.probeInput, passes && styles.probeInputPass, fails && styles.probeInputFail]}
                              placeholder={`Probe ${i + 1} (°F)`}
                              placeholderTextColor={C3S_COLORS.textMuted}
                              keyboardType="numeric"
                              value={probes[i] ?? ''}
                              onChangeText={(v) => {
                                setProbeInputs((prev) => {
                                  const arr = [...(prev[item.id] ?? ['', '', ''])];
                                  arr[i] = v;
                                  return { ...prev, [item.id]: arr };
                                });
                              }}
                            />
                          );
                        })}
                      </View>
                      {allEntered && allPass ? (
                        <Text style={styles.probeAllPass}>✓ All 3 probes passed — min {minProbeTemp}°F — ready to record</Text>
                      ) : allEntered && !allPass ? (
                        <Text style={styles.probeFailWarning}>✗ {parsedProbes.filter((v) => v < target).length} probe(s) below {target}°F — tap Record to trigger deviation flow</Text>
                      ) : null}
                      <TextInput style={[styles.input, { marginTop: 6 }]}
                        placeholder={onDutyAs.trim() ? `${onDutyAs} (tap to override)` : 'Verified by'}
                        placeholderTextColor={onDutyAs.trim() ? C3S_COLORS.textMuted : C3S_COLORS.textMuted}
                        value={critTempVerifiedBy[item.id] ?? ''}
                        onChangeText={(v) => setCritTempVerifiedBy((prev) => ({ ...prev, [item.id]: v }))}
                        autoCorrect={false} autoCapitalize="words" />
                      {critTempError[item.id] ? <Text style={styles.errorText}>{critTempError[item.id]}</Text> : null}
                      {/* Deviation panel — shown when probes below target */}
                      {deviationModeKey === `${item.id}:critical_temp` ? (
                        <View style={styles.deviationPanel}>
                          <Text style={styles.deviationPanelTitle}>⚠ Record Deviation to Proceed</Text>
                          <Text style={styles.deviationPanelHint}>One or more probes below required target. Supervisor approval required to continue.</Text>
                          <TextInput style={styles.input} placeholder="Reason / notes (required)"
                            placeholderTextColor={C3S_COLORS.textMuted} multiline autoCorrect={false}
                            value={deviationNotes[`${item.id}:critical_temp`] ?? ''}
                            onChangeText={(v) => setDeviationNotes((prev) => ({ ...prev, [`${item.id}:critical_temp`]: v }))} />
                          <TextInput style={styles.input} placeholder="Supervisor name or initials (required)"
                            placeholderTextColor={C3S_COLORS.textMuted} autoCorrect={false} autoCapitalize="words"
                            value={deviationSupervisor[`${item.id}:critical_temp`] ?? ''}
                            onChangeText={(v) => setDeviationSupervisor((prev) => ({ ...prev, [`${item.id}:critical_temp`]: v }))} />
                          {deviationError[`${item.id}:critical_temp`] ? <Text style={styles.errorText}>{deviationError[`${item.id}:critical_temp`]}</Text> : null}
                          <View style={styles.buttonRow}>
                            <Pressable style={[styles.secondaryButton, { flex: 1 }]} onPress={() => setDeviationModeKey(null)}>
                              <Text style={styles.secondaryButtonText}>Back</Text>
                            </Pressable>
                            <Pressable style={[styles.deviationSubmitButton, { flex: 2, opacity: deviationSubmitting[`${item.id}:critical_temp`] ? 0.5 : 1 }]}
                              disabled={!!deviationSubmitting[`${item.id}:critical_temp`]}
                              onPress={() => submitDeviation(item, 'critical_temp')}>
                              <Text style={styles.deviationSubmitText}>{deviationSubmitting[`${item.id}:critical_temp`] ? 'Recording…' : 'Submit with Deviation'}</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <Pressable
                          style={[styles.stepButton, { opacity: recordingCritTempId === item.id ? 0.5 : 1 }]}
                          disabled={recordingCritTempId === item.id}
                          onPress={() => onCriticalTemp(item)}>
                          <Text style={styles.stepButtonText}>{recordingCritTempId === item.id ? 'Recording...' : 'Record Check'}</Text>
                        </Pressable>
                      )}
                    </>
                  );
                })() : null}

                {/* Step 6 — Duration Required */}
                {item.durationRequiredAt ? (
                  <Text style={styles.stepDone}>
                    ✓ Step 6 — Duration Required: {item.durationRequired ? 'Yes' : 'No'} at {toSafeDate(item.durationRequiredAt)?.toLocaleTimeString() ?? '—'}
                    {' · '}
                    {item.durationRequired ? '5-minute duration required after critical temp is obtained.' : 'No duration hold required.'}
                  </Text>
                ) : activeStep === 6 ? (
                  <>
                    <Text style={styles.stepHeader}>Step 6 — Duration Required</Text>
                    <View style={styles.buttonRow}>
                      <Pressable style={[styles.stepButton, { flex: 1, opacity: durationLoadingId === item.id ? 0.5 : 1 }]}
                        disabled={durationLoadingId === item.id}
                        onPress={async () => {
                          setDurationError((prev) => ({ ...prev, [item.id]: '' }));
                          try {
                            setDurationLoadingId(item.id);
                            if (item.prepQueueId) {
                              await oItemRecordDuration(item.id, item.prepQueueId, true);
                            }
                            setActionSuccess(`Duration required recorded for ${item.id}.`);
                            await loadData();
                          } catch (error) {
                            setDurationError((prev) => ({ ...prev, [item.id]: toOperatorMessage(error, 'Failed to record duration decision.') }));
                          } finally {
                            setDurationLoadingId(null);
                          }
                        }}>
                        <Text style={styles.stepButtonText}>Yes</Text>
                      </Pressable>
                      <Pressable style={[styles.stepButton, { flex: 1, opacity: durationLoadingId === item.id ? 0.5 : 1 }]}
                        disabled={durationLoadingId === item.id}
                        onPress={async () => {
                          setDurationError((prev) => ({ ...prev, [item.id]: '' }));
                          try {
                            setDurationLoadingId(item.id);
                            if (item.prepQueueId) {
                              await oItemRecordDuration(item.id, item.prepQueueId, false);
                            }
                            setActionSuccess(`No-duration hold recorded for ${item.id}.`);
                            await loadData();
                          } catch (error) {
                            setDurationError((prev) => ({ ...prev, [item.id]: toOperatorMessage(error, 'Failed to record duration decision.') }));
                          } finally {
                            setDurationLoadingId(null);
                          }
                        }}>
                        <Text style={styles.stepButtonText}>No</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.stepHint}>Yes: 5-minute duration required after critical temp is obtained. No: No duration hold required.</Text>
                    {durationError[item.id] ? <Text style={styles.errorText}>{durationError[item.id]}</Text> : null}
                  </>
                ) : null}

                {/* Step 7 — Evacuate / Cold Shower */}
                {item.evacuationCompletedAt ? (
                  <Text style={styles.stepDone}>✓ Step 7 — Evacuation: {item.evacuationMethod === 'dry_vac' ? 'Evacuate' : 'Cold Shower'} at {toSafeDate(item.evacuationCompletedAt)?.toLocaleTimeString() ?? '—'}</Text>
                ) : activeStep === 7 ? (
                  <>
                    <Text style={styles.stepHeader}>Step 7 — Evacuate / Cold Shower</Text>
                    <View style={styles.buttonRow}>
                      <Pressable style={[styles.stepButton, { flex: 1 }]} disabled={evacuatingPrepId === item.id} onPress={() => onEvacuation(item, 'dry_vac')}>
                        <Text style={styles.stepButtonText}>{evacuatingPrepId === item.id ? '...' : 'Evacuate'}</Text>
                      </Pressable>
                      <Pressable style={[styles.stepButton, { flex: 1 }]} disabled={evacuatingPrepId === item.id} onPress={() => onEvacuation(item, 'cold_shower')}>
                        <Text style={styles.stepButtonText}>{evacuatingPrepId === item.id ? '...' : 'Cold Shower'}</Text>
                      </Pressable>
                    </View>
                    {evacuationError[item.id] ? <Text style={styles.errorText}>{evacuationError[item.id]}</Text> : null}
                    {handoffError[item.id] ? <Text style={styles.errorText}>{handoffError[item.id]}</Text> : null}
                  </>
                ) : null}
              </C3SCard>
            );
          }) : null}
        </ScrollView>
      </C3SPage>
    </C3SScreen>
  );
}

const styles = StyleSheet.create({
  refreshBtn: {
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshBtnText: { color: C3S_COLORS.textPrimary, fontSize: 12, fontWeight: '700' },
  onDutyRow: {
    borderWidth: 1,
    borderColor: C3S_COLORS.success,
    backgroundColor: C3S_COLORS.successSoft,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 4,
  },
  onDutyLabel: {
    color: C3S_COLORS.success,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  onDutyInput: {
    color: C3S_COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: 2,
  },
  onDutyInputEmpty: { color: C3S_COLORS.textMuted, fontWeight: '600', fontStyle: 'italic' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  summaryCard: {
    flex: 1,
    minWidth: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    backgroundColor: C3S_COLORS.panel,
    paddingVertical: 8,
    paddingHorizontal: 8,
    minHeight: 80,
  },
  summaryAccent: { height: 3, width: 36, borderRadius: 8, marginBottom: 6 },
  summaryValue: { color: C3S_COLORS.textStrong, fontSize: 24, fontWeight: '800', lineHeight: 28 },
  summaryLabel: { color: C3S_COLORS.textMuted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  listContent: { gap: 10, paddingBottom: 18 },
  sectionTitle: { color: C3S_COLORS.textStrong, fontSize: 19, fontWeight: '900', marginTop: 8, marginBottom: 2 },
  sectionSub: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  infoText: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  errorText: { color: C3S_COLORS.danger, fontSize: 12, fontWeight: '700', marginTop: 2 },
  successText: { color: C3S_COLORS.success, fontSize: 13, fontWeight: '700' },
  warningText: { color: C3S_COLORS.warning, fontSize: 12, fontWeight: '700', marginTop: 2 },
  nextStep: { color: C3S_COLORS.accent, fontSize: 12, fontWeight: '700', marginTop: 6 },
  timerBanner: {
    backgroundColor: C3S_COLORS.warningSoft,
    borderWidth: 1,
    borderColor: C3S_COLORS.danger,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  timerText: { color: C3S_COLORS.danger, fontSize: 16, fontWeight: '800' },
  timerSub: { color: C3S_COLORS.warning, fontSize: 12, fontWeight: '700', marginTop: 2 },
  emptyCard: {
    borderWidth: 1, borderColor: C3S_COLORS.border, borderRadius: 12,
    backgroundColor: C3S_COLORS.panel, padding: 14, gap: 4,
  },
  emptyTitle: { color: C3S_COLORS.textStrong, fontSize: 16, fontWeight: '800' },
  emptySub: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  cardTopRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  product: { color: C3S_COLORS.textStrong, fontSize: 19, fontWeight: '800' },
  batchId: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '700', marginTop: 2 },
  pill: {
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 10,
    minHeight: 26, justifyContent: 'center',
  },
  pillText: { fontSize: 12, fontWeight: '800' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, gap: 4 },
  metaLabel: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '600', minWidth: 104 },
  metaValue: { color: C3S_COLORS.textPrimary, fontSize: 14, fontWeight: '700', flex: 1 },
  stepHeader: {
    color: C3S_COLORS.textMuted, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', marginTop: 10, marginBottom: 4, letterSpacing: 0.5,
  },
  stepHint: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 4, fontStyle: 'italic' },
  stepDone: { color: C3S_COLORS.success, fontSize: 13, fontWeight: '600', marginTop: 6 },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  input: {
    flex: 1, minWidth: 100, borderWidth: 1, borderColor: C3S_COLORS.border,
    borderRadius: 8, backgroundColor: C3S_COLORS.panel, color: C3S_COLORS.textPrimary,
    fontSize: 13, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4,
  },
  stepButton: {
    borderWidth: 1, borderColor: C3S_COLORS.warning, backgroundColor: C3S_COLORS.warningSoft,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  stepButtonText: { color: C3S_COLORS.warning, fontSize: 12, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  chipActive: { borderColor: C3S_COLORS.warning, backgroundColor: C3S_COLORS.warningSoft },
  chipText: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: C3S_COLORS.warning },
  chipSub: { color: C3S_COLORS.textMuted, fontSize: 10, fontWeight: '600', marginTop: 1 },

  // Assign smokehouse inline panel
  assignSmokeButton: {
    borderWidth: 1, borderColor: C3S_COLORS.warning, backgroundColor: C3S_COLORS.warningSoft,
    borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 10,
  },
  assignSmokeButtonText: { color: C3S_COLORS.warning, fontSize: 14, fontWeight: '800' },
  assignPanel: {
    marginTop: 10, backgroundColor: C3S_COLORS.warningSoft, borderWidth: 1,
    borderColor: C3S_COLORS.warning, borderRadius: 10, padding: 14,
  },
  assignPanelTitle: {
    color: C3S_COLORS.textMuted, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2,
  },
  tempFieldHint: {
    color: C3S_COLORS.textMuted, fontSize: 11, fontStyle: 'italic', marginBottom: 5,
  },

  // Step 3 — 50°F Cut inline panel
  cut50Panel: {
    marginTop: 8, backgroundColor: C3S_COLORS.successSoft, borderWidth: 1,
    borderColor: C3S_COLORS.success, borderRadius: 10, padding: 12,
  },
  cut50PanelLabel: {
    color: C3S_COLORS.textMuted, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2,
  },

  // Smokehouse grid — full D–O canonical grid (iPad-optimized)
  smokeGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 4,
  },
  smokeChip: {
    width: 72, height: 60,
    borderWidth: 1.5, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  smokeChipActive: {
    borderColor: C3S_COLORS.warning, backgroundColor: C3S_COLORS.warningSoft,
  },
  smokeChipBusy: {
    borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panelAlt, opacity: 0.55,
  },
  smokeChipCleaning: {
    borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panelAlt, opacity: 0.4,
  },
  smokeChipName: {
    color: C3S_COLORS.textPrimary, fontSize: 18, fontWeight: '800',
  },
  smokeChipNameActive: { color: C3S_COLORS.warning },
  smokeChipNameDim: { color: C3S_COLORS.textMuted },
  smokeChipStatus: {
    color: C3S_COLORS.textMuted, fontSize: 9, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2,
  },
  secondaryButton: {
    borderWidth: 1, borderColor: C3S_COLORS.border, backgroundColor: C3S_COLORS.panel,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  secondaryButtonText: { color: C3S_COLORS.textMuted, fontSize: 13, fontWeight: '700' },

  primaryAction: {
    borderRadius: 10, minHeight: 50, borderWidth: 1,
    borderColor: C3S_COLORS.warning, backgroundColor: C3S_COLORS.warningSoft,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  primaryActionText: { color: C3S_COLORS.warning, fontSize: 13, fontWeight: '700' },

  // 4-probe grid (Step 6)
  probeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  probeInput: {
    width: '47%', borderWidth: 1, borderColor: C3S_COLORS.border,
    borderRadius: 8, backgroundColor: C3S_COLORS.panel, color: C3S_COLORS.textPrimary,
    fontSize: 13, paddingHorizontal: 10, paddingVertical: 8, minHeight: 42,
  },
  probeInputPass: { borderColor: C3S_COLORS.success, backgroundColor: C3S_COLORS.successSoft },
  probeInputFail: { borderColor: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft },
  probeAllPass: { color: C3S_COLORS.success, fontSize: 13, fontWeight: '700', marginTop: 4 },
  probeFailWarning: { color: C3S_COLORS.danger, fontSize: 13, fontWeight: '700', marginTop: 4 },
  finishAction: {
    borderRadius: 10, minHeight: 42, borderWidth: 1,
    borderColor: C3S_COLORS.success, backgroundColor: C3S_COLORS.successSoft,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  finishActionText: { color: C3S_COLORS.textPrimary, fontSize: 13, fontWeight: '700' },

  // ── Rack pool parent indicator (Section 1 card top) ──────────────────────
  rackPoolBanner: {
    backgroundColor: C3S_COLORS.accentSoft,
    borderWidth: 1,
    borderColor: C3S_COLORS.accent,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  rackPoolBannerText: {
    color: C3S_COLORS.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // ── Rack pool breakdown box inside assign panel ────────────────────────────
  rackPoolInfoBox: {
    backgroundColor: C3S_COLORS.accentSoft,
    borderWidth: 1,
    borderColor: C3S_COLORS.accent,
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    marginBottom: 4,
  },

  // ── Load preview box (shows per-smokehouse allocation preview) ─────────────
  loadPreviewBox: {
    backgroundColor: C3S_COLORS.successSoft,
    borderWidth: 1,
    borderColor: C3S_COLORS.success,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    marginBottom: 4,
    gap: 2,
  },

  // ── Child load banner (Sections 2 & 3 cards) ──────────────────────────────
  childLoadBanner: {
    backgroundColor: C3S_COLORS.accentSoft,
    borderWidth: 1,
    borderColor: C3S_COLORS.accent,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 8,
  },
  childLoadBannerText: {
    color: C3S_COLORS.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // ── Deviation badge (on card header) ─────────────────────────────────────
  deviationBadge: {
    borderWidth: 1, borderColor: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    marginRight: 6, alignSelf: 'flex-start',
  },
  deviationBadgeText: { color: C3S_COLORS.warning, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  // ── Deviation panel (inline, inside step panels) ──────────────────────────
  deviationPanel: {
    marginTop: 8, borderWidth: 1, borderColor: C3S_COLORS.danger,
    backgroundColor: C3S_COLORS.warningSoft, borderRadius: 8, padding: 10, gap: 6,
  },
  deviationPanelTitle: { color: C3S_COLORS.warning, fontSize: 13, fontWeight: '800', marginBottom: 2 },
  deviationPanelHint: { color: C3S_COLORS.textMuted, fontSize: 12, fontWeight: '500', marginBottom: 4 },
  deviationSubmitButton: {
    borderRadius: 8, borderWidth: 1, borderColor: C3S_COLORS.danger, backgroundColor: C3S_COLORS.dangerSoft,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 9, marginTop: 4,
  },
  deviationSubmitText: { color: C3S_COLORS.warning, fontSize: 13, fontWeight: '800' },

  // ── DEV: occupancy identity debug box (Section 2 child cards) ────────────
  devDebugBox: {
    marginTop: 8,
    backgroundColor: C3S_COLORS.panelAlt,
    borderWidth: 1,
    borderColor: C3S_COLORS.border,
    borderRadius: 6,
    padding: 8,
    gap: 2,
  },
  devDebugText: {
    color: C3S_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
});
