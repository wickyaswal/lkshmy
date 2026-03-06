import { describe, expect, it } from "vitest";

import { DEFAULT_STRATEGY_PARAMS } from "@/lib/assistant/defaults";
import {
  classifyNetEdgeBand,
  computeDeterministicSuggestion,
  describeDeviationVsMa,
  evaluateSuggestionParameterSanity
} from "@/lib/assistant/suggestion-engine";
import type { InstrumentInfo, TickerSnapshot } from "@/lib/trading/types";

const instrument: InstrumentInfo = {
  pair: "BTCUSDT",
  minOrderQty: 0.0001,
  qtyStep: 0.0001,
  priceStep: 0.1,
  minNotional: 5
};

const ticker: TickerSnapshot = {
  pair: "BTCUSDT",
  bid: 49890,
  ask: 49910,
  last: 49900,
  spreadPct: 0.0004,
  timestamp: "2026-03-05T00:00:00.000Z"
};

describe("deterministic suggestion engine", () => {
  it("returns VIABLE BUY when signal and edge are strong", () => {
    const candles = Array.from({ length: 80 }, (_, index) => 50500 + (index % 3));
    const params = {
      ...DEFAULT_STRATEGY_PARAMS,
      takeProfitPct: 0.007
    };
    const suggestion = computeDeterministicSuggestion({
      pair: "BTCUSDT",
      tradingCapital: 1000,
      params,
      ticker,
      candles,
      instrument,
      nowMs: Date.parse("2026-03-05T12:00:00.000Z")
    });

    expect(suggestion.viability).toBe("VIABLE");
    expect(suggestion.decision).toBe("BUY");
    expect(suggestion.action).toBe("BUY");
    expect(suggestion.entryPrice).toBeGreaterThan(0);
    expect(suggestion.suggestedQty).toBeGreaterThan(0);
    expect(suggestion.hardBlockingReasons).toEqual([]);
  });

  it("returns WAIT (not DO_NOT_TRADE) when no signal but viability is feasible", () => {
    const candles = Array.from({ length: 80 }, () => 50000);
    const viableParams = {
      ...DEFAULT_STRATEGY_PARAMS,
      takeProfitPct: 0.006,
      entryThresholdPct: 0.005
    };
    const weakSignalTicker: TickerSnapshot = {
      ...ticker,
      bid: 49940,
      ask: 49960,
      last: 49950
    };
    const suggestion = computeDeterministicSuggestion({
      pair: "BTCUSDT",
      tradingCapital: 1000,
      params: viableParams,
      ticker: weakSignalTicker,
      candles,
      instrument,
      nowMs: Date.parse("2026-03-05T12:00:00.000Z")
    });

    expect(suggestion.signalDetected).toBe(false);
    expect(suggestion.viability).not.toBe("NOT_VIABLE");
    expect(suggestion.decision).toBe("WAIT");
    expect(suggestion.hardBlockingReasons.length).toBe(0);
    expect(suggestion.waitReasons.join(" ")).toContain("entry threshold");
  });

  it("returns DO_NOT_TRADE only for hard blockers", () => {
    const candles = Array.from({ length: 80 }, () => 50010);
    const badTicker: TickerSnapshot = {
      ...ticker,
      bid: 48000,
      ask: 50000,
      last: 49950,
      spreadPct: 0.04
    };
    const suggestion = computeDeterministicSuggestion({
      pair: "BTCUSDT",
      tradingCapital: 1000,
      params: DEFAULT_STRATEGY_PARAMS,
      ticker: badTicker,
      candles,
      instrument,
      nowMs: Date.parse("2026-03-05T12:00:00.000Z")
    });

    expect(suggestion.viability).toBe("NOT_VIABLE");
    expect(suggestion.decision).toBe("DO_NOT_TRADE");
    expect(suggestion.hardBlockingReasons.join(" ")).toContain("Spread too high");
  });

  it("classifies net edge boundaries as NOT_VIABLE/MARGINAL/VIABLE", () => {
    expect(classifyNetEdgeBand({ netEdgePct: 0.0004, marginalNetEdgePct: 0.0005, minNetEdgePct: 0.0015 })).toBe("NOT_VIABLE");
    expect(classifyNetEdgeBand({ netEdgePct: 0.0005, marginalNetEdgePct: 0.0005, minNetEdgePct: 0.0015 })).toBe("MARGINAL");
    expect(classifyNetEdgeBand({ netEdgePct: 0.00149, marginalNetEdgePct: 0.0005, minNetEdgePct: 0.0015 })).toBe("MARGINAL");
    expect(classifyNetEdgeBand({ netEdgePct: 0.0015, marginalNetEdgePct: 0.0005, minNetEdgePct: 0.0015 })).toBe("VIABLE");
  });

  it("flags unreachable VIABLE configuration via sanity check", () => {
    const sanity = evaluateSuggestionParameterSanity({
      ...DEFAULT_STRATEGY_PARAMS,
      takeProfitPct: 0.004,
      assumedFeePctRoundtrip: 0.002,
      assumedSlippagePctRoundtrip: 0.0005,
      minNetEdgePct: 0.0015
    });

    expect(sanity.maxPossibleNetEdgeNoSpreadPct).toBe(0.0015);
    expect(sanity.viableUnreachable).toBe(true);
  });

  it("describes deviation sign with explicit above/below MA wording", () => {
    const below = describeDeviationVsMa({
      deviationPct: 0.002,
      maPeriod: 50,
      timeframe: "5m"
    });
    const above = describeDeviationVsMa({
      deviationPct: -0.00166,
      maPeriod: 50,
      timeframe: "5m"
    });

    expect(below.direction).toBe("BELOW_MA");
    expect(below.text).toContain("below MA");
    expect(above.direction).toBe("ABOVE_MA");
    expect(above.text).toContain("above MA");
  });

  it("provides sizing audit when qtyRaw is below qtyStep and floors to zero", () => {
    const coarseInstrument: InstrumentInfo = {
      ...instrument,
      qtyStep: 1,
      minOrderQty: 1
    };
    const suggestion = computeDeterministicSuggestion({
      pair: "BTCUSDT",
      tradingCapital: 30,
      params: DEFAULT_STRATEGY_PARAMS,
      ticker,
      candles: Array.from({ length: 80 }, () => 50500),
      instrument: coarseInstrument,
      nowMs: Date.parse("2026-03-05T12:00:00.000Z")
    });

    expect(suggestion.sizingAudit.qtyRaw).toBeLessThan(suggestion.sizingAudit.qtyStep);
    expect(suggestion.sizingAudit.qtyFloored).toBe(0);
    expect(suggestion.minOrderOk).toBe(false);
    expect(suggestion.sizingAudit.firstFailingRule).toContain("below qty step");
  });
});
