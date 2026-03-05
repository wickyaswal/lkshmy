import type { AssistantPair, StrategyParams } from "@/lib/assistant/types";

export const DEFAULT_ASSISTANT_PAIRS: AssistantPair[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export const DEFAULT_SELECTED_PAIRS: AssistantPair[] = ["BTCUSDT"];

export const DEFAULT_STRATEGY_PARAMS: StrategyParams = {
  takeProfitPct: 0.004,
  stopLossPct: 0.003,
  maxHoldMinutes: 120,
  timeframe: "5m",
  maPeriod: 50,
  entryThresholdPct: 0.005,
  maxSpreadAllowedPct: 0.0015,
  assumedFeePctRoundtrip: 0.002,
  assumedSlippagePctRoundtrip: 0.0005,
  minNetEdgePct: 0.0015,
  marginalNetEdgePct: 0.0005
};

export const DEFAULT_RISK_PER_TRADE_PCT = 0.005;
