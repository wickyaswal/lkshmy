import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_STRATEGY_PARAMS } from "@/lib/assistant/defaults";
import * as providers from "@/lib/assistant/data-providers";
import { buildFallbackAiResponse, enforceViableMessaging, normalizeModelResponse } from "@/lib/assistant/ai/response-builder";
import { aiAssistantResponseSchema } from "@/lib/assistant/ai/schema";
import { buildAiSnapshot } from "@/lib/assistant/ai/snapshot-builder";
import type { AiSnapshot } from "@/lib/assistant/ai/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assistant AI modules", () => {
  it("snapshot builder includes balance suggestions and excludes secrets", async () => {
    process.env.KRAKEN_API_SECRET = "very-secret-value";

    vi.spyOn(providers, "getAssistantMarketState").mockResolvedValue({
      ok: true,
      asOf: "2026-03-05T00:00:00.000Z",
      pairs: [
        {
          pair: "BTCUSDT",
          wsSymbol: "XBT/USDT",
          ticker: {
            pair: "BTCUSDT",
            bid: 50000,
            ask: 50020,
            last: 50010,
            spreadPct: 0.0003998,
            openReferencePrice: 49000,
            openReferenceLabel: "OPEN_24H",
            timestamp: "2026-03-05T00:00:00.000Z"
          },
          candles: Array.from({ length: 120 }, () => 50500),
          instrument: {
            pair: "BTCUSDT",
            minOrderQty: 0.0001,
            qtyStep: 0.0001,
            priceStep: 0.1,
            minNotional: 5
          },
          error: null
        }
      ]
    });
    vi.spyOn(providers, "getAssistantPositionsState").mockResolvedValue({
      ok: true,
      authenticated: false,
      checkedAt: "2026-03-05T00:00:00.000Z",
      positions: [],
      openOrders: [],
      quoteBalances: [],
      portfolio: [{ asset: "USDT", available: 30 }],
      latestActivity: null,
      lastError: "Not connected"
    });

    const snapshot = await buildAiSnapshot({
      includeRawCandles: false,
      context: {
        strategyParams: DEFAULT_STRATEGY_PARAMS
      }
    });

    expect(snapshot.balanceSuggestions.length).toBeGreaterThan(0);
    expect(snapshot.balanceSuggestions[0]?.headline).toBeTypeOf("string");
    expect(snapshot.suggestionUniverse.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("very-secret-value");
    expect(serialized).not.toContain("OPENAI_API_KEY");
  });

  it("uses EUR watchlist for AI snapshot when EUR is the funded quote asset", async () => {
    vi.spyOn(providers, "getAssistantPositionsState").mockResolvedValue({
      ok: true,
      authenticated: true,
      checkedAt: "2026-03-05T00:00:00.000Z",
      positions: [],
      openOrders: [],
      quoteBalances: [{ asset: "EUR", available: 95.06 }],
      portfolio: [{ asset: "EUR", available: 95.06 }],
      latestActivity: null,
      lastError: null
    });
    vi.spyOn(providers, "getAssistantMarketState").mockImplementation(async (input) => ({
      ok: true,
      asOf: "2026-03-05T00:00:00.000Z",
      pairs: input.pairs.map((pair) => ({
        pair,
        wsSymbol: null,
        ticker: {
          pair,
          bid: 100,
          ask: 100.1,
          last: 100.05,
          spreadPct: 0.001,
          openReferencePrice: 99,
          openReferenceLabel: "DAY_OPEN",
          timestamp: "2026-03-05T00:00:00.000Z"
        },
        candles: Array.from({ length: 120 }, () => 100),
        instrument: {
          pair,
          minOrderQty: 0.001,
          qtyStep: 0.000001,
          priceStep: 0.01,
          minNotional: 0.5
        },
        error: null
      }))
    }));

    const snapshot = await buildAiSnapshot({
      includeRawCandles: false,
      context: {
        strategyParams: DEFAULT_STRATEGY_PARAMS
      }
    });

    expect(snapshot.suggestionUniverse).toEqual(["BTCEUR", "ETHEUR", "SOLEUR"]);
    expect(snapshot.account.portfolio[0]?.asset).toBe("EUR");
  });

  it("validates AI response schema and rejects invalid shape", () => {
    const valid = aiAssistantResponseSchema.safeParse({
      answer: "Sample",
      top_candidates: [],
      risks: ["risk"],
      learning_corner: [{ term: "Spread", simple: "Gap between bid and ask." }],
      disclaimer: "Educational only."
    });
    expect(valid.success).toBe(true);

    const invalid = aiAssistantResponseSchema.safeParse({
      top_candidates: [],
      risks: []
    });
    expect(invalid.success).toBe(false);
  });

  it("states no BUY candidates when no deterministic BUY exists", () => {
    const snapshot: AiSnapshot = {
      generatedAt: "2026-03-05T00:00:00.000Z",
      settings: {
        strategyParams: DEFAULT_STRATEGY_PARAMS,
        netEdgeSanity: {
          maxPossibleNetEdgeNoSpreadPct: 0.0015,
          maxPossibleNetEdgeNoSpreadBps: 15,
          minNetEdgePct: 0.0015,
          minNetEdgeBps: 15,
          viableUnreachable: true
        }
      },
      sentiment: {
        label: "Risk-off",
        classification: "RISK_OFF",
        scorePct: -0.02,
        scoreBps: -200,
        referenceLabel: "OPEN_24H",
        thresholds: {
          riskOffPct: -0.01,
          riskOnPct: 0.01
        }
      },
      suggestionUniverse: ["BTCUSDT"],
      balanceSuggestions: [
        {
          asset: "USDT",
          marketPair: "BTCUSDT",
          side: "BUY",
          status: "WATCH",
          primaryOrderType: "LIMIT",
          headline: "USDT is best kept on watch for BTC.",
          summary: "Signal or viability is not fully aligned yet.",
          quantity: 0.0005,
          price: 100,
          triggerPrice: 100,
          total: 50,
          notes: ["No signal yet."],
          metrics: {
            spreadBps: 10,
            deviationBps: 20,
            netEdgeBps: 5
          }
        }
      ],
      account: {
        authenticated: false,
        portfolio: [],
        latestActivity: null,
        lastError: null
      }
    };

    const fallback = buildFallbackAiResponse({
      question: "What should I watch?",
      simpleLanguage: true,
      snapshot
    });
    const guarded = enforceViableMessaging(fallback, snapshot);

    expect(guarded.answer).toContain("No ready copy-trade suggestions");
    expect(guarded.top_candidates.every((candidate) => candidate.status !== "VIABLE")).toBe(true);
  });

  it("normalizes malformed model output into valid schema shape", () => {
    const fallback = buildFallbackAiResponse({
      question: "What should I study?",
      simpleLanguage: true,
      snapshot: {
        generatedAt: "2026-03-05T00:00:00.000Z",
        settings: {
          strategyParams: DEFAULT_STRATEGY_PARAMS,
          netEdgeSanity: {
            maxPossibleNetEdgeNoSpreadPct: 0.0015,
            maxPossibleNetEdgeNoSpreadBps: 15,
            minNetEdgePct: 0.0015,
            minNetEdgeBps: 15,
            viableUnreachable: true
          }
        },
        sentiment: {
          label: "Neutral",
          classification: "NEUTRAL",
          scorePct: 0,
          scoreBps: 0,
          referenceLabel: "OPEN_24H",
          thresholds: {
            riskOffPct: -0.01,
            riskOnPct: 0.01
          }
        },
        suggestionUniverse: ["BTCUSDT"],
        balanceSuggestions: [],
        account: {
          authenticated: false,
          portfolio: [],
          latestActivity: null,
          lastError: null
        }
      }
    });

    const normalized = normalizeModelResponse(
      {
        answer: 42,
        top_candidates: [
          {
            pair: "ETHUSDT",
            status: "viable",
            numbers: {
              spread_bps: "12.4",
              deviation_bps: 55,
              net_edge_bps: "33.1"
            },
            feasibility: {
              min_order_ok: "true",
              notes: ["ok"]
            },
            if_user_wants_to_simulate: {
              entry: "100",
              tp: "101",
              sl: "99",
              notional: "30",
              qty: "0.3"
            }
          }
        ],
        risks: "fees",
        disclaimer: 11
      },
      fallback
    );

    const parsed = aiAssistantResponseSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.top_candidates[0]?.status).toBe("VIABLE");
  });
});
