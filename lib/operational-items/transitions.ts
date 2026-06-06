/**
 * lib/operational-items/transitions.ts
 *
 * Pure helpers for validating and building state machine transitions.
 * No Firestore I/O — these are synchronous utility functions.
 */

import { Timestamp } from 'firebase/firestore';
import {
  VALID_TRANSITIONS,
  STATUS_TO_STAGE,
  type OItemStage,
  type OItemStatus,
  type TransitionRecord,
} from './model';

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns true if moving from `from` to `to` is a valid transition.
 *
 * `hold` is always allowed from any non-terminal status.
 * Returning from `hold` is constrained by VALID_TRANSITIONS['hold'].
 */
export function isValidTransition(from: OItemStatus, to: OItemStatus): boolean {
  if (from === to) return false; // no-op transitions are not allowed
  if (from === 'complete' || from === 'packaging_complete') return false; // terminal states

  // Allow hold from any non-terminal
  if (to === 'hold') return true;

  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return (allowed as readonly OItemStatus[]).includes(to);
}

/**
 * Throws a descriptive error if the transition is not valid.
 */
export function validateTransition(
  from: OItemStatus,
  to: OItemStatus,
  context = 'Transition',
): void {
  if (!isValidTransition(from, to)) {
    throw new Error(
      `${context}: invalid transition '${from}' → '${to}'. ` +
        `Allowed from '${from}': [${(VALID_TRANSITIONS[from] ?? []).join(', ')}]`,
    );
  }
}

// ── Stage derivation ──────────────────────────────────────────────────────────

/**
 * Derive the canonical stage from a status.
 * When the new status is `hold`, the stage is preserved (caller must pass currentStage).
 */
export function deriveStage(newStatus: OItemStatus, currentStage: OItemStage): OItemStage {
  if (newStatus === 'hold') return currentStage;
  return STATUS_TO_STAGE[newStatus] ?? currentStage;
}

// ── TransitionRecord builder ──────────────────────────────────────────────────

/**
 * Build a TransitionRecord to be appended to `OItemDoc.transitions`.
 *
 * Validates the transition before building — throws if invalid.
 */
export function buildTransitionRecord(
  from: { stage: OItemStage; status: OItemStatus },
  toStatus: OItemStatus,
  by: string,
  reason?: string,
): { record: TransitionRecord; toStage: OItemStage } {
  validateTransition(from.status, toStatus, 'buildTransitionRecord');

  const toStage = deriveStage(toStatus, from.stage);
  const record: TransitionRecord = {
    from,
    to: { stage: toStage, status: toStatus },
    by,
    at: Timestamp.now(),
    ...(reason ? { reason } : {}),
  };
  return { record, toStage };
}
