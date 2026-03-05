import { roundTo } from "@/lib/utils";

import type { AiAssistantResponse } from "@/lib/assistant/ai/schema";
import type { AiSnapshot } from "@/lib/assistant/ai/types";

const defaultDisclaimer =
  "Educational only, not financial advice. Deterministic engine remains the source of truth for BUY/WAIT/DO_NOT_TRADE.";

const buildRisks = (snapshot: AiSnapshot): string[] => {
  const risks = [
    "Fees and spread can erase thin edge setups quickly.",
    "Slippage can be higher during volatile periods.",
    "Mean-reversion can fail in trend continuation (whipsaw risk)."
  ];

  if (snapshot.sentiment.classification === "RISK_OFF") {
    risks.unshift("Market is risk-off; prioritize selectivity and position-size caution.");
  }

  return risks;
};

const buildLearningCorner = (): AiAssistantResponse["learning_corner"] => [
  { term: "Spread", simple: "The gap between bid and ask; wider spread means higher entry/exit cost." },
  { term: "Net edge", simple: "Expected upside after spread, fees, and slippage are subtracted." },
  { term: "Deviation vs MA", simple: "How far price is below the moving average, used for entry signal." },
  { term: "Notional", simple: "Total order value in quote currency: price × quantity." }
];

const viabilityText = (snapshot: AiSnapshot): string => {
  const viable = snapshot.coins.filter((coin) => coin.deterministic.viability === "VIABLE").length;
  if (viable === 0) {
    return "No VIABLE candidates right now under your deterministic rules.";
  }

  return `${viable} VIABLE candidate(s) currently meet your deterministic constraints.`;
};

const asNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const asString = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return fallback;
};

const asBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
};

const asStringArray = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const next = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  return next.length > 0 ? next : fallback;
};

export const buildFallbackAiResponse = (input: {
  question: string;
  simpleLanguage: boolean;
  snapshot: AiSnapshot;
}): AiAssistantResponse => {
  const top = input.snapshot.deterministicTopCandidates.slice(0, 3).map((candidate) => {
    const coin = input.snapshot.coins.find((row) => row.pair === candidate.pair);
    const note =
      coin?.deterministic.blockingReasons[0] ??
      (coin?.deterministic.minOrderOk ? "Meets minimum order checks for current balance." : "Check minimum order constraints.");

    return {
      pair: candidate.pair,
      status: candidate.viability,
      why_interesting: `${candidate.pair} shows net edge ${roundTo(candidate.netEdgeBps, 2)} bps and deviation ${roundTo(candidate.deviationBps, 2)} bps with spread ${roundTo(candidate.spreadBps, 2)} bps.`,
      numbers: {
        spread_bps: roundTo(candidate.spreadBps, 4),
        deviation_bps: roundTo(candidate.deviationBps, 4),
        net_edge_bps: roundTo(candidate.netEdgeBps, 4)
      },
      feasibility: {
        min_order_ok: coin?.deterministic.minOrderOk ?? false,
        notes: [note]
      },
      if_user_wants_to_simulate: {
        entry: roundTo(coin?.deterministic.entryPrice ?? 0, 8),
        tp: roundTo(coin?.deterministic.tpPrice ?? 0, 8),
        sl: roundTo(coin?.deterministic.slPrice ?? 0, 8),
        notional: roundTo(coin?.deterministic.suggestedNotional ?? 0, 8),
        qty: roundTo(coin?.deterministic.suggestedQty ?? 0, 8)
      }
    };
  });

  const plainAnswer = input.simpleLanguage
    ? `Short answer: ${viabilityText(input.snapshot)} I can help you compare candidates by spread, net edge, and minimum-size feasibility.`
    : `Direct answer: ${viabilityText(input.snapshot)} This answer is grounded in your deterministic snapshot and does not override deterministic decisions.`;

  return {
    answer: plainAnswer,
    top_candidates: top,
    risks: buildRisks(input.snapshot),
    learning_corner: buildLearningCorner(),
    disclaimer: defaultDisclaimer
  };
};

