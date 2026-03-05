import type { DeterministicSuggestion, StrategyParams } from "@/lib/assistant/types";
import { DEFAULT_RISK_PER_TRADE_PCT } from "@/lib/assistant/defaults";
import { movingAverage } from "@/lib/trading/indicators";
import type { InstrumentInfo, TickerSnapshot } from "@/lib/trading/types";
import { floorToStep, roundTo } from "@/lib/utils";

const formatPct = (value: number): string => `${roundTo(value * 100, 3)}%`;

const priceStepDecimals = (priceStep: number): number => {
  if (!Number.isFinite(priceStep) || priceStep <= 0) {
    return 8;
  }

  const text = priceStep.toString();
  if (!text.includes(".")) {
    return 0;
  }

  return text.split(".")[1]?.length ?? 8;
};

export const computeDeterministicSuggestion = (input: {
  pair: string;
  tradingCapital: number;
  params: StrategyParams;
  ticker: TickerSnapshot | null;
  candles: number[];
  instrument: InstrumentInfo | null;
  nowMs?: number;
}): DeterministicSuggestion => {
  const nowMs = input.nowMs ?? Date.now();
  const reasons: string[] = [];
  const notViableReasons: string[] = [];
  const whyBullets: string[] = [];
  const ma = movingAverage(input.candles, input.params.maPeriod);
  const ticker = input.ticker;
  const instrument = input.instrument;
  const mid = ticker ? (ticker.ask + ticker.bid) / 2 : 0;
  const spreadPct = ticker && mid > 0 ? (ticker.ask - ticker.bid) / mid : 0;
  const feePct = input.params.assumedFeePctRoundtrip;
  const slippagePct = input.params.assumedSlippagePctRoundtrip;
  const netEdgePct = input.params.takeProfitPct - spreadPct - feePct - slippagePct;
  const decimals = priceStepDecimals(instrument?.priceStep ?? 0.00000001);

  if (!ticker) {
    notViableReasons.push("Ticker data unavailable.");
  }

  if (!ma) {
    notViableReasons.push(`Not enough candles to compute MA(${input.params.maPeriod}).`);
  }

  const lastPrice = ticker?.last ?? 0;
  const deviationPct = ma && lastPrice > 0 ? (ma - lastPrice) / ma : 0;
  const hasSignal = deviationPct >= input.params.entryThresholdPct;
  const spreadOk = spreadPct <= input.params.maxSpreadAllowedPct;
  const netEdgeMeetsMarginal = netEdgePct >= input.params.marginalNetEdgePct;
  const netEdgeMeetsMin = netEdgePct >= input.params.minNetEdgePct;
  const entryPrice = ticker ? roundTo((ticker.bid + ticker.ask) / 2, decimals) : null;
  const targetNotionalRaw =
    input.params.stopLossPct > 0
      ? (input.tradingCapital * DEFAULT_RISK_PER_TRADE_PCT) / input.params.stopLossPct
      : 0;
  const targetNotional = Math.min(targetNotionalRaw, input.tradingCapital);
  const qtyRaw = entryPrice && entryPrice > 0 ? targetNotional / entryPrice : 0;
  const qty = instrument ? floorToStep(qtyRaw, instrument.qtyStep) : roundTo(qtyRaw, 8);
  const suggestedNotional = entryPrice ? roundTo(qty * entryPrice, 8) : 0;
  const meetsMinOrderSize = instrument
    ? qty >= instrument.minOrderQty && suggestedNotional >= instrument.minNotional
    : false;
  const tpPrice = entryPrice ? roundTo(entryPrice * (1 + input.params.takeProfitPct), decimals) : null;
  const slPrice = entryPrice ? roundTo(entryPrice * (1 - input.params.stopLossPct), decimals) : null;
  const timeStopAt = new Date(nowMs + input.params.maxHoldMinutes * 60_000).toISOString();

  if (ma && ticker) {
    reasons.push(`Price deviation below MA(${input.params.maPeriod}): ${formatPct(deviationPct)}.`);
    whyBullets.push(
      hasSignal
        ? `Signal detected: price is ${formatPct(deviationPct)} below MA(${input.params.maPeriod}) on ${input.params.timeframe} candles.`
        : `No signal: price is only ${formatPct(deviationPct)} below MA(${input.params.maPeriod}), below threshold ${formatPct(input.params.entryThresholdPct)}.`
    );
  }

  if (!hasSignal && ma && ticker) {
    notViableReasons.push(
      `No entry signal: deviation ${formatPct(deviationPct)} is below threshold ${formatPct(input.params.entryThresholdPct)}.`
    );
  }

  if (!spreadOk) {
    notViableReasons.push(
      `Spread too high: ${formatPct(spreadPct)} exceeds max ${formatPct(input.params.maxSpreadAllowedPct)}.`
    );
    whyBullets.push(`Spread is too wide: ${formatPct(spreadPct)} > ${formatPct(input.params.maxSpreadAllowedPct)}.`);
  } else if (ticker) {
    reasons.push(`Spread ${formatPct(spreadPct)} is within allowed threshold.`);
    whyBullets.push(`Spread is acceptable at ${formatPct(spreadPct)}.`);
  }

  if (!netEdgeMeetsMarginal) {
    notViableReasons.push(
      `Net edge too small after costs: ${formatPct(netEdgePct)} below marginal ${formatPct(input.params.marginalNetEdgePct)}.`
    );
    whyBullets.push(`Net edge is too small after costs: ${formatPct(netEdgePct)}.`);
  } else if (!netEdgeMeetsMin) {
    reasons.push(
      `Net edge ${formatPct(netEdgePct)} is only marginal (target ${formatPct(input.params.minNetEdgePct)}).`
    );
    whyBullets.push(`Trade is marginal: net edge ${formatPct(netEdgePct)} is below viable target ${formatPct(input.params.minNetEdgePct)}.`);
  } else {
    reasons.push(`Net edge after costs: ${formatPct(netEdgePct)}.`);
    whyBullets.push(`Net edge after costs is ${formatPct(netEdgePct)}.`);
  }

  if (!meetsMinOrderSize) {
    notViableReasons.push("Suggested quantity is below Kraken minimum order size/notional.");
    whyBullets.push("Suggested order size does not meet Kraken minimums.");
  } else {
    reasons.push(`Risk-sized order: ${roundTo(qty, 8)} units (${roundTo(suggestedNotional, 4)} notional).`);
    whyBullets.push(`Risk-sized notional is ${roundTo(suggestedNotional, 4)} with quantity ${roundTo(qty, 8)}.`);
  }

  const hardFail =
    notViableReasons.length > 0 ||
    !spreadOk ||
    !netEdgeMeetsMarginal ||
    !meetsMinOrderSize ||
    !entryPrice;

  const viability: DeterministicSuggestion["viability"] = hardFail
    ? "NOT_VIABLE"
    : netEdgeMeetsMin
      ? "VIABLE"
      : "MARGINAL";
  const action: DeterministicSuggestion["action"] = hasSignal && viability === "VIABLE" ? "BUY" : "WAIT";
  const decision: DeterministicSuggestion["decision"] =
    viability === "NOT_VIABLE" ? "DO_NOT_TRADE" : action === "BUY" ? "BUY" : "WAIT";

  return {
    pair: input.pair,
    decision,
    action,
    entryType: "LIMIT",
    entryPrice,
    tpPrice,
    slPrice,
    timeStopAt,
    suggestedNotional,
    suggestedQty: qty,
    viability,
    signalDetected: hasSignal,
    maValue: ma ? roundTo(ma, 8) : null,
    deviationPct: roundTo(deviationPct, 8),
    reasons: hardFail ? notViableReasons : reasons,
    whyBullets: whyBullets.slice(0, 3),
    blockingReasons: notViableReasons,
    buyChecklist: {
      netEdge: {
        met: netEdgeMeetsMin,
        currentPct: roundTo(netEdgePct, 8),
        requiredPct: roundTo(input.params.minNetEdgePct, 8)
      },
      spread: {
        met: spreadOk,
        currentPct: roundTo(spreadPct, 8),
        requiredPct: roundTo(input.params.maxSpreadAllowedPct, 8)
      },
      deviation: {
        met: hasSignal,
        currentPct: roundTo(deviationPct, 8),
        requiredPct: roundTo(input.params.entryThresholdPct, 8)
      }
    },
    cost: {
      spreadPct: roundTo(spreadPct, 8),
      feePct: roundTo(feePct, 8),
      slippagePct: roundTo(slippagePct, 8),
      netEdgePct: roundTo(netEdgePct, 8)
    }
  };
};
