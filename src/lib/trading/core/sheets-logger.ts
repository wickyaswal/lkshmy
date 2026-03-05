import { getGoogleSheetsRepository, type GoogleSheetsRepository } from "@/lib/sheets/google-sheets";
import type {
  BufferLedgerRow,
  DailySummaryRow,
  NetCostTrackingRow,
  TradeRow
} from "@/lib/trading/types";

export class SheetsLogger {
  constructor(private readonly sheets: GoogleSheetsRepository = getGoogleSheetsRepository()) {}

  async appendTradeIdempotent(row: TradeRow): Promise<boolean> {
    return this.sheets.appendTradeIfMissing(row);
  }

  upsertDailySummary(row: DailySummaryRow): Promise<void> {
    return this.sheets.upsertDailySummary(row);
  }

  appendBufferLedger(row: BufferLedgerRow): Promise<void> {
    return this.sheets.appendBufferLedger(row);
  }

  upsertNetCost(row: NetCostTrackingRow): Promise<void> {
    return this.sheets.upsertNetCost(row);
  }
}
