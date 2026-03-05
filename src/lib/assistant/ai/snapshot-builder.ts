import { computeMarketSentiment, rankScannerOpportunities } from "@/lib/assistant/dashboard-helpers";
import { DEFAULT_ASSISTANT_PAIRS, DEFAULT_SELECTED_PAIRS, DEFAULT_STRATEGY_PARAMS } from "@/lib/assistant/defaults";
import { computeDeterministicSuggestion } from "@/lib/assistant/suggestion-engine";
import { getAssistantMarketState, getAssistantPositionsState, parseAssistantPairs } from "@/lib/assistant/data-providers";
import type { AiAssistantClientContext, AiSnapshot } from "@/lib/assistant/ai/types";
import { splitInternalPair } from "@/lib/trading/symbol-normalization";
import { roundTo } from "@/lib/utils";

const candleSummary = (candles: number[]): {
  count: number;
  minClose: number | null;
  maxClose: number | null;
  lastClose: number | null;
} => {
  if (candles.length === 0) {
    return {
      count: 0,
      minClose: null,
      maxClose: null,
      lastClose: null
    };
  }

  return {
    count: candles.length,
    minClose: Math.min(...candles),
    maxClose: Math.max(...candles),
    lastClose: candles[candles.length - 1] ?? null
  };
};

const resolveSettings = (context?: Partial<AiAssistantClientContext>) => {
  const selectedPairs = parseAssistantPairs(context?.selectedPairs, DEFAULT_SELECTED_PAIRS, 3);
  const strategyParams = context?.strategyParams ?? DEFAULT_STRATEGY_PARAMS;
  const tradingCapital = Number.isFinite(context?.tradingCapital) ? Math.max(0, context?.tradingCapital ?? 0) : 0;
  const learningMode = context?.learningMode ?? true;

  return {
    selectedPairs,
    strategyParams,
    tradingCapital,
    learningMode
  };
};

const resolveAvailableQuoteBalance = (input: {
  quoteAsset: string;
  authenticated: boolean;
  quoteBalances: { asset: string; available: number }[];
  context?: Partial<AiAssistantClientContext>;
}): number | null => {
  const detected = input.quoteBalances.find(
    (balance) => balance.asset.toUpperCase() === input.quoteAsset.toUpperCase()
  )?.available;

  if (Number.isFinite(detected) && (detected ?? 0) >= 0) {
    return detected ?? 0;
  }

  const provided = input.context?.availableQuoteBalance;
  if (Number.isFinite(provided) && (provided ?? 0) >= 0) {
    return provided ?? 0;
  }

  return null;
};

