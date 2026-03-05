import type {
  AssistantMarketPair,
  AssistantMarketResponse,
  AssistantPositionsResponse,
  KrakenPortfolioAsset,
  LatestActivity,
  MonitoredPosition,
  QuoteBalanceView
} from "@/lib/assistant/types";
import { DEFAULT_STRATEGY_PARAMS } from "@/lib/assistant/defaults";
import { getEnv } from "@/lib/env";
import { resolveKrakenSymbol } from "@/lib/kraken/symbol-resolver";
import { KrakenClient } from "@/lib/kraken/kraken-client";
import { splitInternalPair, toInternalPair } from "@/lib/trading/symbol-normalization";
import type { ExchangeBalance, ExchangeFill } from "@/lib/trading/types";
import { formatIsoNow, roundTo } from "@/lib/utils";

const BASE_ALIASES: Record<string, string> = {
  BTC: "XBT",
  XBT: "BTC"
};
const POSITIONS_CACHE_TTL_MS = 60_000;
const positionsCache = new Map<string, { expiresAt: number; state: AssistantPositionsResponse }>();

const toPairList = (value: string[] | string | null | undefined, maxPairs: number): string[] => {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      raw
        .map((pair) => toInternalPair(pair))
        .filter(Boolean)
    )
  ).slice(0, Math.max(1, Math.min(20, maxPairs)));
};

const findBalance = (balances: ExchangeBalance[], asset: string): number => {
  const upper = asset.toUpperCase();
  const alias = BASE_ALIASES[upper];
  const match = balances.find(
    (balance) =>
      balance.asset.toUpperCase() === upper ||
      (alias ? balance.asset.toUpperCase() === alias : false)
  );
  return match?.available ?? 0;
};

const estimateEntryFromFills = (pair: string, fills: ExchangeFill[]): { entryPrice: number; openedAt: string } | null => {
  const pairFills = fills
    .filter((fill) => toInternalPair(fill.pair) === pair)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));

  if (pairFills.length === 0) {
    return null;
  }

  let netQty = 0;
  let cost = 0;
  let openedAt = "";

  for (const fill of pairFills) {
    if (fill.side === "BUY") {
      if (netQty <= 0) {
        openedAt = fill.timestamp;
      }

      netQty += fill.qty;
      cost += fill.qty * fill.price;
      continue;
    }

    if (fill.side === "SELL" && netQty > 0) {
      const avgCost = netQty > 0 ? cost / netQty : 0;
      const matchedQty = Math.min(netQty, fill.qty);
      cost -= matchedQty * avgCost;
      netQty -= matchedQty;

      if (netQty <= 0) {
        netQty = 0;
        cost = 0;
        openedAt = "";
      }
    }
  }

  if (netQty <= 0 || cost <= 0) {
    const latestBuy = pairFills
      .slice()
      .reverse()
      .find((fill) => fill.side === "BUY");

    if (!latestBuy) {
      return null;
    }

    return {
      entryPrice: roundTo(latestBuy.price, 8),
      openedAt: latestBuy.timestamp
    };
  }

  return {
    entryPrice: roundTo(cost / netQty, 8),
    openedAt: openedAt || pairFills[pairFills.length - 1]?.timestamp || formatIsoNow()
  };
};

const detectPositions = (input: {
  pairs: string[];
  balances: ExchangeBalance[];
  fills: ExchangeFill[];
}): MonitoredPosition[] => {
  const positions: MonitoredPosition[] = [];

  for (const pair of input.pairs) {
    const { base } = splitInternalPair(pair);
    const qty = roundTo(findBalance(input.balances, base), 8);

    if (qty <= 0) {
      continue;
    }

    const estimate = estimateEntryFromFills(pair, input.fills);
    positions.push({
      pair,
      qty,
      entryPrice: estimate?.entryPrice ?? 0,
      openedAt: estimate?.openedAt ?? formatIsoNow(),
      source: "KRAKEN_READ_ONLY"
    });
  }

  return positions;
};

const getQuoteBalances = (pairs: string[], balances: ExchangeBalance[]): QuoteBalanceView[] => {
  const quotes = Array.from(new Set(pairs.map((pair) => splitInternalPair(pair).quote)));

  return quotes.map((quote) => ({
    asset: quote,
    available: roundTo(findBalance(balances, quote), 8)
  }));
};

const getPortfolioBalances = (balances: ExchangeBalance[]): KrakenPortfolioAsset[] =>
  balances
    .filter((balance) => Number.isFinite(balance.available) && balance.available > 0)
    .map((balance) => ({
      asset: balance.asset.toUpperCase(),
      available: roundTo(balance.available, 8)
    }))
    .sort((left, right) => right.available - left.available);

const getLatestActivity = (fills: ExchangeFill[], openOrders: Awaited<ReturnType<KrakenClient["getOpenOrders"]>>): LatestActivity | null => {
  const latestTrade = fills
    .slice()
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  const latestOrder = openOrders
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  const latestTradeTs = latestTrade ? Date.parse(latestTrade.timestamp) : Number.NEGATIVE_INFINITY;
  const latestOrderTs = latestOrder ? Date.parse(latestOrder.createdAt) : Number.NEGATIVE_INFINITY;

  if (latestTradeTs === Number.NEGATIVE_INFINITY && latestOrderTs === Number.NEGATIVE_INFINITY) {
    return null;
  }

  if (latestTradeTs >= latestOrderTs && latestTrade) {
    return {
      type: "trade",
      side: latestTrade.side,
      pair: toInternalPair(latestTrade.pair),
      price: roundTo(latestTrade.price, 8),
      qty: roundTo(latestTrade.qty, 8),
      status: "FILLED",
      timestamp: latestTrade.timestamp,
      source: "kraken"
    };
  }

  if (!latestOrder) {
    return null;
  }

  return {
    type: "order",
    side: latestOrder.side,
    pair: toInternalPair(latestOrder.pair),
    price: roundTo(latestOrder.avgFillPrice, 8),
    qty: roundTo(latestOrder.requestedQty, 8),
    status: latestOrder.status,
    timestamp: latestOrder.createdAt,
    source: "kraken"
  };
};