export const normalizeModelResponse = (raw: unknown, fallback: AiAssistantResponse): AiAssistantResponse => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fallbackByPair = new Map(fallback.top_candidates.map((candidate) => [candidate.pair, candidate]));
  const topRaw = Array.isArray(source.top_candidates) ? source.top_candidates : [];

  const topCandidates = topRaw.slice(0, 3).map((candidateRaw, index) => {
    const sourceCandidate = candidateRaw && typeof candidateRaw === "object"
      ? (candidateRaw as Record<string, unknown>)
      : {};
    const pair = asString(sourceCandidate.pair, fallback.top_candidates[index]?.pair ?? "BTCUSDT");
    const matchedFallback = fallbackByPair.get(pair) ?? fallback.top_candidates[index] ?? fallback.top_candidates[0];
    const statusRaw = asString(sourceCandidate.status, matchedFallback?.status ?? "NOT_VIABLE").toUpperCase();
    const status = statusRaw === "VIABLE" || statusRaw === "MARGINAL" || statusRaw === "NOT_VIABLE"
      ? statusRaw
      : matchedFallback?.status ?? "NOT_VIABLE";
    const numbersRaw = sourceCandidate.numbers && typeof sourceCandidate.numbers === "object"
      ? (sourceCandidate.numbers as Record<string, unknown>)
      : {};
    const feasibilityRaw = sourceCandidate.feasibility && typeof sourceCandidate.feasibility === "object"
      ? (sourceCandidate.feasibility as Record<string, unknown>)
      : {};
    const simulateRaw = sourceCandidate.if_user_wants_to_simulate && typeof sourceCandidate.if_user_wants_to_simulate === "object"
      ? (sourceCandidate.if_user_wants_to_simulate as Record<string, unknown>)
      : {};

    return {
      pair,
      status,
      why_interesting: asString(sourceCandidate.why_interesting, matchedFallback?.why_interesting ?? "Interesting under deterministic filters."),
      numbers: {
        spread_bps: asNumber(numbersRaw.spread_bps, matchedFallback?.numbers.spread_bps ?? 0),
        deviation_bps: asNumber(numbersRaw.deviation_bps, matchedFallback?.numbers.deviation_bps ?? 0),
        net_edge_bps: asNumber(numbersRaw.net_edge_bps, matchedFallback?.numbers.net_edge_bps ?? 0)
      },
      feasibility: {
        min_order_ok: asBoolean(feasibilityRaw.min_order_ok, matchedFallback?.feasibility.min_order_ok ?? false),
        notes: asStringArray(feasibilityRaw.notes, matchedFallback?.feasibility.notes ?? ["Check feasibility constraints."])
      },
      if_user_wants_to_simulate: {
        entry: asNumber(simulateRaw.entry, matchedFallback?.if_user_wants_to_simulate.entry ?? 0),
        tp: asNumber(simulateRaw.tp, matchedFallback?.if_user_wants_to_simulate.tp ?? 0),
        sl: asNumber(simulateRaw.sl, matchedFallback?.if_user_wants_to_simulate.sl ?? 0),
        notional: asNumber(simulateRaw.notional, matchedFallback?.if_user_wants_to_simulate.notional ?? 0),
        qty: asNumber(simulateRaw.qty, matchedFallback?.if_user_wants_to_simulate.qty ?? 0)
      }
    };
  });

  return {
    answer: asString(source.answer, fallback.answer),
    top_candidates: topCandidates.length > 0 ? topCandidates : fallback.top_candidates,
    risks: asStringArray(source.risks, fallback.risks),
    learning_corner: Array.isArray(source.learning_corner)
      ? source.learning_corner
          .map((item, index) => {
            const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            const fallbackRow = fallback.learning_corner[index] ?? fallback.learning_corner[0] ?? { term: "Term", simple: "Simple meaning." };
            return {
              term: asString(row.term, fallbackRow.term),
              simple: asString(row.simple, fallbackRow.simple)
            };
          })
          .slice(0, 5)
      : fallback.learning_corner,
    disclaimer: asString(source.disclaimer, fallback.disclaimer)
  };
};

export const enforceViableMessaging = (response: AiAssistantResponse, snapshot: AiSnapshot): AiAssistantResponse => {
  const hasViable = snapshot.coins.some((coin) => coin.deterministic.viability === "VIABLE");
  if (hasViable) {
    return response;
  }

  if (response.answer.toUpperCase().includes("NO VIABLE")) {
    return response;
  }

  return {
    ...response,
    answer: `No VIABLE candidates right now under your deterministic rules. ${response.answer}`
  };
};
