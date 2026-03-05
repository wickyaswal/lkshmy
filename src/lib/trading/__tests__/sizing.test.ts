import { describe, expect, it } from "vitest";

import { calculatePositionSize } from "@/lib/trading/risk";

describe("calculatePositionSize", () => {
  it("sizes a trade from risk budget and rounds down to exchange step size", () => {
    const result = calculatePositionSize({
      tradingCapitalUsdt: 1000,
      stopLossPct: 0.004,
      riskPerTradePct: 0.005,
      price: 50000,
      qtyStep: 0.0001,
      minNotional: 5
    });

    expect(result.shouldTrade).toBe(true);
    expect(result.qty).toBe(0.025);
    expect(result.notionalUsdt).toBe(1250);
  });

  it("skips the trade when the rounded notional falls below the minimum", () => {
    const result = calculatePositionSize({
      tradingCapitalUsdt: 10,
      stopLossPct: 0.01,
      riskPerTradePct: 0.005,
      price: 1000,
      qtyStep: 0.01,
      minNotional: 10
    });

    expect(result.shouldTrade).toBe(false);
    expect(result.skipReason).toContain("minimum");
  });
});
