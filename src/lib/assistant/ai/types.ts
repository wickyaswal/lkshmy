import type { StrategyParams } from "@/lib/assistant/types";

export type AiAssistantClientContext = {
  selectedPairs: string[];
  strategyParams: StrategyParams;
  tradingCapital: number;
  learningMode: boolean;
  availableQuoteBalance?: number;
};

export type AiSnapshotCoin = {
  pair: string;
  ticker: {
    bid: number;
    ask: number;
    last: number;
    spreadPct: number;
    openReferencePrice: number | null;
    openReferenceLabel: "OPEN_24H" | "DAY_OPEN" | null;
  } | null;
  ma: {
    period: number;
    value: number | null;
    deviationPct: number;
    summary: {
      count: number;
      minClose: number | null;
      maxClose: number | null;
      lastClose: number | null;
    };
    rawCloses?: number[];
  };
  instrument: {
    minOrderQty: number;
    qtyStep: number;
    priceStep: number;
    minNotional: number;
  } | null;
  deterministic: {
    decision: "BUY" | "WAIT" | "DO_NOT_TRADE";
    viability: "VIABLE" | "MARGINAL" | "NOT_VIABLE";
    signalDetected: boolean;
    spreadPct: number;
    netEdgePct: number;
    deviationPct: number;
    entryPrice: number | null;
    tpPrice: number | null;
    slPrice: number | null;
    suggestedNotional: number;
    suggestedQty: number;
    minOrderOk: boolean;
    blockingReasons: string[];
  };
};

export type AiSnapshot = {
  generatedAt: string;
  settings: {
    selectedPairs: string[];
    strategyParams: StrategyParams;
    tradingCapital: number;
    learningMode: boolean;
    quoteAsset: string;
    availableQuoteBalance: number | null;
  };
  watchlistUniverse: string[];
  sentiment: {
    label: "Risk-off" | "Neutral" | "Risk-on";
    classification: "RISK_OFF" | "NEUTRAL" | "RISK_ON";
    scorePct: number;
    scoreBps: number;
    referenceLabel: "OPEN_24H" | "DAY_OPEN" | "MIXED" | "UNAVAILABLE";
  };
  deterministicTopCandidates: {
    pair: string;
    viability: "VIABLE" | "MARGINAL" | "NOT_VIABLE";
    decision: "BUY" | "WAIT" | "DO_NOT_TRADE";
    scoreScaled: number;
    spreadBps: number;
    deviationBps: number;
    netEdgeBps: number;
  }[];
  coins: AiSnapshotCoin[];
  account: {
    authenticated: boolean;
    quoteBalances: {
      asset: string;
      available: number;
    }[];
    latestActivity: {
      type: "order" | "trade";
      side: "BUY" | "SELL";
      pair: string;
      price: number;
      qty: number;
      status: string;
      timestamp: string;
      source: "kraken";
    } | null;
    lastError: string | null;
  };
};
