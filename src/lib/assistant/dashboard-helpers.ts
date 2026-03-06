import type { DeterministicSuggestion } from "@/lib/assistant/types";

export type SentimentClassification = "RISK_OFF" | "NEUTRAL" | "RISK_ON";

export type SentimentInput = {
  pair: string;
  lastPrice: number;
  openReferencePrice: number | null;
  openReferenceLabel: "OPEN_24H" | "DAY_OPEN" | null;
};

export type MarketSentiment = {
  scorePct: number;
  scoreBps: number;
  classification: SentimentClassification;
  label: "Risk-off" | "Neutral" | "Risk-on";
  color: "RED" | "AMBER" | "GREEN";
  sampleSize: number;
  referenceLabel: "OPEN_24H" | "DAY_OPEN" | "MIXED" | "UNAVAILABLE";
};

export type ScannerOpportunity = {
  pair: string;
  suggestion: DeterministicSuggestion;
  scoreScaled: number;
  needsDip: boolean;
};

const SCORE_SCALE = 1_000_000_000;
export const SENTIMENT_RED_THRESHOLD_PCT = -0.01;
export const SENTIMENT_GREEN_THRESHOLD_PCT = 0.01;

const toScaled = (value: number): number => Math.round(value * SCORE_SCALE);

const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }

  const left = sorted[middle - 1] ?? 0;
  const right = sorted[middle] ?? 0;
  return (left + right) / 2;
};

const buildSentimentReferenceLabel = (inputs: SentimentInput[]): MarketSentiment["referenceLabel"] => {
  const labels = new Set(inputs.map((item) => item.openReferenceLabel).filter((label): label is "OPEN_24H" | "DAY_OPEN" => !!label));

  if (labels.size === 0) {
    return "UNAVAILABLE";
  }

  if (labels.size === 1) {
    return labels.has("OPEN_24H") ? "OPEN_24H" : "DAY_OPEN";
  }

  return "MIXED";
};

export const classifySentiment = (scorePct: number): SentimentClassification => {
  if (scorePct <= SENTIMENT_RED_THRESHOLD_PCT) {
    return "RISK_OFF";
  }

  if (scorePct >= SENTIMENT_GREEN_THRESHOLD_PCT) {
    return "RISK_ON";
  }

  return "NEUTRAL";
};

