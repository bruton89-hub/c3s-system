export const HOLD_REASONS = [
  { key: 'qa_review', label: 'QA Review' },
  { key: 'process_deviation', label: 'Process Deviation' },
  { key: 'equipment_issue', label: 'Equipment Issue' },
  { key: 'product_condition', label: 'Product Condition' },
  { key: 'documentation', label: 'Documentation' },
  { key: 'supervisor_decision', label: 'Supervisor Decision' },
  { key: 'other', label: 'Other' },
] as const;

export const SUPPORTED_HOLD_OUTCOMES = [
  { key: 'released_to_production', label: 'Released to Production' },
] as const;

export function isHeldStatus(status: string): boolean {
  return status === 'hold' || status === 'qa_hold' || status === 'qa_review_required';
}

export function progressionAllowed(status: string): boolean {
  return !isHeldStatus(status);
}

export function isSupportedHoldOutcome(outcome: string): boolean {
  return SUPPORTED_HOLD_OUTCOMES.some((entry) => entry.key === outcome);
}
