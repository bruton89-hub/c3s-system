/** Enable only after hold_events rules are deployed in the target development environment. */
export const HOLD_WORKFLOW_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_HOLD_WORKFLOW === 'true';