export const computeMarketSentiment = (inputs: SentimentInput[]): MarketSentiment => {
  const validChanges = inputs
    .map((item) => {
      if (!item.openReferencePrice || item.openReferencePrice <= 0 || !item.lastPrice || item.lastPrice <= 0) {
        return null;
      }

      return (item.lastPrice - item.openReferencePrice) / item.openReferencePrice;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const scorePct = median(validChanges);
  const classification = classifySentiment(scorePct);
  const referenceLabel = buildSentimentReferenceLabel(inputs);

  if (classification === "RISK_OFF") {
    return {
      scorePct,
      scoreBps: scorePct * 10_000,
      classification,
      label: "Risk-off",
      color: "RED",
      sampleSize: validChanges.length,
      referenceLabel
    };
  }

  if (classification === "RISK_ON") {
    return {
      scorePct,
      scoreBps: scorePct * 10_000,
      classification,
      label: "Risk-on",
      color: "GREEN",
      sampleSize: validChanges.length,
      referenceLabel
    };
  }

  return {
    scorePct,
    scoreBps: scorePct * 10_000,
    classification,
    label: "Neutral",
    color: "AMBER",
    sampleSize: validChanges.length,
    referenceLabel
  };
};

export const rankScannerOpportunities = (input: {
  suggestions: DeterministicSuggestion[];
  availableQuoteBalance: number;
  sentiment: SentimentClassification;
  riskOffExtraStrict?: boolean;
  limit?: number;
}): ScannerOpportunity[] => {
  const candidateLists = buildDeterministicCandidateLists({
    suggestions: input.suggestions,
    availableQuoteBalance: input.availableQuoteBalance,
    sentiment: input.sentiment,
    riskOffExtraStrict: input.riskOffExtraStrict,
    limit: input.limit
  });

  return [...candidateLists.buyCandidates, ...candidateLists.watchCandidates].slice(
    0,
    Math.max(1, Math.min(10, Math.trunc(input.limit ?? 3)))
  );
};

export const buildDeterministicCandidateLists = (input: {
  suggestions: DeterministicSuggestion[];
  availableQuoteBalance: number;
  sentiment: SentimentClassification;
  riskOffExtraStrict?: boolean;
  limit?: number;
}): {
  buyCandidates: ScannerOpportunity[];
  watchCandidates: ScannerOpportunity[];
} => {
  const safeLimit = Math.max(1, Math.min(10, Math.trunc(input.limit ?? 3)));
  const strictRiskOff = input.riskOffExtraStrict === true && input.sentiment === "RISK_OFF";

  const affordable = input.suggestions.filter((suggestion) => {
    if (!Number.isFinite(input.availableQuoteBalance) || input.availableQuoteBalance <= 0) {
      return false;
    }

    if (!suggestion.entryPrice || suggestion.suggestedQty <= 0 || suggestion.suggestedNotional <= 0) {
      return false;
    }

    if (suggestion.suggestedNotional > input.availableQuoteBalance) {
      return false;
    }

    return true;
  });

  const rankWatchCandidate = (candidate: ScannerOpportunity, other: ScannerOpportunity): number => {
    if (other.suggestion.cost.netEdgePct !== candidate.suggestion.cost.netEdgePct) {
      return other.suggestion.cost.netEdgePct - candidate.suggestion.cost.netEdgePct;
    }

    if (candidate.suggestion.cost.spreadPct !== other.suggestion.cost.spreadPct) {
      return candidate.suggestion.cost.spreadPct - other.suggestion.cost.spreadPct;
    }

    const candidateBelow = candidate.suggestion.deviationPct >= 0;
    const otherBelow = other.suggestion.deviationPct >= 0;

    if (candidateBelow !== otherBelow) {
      return candidateBelow ? -1 : 1;
    }

    if (candidateBelow) {
      if (other.suggestion.deviationPct !== candidate.suggestion.deviationPct) {
        return other.suggestion.deviationPct - candidate.suggestion.deviationPct;
      }
    } else if (other.suggestion.deviationPct !== candidate.suggestion.deviationPct) {
      return other.suggestion.deviationPct - candidate.suggestion.deviationPct;
    }

    return candidate.pair.localeCompare(other.pair);
  };

  const buyCandidates = affordable
    .filter((suggestion) => suggestion.decision === "BUY")
    .map((suggestion) => ({
      pair: suggestion.pair,
      suggestion,
      scoreScaled: toScaled(suggestion.cost.netEdgePct) + toScaled(suggestion.deviationPct),
      needsDip: false
    }))
    .sort((left, right) => {
      if (right.suggestion.cost.netEdgePct !== left.suggestion.cost.netEdgePct) {
        return right.suggestion.cost.netEdgePct - left.suggestion.cost.netEdgePct;
      }

      if (left.suggestion.cost.spreadPct !== right.suggestion.cost.spreadPct) {
        return left.suggestion.cost.spreadPct - right.suggestion.cost.spreadPct;
      }

      return right.suggestion.deviationPct - left.suggestion.deviationPct;
    })
    .slice(0, safeLimit);

  const watchCandidates = affordable
    .filter((suggestion) => suggestion.decision === "WAIT" && suggestion.viability !== "NOT_VIABLE")
    .filter((suggestion) => !strictRiskOff || suggestion.viability === "VIABLE")
    .map((suggestion) => ({
      pair: suggestion.pair,
      suggestion,
      scoreScaled: toScaled(suggestion.cost.netEdgePct) + toScaled(suggestion.deviationPct),
      needsDip: suggestion.deviationPct < 0
    }))
    .sort(rankWatchCandidate)
    .slice(0, safeLimit);

  return {
    buyCandidates,
    watchCandidates
  };
};
