/**
 * Product Intelligence — public surface.
 *
 * Consumers should import from `@/lib/products` rather than reaching into
 * the implementation files. This keeps the rules engine swappable.
 */
export * from './types';
export * from './repository';
export { PRODUCT_PROFILE_SEED } from './seed-data';
