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
};

const SCORE_SCALE = 1_000_000_000;
const RED_THRESHOLD = -0.01;
const GREEN_THRESHOLD = 0.01;

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
  if (scorePct <= RED_THRESHOLD) {
    return "RISK_OFF";
  }

  if (scorePct >= GREEN_THRESHOLD) {
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
  limit?: number;
}): ScannerOpportunity[] => {
  const safeLimit = Math.max(1, Math.min(10, Math.trunc(input.limit ?? 3)));

  const candidates = input.suggestions.filter((suggestion) => {
    if (!Number.isFinite(input.availableQuoteBalance) || input.availableQuoteBalance <= 0) {
      return false;
    }

    if (!suggestion.entryPrice || suggestion.suggestedQty <= 0 || suggestion.suggestedNotional <= 0) {
      return false;
    }

    if (suggestion.suggestedNotional > input.availableQuoteBalance) {
      return false;
    }

    if (suggestion.viability === "NOT_VIABLE") {
      return false;
    }

    if (input.sentiment === "RISK_OFF" && suggestion.viability !== "VIABLE") {
      return false;
    }

    return true;
  });

  const ranked = candidates
    .map((suggestion) => ({
      pair: suggestion.pair,
      suggestion,
      scoreScaled: toScaled(suggestion.cost.netEdgePct) + toScaled(suggestion.deviationPct)
    }))
    .sort((left, right) => {
      if (right.scoreScaled !== left.scoreScaled) {
        return right.scoreScaled - left.scoreScaled;
      }

      if (left.suggestion.cost.spreadPct !== right.suggestion.cost.spreadPct) {
        return left.suggestion.cost.spreadPct - right.suggestion.cost.spreadPct;
      }

      return left.pair.localeCompare(right.pair);
    });

  return ranked.slice(0, safeLimit);
};