export const buildAiSnapshot = async (input: {
  includeRawCandles: boolean;
  context?: Partial<AiAssistantClientContext>;
}): Promise<AiSnapshot> => {
  const settings = resolveSettings(input.context);
  const watchlistUniverse = parseAssistantPairs(
    [...DEFAULT_ASSISTANT_PAIRS, ...settings.selectedPairs],
    DEFAULT_ASSISTANT_PAIRS,
    10
  );
  const quoteAsset = splitInternalPair(settings.selectedPairs[0] ?? "BTCUSDT").quote;

  const [marketState, positionsState] = await Promise.all([
    getAssistantMarketState({
      pairs: watchlistUniverse,
      timeframe: settings.strategyParams.timeframe,
      limit: Math.max(120, settings.strategyParams.maPeriod + 20)
    }),
    getAssistantPositionsState({
      pairs: watchlistUniverse
    })
  ]);

  const availableQuoteBalance = resolveAvailableQuoteBalance({
    quoteAsset,
    authenticated: positionsState.authenticated,
    quoteBalances: positionsState.quoteBalances,
    context: input.context
  });
  const effectiveQuoteBalance = Math.max(availableQuoteBalance ?? 0, 0);

  const sentiment = computeMarketSentiment(
    watchlistUniverse.map((pair) => {
      const marketPair = marketState.pairs.find((row) => row.pair === pair);
      const ticker = marketPair?.ticker;
      return {
        pair,
        lastPrice: ticker?.last ?? 0,
        openReferencePrice: ticker?.openReferencePrice ?? null,
        openReferenceLabel: ticker?.openReferenceLabel ?? null
      };
    })
  );

  const suggestions = watchlistUniverse.map((pair) => {
    const marketPair = marketState.pairs.find((row) => row.pair === pair);
    return computeDeterministicSuggestion({
      pair,
      tradingCapital: effectiveQuoteBalance,
      params: settings.strategyParams,
      ticker: marketPair?.ticker ?? null,
      candles: marketPair?.candles ?? [],
      instrument: marketPair?.instrument ?? null
    });
  });

  const ranked = rankScannerOpportunities({
    suggestions,
    availableQuoteBalance: effectiveQuoteBalance,
    sentiment: sentiment.classification,
    limit: 3
  });

  return {
    generatedAt: new Date().toISOString(),
    settings: {
      selectedPairs: settings.selectedPairs,
      strategyParams: settings.strategyParams,
      tradingCapital: settings.tradingCapital,
      learningMode: settings.learningMode,
      quoteAsset,
      availableQuoteBalance
    },
    watchlistUniverse,
    sentiment: {
      label: sentiment.label,
      classification: sentiment.classification,
      scorePct: roundTo(sentiment.scorePct, 8),
      scoreBps: roundTo(sentiment.scoreBps, 4),
      referenceLabel: sentiment.referenceLabel
    },
    deterministicTopCandidates: ranked.map((row) => ({
      pair: row.pair,
      viability: row.suggestion.viability,
      decision: row.suggestion.decision,
      scoreScaled: row.scoreScaled,
      spreadBps: roundTo(row.suggestion.cost.spreadPct * 10_000, 4),
      deviationBps: roundTo(row.suggestion.deviationPct * 10_000, 4),
      netEdgeBps: roundTo(row.suggestion.cost.netEdgePct * 10_000, 4)
    })),
    coins: watchlistUniverse.map((pair) => {
      const marketPair = marketState.pairs.find((row) => row.pair === pair);
      const suggestion = suggestions.find((row) => row.pair === pair);
      const summary = candleSummary(marketPair?.candles ?? []);
      const minOrderOk = !!(
        suggestion &&
        marketPair?.instrument &&
        suggestion.suggestedQty >= marketPair.instrument.minOrderQty &&
        suggestion.suggestedNotional >= marketPair.instrument.minNotional
      );

      return {
        pair,
        ticker: marketPair?.ticker
          ? {
              bid: roundTo(marketPair.ticker.bid, 8),
              ask: roundTo(marketPair.ticker.ask, 8),
              last: roundTo(marketPair.ticker.last, 8),
              spreadPct: roundTo(marketPair.ticker.spreadPct, 8),
              openReferencePrice: marketPair.ticker.openReferencePrice ?? null,
              openReferenceLabel: marketPair.ticker.openReferenceLabel ?? null
            }
          : null,
        ma: {
          period: settings.strategyParams.maPeriod,
          value: suggestion?.maValue ?? null,
          deviationPct: suggestion?.deviationPct ?? 0,
          summary,
          rawCloses: input.includeRawCandles ? marketPair?.candles ?? [] : undefined
        },
        instrument: marketPair?.instrument
          ? {
              minOrderQty: marketPair.instrument.minOrderQty,
              qtyStep: marketPair.instrument.qtyStep,
              priceStep: marketPair.instrument.priceStep,
              minNotional: marketPair.instrument.minNotional
            }
          : null,
        deterministic: {
          decision: suggestion?.decision ?? "DO_NOT_TRADE",
          viability: suggestion?.viability ?? "NOT_VIABLE",
          signalDetected: suggestion?.signalDetected ?? false,
          spreadPct: suggestion?.cost.spreadPct ?? 0,
          netEdgePct: suggestion?.cost.netEdgePct ?? 0,
          deviationPct: suggestion?.deviationPct ?? 0,
          entryPrice: suggestion?.entryPrice ?? null,
          tpPrice: suggestion?.tpPrice ?? null,
          slPrice: suggestion?.slPrice ?? null,
          suggestedNotional: suggestion?.suggestedNotional ?? 0,
          suggestedQty: suggestion?.suggestedQty ?? 0,
          minOrderOk,
          blockingReasons: suggestion?.blockingReasons ?? []
        }
      };
    }),
    account: {
      authenticated: positionsState.authenticated,
      quoteBalances: positionsState.quoteBalances,
      latestActivity: positionsState.latestActivity,
      lastError: positionsState.lastError
    }
  };
};
