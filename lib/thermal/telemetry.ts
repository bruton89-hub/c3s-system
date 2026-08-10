/**
 * Presentation boundary for a future real oven integration.
 * No provider implementation, mock telemetry, protocol, or oven controls are included.
 */
export type OvenTelemetrySnapshot = {
  ovenId: string;
  connectionStatus: 'connected' | 'disconnected' | 'unknown';
  recipe?: string | null;
  currentStep?: string | null;
  dryBulb?: number | null;
  wetBulb?: number | null;
  productTemperature?: number | null;
  elapsedMinutes?: number | null;
  alarmState?: string | null;
};

export interface OvenTelemetryProvider {
  getSnapshot(ovenId: string): Promise<OvenTelemetrySnapshot | null>;
  subscribe?(ovenId: string, onSnapshot: (snapshot: OvenTelemetrySnapshot) => void): () => void;
}

/** Intentionally disconnected until authenticated ALKAR integration details exist. */
export const ovenTelemetryProvider: OvenTelemetryProvider | null = null;