export const parseAssistantPairs = (
  value: string[] | string | null | undefined,
  fallback = ["BTCUSDT"],
  maxPairs = 3
): string[] => {
  const parsed = toPairList(value, maxPairs);
  if (parsed.length > 0) {
    return parsed;
  }

  return toPairList(fallback, maxPairs);
};

export const getAssistantMarketState = async (input: {
  pairs: string[];
  timeframe?: "5m";
  limit?: number;
}): Promise<AssistantMarketResponse> => {
  const pairs = parseAssistantPairs(input.pairs, ["BTCUSDT"], 20);
  const timeframe = input.timeframe === "5m" ? input.timeframe : DEFAULT_STRATEGY_PARAMS.timeframe;
  const limit = Math.max(60, Math.min(300, Math.trunc(input.limit ?? 120)));
  const client = new KrakenClient();

  const pairResults = await Promise.all(
    pairs.map(async (pair): Promise<AssistantMarketPair> => {
      try {
        const normalized = await resolveKrakenSymbol(pair);
        const [ticker, candles, instrument] = await Promise.all([
          client.getTicker(pair),
          client.getCandles(pair, timeframe, limit),
          client.getInstrumentInfo(pair)
        ]);

        return {
          pair,
          wsSymbol: normalized.exchangeWs,
          ticker,
          candles: candles.map((candle) => candle.close),
          instrument,
          error: null
        };
      } catch (error) {
        return {
          pair,
          wsSymbol: null,
          ticker: null,
          candles: [],
          instrument: null,
          error: error instanceof Error ? error.message : "Market data unavailable."
        };
      }
    })
  );

  return {
    ok: true,
    asOf: formatIsoNow(),
    pairs: pairResults
  };
};

export const getAssistantPositionsState = async (input: {
  pairs: string[];
}): Promise<AssistantPositionsResponse> => {
  const now = formatIsoNow();
  const pairs = parseAssistantPairs(input.pairs, ["BTCUSDT"], 20);
  const cacheKey = pairs.slice().sort().join(",");
  const cacheNow = Date.now();
  const cachedEntry = positionsCache.get(cacheKey);

  if (cachedEntry && cachedEntry.expiresAt > cacheNow) {
    return {
      ...cachedEntry.state,
      cached: {
        ...cachedEntry.state.cached,
        hit: true
      }
    };
  }

  const env = getEnv();

  if (!env.krakenApiKey || !env.krakenApiSecret) {
    const state: AssistantPositionsResponse = {
      ok: true,
      authenticated: false,
      checkedAt: now,
      positions: [],
      openOrders: [],
      quoteBalances: [],
      portfolio: [],
      latestActivity: null,
      cached: {
        hit: false,
        ttlSeconds: Math.trunc(POSITIONS_CACHE_TTL_MS / 1000)
      },
      lastError: "Kraken API keys are missing. Use manual position fallback."
    };

    positionsCache.set(cacheKey, {
      expiresAt: cacheNow + POSITIONS_CACHE_TTL_MS,
      state
    });

    return state;
  }

  try {
    const client = new KrakenClient({
      apiKey: env.krakenApiKey,
      apiSecret: env.krakenApiSecret
    });
    const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [balances, fills, openOrders] = await Promise.all([
      client.getBalances(),
      client.listFills(sinceIso),
      client.getOpenOrders()
    ]);
    const positions = detectPositions({
      pairs,
      balances,
      fills
    });
    const quoteBalances = getQuoteBalances(pairs, balances);
    const portfolio = getPortfolioBalances(balances);
    const latestActivity = getLatestActivity(fills, openOrders);
    const state: AssistantPositionsResponse = {
      ok: true,
      authenticated: true,
      checkedAt: now,
      positions,
      openOrders: openOrders
        .filter((order) => pairs.includes(order.pair))
        .map((order) => ({
          orderId: order.orderId,
          pair: order.pair,
          side: order.side,
          type: order.type,
          qty: order.requestedQty,
          price: order.avgFillPrice,
          openedAt: order.createdAt
        })),
      quoteBalances,
      portfolio,
      latestActivity,
      cached: {
        hit: false,
        ttlSeconds: Math.trunc(POSITIONS_CACHE_TTL_MS / 1000)
      },
      lastError: null
    };

    positionsCache.set(cacheKey, {
      expiresAt: Date.now() + POSITIONS_CACHE_TTL_MS,
      state
    });

    return state;
  } catch (error) {
    const state: AssistantPositionsResponse = {
      ok: false,
      authenticated: true,
      checkedAt: now,
      positions: [],
      openOrders: [],
      quoteBalances: [],
      portfolio: [],
      latestActivity: null,
      cached: {
        hit: false,
        ttlSeconds: Math.trunc(POSITIONS_CACHE_TTL_MS / 1000)
      },
      lastError: error instanceof Error ? error.message : "Unable to read Kraken account state."
    };

    positionsCache.set(cacheKey, {
      expiresAt: Date.now() + POSITIONS_CACHE_TTL_MS,
      state
    });

    return state;
  }
};
