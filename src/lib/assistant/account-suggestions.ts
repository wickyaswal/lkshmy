import { DEFAULT_ASSISTANT_PAIRS } from "@/lib/assistant/defaults";
import { buildDeterministicCandidateLists } from "@/lib/assistant/dashboard-helpers";
import { computeDeterministicSuggestion } from "@/lib/assistant/suggestion-engine";
import type {
  AssistantMarketPair,
  AssistantPositionsResponse,
  KrakenOpenOrderView,
  KrakenPortfolioAsset,
  LatestActivity,
  StrategyParams
} from "@/lib/assistant/types";
import { splitInternalPair } from "@/lib/trading/symbol-normalization";
import type { InstrumentInfo } from "@/lib/trading/types";
import { roundTo } from "@/lib/utils";

export type KrakenOrderTemplateType =
  | "LIMIT"
  | "TAKE_PROFIT"
  | "TAKE_PROFIT_LIMIT"
  | "ICEBERG"
  | "TRAILING_STOP"
  | "TRAILING_STOP_LIMIT";

export type KrakenOrderTemplateField = {
  label: string;
  value: string;
  unit?: string;
};

export type KrakenOrderTemplate = {
  type: KrakenOrderTemplateType;
  side: "BUY" | "SELL";
  pair: string;
  availableText: string;
  tpSlEnabled: boolean;
  tpSlMode: "TP" | "SL" | null;
  submitLabel: string;
  fields: KrakenOrderTemplateField[];
  notes: string[];
};

export type AccountSuggestionStatus = "READY" | "WATCH" | "NO_ACTION";

export type BalanceSuggestion = {
  key: string;
  asset: string;
  available: number;
  marketPair: string | null;
  side: "BUY" | "SELL";
  status: AccountSuggestionStatus;
  primaryOrderType: KrakenOrderTemplateType | null;
  headline: string;
  summary: string;
  quantity: number;
  price: number | null;
  triggerPrice: number | null;
  total: number;
  notes: string[];
  metrics: {
    spreadBps: number | null;
    deviationBps: number | null;
    netEdgeBps: number | null;
  };
  templates: KrakenOrderTemplate[];
};

const QUOTE_ASSETS = new Set(["EUR", "USD", "USDT", "GBP"]);

const toFixedText = (value: number, decimals = 8): string => `${roundTo(value, decimals)}`;

const stepDecimals = (step: number): number => {
  if (!Number.isFinite(step) || step <= 0) {
    return 8;
  }

  const text = step.toString();
  const [, decimals = ""] = text.split(".");
  return decimals.length;
};

const floorToStep = (value: number, step: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (!Number.isFinite(step) || step <= 0) {
    return roundTo(value, 8);
  }

  const decimals = stepDecimals(step);
  return roundTo(Math.floor(value / step) * step, decimals);
};

const ceilToStep = (value: number, step: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (!Number.isFinite(step) || step <= 0) {
    return roundTo(value, 8);
  }

  const decimals = stepDecimals(step);
  return roundTo(Math.ceil(value / step) * step, decimals);
};

const resolvePreferredQuoteAsset = (
  portfolio: KrakenPortfolioAsset[],
  latestActivity: LatestActivity | null,
  selectedPairs: string[]
): string => {
  const fundedQuote = portfolio
    .filter((row) => QUOTE_ASSETS.has(row.asset.toUpperCase()) && row.available > 0)
    .sort((left, right) => right.available - left.available)[0];

  if (fundedQuote) {
    return fundedQuote.asset.toUpperCase();
  }

  if (latestActivity) {
    return splitInternalPair(latestActivity.pair).quote;
  }

  return splitInternalPair(selectedPairs[0] ?? DEFAULT_ASSISTANT_PAIRS[0]).quote;
};

