import { google, sheets_v4 } from "googleapis";

import { getEnv, requireSpreadsheetId } from "@/lib/env";
import { SHEET_SCHEMAS, type SheetName } from "@/lib/sheets/schema";
import { SheetsWriteQueue, type SheetsFlushResult, type SheetsWriteQueueState } from "@/lib/sheets/write-queue";
import { parseBotConfig } from "@/lib/trading/config";
import { DEFAULT_CONFIG_ROWS, DEFAULT_DAILY_STATE_META, DEFAULT_STATUS_ROWS } from "@/lib/trading/defaults";
import type {
  BotConfig,
  BotStatusSnapshot,
  BufferLedgerRow,
  ConfigRow,
  DailySummaryRow,
  DailyStateMeta,
  ExchangeAvailability,
  ExchangeId,
  NetCostTrackingRow,
  OpenPositionMeta,
  PairState,
  PairSelectionRow,
  StatusKey,
  StatusRow,
  TradeRow
} from "@/lib/trading/types";
import { formatDateInTimeZone, parseBooleanLike, safeJsonParse } from "@/lib/utils";

type RowShape = Record<string, string>;
type IndexedRow<T> = {
  rowIndex: number;
  row: T;
};
type ModeNotes = {
  enabledExchanges?: ExchangeAvailability[];
  liveCapableExchanges?: ExchangeId[];
  selectedLiveExchange?: ExchangeId | null;
  pairStates?: Record<string, PairState>;
};
type StatusValue = {
  value: string;
  notes: string;
};
type WritePipelineState = {
  queue: SheetsWriteQueueState;
  inMemoryError: string | null;
};

const STATUS_KEYS: StatusKey[] = [
  "bot_enabled",
  "mode",
  "active_symbol",
  "trading_capital_tc_usdt",
  "buffer_usdt",
  "open_position",
  "open_position_side",
  "open_position_entry_price",
  "open_position_qty",
  "open_position_open_time",
  "today_realized_pnl_usdt",
  "trades_today",
  "daily_stop_hit",
  "last_error",
  "last_heartbeat"
];
const STATUS_KEY_SET = new Set<StatusKey>(STATUS_KEYS);
const STATUS_READ_CACHE_MS = 10_000;
const RECENT_TRADES_READ_CACHE_MS = 15_000;

const columnLetter = (index: number): string => {
  let value = index + 1;
  let letters = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }

  return letters;
};

const rowToValues = <T extends object>(row: T, headers: readonly string[]): string[] =>
  headers.map((header) => String((row as Record<string, unknown>)[header] ?? ""));

const isStatusKey = (value: string): value is StatusKey => STATUS_KEY_SET.has(value as StatusKey);

export class GoogleSheetsRepository {
  private clientPromise: Promise<sheets_v4.Sheets> | null = null;
  private templatesPromise: Promise<void> | null = null;
  private readonly writeQueue: SheetsWriteQueue;
  private readonly statusWriteIntervalMs: number;
  private readonly statusRowByKey = new Map<StatusKey, number>();
  private readonly statusLastWritten = new Map<StatusKey, StatusValue>();
  private readonly statusPending = new Map<StatusKey, StatusValue>();
  private statusCacheReady = false;
  private lastHeartbeatQueuedAt = 0;
  private inMemoryWriteError: string | null = null;
  private readonly tradeIdsWritten = new Set<string>();
  private readonly tradeIdsPending = new Set<string>();
  private readonly pendingTradeRows = new Map<string, TradeRow>();
  private tradeIdCacheReady = false;
  private readonly keyedRowIndexCache = new Map<string, Map<string, number>>();
  private readonly nextRowBySheet = new Map<SheetName, number>();
  private statusRowsCache: { rows: StatusRow[]; fetchedAt: number } | null = null;
  private recentTradesCache: { rows: TradeRow[]; fetchedAt: number } | null = null;

