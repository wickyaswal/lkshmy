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
  { term: "Take profit limit", simple: "A trigger plus a limit price, often used to lock in gains at a chosen level." },
  { term: "Trailing stop", simple: "A moving stop that follows price and helps protect gains or cap losses." },
  { term: "Iceberg", simple: "A large order split so only a smaller visible quantity is shown at once." },
  { term: "Notional", simple: "Total order value in quote currency: price × quantity." }
];

const deterministicSummaryText = (snapshot: AiSnapshot): string => {
  const readyCount = snapshot.balanceSuggestions.filter((item) => item.status === "READY").length;
  const watchCount = snapshot.balanceSuggestions.filter((item) => item.status === "WATCH").length;
  if (readyCount > 0) {
    return `${readyCount} balance-driven suggestion(s) are ready to copy into Kraken. ${watchCount} more are worth monitoring.`;
  }

  if (watchCount > 0) {
    return `No ready copy-trade suggestions right now. ${watchCount} balance-driven idea(s) are worth monitoring.`;
  }

  return "No ready balance-driven suggestions right now.";
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
  const ranked = input.snapshot.balanceSuggestions
    .slice()
    .sort((left, right) => {
      const score = (value: AiSnapshot["balanceSuggestions"][number]["status"]): number => {
        if (value === "READY") {
          return 2;
        }
        if (value === "WATCH") {
          return 1;
        }
        return 0;
      };

      return score(right.status) - score(left.status);
    })
    .slice(0, 3);
  const top = ranked.map((candidate) => {
    const status: AiAssistantResponse["top_candidates"][number]["status"] =
      candidate.status === "READY" ? "VIABLE" : candidate.status === "WATCH" ? "MARGINAL" : "NOT_VIABLE";
    const note = candidate.notes[0] ?? "Review the Kraken copy form before using this setup.";
    const modeLabel = candidate.status === "READY" ? "ready to copy" : candidate.status === "WATCH" ? "watch-only" : "blocked";
    const pair = candidate.marketPair ?? candidate.asset;

    return {
      pair,
      status,
      why_interesting: `${pair} is ${modeLabel}: ${candidate.summary}`,
      numbers: {
        spread_bps: roundTo(candidate.metrics.spreadBps ?? 0, 4),
        deviation_bps: roundTo(candidate.metrics.deviationBps ?? 0, 4),
        net_edge_bps: roundTo(candidate.metrics.netEdgeBps ?? 0, 4)
      },
      feasibility: {
        min_order_ok: candidate.quantity > 0 && candidate.total > 0,
        notes: [note]
      },
      if_user_wants_to_simulate: {
        entry: roundTo(candidate.price ?? 0, 8),
        tp: roundTo(candidate.triggerPrice ?? 0, 8),
        sl: 0,
        notional: roundTo(candidate.total ?? 0, 8),
        qty: roundTo(candidate.quantity ?? 0, 8)
      }
    };
  });

  const plainAnswer = input.simpleLanguage
    ? `Short answer: ${deterministicSummaryText(input.snapshot)} I can help you compare the copy-ready Kraken forms, order types, and balance constraints.`
    : `Direct answer: ${deterministicSummaryText(input.snapshot)} This answer is grounded in your current account snapshot, sentiment, and balance-driven suggestion set.`;

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
  const hasReadySuggestions = snapshot.balanceSuggestions.some((item) => item.status === "READY");
  if (hasReadySuggestions) {
    return response;
  }

  if (response.answer.toUpperCase().includes("NO READY")) {
    return response;
  }

  return {
    ...response,
    answer: `No ready copy-trade suggestions right now. ${response.answer}`
  };
};
