import { describe, expect, it } from "vitest";

import { RiskEngine } from "@/lib/trading/core/risk-engine";
import type { BotConfig, BotStatusSnapshot } from "@/lib/trading/types";

const config: BotConfig = {
  botEnabled: true,
  mode: "DEMO",
  activeSymbol: "BTCUSDT",
  virtualBufferEnabled: true,
  pairSelectionMode: "MANUAL",
  maxTradesPerDay: 3,
  maxOpenPositions: 1,
  takeProfitPct: 0.006,
  stopLossPct: 0.004,
  maxHoldMinutes: 90,
  dailyLossLimitPct: 0.01,
  riskPerTradePct: 0.005,
  bufferPctOfNetProfit: 0.5,
  allowedHoursStartLocal: "07:00",
  allowedHoursEndLocal: "22:00",
  maxSpreadAllowedPct: 0.0025,
  consecutiveLossesStop: 2,
  heartbeatIntervalSeconds: 60,
  meanReversionThresholdPct: 0.0035
};

const baseStatus: BotStatusSnapshot = {
  botEnabled: true,
  mode: "DEMO",
  activeSymbol: "BTCUSDT",
  tradingCapitalTcUsdt: 1000,
  bufferUsdt: 0,
  openPosition: false,
  openPositionSide: "",
  openPositionEntryPrice: 0,
  openPositionQty: 0,
  openPositionOpenTime: "",
  todayRealizedPnlUsdt: 0,
  tradesToday: 0,
  dailyStopHit: false,
  lastError: "",
  lastHeartbeat: "",
  openPositionMeta: null,
  dailyStateMeta: {
    date: "2026-03-04",
    tcStartOfDay: 1000,
    bufferStartOfDay: 0,
    consecutiveLosses: 0,
    dailyGrossPnl: 0,
    dailyFees: 0,
    wins: 0,
    losses: 0,
    skimToBuffer: 0,
    maxDrawdownEst: 0
  },
  enabledExchanges: [],
  liveCapableExchanges: []
};

describe("shouldStopTradingForDay", () => {
  const riskEngine = new RiskEngine();

  it("stops when daily loss exceeds the configured limit", () => {
    const result = riskEngine.shouldStopForDay(
      {
        ...baseStatus,
        todayRealizedPnlUsdt: -10.01
      },
      config
    );

    expect(result.stop).toBe(true);
    expect(result.reason).toContain("Daily loss limit");
  });

  it("stops when consecutive losses reaches the threshold", () => {
    const result = riskEngine.shouldStopForDay(
      {
        ...baseStatus,
        dailyStateMeta: {
          ...baseStatus.dailyStateMeta,
          consecutiveLosses: 2
        }
      },
      config
    );

    expect(result.stop).toBe(true);
    expect(result.reason).toContain("Consecutive loss");
  });
});
