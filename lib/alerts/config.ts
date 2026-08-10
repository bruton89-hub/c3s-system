/**
 * Persistence is opt-in until the new rules and indexes are deployed.
 * This prevents a preview build pointed at an existing Firebase project from
 * creating lifecycle documents merely because an operator opens Alerts.
 */
export const ALERT_PERSISTENCE_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_ALERT_PERSISTENCE === 'true';
