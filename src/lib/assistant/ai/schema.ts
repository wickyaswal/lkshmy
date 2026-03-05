import { z } from "zod";

const statusSchema = z.enum(["VIABLE", "MARGINAL", "NOT_VIABLE"]);

export const aiAssistantRequestSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  simpleLanguage: z.boolean().default(true),
  includeRawCandles: z.boolean().default(false),
  context: z
    .object({
      selectedPairs: z.array(z.string().min(3).max(24)).max(10).optional(),
      strategyParams: z
        .object({
          takeProfitPct: z.number(),
          stopLossPct: z.number(),
          maxHoldMinutes: z.number().int().positive(),
          timeframe: z.literal("5m"),
          maPeriod: z.number().int().positive(),
          entryThresholdPct: z.number(),
          maxSpreadAllowedPct: z.number(),
          assumedFeePctRoundtrip: z.number(),
          assumedSlippagePctRoundtrip: z.number(),
          minNetEdgePct: z.number(),
          marginalNetEdgePct: z.number()
        })
        .optional(),
      tradingCapital: z.number().nonnegative().optional(),
      learningMode: z.boolean().optional(),
      availableQuoteBalance: z.number().nonnegative().optional()
    })
    .optional()
});

export const aiAssistantResponseSchema = z.object({
  answer: z.string().min(1),
  top_candidates: z.array(
    z.object({
      pair: z.string().min(3),
      status: statusSchema,
      why_interesting: z.string().min(1),
      numbers: z.object({
        spread_bps: z.number(),
        deviation_bps: z.number(),
        net_edge_bps: z.number()
      }),
      feasibility: z.object({
        min_order_ok: z.boolean(),
        notes: z.array(z.string())
      }),
      if_user_wants_to_simulate: z.object({
        entry: z.number(),
        tp: z.number(),
        sl: z.number(),
        notional: z.number(),
        qty: z.number()
      })
    })
  ),
  risks: z.array(z.string()),
  learning_corner: z.array(
    z.object({
      term: z.string(),
      simple: z.string()
    })
  ),
  disclaimer: z.string().min(1)
});

export type AiAssistantRequest = z.infer<typeof aiAssistantRequestSchema>;
export type AiAssistantResponse = z.infer<typeof aiAssistantResponseSchema>;