const resolveSellPair = (input: {
  asset: string;
  latestActivity: LatestActivity | null;
  openOrders: KrakenOpenOrderView[];
  preferredQuoteAsset: string;
}): string => {
  const latestActivityPair =
    input.latestActivity && splitInternalPair(input.latestActivity.pair).base === input.asset
      ? input.latestActivity.pair
      : null;

  if (latestActivityPair) {
    return latestActivityPair;
  }

  const openOrderPair = input.openOrders.find((order) => splitInternalPair(order.pair).base === input.asset)?.pair;
  if (openOrderPair) {
    return openOrderPair;
  }

  return `${input.asset}${input.preferredQuoteAsset}`;
};

const resolveBuyPairs = (quoteAsset: string, selectedPairs: string[]): string[] => {
  const baseUniverse = Array.from(
    new Set(
      [...selectedPairs, ...DEFAULT_ASSISTANT_PAIRS].map((pair) => splitInternalPair(pair).base)
    )
  );

  return baseUniverse.map((base) => `${base}${quoteAsset}`);
};

const buildLimitOffset = (price: number, instrument: InstrumentInfo | null, spreadPct: number, direction: "BUY" | "SELL"): number => {
  const priceStep = instrument?.priceStep ?? 0.0001;
  const spreadBased = Math.max(price * spreadPct * 0.5, priceStep * 2);
  const moved = direction === "SELL" ? price - spreadBased : price + spreadBased;
  const rounded = direction === "SELL" ? floorToStep(moved, priceStep) : ceilToStep(moved, priceStep);
  return rounded > 0 ? rounded : price;
};

const buildIcebergDisplayQty = (qty: number, instrument: InstrumentInfo | null): number => {
  const minQty = instrument?.minOrderQty ?? 0;
  const step = instrument?.qtyStep ?? 0.00000001;
  const candidate = floorToStep(Math.max(qty * 0.25, minQty), step);
  return candidate > 0 ? Math.min(candidate, qty) : qty;
};

