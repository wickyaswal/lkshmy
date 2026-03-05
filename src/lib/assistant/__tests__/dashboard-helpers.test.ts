import { describe, expect, it } from "vitest";

import { classifySentiment, computeMarketSentiment, rankScannerOpportunities } from "@/lib/assistant/dashboard-helpers";
import type { DeterministicSuggestion } from "@/lib/assistant/types";

const buildSuggestion = (input: {
  pair: string;
  viability: DeterministicSuggestion["viability"];
  decision?: DeterministicSuggestion["decision"];
  netEdgePct: number;
  deviationPct: number;
  spreadPct: number;
  suggestedNotional: number;
}): DeterministicSuggestion => ({
  pair: input.pair,
  decision: input.decision ?? "WAIT",
  action: input.decision === "BUY" ? "BUY" : "WAIT",
  entryType: "LIMIT",
  entryPrice: 100,
  tpPrice: 100.4,
  slPrice: 99.7,
  timeStopAt: "2026-03-05T12:00:00.000Z",
  suggestedNotional: input.suggestedNotional,
  suggestedQty: 1,
  viability: input.viability,
  signalDetected: true,
  maValue: 101,
  deviationPct: input.deviationPct,
  reasons: [],
  whyBullets: [],
  blockingReasons: [],
  buyChecklist: {
    netEdge: {
      met: true,
      currentPct: input.netEdgePct,
      requiredPct: 0.0015
    },
    spread: {
      met: true,
      currentPct: input.spreadPct,
      requiredPct: 0.0015
    },
    deviation: {
      met: true,
      currentPct: input.deviationPct,
      requiredPct: 0.005
    }
  },
  cost: {
    spreadPct: input.spreadPct,
    feePct: 0.002,
    slippagePct: 0.0005,
    netEdgePct: input.netEdgePct
  }
});

describe("dashboard helpers", () => {
  it("classifies sentiment with fixed thresholds", () => {
    expect(classifySentiment(-0.02)).toBe("RISK_OFF");
    expect(classifySentiment(0)).toBe("NEUTRAL");
    expect(classifySentiment(0.02)).toBe("RISK_ON");
  });

  it("computes median sentiment deterministically", () => {
    const sentiment = computeMarketSentiment([
      {
        pair: "BTCUSDT",
        lastPrice: 98,
        openReferencePrice: 100,
        openReferenceLabel: "OPEN_24H"
      },
      {
        pair: "ETHUSDT",
        lastPrice: 102,
        openReferencePrice: 100,
        openReferenceLabel: "OPEN_24H"
      },
      {
        pair: "SOLUSDT",
        lastPrice: 101,
        openReferencePrice: 100,
        openReferenceLabel: "OPEN_24H"
      }
    ]);

    expect(sentiment.referenceLabel).toBe("OPEN_24H");
    expect(sentiment.classification).toBe("RISK_ON");
    expect(sentiment.scorePct).toBeCloseTo(0.01, 8);
  });

  it("ranks scanner opportunities by score, then lower spread, and applies risk-off filter", () => {
    const suggestions = [
      buildSuggestion({
        pair: "BTCUSDT",
        viability: "VIABLE",
        decision: "BUY",
        netEdgePct: 0.003,
        deviationPct: 0.006,
        spreadPct: 0.0009,
        suggestedNotional: 20
      }),
      buildSuggestion({
        pair: "ETHUSDT",
        viability: "MARGINAL",
        netEdgePct: 0.0025,
        deviationPct: 0.006,
        spreadPct: 0.0006,
        suggestedNotional: 15
      }),
      buildSuggestion({
        pair: "SOLUSDT",
        viability: "VIABLE",
        netEdgePct: 0.0025,
        deviationPct: 0.006,
        spreadPct: 0.0004,
        suggestedNotional: 12
      })
    ];

    const neutralRanked = rankScannerOpportunities({
      suggestions,
      availableQuoteBalance: 30,
      sentiment: "NEUTRAL"
    });
    expect(neutralRanked.map((row) => row.pair)).toEqual(["BTCUSDT", "SOLUSDT", "ETHUSDT"]);

    const riskOffRanked = rankScannerOpportunities({
      suggestions,
      availableQuoteBalance: 30,
      sentiment: "RISK_OFF"
    });
    expect(riskOffRanked.map((row) => row.pair)).toEqual(["BTCUSDT", "SOLUSDT"]);
  });
});