  constructor() {
    const env = getEnv();
    const flushIntervalSeconds = Math.max(5, Math.trunc(env.sheetsFlushIntervalSeconds));
    this.statusWriteIntervalMs = Math.max(5, Math.trunc(env.sheetsStatusWriteIntervalSeconds)) * 1000;
    this.writeQueue = new SheetsWriteQueue({
      getClient: () => this.getClient(),
      getSpreadsheetId: () => requireSpreadsheetId(),
      onFlushSuccess: (result) => {
        this.handleQueueFlushSuccess(result);
      },
      onFlushError: (error) => {
        this.inMemoryWriteError = error.message;
      }
    });
    this.writeQueue.startAutoFlush(flushIntervalSeconds * 1000);
  }

  private async getClient(): Promise<sheets_v4.Sheets> {
    if (!this.clientPromise) {
      const env = getEnv();
      const auth = env.googleApplicationCredentialsPath
        ? new google.auth.GoogleAuth({
            keyFile: env.googleApplicationCredentialsPath,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"]
          })
        : (() => {
            const credentials = env.googleServiceAccountJson
              ? JSON.parse(env.googleServiceAccountJson)
              : {
                  client_email: env.googleServiceAccountEmail,
                  private_key: env.googleServiceAccountPrivateKey
                };

            if (!credentials.client_email || !credentials.private_key) {
              throw new Error(
                "Google service account credentials are required. Set GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY."
              );
            }

            return new google.auth.GoogleAuth({
              credentials,
              scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });
          })();

      this.clientPromise = Promise.resolve(google.sheets({ version: "v4", auth }));
    }

    return this.clientPromise;
  }

  async ensureTemplates(): Promise<void> {
    if (this.templatesPromise) {
      return this.templatesPromise;
    }

    this.templatesPromise = this.ensureTemplatesInternal().catch((error) => {
      this.templatesPromise = null;
      throw error;
    });

    return this.templatesPromise;
  }

  async getConfig(): Promise<BotConfig> {
    await this.ensureTemplates();
    const rows = await this.readRowsFromSheet<ConfigRow>("Config");
    return parseBotConfig(rows);
  }

  async getConfigRows(): Promise<ConfigRow[]> {
    await this.ensureTemplates();
    return this.readRowsFromSheet<ConfigRow>("Config");
  }

  async getPairSelectionRows(): Promise<PairSelectionRow[]> {
    await this.ensureTemplates();
    return this.readRowsFromSheet<PairSelectionRow>("PairSelection");
  }