const buildBuyTemplates = (input: {
  pair: string;
  quoteAsset: string;
  availableBalance: number;
  qty: number;
  notional: number;
  entryPrice: number;
  currentAsk: number;
  spreadPct: number;
  params: StrategyParams;
  instrument: InstrumentInfo | null;
}): KrakenOrderTemplate[] => {
  const priceStep = input.instrument?.priceStep ?? 0.0001;
  const qtyStep = input.instrument?.qtyStep ?? 0.00000001;
  const breakoutTrigger = ceilToStep(input.currentAsk * (1 + input.params.entryThresholdPct * 0.35), priceStep);
  const breakoutLimit = ceilToStep(breakoutTrigger * (1 + Math.max(input.spreadPct, 0.0005)), priceStep);
  const trailingOffsetPct = Math.max(input.params.entryThresholdPct * 0.6, input.params.stopLossPct);
  const trailingOffsetValue = ceilToStep(input.currentAsk * trailingOffsetPct, priceStep);
  const icebergVisibleQty = buildIcebergDisplayQty(input.qty, input.instrument);

  return [
    {
      type: "LIMIT",
      side: "BUY",
      pair: input.pair,
      availableText: `${toFixedText(input.availableBalance, 6)} ${input.quoteAsset}`,
      tpSlEnabled: false,
      tpSlMode: null,
      submitLabel: `Buy ${input.pair}`,
      fields: [
        { label: "Limit price", value: toFixedText(input.entryPrice, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Quantity", value: toFixedText(input.qty, stepDecimals(qtyStep)), unit: splitInternalPair(input.pair).base },
        { label: "Total", value: toFixedText(input.notional, 6), unit: input.quoteAsset }
      ],
      notes: ["Strategy-aligned entry template.", "Uses the deterministic dip-entry price."]
    },
    {
      type: "TAKE_PROFIT",
      side: "BUY",
      pair: input.pair,
      availableText: `${toFixedText(input.availableBalance, 6)} ${input.quoteAsset}`,
      tpSlEnabled: false,
      tpSlMode: null,
      submitLabel: `Buy ${input.pair}`,
      fields: [
        { label: "Trigger price", value: toFixedText(breakoutTrigger, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Quantity", value: toFixedText(input.qty, stepDecimals(qtyStep)), unit: splitInternalPair(input.pair).base },
        { label: "Est. total", value: toFixedText(input.qty * breakoutTrigger, 6), unit: input.quoteAsset }
      ],
      notes: ["Breakout-style alternative.", "Not the primary deterministic entry."]
    },
    {
      type: "TAKE_PROFIT_LIMIT",
      side: "BUY",
      pair: input.pair,
      availableText: `${toFixedText(input.availableBalance, 6)} ${input.quoteAsset}`,
      tpSlEnabled: false,
      tpSlMode: null,
      submitLabel: `Buy ${input.pair}`,
      fields: [
        { label: "Trigger price", value: toFixedText(breakoutTrigger, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Limit price", value: toFixedText(breakoutLimit, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Quantity", value: toFixedText(input.qty, stepDecimals(qtyStep)), unit: splitInternalPair(input.pair).base }
      ],
      notes: ["Breakout trigger plus capped entry price.", "Use only if you want a non-mean-reversion entry."]
    },
    {
      type: "ICEBERG",
      side: "BUY",
      pair: input.pair,
      availableText: `${toFixedText(input.availableBalance, 6)} ${input.quoteAsset}`,
      tpSlEnabled: false,
      tpSlMode: null,
      submitLabel: `Buy ${input.pair}`,
      fields: [
        { label: "Limit price", value: toFixedText(input.entryPrice, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Quantity", value: toFixedText(input.qty, stepDecimals(qtyStep)), unit: splitInternalPair(input.pair).base },
        { label: "Display qty", value: toFixedText(icebergVisibleQty, stepDecimals(qtyStep)), unit: splitInternalPair(input.pair).base }
      ],
      notes: ["Same entry as limit, split into visible clips.", "Useful only for larger orders."]
    },
    {
      type: "TRAILING_STOP",
      side: "BUY",
      pair: input.pair,
      availableText: `${toFixedText(input.availableBalance, 6)} ${input.quoteAsset}`,
      tpSlEnabled: false,
      tpSlMode: null,
      submitLabel: `Buy ${input.pair}`,
      fields: [
        { label: "Trailing offset", value: toFixedText(trailingOffsetValue, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Trailing offset %", value: `${roundTo(trailingOffsetPct * 100, 3)}%` },
        { label: "Quantity", value: toFixedText(input.qty, stepDecimals(qtyStep)), unit: splitInternalPair(input.pair).base }
      ],
      notes: ["Alternative reversal-catch entry.", "Not the default deterministic order type."]
    },
    {
      type: "TRAILING_STOP_LIMIT",
      side: "BUY",
      pair: input.pair,
      availableText: `${toFixedText(input.availableBalance, 6)} ${input.quoteAsset}`,
      tpSlEnabled: false,
      tpSlMode: null,
      submitLabel: `Buy ${input.pair}`,
      fields: [
        { label: "Trailing offset", value: toFixedText(trailingOffsetValue, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Limit offset", value: toFixedText(Math.max(priceStep * 2, trailingOffsetValue * 0.35), stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Quantity", value: toFixedText(input.qty, stepDecimals(qtyStep)), unit: splitInternalPair(input.pair).base }
      ],
      notes: ["Trailing entry with capped fill price.", "Use when you want confirmation before buying."]
    }
  ];
};

const buildSellTemplates = (input: {
  pair: string;
  quoteAsset: string;
  availableQty: number;
  currentBid: number;
  entryAnchor: number | null;
  params: StrategyParams;
  instrument: InstrumentInfo | null;
  spreadPct: number;
}): KrakenOrderTemplate[] => {
  const { base } = splitInternalPair(input.pair);
  const priceStep = input.instrument?.priceStep ?? 0.0001;
  const qtyStep = input.instrument?.qtyStep ?? 0.00000001;
  const qty = floorToStep(input.availableQty, qtyStep);
  const anchor = input.entryAnchor ?? input.currentBid;
  const limitPrice = ceilToStep(anchor * (1 + input.params.takeProfitPct * 0.6), priceStep);
  const takeProfitTrigger = ceilToStep(anchor * (1 + input.params.takeProfitPct), priceStep);
  const takeProfitLimit = buildLimitOffset(takeProfitTrigger, input.instrument, input.spreadPct, "SELL");
  const stopAnchor = floorToStep(anchor * (1 - input.params.stopLossPct), priceStep);
  const trailingOffsetPct = Math.max(input.params.stopLossPct, input.params.takeProfitPct * 0.5);
  const trailingOffsetValue = ceilToStep(anchor * trailingOffsetPct, priceStep);
  const trailingLimitOffset = ceilToStep(Math.max(priceStep * 2, anchor * input.spreadPct), priceStep);
  const icebergVisibleQty = buildIcebergDisplayQty(qty, input.instrument);
  const hasProfitAnchor = Boolean(input.entryAnchor && input.currentBid >= takeProfitTrigger);
  const hasStopAnchor = Boolean(input.entryAnchor && input.currentBid <= stopAnchor);
  const trailingMode: "TP" | "SL" | null = hasProfitAnchor ? "TP" : hasStopAnchor ? "SL" : null;
  const trailingEnabled = trailingMode !== null;

  return [
    {
      type: "LIMIT",
      side: "SELL",
      pair: input.pair,
      availableText: `${toFixedText(input.availableQty, stepDecimals(qtyStep))} ${base}`,
      tpSlEnabled: false,
      tpSlMode: null,
      submitLabel: `Sell ${input.pair}`,
      fields: [
        { label: "Limit price", value: toFixedText(limitPrice, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Quantity", value: toFixedText(qty, stepDecimals(qtyStep)), unit: base },
        { label: "Total", value: toFixedText(qty * limitPrice, 6), unit: input.quoteAsset }
      ],
      notes: ["Straight limit exit.", "Good when you want one exact target price."]
    },
    {
      type: "TAKE_PROFIT",
      side: "SELL",
      pair: input.pair,
      availableText: `${toFixedText(input.availableQty, stepDecimals(qtyStep))} ${base}`,
      tpSlEnabled: true,
      tpSlMode: "TP",
      submitLabel: `Sell ${input.pair}`,
      fields: [
        { label: "Trigger price", value: toFixedText(takeProfitTrigger, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Quantity", value: toFixedText(qty, stepDecimals(qtyStep)), unit: base },
        { label: "Est. total", value: toFixedText(qty * takeProfitTrigger, 6), unit: input.quoteAsset }
      ],
      notes: ["Profit-taking trigger.", "Useful when price is approaching your target."]
    },
    {
      type: "TAKE_PROFIT_LIMIT",
      side: "SELL",
      pair: input.pair,
      availableText: `${toFixedText(input.availableQty, stepDecimals(qtyStep))} ${base}`,
      tpSlEnabled: true,
      tpSlMode: "TP",
      submitLabel: `Sell ${input.pair}`,
      fields: [
        { label: "Trigger price", value: toFixedText(takeProfitTrigger, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Limit price", value: toFixedText(takeProfitLimit, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Quantity", value: toFixedText(qty, stepDecimals(qtyStep)), unit: base }
      ],
      notes: ["Primary template when price is already stretching higher.", "Trigger protects the target; limit caps slippage."]
    },
    {
      type: "ICEBERG",
      side: "SELL",
      pair: input.pair,
      availableText: `${toFixedText(input.availableQty, stepDecimals(qtyStep))} ${base}`,
      tpSlEnabled: false,
      tpSlMode: null,
      submitLabel: `Sell ${input.pair}`,
      fields: [
        { label: "Limit price", value: toFixedText(limitPrice, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Quantity", value: toFixedText(qty, stepDecimals(qtyStep)), unit: base },
        { label: "Display qty", value: toFixedText(icebergVisibleQty, stepDecimals(qtyStep)), unit: base }
      ],
      notes: ["Same sell target, smaller visible clips.", "Only useful if size is large enough to hide."]
    },
    {
      type: "TRAILING_STOP",
      side: "SELL",
      pair: input.pair,
      availableText: `${toFixedText(input.availableQty, stepDecimals(qtyStep))} ${base}`,
      tpSlEnabled: trailingEnabled,
      tpSlMode: trailingMode,
      submitLabel: `Sell ${input.pair}`,
      fields: [
        { label: "Trailing offset", value: toFixedText(trailingOffsetValue, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Trailing offset %", value: `${roundTo(trailingOffsetPct * 100, 3)}%` },
        { label: "Quantity", value: toFixedText(qty, stepDecimals(qtyStep)), unit: base }
      ],
      notes: ["Protective exit that follows price higher.", "Useful when you want to lock gains or cap loss without a fixed limit price."]
    },
    {
      type: "TRAILING_STOP_LIMIT",
      side: "SELL",
      pair: input.pair,
      availableText: `${toFixedText(input.availableQty, stepDecimals(qtyStep))} ${base}`,
      tpSlEnabled: trailingEnabled,
      tpSlMode: trailingMode,
      submitLabel: `Sell ${input.pair}`,
      fields: [
        { label: "Trailing offset", value: toFixedText(trailingOffsetValue, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Limit offset", value: toFixedText(trailingLimitOffset, stepDecimals(priceStep)), unit: input.quoteAsset },
        { label: "Quantity", value: toFixedText(qty, stepDecimals(qtyStep)), unit: base }
      ],
      notes: ["Protective trailing exit with a capped limit fill.", "Use when you want tighter control over the execution price."]
    }
  ];
};

export const buildAccountSuggestionPairUniverse = (input: {
  portfolio: KrakenPortfolioAsset[];
  latestActivity: LatestActivity | null;
  openOrders: KrakenOpenOrderView[];
  selectedPairs: string[];
}): string[] => {
  const preferredQuote = resolvePreferredQuoteAsset(input.portfolio, input.latestActivity, input.selectedPairs);
  const pairs = new Set<string>();

  for (const row of input.portfolio) {
    const asset = row.asset.toUpperCase();
    if (!asset || row.available <= 0) {
      continue;
    }

    if (QUOTE_ASSETS.has(asset)) {
      for (const pair of resolveBuyPairs(asset, input.selectedPairs)) {
        pairs.add(pair);
      }
      continue;
    }

    pairs.add(
      resolveSellPair({
        asset,
        latestActivity: input.latestActivity,
        openOrders: input.openOrders,
        preferredQuoteAsset: preferredQuote
      })
    );
  }

  return Array.from(pairs).slice(0, 20);
};

const buildQuoteBalanceSuggestion = (input: {
  row: KrakenPortfolioAsset;
  marketMap: Map<string, AssistantMarketPair>;
  params: StrategyParams;
  selectedPairs: string[];
  sentiment: "RISK_ON" | "NEUTRAL" | "RISK_OFF";
}): BalanceSuggestion => {
  const asset = input.row.asset.toUpperCase();
  const candidatePairs = resolveBuyPairs(asset, input.selectedPairs);
  const candidateSuggestions = candidatePairs.map((pair) => {
    const market = input.marketMap.get(pair);
    return computeDeterministicSuggestion({
      pair,
      tradingCapital: input.row.available,
      params: input.params,
      ticker: market?.ticker ?? null,
      candles: market?.candles ?? [],
      instrument: market?.instrument ?? null
    });
  });
  const ranked = buildDeterministicCandidateLists({
    suggestions: candidateSuggestions,
    availableQuoteBalance: input.row.available,
    sentiment: input.sentiment,
    limit: 1
  });
  const primaryRow = ranked.buyCandidates[0] ?? ranked.watchCandidates[0] ?? null;
  const primarySuggestion = primaryRow?.suggestion ?? candidateSuggestions[0] ?? null;
  const market = primarySuggestion ? input.marketMap.get(primarySuggestion.pair) : null;

  if (!primarySuggestion || !market?.ticker || !market.instrument || primarySuggestion.entryPrice === null || primarySuggestion.suggestedQty <= 0) {
    return {
      key: `quote-${asset}`,
      asset,
      available: input.row.available,
      marketPair: primarySuggestion?.pair ?? candidatePairs[0] ?? null,
      side: "BUY",
      status: "NO_ACTION",
      primaryOrderType: null,
      headline: `${asset} balance is not actionable right now.`,
      summary: "No deterministic buy setup cleared cost, signal, and minimum-size rules for this quote balance.",
      quantity: 0,
      price: null,
      triggerPrice: null,
      total: 0,
      notes: primarySuggestion?.hardBlockingReasons.length ? primarySuggestion.hardBlockingReasons : ["No viable buy setup from this quote balance."],
      metrics: {
        spreadBps: primarySuggestion ? roundTo(primarySuggestion.cost.spreadPct * 10_000, 4) : null,
        deviationBps: primarySuggestion ? roundTo(primarySuggestion.deviationPct * 10_000, 4) : null,
        netEdgeBps: primarySuggestion ? roundTo(primarySuggestion.cost.netEdgePct * 10_000, 4) : null
      },
      templates: []
    };
  }

  const status: AccountSuggestionStatus =
    primarySuggestion.decision === "BUY"
      ? "READY"
      : primarySuggestion.viability === "NOT_VIABLE"
        ? "NO_ACTION"
        : "WATCH";

  return {
    key: `quote-${asset}`,
    asset,
    available: input.row.available,
    marketPair: primarySuggestion.pair,
    side: "BUY",
    status,
    primaryOrderType: "LIMIT",
    headline:
      status === "READY"
        ? `${asset} can fund a deterministic ${splitInternalPair(primarySuggestion.pair).base} buy setup.`
        : `${asset} is best kept on watch for ${splitInternalPair(primarySuggestion.pair).base}.`,
    summary:
      status === "READY"
        ? `${primarySuggestion.deviationText} Primary entry stays limit-only for this strategy.`
        : `${primarySuggestion.deviationText} Signal or viability is not fully aligned yet.`,
    quantity: primarySuggestion.suggestedQty,
    price: primarySuggestion.entryPrice,
    triggerPrice: primarySuggestion.entryPrice,
    total: primarySuggestion.suggestedNotional,
    notes: (status === "NO_ACTION" ? primarySuggestion.hardBlockingReasons : primarySuggestion.waitReasons.length > 0 ? primarySuggestion.waitReasons : primarySuggestion.whyBullets).slice(0, 3),
    metrics: {
      spreadBps: roundTo(primarySuggestion.cost.spreadPct * 10_000, 4),
      deviationBps: roundTo(primarySuggestion.deviationPct * 10_000, 4),
      netEdgeBps: roundTo(primarySuggestion.cost.netEdgePct * 10_000, 4)
    },
    templates: buildBuyTemplates({
      pair: primarySuggestion.pair,
      quoteAsset: asset,
      availableBalance: input.row.available,
      qty: primarySuggestion.suggestedQty,
      notional: primarySuggestion.suggestedNotional,
      entryPrice: primarySuggestion.entryPrice,
      currentAsk: market.ticker.ask,
      spreadPct: primarySuggestion.cost.spreadPct,
      params: input.params,
      instrument: market.instrument
    })
  };
};

const buildBaseAssetSuggestion = (input: {
  row: KrakenPortfolioAsset;
  marketMap: Map<string, AssistantMarketPair>;
  latestActivity: LatestActivity | null;
  openOrders: KrakenOpenOrderView[];
  params: StrategyParams;
  preferredQuoteAsset: string;
}): BalanceSuggestion => {
  const asset = input.row.asset.toUpperCase();
  const pair = resolveSellPair({
    asset,
    latestActivity: input.latestActivity,
    openOrders: input.openOrders,
    preferredQuoteAsset: input.preferredQuoteAsset
  });
  const market = input.marketMap.get(pair);
  const quoteAsset = splitInternalPair(pair).quote;
  const instrument = market?.instrument ?? null;
  const qty = floorToStep(input.row.available, instrument?.qtyStep ?? 0.00000001);
  const bid = market?.ticker?.bid ?? 0;
  const total = qty * bid;
  const minQty = instrument?.minOrderQty ?? 0;
  const minNotional = instrument?.minNotional ?? 0;
  const activityMatch =
    input.latestActivity && splitInternalPair(input.latestActivity.pair).base === asset && input.latestActivity.side === "BUY"
      ? input.latestActivity
      : null;
  const entryAnchor = activityMatch?.price ?? null;

  if (!market?.ticker || !instrument) {
    return {
      key: `asset-${asset}`,
      asset,
      available: input.row.available,
      marketPair: pair,
      side: "SELL",
      status: "NO_ACTION",
      primaryOrderType: null,
      headline: `${asset} has no live market template available.`,
      summary: `Could not build a live ${asset}/${quoteAsset} order form from Kraken data.`,
      quantity: 0,
      price: null,
      triggerPrice: null,
      total: 0,
      notes: ["Market data or instrument rules are unavailable for this asset."],
      metrics: {
        spreadBps: null,
        deviationBps: null,
        netEdgeBps: null
      },
      templates: []
    };
  }

  if (qty <= 0 || qty < minQty || total < minNotional) {
    return {
      key: `asset-${asset}`,
      asset,
      available: input.row.available,
      marketPair: pair,
      side: "SELL",
      status: "NO_ACTION",
      primaryOrderType: null,
      headline: `${asset} is below Kraken minimum size.`,
      summary: `Current balance rounds to ${toFixedText(qty)} ${asset}, which is too small to place a safe sell order.`,
      quantity: qty,
      price: bid,
      triggerPrice: null,
      total,
      notes: [
        `Min qty: ${toFixedText(minQty)} ${asset}.`,
        `Min notional: ${toFixedText(minNotional, 6)} ${quoteAsset}.`
      ],
      metrics: {
        spreadBps: roundTo(market.ticker.spreadPct * 10_000, 4),
        deviationBps: null,
        netEdgeBps: null
      },
      templates: []
    };
  }

  const tpTarget = ceilToStep((entryAnchor ?? bid) * (1 + input.params.takeProfitPct), instrument.priceStep);
  const slTrigger = floorToStep((entryAnchor ?? bid) * (1 - input.params.stopLossPct), instrument.priceStep);
  const pnlPct = entryAnchor ? (market.ticker.last - entryAnchor) / entryAnchor : null;
  let status: AccountSuggestionStatus = "WATCH";
  let primaryOrderType: KrakenOrderTemplateType = "LIMIT";
  let headline = `${asset} can be monitored for a sell setup.`;
  let summary = `Live bid is ${toFixedText(market.ticker.bid, stepDecimals(instrument.priceStep))} ${quoteAsset}.`;
  const notes: string[] = [];

  if (entryAnchor && pnlPct !== null && pnlPct >= input.params.takeProfitPct) {
    status = "READY";
    primaryOrderType = "TAKE_PROFIT_LIMIT";
    headline = `${asset} is above the recent buy anchor.`;
    summary = `Price is ${roundTo(pnlPct * 100, 3)}% above the latest buy reference, so a take-profit limit exit is ready.`;
    notes.push(`Recent buy anchor: ${toFixedText(entryAnchor, stepDecimals(instrument.priceStep))} ${quoteAsset}.`);
    notes.push(`TP target: ${toFixedText(tpTarget, stepDecimals(instrument.priceStep))} ${quoteAsset}.`);
  } else if (entryAnchor && pnlPct !== null && pnlPct <= -input.params.stopLossPct) {
    status = "READY";
    primaryOrderType = "TRAILING_STOP_LIMIT";
    headline = `${asset} is below the recent buy anchor.`;
    summary = `Price is ${roundTo(Math.abs(pnlPct) * 100, 3)}% below the latest buy reference, so a protective trailing stop limit is ready.`;
    notes.push(`Stop anchor: ${toFixedText(slTrigger, stepDecimals(instrument.priceStep))} ${quoteAsset}.`);
  } else if (entryAnchor && pnlPct !== null && pnlPct > 0) {
    primaryOrderType = "LIMIT";
    headline = `${asset} is in profit, but TP is not hit yet.`;
    summary = `Current price is ${roundTo(pnlPct * 100, 3)}% above the latest buy reference.`;
    notes.push(`Take-profit target remains ${toFixedText(tpTarget, stepDecimals(instrument.priceStep))} ${quoteAsset}.`);
  } else if (entryAnchor) {
    primaryOrderType = "TRAILING_STOP";
    headline = `${asset} is below the recent buy anchor.`;
    summary = `Current price is still below the latest buy reference, so only protective sell templates make sense.`;
    notes.push(`Stop anchor remains ${toFixedText(slTrigger, stepDecimals(instrument.priceStep))} ${quoteAsset}.`);
  } else {
    primaryOrderType = "LIMIT";
    headline = `${asset} has no recent buy anchor in the latest activity feed.`;
    summary = "Using live price only. Review the modal templates before copying values into Kraken.";
    notes.push("No latest BUY activity matched this asset, so TP/SL anchors are approximate.");
  }

  const matchingOpenOrder = input.openOrders.find((order) => splitInternalPair(order.pair).base === asset);
  if (matchingOpenOrder) {
    notes.push(`Existing open order detected: ${matchingOpenOrder.side} ${matchingOpenOrder.type}.`);
  }

  return {
    key: `asset-${asset}`,
    asset,
    available: input.row.available,
    marketPair: pair,
    side: "SELL",
    status,
    primaryOrderType,
    headline,
    summary,
    quantity: qty,
    price: market.ticker.bid,
    triggerPrice: entryAnchor ? (primaryOrderType === "TRAILING_STOP_LIMIT" ? slTrigger : tpTarget) : null,
    total,
    notes: notes.slice(0, 3),
    metrics: {
      spreadBps: roundTo(market.ticker.spreadPct * 10_000, 4),
      deviationBps: null,
      netEdgeBps: null
    },
    templates: buildSellTemplates({
      pair,
      quoteAsset,
      availableQty: qty,
      currentBid: market.ticker.bid,
      entryAnchor,
      params: input.params,
      instrument,
      spreadPct: market.ticker.spreadPct
    })
  };
};

export const buildBalanceSuggestions = (input: {
  positionsState: AssistantPositionsResponse | null;
  marketPairs: AssistantMarketPair[];
  params: StrategyParams;
  selectedPairs: string[];
  sentiment: "RISK_ON" | "NEUTRAL" | "RISK_OFF";
}): BalanceSuggestion[] => {
  const portfolio = input.positionsState?.portfolio ?? [];
  const latestActivity = input.positionsState?.latestActivity ?? null;
  const openOrders = input.positionsState?.openOrders ?? [];
  const marketMap = new Map(input.marketPairs.map((row) => [row.pair, row]));
  const preferredQuote = resolvePreferredQuoteAsset(portfolio, latestActivity, input.selectedPairs);

  return portfolio
    .filter((row) => row.available > 0)
    .map((row) => {
      const asset = row.asset.toUpperCase();
      if (QUOTE_ASSETS.has(asset)) {
        return buildQuoteBalanceSuggestion({
          row,
          marketMap,
          params: input.params,
          selectedPairs: input.selectedPairs,
          sentiment: input.sentiment
        });
      }

      return buildBaseAssetSuggestion({
        row,
        marketMap,
        latestActivity,
        openOrders,
        params: input.params,
        preferredQuoteAsset: preferredQuote
      });
    });
};
