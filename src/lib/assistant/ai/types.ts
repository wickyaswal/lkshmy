import type { StrategyParams } from "@/lib/assistant/types";
import type { AccountSuggestionStatus, KrakenOrderTemplateType } from "@/lib/assistant/account-suggestions";

export type AiAssistantClientContext = {
  strategyParams: StrategyParams;
};

export type AiSnapshot = {
  generatedAt: string;
  settings: {
    strategyParams: StrategyParams;
    netEdgeSanity: {
      maxPossibleNetEdgeNoSpreadPct: number;
      maxPossibleNetEdgeNoSpreadBps: number;
      minNetEdgePct: number;
      minNetEdgeBps: number;
      viableUnreachable: boolean;
    };
  };
  sentiment: {
    label: "Risk-off" | "Neutral" | "Risk-on";
    classification: "RISK_OFF" | "NEUTRAL" | "RISK_ON";
    scorePct: number;
    scoreBps: number;
    referenceLabel: "OPEN_24H" | "DAY_OPEN" | "MIXED" | "UNAVAILABLE";
    thresholds: {
      riskOffPct: number;
      riskOnPct: number;
    };
  };
  suggestionUniverse: string[];
  balanceSuggestions: {
    asset: string;
    marketPair: string | null;
    side: "BUY" | "SELL";
    status: AccountSuggestionStatus;
    primaryOrderType: KrakenOrderTemplateType | null;
    headline: string;
    summary: string;
    quantity: number;
    price: number | null;
    triggerPrice: number | null;
    total: number;
    notes: string[];
    metrics: {
      spreadBps: number | null;
      deviationBps: number | null;
      netEdgeBps: number | null;
    };
  }[];
  account: {
    authenticated: boolean;
    portfolio: {
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