  async getStatus(config?: BotConfig): Promise<BotStatusSnapshot> {
    await this.ensureTemplates();
    const rows = await this.getStatusRowsCached();
    const timeZone = getEnv().botTimezone;
    const currentDate = formatDateInTimeZone(new Date(), timeZone);
    const defaultRows = DEFAULT_STATUS_ROWS(currentDate);
    const merged = new Map<StatusKey, StatusRow>(defaultRows.map((row) => [row.key, row]));

    for (const row of rows) {
      merged.set(row.key, {
        key: row.key,
        value: row.value ?? "",
        notes: row.notes ?? ""
      });
    }

    for (const [key, pending] of this.statusPending.entries()) {
      merged.set(key, {
        key,
        value: pending.value,
        notes: pending.notes
      });
    }

    for (const [key, persisted] of this.statusLastWritten.entries()) {
      merged.set(key, {
        key,
        value: persisted.value,
        notes: persisted.notes
      });
    }

    const read = (key: StatusKey): StatusRow => merged.get(key) ?? defaultRows.find((row) => row.key === key)!;
    const tradingCapitalTcUsdt = Number(read("trading_capital_tc_usdt").value || "0");
    const bufferUsdt = Number(read("buffer_usdt").value || "0");
    const fallbackDailyState = DEFAULT_DAILY_STATE_META(tradingCapitalTcUsdt || 0, bufferUsdt || 0, currentDate);
    const dailyStateMeta = safeJsonParse<DailyStateMeta>(read("today_realized_pnl_usdt").notes, fallbackDailyState);
    const openPositionMeta = safeJsonParse<OpenPositionMeta | null>(read("open_position").notes, null);
    const modeNotes = safeJsonParse<ModeNotes>(read("mode").notes, {});

    const snapshotConfig = config ?? (await this.getConfig());
    const resolvedSymbol = snapshotConfig.activeSymbol || read("active_symbol").value || "BTCUSDT";

    return {
      botEnabled: parseBooleanLike(read("bot_enabled").value),
      mode: read("mode").value.toUpperCase() === "LIVE" ? "LIVE" : "DEMO",
      activeSymbol: resolvedSymbol,
      tradingCapitalTcUsdt: Number.isFinite(tradingCapitalTcUsdt) ? tradingCapitalTcUsdt : 0,
      bufferUsdt: Number.isFinite(bufferUsdt) ? bufferUsdt : 0,
      openPosition: parseBooleanLike(read("open_position").value),
      openPositionSide: read("open_position_side").value ? "LONG" : "",
      openPositionEntryPrice: Number(read("open_position_entry_price").value || "0"),
      openPositionQty: Number(read("open_position_qty").value || "0"),
      openPositionOpenTime: read("open_position_open_time").value,
      todayRealizedPnlUsdt: Number(read("today_realized_pnl_usdt").value || "0"),
      tradesToday: Number(read("trades_today").value || "0"),
      dailyStopHit: parseBooleanLike(read("daily_stop_hit").value),
      lastError: read("last_error").value,
      lastHeartbeat: read("last_heartbeat").value,
      openPositionMeta,
      dailyStateMeta,
      enabledExchanges: modeNotes.enabledExchanges ?? [],
      liveCapableExchanges: modeNotes.liveCapableExchanges ?? []
    };
  }

  async getRecentTrades(limit: number): Promise<TradeRow[]> {
    await this.ensureTemplates();
    const rows = await this.getRecentTradesRowsCached();
    const merged = new Map<string, TradeRow>();

    for (const row of rows) {
      merged.set(row.trade_id, row);
    }

    for (const [tradeId, row] of this.pendingTradeRows.entries()) {
      if (!merged.has(tradeId)) {
        merged.set(tradeId, row);
      }
    }

    return Array.from(merged.values())
      .slice()
      .sort((left, right) => Date.parse(right.close_time || right.open_time) - Date.parse(left.close_time || left.open_time))
      .slice(0, limit);
  }

  async updateStatusEntries(entries: Partial<Record<StatusKey, { value: string; notes?: string }>>): Promise<void> {
    await this.ensureTemplates();
    await this.ensureStatusCache();
    const now = Date.now();
    const updates: Array<{ rangeA1: string; values2D: string[][] }> = [];

    for (const [key, payload] of Object.entries(entries) as Array<[StatusKey, { value: string; notes?: string }]>) {
      const notes = payload.notes ?? "";
      const candidate: StatusValue = {
        value: payload.value,
        notes
      };

      if (key === "last_heartbeat" && now - this.lastHeartbeatQueuedAt < this.statusWriteIntervalMs) {
        continue;
      }

      const baseline = this.statusPending.get(key) ?? this.statusLastWritten.get(key);
      if (baseline && baseline.value === candidate.value && baseline.notes === candidate.notes) {
        continue;
      }

      const rowIndex = await this.ensureStatusRowIndex(key);
      updates.push({
        rangeA1: `Status!A${rowIndex}:C${rowIndex}`,
        values2D: [[key, candidate.value, candidate.notes]]
      });
      this.statusPending.set(key, candidate);

      if (key === "last_heartbeat") {
        this.lastHeartbeatQueuedAt = now;
      }
    }

    if (updates.length === 0) {
      return;
    }

    this.writeQueue.queueMultiRangeUpdate(updates);
  }

