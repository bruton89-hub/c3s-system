/**
 * Product Intelligence — public types.
 *
 * The ProductProfile is the **operational rules engine** for the entire app.
 * Planning, forecasting, capacity tracking, and the thermal timeline all
 * resolve product behavior through this profile.
 *
 * Firestore collection: `product_profiles`
 */
import type {
  ProductBoxType,
  ProductCategory,
  ProductProcessType,
  ProductProfileDoc,
  ProductSmokeType,
  ProductSpecies,
} from '@/lib/firebase/models';

export type {
  ProductBoxType,
  ProductCategory,
  ProductProcessType,
  ProductProfileDoc,
  ProductSmokeType,
  ProductSpecies,
};

/** ProductProfile as stored in Firestore, with the document id attached. */
export type ProductProfile = ProductProfileDoc & { id: string };

/** Input shape for creating a new product profile (createdAt added at write). */
export type NewProductProfileInput = Omit<ProductProfileDoc, 'createdAt' | 'updatedAt'> & {
  createdAt?: import('firebase/firestore').Timestamp;
};

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  salad_items: 'Salad Items',
  fresh_kitchen: 'Fresh Kitchen',
  bulk_items: 'Bulk Items',
  slicing_items: 'Slicing Items',
  other: 'Other',
};

export const PRODUCTION_SECTION_LABELS = {
  boning_room: 'Boning Room',
  ham_stuffing: 'Ham Stuffing',
  process_meats: 'Process Meats',
  turkey_room: 'Turkey Room',
} as const;

export type ProductionSection = keyof typeof PRODUCTION_SECTION_LABELS;

export const PRODUCTION_SECTION_ORDER: ProductionSection[] = [
  'boning_room',
  'ham_stuffing',
  'process_meats',
  'turkey_room',
];

/** Convenience: get a printable duration "Xh Ym" from decimal hours. */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
