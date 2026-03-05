import { getEnv } from "@/lib/env";
import { KrakenClient } from "@/lib/kraken/kraken-client";
import { buildConnectionIndicator, type CachedHealthState } from "@/lib/health/types";
import type { ConnectionIndicator } from "@/lib/trading/types";

const CHECK_INTERVAL_MS = 45_000;
const SUCCESS_WINDOW_MS = 60_000;

export class KrakenHealthService {
  private readonly state: CachedHealthState = {
    lastCheckedAt: 0,
    lastSuccessAt: null,
    lastError: null
  };
  private inFlight: Promise<ConnectionIndicator> | null = null;
  private client: KrakenClient | null = null;

  async check(force = false): Promise<ConnectionIndicator> {
    const now = Date.now();

    if (!force && now - this.state.lastCheckedAt < CHECK_INTERVAL_MS) {
      return buildConnectionIndicator({
        state: this.state,
        now,
        checkIntervalMs: CHECK_INTERVAL_MS,
        successWindowMs: SUCCESS_WINDOW_MS
      });
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.runCheck();
    const result = await this.inFlight;
    this.inFlight = null;
    return result;
  }

  private async runCheck(): Promise<ConnectionIndicator> {
    const now = Date.now();
    this.state.lastCheckedAt = now;
    const env = getEnv();

    if (!env.krakenApiKey || !env.krakenApiSecret) {
      this.state.lastError = "Kraken credentials are missing.";
      return buildConnectionIndicator({
        state: this.state,
        now,
        checkIntervalMs: CHECK_INTERVAL_MS,
        successWindowMs: SUCCESS_WINDOW_MS
      });
    }

    try {
      if (!this.client) {
        this.client = new KrakenClient({
          apiKey: env.krakenApiKey,
          apiSecret: env.krakenApiSecret
        });
      }

      await this.client.getBalances();
      this.state.lastSuccessAt = new Date(now).toISOString();
      this.state.lastError = null;
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : "Kraken health check failed.";
    }

    return buildConnectionIndicator({
      state: this.state,
      now,
      checkIntervalMs: CHECK_INTERVAL_MS,
      successWindowMs: SUCCESS_WINDOW_MS
    });
  }
}

let krakenHealthService: KrakenHealthService | null = null;

export const getKrakenHealthService = (): KrakenHealthService => {
  if (!krakenHealthService) {
    krakenHealthService = new KrakenHealthService();
  }

  return krakenHealthService;
};
