import { describe, expect, it } from "vitest";

import { parseBotConfig } from "@/lib/trading/config";
import type { ConfigRow } from "@/lib/trading/types";

describe("parseBotConfig", () => {
  it("parses config rows and applies safe normalization", () => {
    const rows: ConfigRow[] = [
      { param: "bot_enabled", value: "TRUE", type: "boolean", description: "" },
      { param: "mode", value: "LIVE", type: "enum", description: "" },
      { param: "active_symbol", value: "eth/usdt", type: "string", description: "" },
      { param: "pair_selection_mode", value: "sheet_selected", type: "enum", description: "" },
      { param: "max_trades_per_day", value: "5", type: "number", description: "" },
      { param: "max_open_positions", value: "1", type: "number", description: "" },
      { param: "take_profit_pct", value: "0.01", type: "number", description: "" },
      { param: "stop_loss_pct", value: "0.005", type: "number", description: "" },
      { param: "max_hold_minutes", value: "120", type: "number", description: "" },
      { param: "daily_loss_limit_pct", value: "0.02", type: "number", description: "" },
      { param: "risk_per_trade_pct", value: "0.0075", type: "number", description: "" },
      { param: "buffer_pct_of_net_profit", value: "0.4", type: "number", description: "" },
      { param: "allowed_hours_start_local", value: "08:00", type: "time", description: "" },
      { param: "allowed_hours_end_local", value: "19:00", type: "time", description: "" },
      { param: "max_spread_allowed_pct", value: "0.001", type: "number", description: "" },
      { param: "consecutive_losses_stop", value: "3", type: "number", description: "" },
      { param: "heartbeat_interval_seconds", value: "15", type: "number", description: "" }
    ];

    const config = parseBotConfig(rows);

    expect(config.botEnabled).toBe(true);
    expect(config.mode).toBe("LIVE");
    expect(config.activeSymbol).toBe("ETHUSDT");
    expect(config.pairSelectionMode).toBe("SHEET_SELECTED");
    expect(config.maxTradesPerDay).toBe(5);
    expect(config.takeProfitPct).toBe(0.01);
    expect(config.stopLossPct).toBe(0.005);
    expect(config.heartbeatIntervalSeconds).toBe(15);
  });
});
