import { describe, expect, it } from "vitest";

import { DEFAULT_STRATEGY_PARAMS } from "@/lib/assistant/defaults";
import { computeDeterministicSuggestion } from "@/lib/assistant/suggestion-engine";
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
    expect(suggestion.action).toBe("BUY");
    expect(suggestion.entryPrice).toBeGreaterThan(0);
    expect(suggestion.suggestedQty).toBeGreaterThan(0);
  });

  it("returns NOT_VIABLE WAIT when spread and signal fail", () => {
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
    expect(suggestion.action).toBe("WAIT");
    expect(suggestion.reasons.join(" ")).toContain("Spread too high");
  });
});
