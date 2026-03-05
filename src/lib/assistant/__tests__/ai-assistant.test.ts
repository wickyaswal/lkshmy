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
  it("snapshot builder includes deterministic outputs and excludes secrets", async () => {
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
      latestActivity: null,
      lastError: "Not connected"
    });

    const snapshot = await buildAiSnapshot({
      includeRawCandles: false,
      context: {
        selectedPairs: ["BTCUSDT"],
        strategyParams: DEFAULT_STRATEGY_PARAMS,
        tradingCapital: 1000,
        learningMode: true
      }
    });

    expect(snapshot.coins.length).toBeGreaterThan(0);
    expect(snapshot.coins[0]?.deterministic.viability).toBeTypeOf("string");
    expect(snapshot.coins[0]?.ma.summary.count).toBeGreaterThan(0);
    expect(snapshot.coins[0]?.ma.rawCloses).toBeUndefined();

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("very-secret-value");
    expect(serialized).not.toContain("OPENAI_API_KEY");
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

  it("states no viable candidates when none are viable", () => {
    const snapshot: AiSnapshot = {
      generatedAt: "2026-03-05T00:00:00.000Z",
      settings: {
        selectedPairs: ["BTCUSDT"],
        strategyParams: DEFAULT_STRATEGY_PARAMS,
        tradingCapital: 1000,
        learningMode: true,
        quoteAsset: "USDT",
        availableQuoteBalance: 30
      },
      watchlistUniverse: ["BTCUSDT"],
      sentiment: {
        label: "Risk-off",
        classification: "RISK_OFF",
        scorePct: -0.02,
        scoreBps: -200,
        referenceLabel: "OPEN_24H"
      },
      deterministicTopCandidates: [
        {
          pair: "BTCUSDT",
          viability: "MARGINAL",
          decision: "WAIT",
          scoreScaled: 1,
          spreadBps: 10,
          deviationBps: 20,
          netEdgeBps: 5
        }
      ],
      coins: [
        {
          pair: "BTCUSDT",
          ticker: null,
          ma: {
            period: 50,
            value: null,
            deviationPct: 0,
            summary: {
              count: 0,
              minClose: null,
              maxClose: null,
              lastClose: null
            }
          },
          instrument: null,
          deterministic: {
            decision: "WAIT",
            viability: "NOT_VIABLE",
            signalDetected: false,
            spreadPct: 0,
            netEdgePct: 0,
            deviationPct: 0,
            entryPrice: null,
            tpPrice: null,
            slPrice: null,
            suggestedNotional: 0,
            suggestedQty: 0,
            minOrderOk: false,
            blockingReasons: ["No signal"]
          }
        }
      ],
      account: {
        authenticated: false,
        quoteBalances: [],
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

    expect(guarded.answer).toContain("No VIABLE candidates");
    expect(guarded.top_candidates.every((candidate) => candidate.status !== "VIABLE")).toBe(true);
  });

  it("normalizes malformed model output into valid schema shape", () => {
    const fallback = buildFallbackAiResponse({
      question: "What should I study?",
      simpleLanguage: true,
      snapshot: {
        generatedAt: "2026-03-05T00:00:00.000Z",
        settings: {
          selectedPairs: ["BTCUSDT"],
          strategyParams: DEFAULT_STRATEGY_PARAMS,
          tradingCapital: 1000,
          learningMode: true,
          quoteAsset: "USDT",
          availableQuoteBalance: 30
        },
        watchlistUniverse: ["BTCUSDT"],
        sentiment: {
          label: "Neutral",
          classification: "NEUTRAL",
          scorePct: 0,
          scoreBps: 0,
          referenceLabel: "OPEN_24H"
        },
        deterministicTopCandidates: [],
        coins: [],
        account: {
          authenticated: false,
          quoteBalances: [],
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