  async appendTradeIfMissing(row: TradeRow): Promise<boolean> {
    await this.ensureTemplates();
    await this.ensureTradeIdCache();

    if (this.tradeIdsWritten.has(row.trade_id) || this.tradeIdsPending.has(row.trade_id)) {
      return false;
    }

    const headers = SHEET_SCHEMAS.Trades;
    this.tradeIdsPending.add(row.trade_id);
    this.pendingTradeRows.set(row.trade_id, row);
    this.writeQueue.queueAppendRows("Trades", [rowToValues(row, headers)]);
    return true;
  }

  async upsertDailySummary(row: DailySummaryRow): Promise<void> {
    await this.ensureTemplates();
    await this.queueUpsertRow("DailySummary", "date", row);
  }

  async appendBufferLedger(row: BufferLedgerRow): Promise<void> {
    await this.ensureTemplates();
    await this.queueAppendViaRange("BufferLedger", row);
  }

  async upsertNetCost(row: NetCostTrackingRow): Promise<void> {
    await this.ensureTemplates();
    await this.queueUpsertRow("NetCostTracking", "trade_id", row);
  }

  async exportTabs(): Promise<Record<SheetName, RowShape[]>> {
    await this.ensureTemplates();
    await this.writeQueue.flushNow().catch(() => undefined);
    const result = {} as Record<SheetName, RowShape[]>;

    for (const sheetName of Object.keys(SHEET_SCHEMAS) as SheetName[]) {
      result[sheetName] = await this.readRowsFromSheet<RowShape>(sheetName);
    }

    return result;
  }

  async healthCheck(): Promise<void> {
    const client = await this.getClient();
    const spreadsheetId = requireSpreadsheetId();
    await client.spreadsheets.values.get({
      spreadsheetId,
      range: "Status!A1:C2"
    });
  }

  getWritePipelineState(): WritePipelineState {
    return {
      queue: this.writeQueue.getState(),
      inMemoryError: this.inMemoryWriteError
    };
  }

  async flushWritesNow(): Promise<void> {
    await this.writeQueue.flushNow();
  }

  private async ensureTemplatesInternal(): Promise<void> {
    const client = await this.getClient();
    const spreadsheetId = requireSpreadsheetId();
    const meta = await client.spreadsheets.get({ spreadsheetId });
    const existingSheetNames = new Set(meta.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) as string[]);
    const sheetNames = Object.keys(SHEET_SCHEMAS) as SheetName[];
    const missingSheets = sheetNames.filter((sheetName) => !existingSheetNames.has(sheetName));

