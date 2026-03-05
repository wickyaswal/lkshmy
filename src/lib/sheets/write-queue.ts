import type { sheets_v4 } from "googleapis";

const DEFAULT_AUTO_FLUSH_INTERVAL_MS = 20_000;
const QUOTA_COOLDOWN_MS = 60_000;
const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

export type RangeUpdateIntent = {
  rangeA1: string;
  values2D: string[][];
};

export type AppendRowsIntent = {
  sheetName: string;
  rows2D: string[][];
};

export type SheetsFlushResult = {
  rangeUpdates: RangeUpdateIntent[];
  appendRows: AppendRowsIntent[];
  flushedAt: string;
};

export type SheetsWriteQueueState = {
  pendingRangeUpdates: number;
  pendingAppendSheets: number;
  pendingAppendRows: number;
  inFlight: boolean;
  lastFlushSuccessAt: string | null;
  lastFlushError: string | null;
  cooldownUntil: string | null;
  nextRetryAt: string | null;
  backoffMs: number;
};

type FlushErrorPayload = {
  message: string;
  quotaError: boolean;
  at: string;
};

type QueueInput = {
  getClient: () => Promise<sheets_v4.Sheets>;
  getSpreadsheetId: () => string;
  onFlushSuccess?: (result: SheetsFlushResult) => void;
  onFlushError?: (error: FlushErrorPayload) => void;
};

const clone2d = (input: string[][]): string[][] => input.map((row) => [...row]);

const isQuotaWriteError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("quota") &&
    (message.includes("write requests") || message.includes("write request") || message.includes("rate limit"))
  );
};

export class SheetsWriteQueue {
  private readonly pendingRangeUpdates = new Map<string, string[][]>();
  private readonly pendingAppendRows = new Map<string, string[][]>();
  private autoFlushTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private lastFlushSuccessAt: string | null = null;
  private lastFlushError: string | null = null;
  private cooldownUntilMs = 0;
  private nextRetryAtMs = 0;
  private backoffMs = 0;

  constructor(private readonly input: QueueInput) {}

  queueRangeUpdate(rangeA1: string, values2D: string[][]): void {
    if (!rangeA1 || values2D.length === 0) {
      return;
    }

    this.pendingRangeUpdates.set(rangeA1, clone2d(values2D));
  }

  queueMultiRangeUpdate(updates: RangeUpdateIntent[]): void {
    for (const update of updates) {
      this.queueRangeUpdate(update.rangeA1, update.values2D);
    }
  }

  queueAppendRows(sheetName: string, rows2D: string[][]): void {
    if (!sheetName || rows2D.length === 0) {
      return;
    }

    const existing = this.pendingAppendRows.get(sheetName) ?? [];
    this.pendingAppendRows.set(sheetName, [...existing, ...clone2d(rows2D)]);
  }

  startAutoFlush(intervalMs = DEFAULT_AUTO_FLUSH_INTERVAL_MS): void {
    if (this.autoFlushTimer) {
      clearInterval(this.autoFlushTimer);
      this.autoFlushTimer = null;
    }

    const safeInterval = Math.max(1000, Math.trunc(intervalMs));
    this.autoFlushTimer = setInterval(() => {
      void this.flushNow().catch(() => undefined);
    }, safeInterval);

    if (typeof this.autoFlushTimer.unref === "function") {
      this.autoFlushTimer.unref();
    }
  }

  stopAutoFlush(): void {
    if (!this.autoFlushTimer) {
      return;
    }

    clearInterval(this.autoFlushTimer);
    this.autoFlushTimer = null;
  }

  getState(): SheetsWriteQueueState {
    const now = Date.now();
    const pendingAppendRows = Array.from(this.pendingAppendRows.values()).reduce((sum, rows) => sum + rows.length, 0);

    return {
      pendingRangeUpdates: this.pendingRangeUpdates.size,
      pendingAppendSheets: this.pendingAppendRows.size,
      pendingAppendRows,
      inFlight: Boolean(this.inFlight),
      lastFlushSuccessAt: this.lastFlushSuccessAt,
      lastFlushError: this.lastFlushError,
      cooldownUntil: this.cooldownUntilMs > now ? new Date(this.cooldownUntilMs).toISOString() : null,
      nextRetryAt: this.nextRetryAtMs > now ? new Date(this.nextRetryAtMs).toISOString() : null,
      backoffMs: this.backoffMs
    };
  }

