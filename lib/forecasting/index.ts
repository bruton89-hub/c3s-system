/**
 * Forecasting engine.
 *
 * Pure functions that translate (product profile + rack count + planned start)
 * into expected milestones across the cook → chill → packaging path.
 *
 * Design: zero side effects, no Firestore reads. The caller passes in a
 * ProductProfile (resolved via product_profiles repo). This keeps forecasting
 * trivial to unit test and reuseable on both planning + thermal-timeline.
 */
import type { ProductProfile } from '@/lib/products';

export interface ForecastInput {
  /** Resolved product profile (cook/chill/blast hours come from here). */
  profile: Pick<
    ProductProfile,
    | 'estimatedCookTimeHours'
    | 'estimatedChillTimeHours'
    | 'estimatedBlastCellHours'
    | 'rackCapacity'
    | 'productName'
    | 'productCode'
  >;
  /** Number of racks scheduled. Drives the load-factor adjustment. */
  rackCount: number;
  /** Planned start moment for the cook. */
  plannedStart: Date;
  /**
   * Optional packaging buffer (hours) after the last cold-side step finishes
   * before the load is considered "packaging ready". Defaults to 0.5h.
   */
  packagingBufferHours?: number;
}

export interface ForecastResult {
  /** Planned cook start (echoed). */
  cookStart: Date;
  /** Expected cook completion (`cookStart + adjustedCookHours`). */
  cookEnd: Date;
  /** Adjusted cook hours used for the computation. */
  adjustedCookHours: number;
  /**
   * Expected chill completion. Null when the profile has no chill step
   * (NA on master sheet). Chill runs in parallel with blast cell if both exist;
   * the "post-thermal" completion is `max(chillEnd, blastEnd)`.
   */
  chillEnd: Date | null;
  /** Expected blast cell completion. Null when profile has no blast step. */
  blastEnd: Date | null;
  /** Whichever cold step (chill or blast) finishes last. */
  postThermalEnd: Date;
  /** Packaging readiness ETA = postThermalEnd + packagingBuffer. */
  packagingReadyEta: Date;
  /** Total operational hours from cook start to packaging ready. */
  totalHours: number;
  /** Multiplier applied to cook hours (rackCount / rackCapacity, clamped). */
  loadFactor: number;
}

/**
 * Compute the rack-utilization load factor.
 *
 * Below capacity → 1.0 (no penalty).
 * Above capacity → linear penalty up to 1.5×.
 * This is intentionally conservative; real cook overruns are tracked
 * separately via operational_events.
 */
export function computeLoadFactor(rackCount: number, rackCapacity: number): number {
  if (!Number.isFinite(rackCount) || rackCount <= 0) return 1;
  if (!Number.isFinite(rackCapacity) || rackCapacity <= 0) return 1;
  if (rackCount <= rackCapacity) return 1;
  const overflow = rackCount / rackCapacity;
  return Math.min(1.5, overflow);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Run the forecast.
 *
 * Cook duration is scaled by load factor (over-capacity loads cook slower
 * because of airflow/heat-transfer constraints). Chill and blast cell stages
 * are NOT scaled — they're driven by product mass, not house loading.
 */
export function forecastSchedule(input: ForecastInput): ForecastResult {
  const {
    profile,
    rackCount,
    plannedStart,
    packagingBufferHours = 0.5,
  } = input;

  const loadFactor = computeLoadFactor(rackCount, profile.rackCapacity);
  const adjustedCookHours = Math.max(0, profile.estimatedCookTimeHours) * loadFactor;
  const cookStart = plannedStart;
  const cookEnd = addHours(cookStart, adjustedCookHours);

  const chillHours = profile.estimatedChillTimeHours;
  const blastHours = profile.estimatedBlastCellHours;

  const chillEnd = chillHours > 0 ? addHours(cookEnd, chillHours) : null;
  const blastEnd = blastHours > 0 ? addHours(cookEnd, blastHours) : null;

  // Pick the later of the two cold-side steps. If neither exists, the cook
  // itself defines the post-thermal moment.
  const candidates = [chillEnd, blastEnd].filter((d): d is Date => d !== null);
  const postThermalEnd = candidates.length > 0
    ? candidates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
    : cookEnd;

  const packagingReadyEta = addHours(postThermalEnd, packagingBufferHours);
  const totalHours = (packagingReadyEta.getTime() - cookStart.getTime()) / (60 * 60 * 1000);

  return {
    cookStart,
    cookEnd,
    adjustedCookHours,
    chillEnd,
    blastEnd,
    postThermalEnd,
    packagingReadyEta,
    totalHours,
    loadFactor,
  };
}

/** Convenience: format a Date as "Mon 14:30" for compact UI labels. */
export function formatForecastTime(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[d.getDay()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${hh}:${mm}`;
}

/** Compute the BTC (load factor) shown on the spreadsheet as a single number. */
export function computeBtc(rackCount: number, rackCapacity: number): number {
  if (rackCapacity <= 0) return 0;
  return Math.round((rackCount / rackCapacity) * 100) / 100;
}
