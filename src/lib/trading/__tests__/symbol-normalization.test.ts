import { describe, expect, it } from "vitest";

import { normalizePairForKraken, toInternalPair } from "@/lib/trading/symbol-normalization";

describe("symbol normalization", () => {
  it("normalizes exchange and human formats to internal pair format", () => {
    expect(toInternalPair("eth/usdt")).toBe("ETHUSDT");
    expect(toInternalPair("XBT/USDT")).toBe("BTCUSDT");
    expect(toInternalPair("XXBTZUSD")).toBe("BTCUSD");
  });

  it("maps internal pair to Kraken REST and WS symbols", () => {
    const normalized = normalizePairForKraken("BTCUSDT");

    expect(normalized.internal).toBe("BTCUSDT");
    expect(normalized.exchangeRest).toBe("XBTUSDT");
    expect(normalized.exchangeWs).toBe("XBT/USDT");
  });
});