    if (missingSheets.length > 0) {
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: missingSheets.map((sheetName) => ({
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }))
        }
      });
    }

    const headerUpdates: Array<{ rangeA1: string; values2D: string[][] }> = [];

    for (const sheetName of sheetNames) {
      const headers = SHEET_SCHEMAS[sheetName];
      const lastColumn = columnLetter(headers.length - 1);
      const response = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:${lastColumn}1`
      });
      const headerRow = response.data.values?.[0]?.map((cell) => String(cell)) ?? [];
      const expected = Array.from(headers);
      const mismatched =
        headerRow.length !== expected.length || expected.some((header, index) => headerRow[index] !== header);

      if (mismatched) {
        headerUpdates.push({
          rangeA1: `${sheetName}!A1:${lastColumn}1`,
          values2D: [expected]
        });
      }
    }

    if (headerUpdates.length > 0) {
      this.writeQueue.queueMultiRangeUpdate(headerUpdates);
    }

    const currentDate = formatDateInTimeZone(new Date(), getEnv().botTimezone);
    const statusRows = await this.readRowsFromSheet<StatusRow>("Status");
    if (statusRows.length === 0) {
      const statusValues = DEFAULT_STATUS_ROWS(currentDate).map((row) => rowToValues(row, SHEET_SCHEMAS.Status));
      this.writeQueue.queueRangeUpdate(`Status!A2:C${statusValues.length + 1}`, statusValues);
    }

    const configRows = await this.readRowsFromSheet<ConfigRow>("Config");
    if (configRows.length === 0) {
      const configHeaders = SHEET_SCHEMAS.Config;
      const configLastColumn = columnLetter(configHeaders.length - 1);
      const configValues = DEFAULT_CONFIG_ROWS.map((row) => rowToValues(row, configHeaders));
      this.writeQueue.queueRangeUpdate(`Config!A2:${configLastColumn}${configValues.length + 1}`, configValues);
    }

    await this.writeQueue.flushNow();
  }

  private async readRowsFromSheet<T>(sheetName: SheetName): Promise<T[]> {
    const indexed = await this.readRowsWithIndexesFromSheet<T>(sheetName);
    return indexed.map((entry) => entry.row);
  }

  private async readRowsWithIndexesFromSheet<T>(sheetName: SheetName): Promise<IndexedRow<T>[]> {
    const client = await this.getClient();
    const spreadsheetId = requireSpreadsheetId();
    const headers = SHEET_SCHEMAS[sheetName];
    const lastColumn = columnLetter(headers.length - 1);
    const response = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:${lastColumn}`
    });
    const rows = response.data.values ?? [];
    const mapped: IndexedRow<T>[] = [];

    rows.forEach((rawRow, index) => {
      if (!rawRow.some((value) => String(value ?? "").trim() !== "")) {
        return;
      }

      const row = {} as Record<string, string>;
      headers.forEach((header, headerIndex) => {
        row[header] = String(rawRow[headerIndex] ?? "");
      });

      mapped.push({
        rowIndex: index + 2,
        row: row as T
      });
    });

    return mapped;
  }

  private async ensureStatusCache(): Promise<void> {
    if (this.statusCacheReady) {
      return;
    }

    const rows = await this.readRowsWithIndexesFromSheet<StatusRow>("Status");
    let maxRow = 1;

    for (const item of rows) {
      maxRow = Math.max(maxRow, item.rowIndex);
      this.statusRowByKey.set(item.row.key, item.rowIndex);
      this.statusLastWritten.set(item.row.key, {
        value: item.row.value ?? "",
        notes: item.row.notes ?? ""
      });
    }

    this.nextRowBySheet.set("Status", maxRow + 1);
    const heartbeat = this.statusLastWritten.get("last_heartbeat")?.value ?? "";
    const heartbeatMs = Date.parse(heartbeat);
    if (Number.isFinite(heartbeatMs)) {
      this.lastHeartbeatQueuedAt = heartbeatMs;
    }
    this.statusCacheReady = true;
  }

  private async getStatusRowsCached(): Promise<StatusRow[]> {
    const now = Date.now();
    if (this.statusRowsCache && now - this.statusRowsCache.fetchedAt < STATUS_READ_CACHE_MS) {
      return this.statusRowsCache.rows.map((row) => ({ ...row }));
    }

    const rows = await this.readRowsFromSheet<StatusRow>("Status");
    this.statusRowsCache = {
      rows: rows.map((row) => ({ ...row })),
      fetchedAt: now
    };
    return rows;
  }

  private async getRecentTradesRowsCached(): Promise<TradeRow[]> {
    const now = Date.now();
    if (this.recentTradesCache && now - this.recentTradesCache.fetchedAt < RECENT_TRADES_READ_CACHE_MS) {
      return this.recentTradesCache.rows.map((row) => ({ ...row }));
    }

    const rows = await this.readRowsFromSheet<TradeRow>("Trades");
    this.recentTradesCache = {
      rows: rows.map((row) => ({ ...row })),
      fetchedAt: now
    };
    return rows;
  }

  private async ensureStatusRowIndex(key: StatusKey): Promise<number> {
    const existing = this.statusRowByKey.get(key);
    if (existing) {
      return existing;
    }

    const rowIndex = await this.allocateNextRow("Status");
    this.statusRowByKey.set(key, rowIndex);
    return rowIndex;
  }

  private async ensureTradeIdCache(): Promise<void> {
    if (this.tradeIdCacheReady) {
      return;
    }

    const rows = await this.readRowsFromSheet<TradeRow>("Trades");
    for (const row of rows) {
      if (row.trade_id) {
        this.tradeIdsWritten.add(row.trade_id);
      }
    }
    this.tradeIdCacheReady = true;
  }

  private async queueUpsertRow<T extends object>(sheetName: SheetName, keyColumn: string, row: T): Promise<void> {
    const indexMap = await this.ensureKeyIndexMap(sheetName, keyColumn);
    const candidate = row as Record<string, unknown>;
    const key = String(candidate[keyColumn] ?? "");
    if (!key) {
      return;
    }

    let rowIndex = indexMap.get(key);
    if (!rowIndex) {
      rowIndex = await this.allocateNextRow(sheetName);
      indexMap.set(key, rowIndex);
    }

    const headers = SHEET_SCHEMAS[sheetName];
    const lastColumn = columnLetter(headers.length - 1);
    this.writeQueue.queueRangeUpdate(`${sheetName}!A${rowIndex}:${lastColumn}${rowIndex}`, [rowToValues(row, headers)]);
  }

  private async queueAppendViaRange<T extends object>(sheetName: SheetName, row: T): Promise<void> {
    const rowIndex = await this.allocateNextRow(sheetName);
    const headers = SHEET_SCHEMAS[sheetName];
    const lastColumn = columnLetter(headers.length - 1);
    this.writeQueue.queueRangeUpdate(`${sheetName}!A${rowIndex}:${lastColumn}${rowIndex}`, [rowToValues(row, headers)]);
  }

  private async ensureKeyIndexMap(sheetName: SheetName, keyColumn: string): Promise<Map<string, number>> {
    const cacheKey = `${sheetName}:${keyColumn}`;
    const existing = this.keyedRowIndexCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const rows = await this.readRowsWithIndexesFromSheet<RowShape>(sheetName);
    const map = new Map<string, number>();
    let maxRow = 1;

    for (const item of rows) {
      maxRow = Math.max(maxRow, item.rowIndex);
      const key = String(item.row[keyColumn] ?? "");
      if (key) {
        map.set(key, item.rowIndex);
      }
    }

    this.keyedRowIndexCache.set(cacheKey, map);
    this.nextRowBySheet.set(sheetName, maxRow + 1);
    return map;
  }

  private async allocateNextRow(sheetName: SheetName): Promise<number> {
    if (!this.nextRowBySheet.has(sheetName)) {
      const rows = await this.readRowsWithIndexesFromSheet<RowShape>(sheetName);
      const maxRow = rows.reduce((max, entry) => Math.max(max, entry.rowIndex), 1);
      this.nextRowBySheet.set(sheetName, maxRow + 1);
    }

    const current = this.nextRowBySheet.get(sheetName) ?? 2;
    this.nextRowBySheet.set(sheetName, current + 1);
    return current;
  }

  private handleQueueFlushSuccess(result: SheetsFlushResult): void {
    this.inMemoryWriteError = null;

    for (const rangeUpdate of result.rangeUpdates) {
      const row = rangeUpdate.values2D[0];
      if (!row || row.length === 0) {
        continue;
      }

      const key = String(row[0] ?? "");
      if (!isStatusKey(key)) {
        continue;
      }

      const value = String(row[1] ?? "");
      const notes = String(row[2] ?? "");
      this.statusLastWritten.set(key, { value, notes });
      this.statusPending.delete(key);
      this.statusRowsCache = null;
    }

    for (const append of result.appendRows) {
      if (append.sheetName !== "Trades") {
        continue;
      }

      for (const row of append.rows2D) {
        const tradeId = String(row[0] ?? "");
        if (!tradeId) {
          continue;
        }

        this.tradeIdsPending.delete(tradeId);
        this.tradeIdsWritten.add(tradeId);
        this.pendingTradeRows.delete(tradeId);
      }
      this.recentTradesCache = null;
    }
  }
}

let repository: GoogleSheetsRepository | null = null;

export const getGoogleSheetsRepository = (): GoogleSheetsRepository => {
  if (!repository) {
    repository = new GoogleSheetsRepository();
  }

  return repository;
};
