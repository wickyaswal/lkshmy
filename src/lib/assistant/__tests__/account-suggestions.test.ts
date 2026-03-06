import { describe, expect, it } from "vitest";

import {
  buildAccountSuggestionPairUniverse,
  buildBalanceSuggestions
} from "@/lib/assistant/account-suggestions";
import { DEFAULT_STRATEGY_PARAMS } from "@/lib/assistant/defaults";
import type { AssistantMarketPair, AssistantPositionsResponse } from "@/lib/assistant/types";

const marketRow = (input: Partial<AssistantMarketPair> & Pick<AssistantMarketPair, "pair">): AssistantMarketPair => ({
  pair: input.pair,
  wsSymbol: null,
  ticker: input.ticker ?? null,
  candles: input.candles ?? [],
  instrument: input.instrument ?? null,
  error: input.error ?? null
});

const basePositionsState = (): AssistantPositionsResponse => ({
  ok: true,
  authenticated: true,
  checkedAt: "2026-03-06T10:00:00.000Z",
  positions: [],
  openOrders: [],
  quoteBalances: [],
  portfolio: [],
  latestActivity: null,
  cached: {
    hit: false,
    ttlSeconds: 60
  },
  lastError: null
});

describe("account suggestions", () => {
  it("builds market pair requests from live balances and latest activity", () => {
    const pairs = buildAccountSuggestionPairUniverse({
      portfolio: [
        { asset: "EUR", available: 95.06 },
        { asset: "XRP", available: 54.8 }
      ],
      latestActivity: {
        type: "trade",
        side: "BUY",
        pair: "XRPEUR",
        price: 1.25,
        qty: 54.8,
        status: "FILLED",
        timestamp: "2026-03-06T09:00:00.000Z",
        source: "kraken"
      },
      openOrders: [],
      selectedPairs: ["BTCEUR"]
    });

    expect(pairs).toContain("XRPEUR");
    expect(pairs).toContain("BTCEUR");
    expect(pairs).toContain("ETHEUR");
    expect(pairs).toContain("SOLEUR");
  });

  it("creates a ready sell suggestion when a held asset is above the latest buy anchor", () => {
    const positionsState = basePositionsState();
    positionsState.portfolio = [{ asset: "XRP", available: 54.80817141 }];
    positionsState.latestActivity = {
      type: "trade",
      side: "BUY",
      pair: "XRPUSD",
      price: 1.25,
      qty: 54.80817141,
      status: "FILLED",
      timestamp: "2026-03-06T09:00:00.000Z",
      source: "kraken"
    };

    const suggestions = buildBalanceSuggestions({
      positionsState,
      marketPairs: [
        marketRow({
          pair: "XRPUSD",
          ticker: {
            pair: "XRPUSD",
            bid: 1.38,
            ask: 1.381,
            last: 1.382,
            spreadPct: 0.000724,
            timestamp: "2026-03-06T10:00:00.000Z"
          },
          candles: Array.from({ length: 120 }, () => 1.31),
          instrument: {
            pair: "XRPUSD",
            minOrderQty: 1,
            qtyStep: 0.01,
            priceStep: 0.00001,
            minNotional: 0.5
          }
        })
      ],
      params: DEFAULT_STRATEGY_PARAMS,
      selectedPairs: ["BTCUSD"],
      sentiment: "NEUTRAL"
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.status).toBe("READY");
    expect(suggestions[0]?.primaryOrderType).toBe("TAKE_PROFIT_LIMIT");
    expect(suggestions[0]?.templates.some((template) => template.type === "TRAILING_STOP_LIMIT")).toBe(true);
  });

  it("creates a ready buy suggestion for a quote balance when the deterministic buy conditions are met", () => {
    const positionsState = basePositionsState();
    positionsState.portfolio = [{ asset: "EUR", available: 100 }];

    const suggestions = buildBalanceSuggestions({
      positionsState,
      marketPairs: [
        marketRow({
          pair: "BTCEUR",
          ticker: {
            pair: "BTCEUR",
            bid: 99,
            ask: 99,
            last: 99,
            spreadPct: 0,
            timestamp: "2026-03-06T10:00:00.000Z"
          },
          candles: Array.from({ length: 120 }, () => 100),
          instrument: {
            pair: "BTCEUR",
            minOrderQty: 0.00001,
            qtyStep: 0.00000001,
            priceStep: 0.01,
            minNotional: 0.5
          }
        }),
        marketRow({
          pair: "ETHEUR",
          ticker: {
            pair: "ETHEUR",
            bid: 2000,
            ask: 2002,
            last: 2001,
            spreadPct: 0.001,
            timestamp: "2026-03-06T10:00:00.000Z"
          },
          candles: Array.from({ length: 120 }, () => 1990),
          instrument: {
            pair: "ETHEUR",
            minOrderQty: 0.001,
            qtyStep: 0.00000001,
            priceStep: 0.01,
            minNotional: 0.5
          }
        }),
        marketRow({
          pair: "SOLEUR",
          ticker: {
            pair: "SOLEUR",
            bid: 88,
            ask: 88.2,
            last: 88.1,
            spreadPct: 0.0022,
            timestamp: "2026-03-06T10:00:00.000Z"
          },
          candles: Array.from({ length: 120 }, () => 89),
          instrument: {
            pair: "SOLEUR",
            minOrderQty: 0.02,
            qtyStep: 0.00000001,
            priceStep: 0.01,
            minNotional: 0.5
          }
        })
      ],
      params: DEFAULT_STRATEGY_PARAMS,
      selectedPairs: ["BTCEUR"],
      sentiment: "NEUTRAL"
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.side).toBe("BUY");
    expect(suggestions[0]?.status).toBe("READY");
    expect(suggestions[0]?.primaryOrderType).toBe("LIMIT");
    expect(suggestions[0]?.marketPair).toBe("BTCEUR");
    expect(suggestions[0]?.templates[0]?.type).toBe("LIMIT");
  });
});