  async flushNow(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const now = Date.now();
    if (now < this.cooldownUntilMs || now < this.nextRetryAtMs) {
      return;
    }

    if (this.pendingRangeUpdates.size === 0 && this.pendingAppendRows.size === 0) {
      return;
    }

    const rangeSnapshot = new Map<string, string[][]>(this.pendingRangeUpdates);
    const appendSnapshot = new Map<string, string[][]>();
    for (const [sheetName, rows] of this.pendingAppendRows.entries()) {
      appendSnapshot.set(sheetName, clone2d(rows));
    }

    this.pendingRangeUpdates.clear();
    this.pendingAppendRows.clear();

    this.inFlight = this.flushSnapshot(rangeSnapshot, appendSnapshot)
      .catch((error) => {
        this.requeueFailed(rangeSnapshot, appendSnapshot);
        this.handleFlushError(error);
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  private async flushSnapshot(
    rangeSnapshot: Map<string, string[][]>,
    appendSnapshot: Map<string, string[][]>
  ): Promise<void> {
    const client = await this.input.getClient();
    const spreadsheetId = this.input.getSpreadsheetId();
    const rangeUpdates: RangeUpdateIntent[] = Array.from(rangeSnapshot.entries()).map(([rangeA1, values2D]) => ({
      rangeA1,
      values2D: clone2d(values2D)
    }));
    const appendRows: AppendRowsIntent[] = [];

    if (rangeUpdates.length > 0) {
      await client.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: rangeUpdates.map((update) => ({
            range: update.rangeA1,
            values: update.values2D
          }))
        }
      });
    }

    const prioritizedSheet = appendSnapshot.has("Trades")
      ? "Trades"
      : Array.from(appendSnapshot.keys())[0];

    if (prioritizedSheet) {
      const rows = appendSnapshot.get(prioritizedSheet) ?? [];
      if (rows.length > 0) {
        await client.spreadsheets.values.append({
          spreadsheetId,
          range: `${prioritizedSheet}!A1`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: {
            values: rows
          }
        });
        appendRows.push({
          sheetName: prioritizedSheet,
          rows2D: clone2d(rows)
        });
      }
      appendSnapshot.delete(prioritizedSheet);
    }

    if (appendSnapshot.size > 0) {
      this.requeueFailed(new Map(), appendSnapshot);
    }

    this.lastFlushSuccessAt = new Date().toISOString();
    this.lastFlushError = null;
    this.cooldownUntilMs = 0;
    this.nextRetryAtMs = 0;
    this.backoffMs = 0;
    this.input.onFlushSuccess?.({
      rangeUpdates,
      appendRows,
      flushedAt: this.lastFlushSuccessAt
    });
  }

  private handleFlushError(error: unknown): void {
    const now = Date.now();
    const message = error instanceof Error ? error.message : "Unknown Sheets flush error.";
    const quotaError = isQuotaWriteError(error);
    this.lastFlushError = message;

    if (quotaError) {
      this.backoffMs = this.backoffMs === 0 ? INITIAL_BACKOFF_MS : Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.cooldownUntilMs = now + QUOTA_COOLDOWN_MS;
      this.nextRetryAtMs = this.cooldownUntilMs + this.backoffMs;
    } else {
      this.nextRetryAtMs = now + Math.min(this.backoffMs || INITIAL_BACKOFF_MS, MAX_BACKOFF_MS);
      this.backoffMs = Math.min(Math.max(this.backoffMs || INITIAL_BACKOFF_MS, INITIAL_BACKOFF_MS), MAX_BACKOFF_MS);
    }

    this.input.onFlushError?.({
      message,
      quotaError,
      at: new Date(now).toISOString()
    });
  }

  private requeueFailed(
    failedRanges: Map<string, string[][]>,
    failedAppends: Map<string, string[][]>
  ): void {
    for (const [rangeA1, values2D] of failedRanges.entries()) {
      if (!this.pendingRangeUpdates.has(rangeA1)) {
        this.pendingRangeUpdates.set(rangeA1, clone2d(values2D));
      }
    }

    for (const [sheetName, rows] of failedAppends.entries()) {
      const existing = this.pendingAppendRows.get(sheetName) ?? [];
      this.pendingAppendRows.set(sheetName, [...clone2d(rows), ...existing]);
    }
  }
}
