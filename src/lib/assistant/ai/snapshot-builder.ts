import {
  computeMarketSentiment,
  SENTIMENT_GREEN_THRESHOLD_PCT,
  SENTIMENT_RED_THRESHOLD_PCT
} from "@/lib/assistant/dashboard-helpers";
import { buildAccountSuggestionPairUniverse, buildBalanceSuggestions } from "@/lib/assistant/account-suggestions";
import { DEFAULT_ASSISTANT_PAIRS, DEFAULT_STRATEGY_PARAMS } from "@/lib/assistant/defaults";
import { evaluateSuggestionParameterSanity } from "@/lib/assistant/suggestion-engine";
import { getAssistantMarketState, getAssistantPositionsState, parseAssistantPairs } from "@/lib/assistant/data-providers";
import type { AiAssistantClientContext, AiSnapshot } from "@/lib/assistant/ai/types";
import { roundTo } from "@/lib/utils";

const resolveSettings = (context?: Partial<AiAssistantClientContext>) => {
  const strategyParams = context?.strategyParams ?? DEFAULT_STRATEGY_PARAMS;

  return {
    strategyParams
  };
};

export const buildAiSnapshot = async (input: {
  includeRawCandles: boolean;
  context?: Partial<AiAssistantClientContext>;
}): Promise<AiSnapshot> => {
  const settings = resolveSettings(input.context);
  const seedUniverse = parseAssistantPairs(DEFAULT_ASSISTANT_PAIRS, DEFAULT_ASSISTANT_PAIRS, 10);
  const positionsState = await getAssistantPositionsState({
    pairs: seedUniverse
  });
  const suggestionUniverse = buildAccountSuggestionPairUniverse({
    portfolio: positionsState.portfolio,
    latestActivity: positionsState.latestActivity,
    openOrders: positionsState.openOrders,
    selectedPairs: DEFAULT_ASSISTANT_PAIRS
  });
  const marketState = await getAssistantMarketState({
    pairs: suggestionUniverse.length > 0 ? suggestionUniverse : seedUniverse,
    timeframe: settings.strategyParams.timeframe,
    limit: Math.max(120, settings.strategyParams.maPeriod + 20)
  });

  const sentiment = computeMarketSentiment(
    marketState.pairs.map((pair) => {
      const ticker = pair.ticker;
      return {
        pair: pair.pair,
        lastPrice: ticker?.last ?? 0,
        openReferencePrice: ticker?.openReferencePrice ?? null,
        openReferenceLabel: ticker?.openReferenceLabel ?? null
      };
    })
  );

  const balanceSuggestions = buildBalanceSuggestions({
    positionsState,
    marketPairs: marketState.pairs,
    params: settings.strategyParams,
    selectedPairs: DEFAULT_ASSISTANT_PAIRS,
    sentiment: sentiment.classification
  });

  const netEdgeSanity = evaluateSuggestionParameterSanity(settings.strategyParams);

  return {
    generatedAt: new Date().toISOString(),
    settings: {
      strategyParams: settings.strategyParams,
      netEdgeSanity: {
        maxPossibleNetEdgeNoSpreadPct: netEdgeSanity.maxPossibleNetEdgeNoSpreadPct,
        maxPossibleNetEdgeNoSpreadBps: roundTo(netEdgeSanity.maxPossibleNetEdgeNoSpreadPct * 10_000, 4),
        minNetEdgePct: netEdgeSanity.minNetEdgePct,
        minNetEdgeBps: roundTo(netEdgeSanity.minNetEdgePct * 10_000, 4),
        viableUnreachable: netEdgeSanity.viableUnreachable
      }
    },
    sentiment: {
      label: sentiment.label,
      classification: sentiment.classification,
      scorePct: roundTo(sentiment.scorePct, 8),
      scoreBps: roundTo(sentiment.scoreBps, 4),
      referenceLabel: sentiment.referenceLabel,
      thresholds: {
        riskOffPct: SENTIMENT_RED_THRESHOLD_PCT,
        riskOnPct: SENTIMENT_GREEN_THRESHOLD_PCT
      }
    },
    suggestionUniverse,
    balanceSuggestions: balanceSuggestions.map((suggestion) => ({
      asset: suggestion.asset,
      marketPair: suggestion.marketPair,
      side: suggestion.side,
      status: suggestion.status,
      primaryOrderType: suggestion.primaryOrderType,
      headline: suggestion.headline,
      summary: suggestion.summary,
      quantity: roundTo(suggestion.quantity, 8),
      price: suggestion.price !== null ? roundTo(suggestion.price, 8) : null,
      triggerPrice: suggestion.triggerPrice !== null ? roundTo(suggestion.triggerPrice, 8) : null,
      total: roundTo(suggestion.total, 8),
      notes: suggestion.notes,
      metrics: {
        spreadBps: suggestion.metrics.spreadBps,
        deviationBps: suggestion.metrics.deviationBps,
        netEdgeBps: suggestion.metrics.netEdgeBps
      }
    })),
    account: {
      authenticated: positionsState.authenticated,
      portfolio: positionsState.portfolio,
      latestActivity: positionsState.latestActivity,
      lastError: positionsState.lastError
    }
  };
};
