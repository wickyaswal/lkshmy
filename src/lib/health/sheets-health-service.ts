import { getGoogleSheetsRepository, type GoogleSheetsRepository } from "@/lib/sheets/google-sheets";
import { buildConnectionIndicator, type CachedHealthState } from "@/lib/health/types";
import type { ConnectionIndicator } from "@/lib/trading/types";

const CHECK_INTERVAL_MS = 45_000;
const SUCCESS_WINDOW_MS = 60_000;

export class SheetsHealthService {
  private readonly state: CachedHealthState = {
    lastCheckedAt: 0,
    lastSuccessAt: null,
    lastError: null
  };
  private inFlight: Promise<ConnectionIndicator> | null = null;

  constructor(private readonly sheets: GoogleSheetsRepository = getGoogleSheetsRepository()) {}

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

    try {
      await this.sheets.healthCheck();
      this.state.lastSuccessAt = new Date(now).toISOString();
      this.state.lastError = null;
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : "Google Sheets health check failed.";
    }

    return buildConnectionIndicator({
      state: this.state,
      now,
      checkIntervalMs: CHECK_INTERVAL_MS,
      successWindowMs: SUCCESS_WINDOW_MS
    });
  }
}

let sheetsHealthService: SheetsHealthService | null = null;

export const getSheetsHealthService = (): SheetsHealthService => {
  if (!sheetsHealthService) {
    sheetsHealthService = new SheetsHealthService();
  }

  return sheetsHealthService;
};
