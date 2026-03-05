import type { InstrumentInfo, TickerSnapshot } from "@/lib/trading/types";

export type AssistantPair = "BTCUSDT" | "ETHUSDT" | "SOLUSDT";

export type StrategyParams = {
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldMinutes: number;
  timeframe: "5m";
  maPeriod: number;
  entryThresholdPct: number;
  maxSpreadAllowedPct: number;
  assumedFeePctRoundtrip: number;
  assumedSlippagePctRoundtrip: number;
  minNetEdgePct: number;
  marginalNetEdgePct: number;
};

export type ViabilityLabel = "VIABLE" | "MARGINAL" | "NOT_VIABLE";
export type SuggestionAction = "BUY" | "WAIT";
export type SuggestionDecision = "BUY" | "WAIT" | "DO_NOT_TRADE";

export type SuggestionCostBreakdown = {
  spreadPct: number;
  feePct: number;
  slippagePct: number;
  netEdgePct: number;
};

export type DeterministicSuggestion = {
  pair: string;
  decision: SuggestionDecision;
  action: SuggestionAction;
  entryType: "LIMIT";
  entryPrice: number | null;
  tpPrice: number | null;
  slPrice: number | null;
  timeStopAt: string | null;
  suggestedNotional: number;
  suggestedQty: number;
  viability: ViabilityLabel;
  signalDetected: boolean;
  maValue: number | null;
  deviationPct: number;
  reasons: string[];
  whyBullets: string[];
  blockingReasons: string[];
  buyChecklist: {
    netEdge: {
      met: boolean;
      currentPct: number;
      requiredPct: number;
    };
    spread: {
      met: boolean;
      currentPct: number;
      requiredPct: number;
    };
    deviation: {
      met: boolean;
      currentPct: number;
      requiredPct: number;
    };
  };
  cost: SuggestionCostBreakdown;
};

export type AssistantMarketPair = {
  pair: string;
  wsSymbol: string | null;
  ticker: TickerSnapshot | null;
  candles: number[];
  instrument: InstrumentInfo | null;
  error: string | null;
};

export type AssistantMarketResponse = {
  ok: boolean;
  asOf: string;
  pairs: AssistantMarketPair[];
};

export type PositionSource = "KRAKEN_READ_ONLY" | "MANUAL" | "MARKED_EXECUTED";

export type MonitoredPosition = {
  pair: string;
  qty: number;
  entryPrice: number;
  openedAt: string;
  source: PositionSource;
};

export type KrakenOpenOrderView = {
  orderId: string;
  pair: string;
  side: "BUY" | "SELL";
  type: string;
  qty: number;
  price: number;
  openedAt: string;
};

export type QuoteBalanceView = {
  asset: string;
  available: number;
};

export type KrakenPortfolioAsset = {
  asset: string;
  available: number;
};

export type LatestActivity = {
  type: "order" | "trade";
  side: "BUY" | "SELL";
  pair: string;
  price: number;
  qty: number;
  status: string;
  timestamp: string;
  source: "kraken";
};

export type AssistantPositionsResponse = {
  ok: boolean;
  authenticated: boolean;
  checkedAt: string;
  positions: MonitoredPosition[];
  openOrders: KrakenOpenOrderView[];
  quoteBalances: QuoteBalanceView[];
  portfolio: KrakenPortfolioAsset[];
  latestActivity: LatestActivity | null;
  cached: {
    hit: boolean;
    ttlSeconds: number;
  };
  lastError: string | null;
};
