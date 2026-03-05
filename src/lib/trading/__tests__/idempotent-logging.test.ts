import { describe, expect, it } from "vitest";

import { SheetsLogger } from "@/lib/trading/core/sheets-logger";
import type { TradeRow } from "@/lib/trading/types";

class FakeSheetsRepo {
  private readonly seenIds = new Set<string>();
  appendCount = 0;

  async appendTradeIfMissing(row: TradeRow): Promise<boolean> {
    if (this.seenIds.has(row.trade_id)) {
      return false;
    }

    this.seenIds.add(row.trade_id);
    this.appendCount += 1;
    return true;
  }
}

describe("idempotent trade logging", () => {
  it("prevents duplicate trades from being appended", async () => {
    const repo = new FakeSheetsRepo();
    const logger = new SheetsLogger(repo as never);
    const trade: TradeRow = {
      trade_id: "BTCUSDT-20260305120000",
      open_time: "2026-03-05T12:00:00.000Z",
      close_time: "2026-03-05T12:10:00.000Z",
      symbol: "BTCUSDT",
      side: "LONG",
      entry_price: "50000",
      exit_price: "50100",
      qty: "0.01",
      gross_pnl_usdt: "1",
      fees_usdt: "0.1",
      net_pnl_usdt: "0.9",
      exit_reason: "TAKE_PROFIT",
      spread_at_entry_pct: "0.0005",
      strategy_version: "mean-reversion-v0",
      notes: ""
    };

    const first = await logger.appendTradeIdempotent(trade);
    const second = await logger.appendTradeIdempotent(trade);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(repo.appendCount).toBe(1);
  });
});
