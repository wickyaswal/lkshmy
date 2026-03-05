import type { ConnectionIndicator } from "@/lib/trading/types";

export interface CachedHealthState {
  lastCheckedAt: number;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export type HealthCheckFunction = () => Promise<void>;

export const buildConnectionIndicator = (input: {
  state: CachedHealthState;
  now: number;
  checkIntervalMs: number;
  successWindowMs: number;
}): ConnectionIndicator => {
  const { state, now, checkIntervalMs, successWindowMs } = input;
  const successAgeMs = state.lastSuccessAt ? now - Date.parse(state.lastSuccessAt) : Number.POSITIVE_INFINITY;
  const connected = Number.isFinite(successAgeMs) && successAgeMs <= successWindowMs;
  const status = connected
    ? state.lastError
      ? "DEGRADED"
      : "CONNECTED"
    : state.lastSuccessAt
      ? "DEGRADED"
      : "DISCONNECTED";

  return {
    status,
    connected,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    checkedAt: state.lastCheckedAt > 0 ? new Date(state.lastCheckedAt).toISOString() : new Date(now).toISOString(),
    checkIntervalSeconds: Math.floor(checkIntervalMs / 1000),
    successWindowSeconds: Math.floor(successWindowMs / 1000)
  };
};
