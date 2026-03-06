import type {
  DeviationDirection,
  DeterministicSuggestion,
  StrategyParams,
  SuggestionParameterSanity,
  ViabilityLabel
} from "@/lib/assistant/types";
import { DEFAULT_RISK_PER_TRADE_PCT } from "@/lib/assistant/defaults";
import { movingAverage } from "@/lib/trading/indicators";
import type { InstrumentInfo, TickerSnapshot } from "@/lib/trading/types";
import { floorToStep, roundTo } from "@/lib/utils";

const formatPct = (value: number): string => `${roundTo(value * 100, 3)}%`;
const asBps = (value: number): number => roundTo(value * 10_000, 4);

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

const pushUnique = (target: string[], message: string): void => {
  if (!target.includes(message)) {
    target.push(message);
  }
};

export const describeDeviationVsMa = (input: {
  deviationPct: number;
  maPeriod: number;
  timeframe: "5m";
}): { direction: DeviationDirection; text: string } => {
  if (!Number.isFinite(input.deviationPct) || Math.abs(input.deviationPct) < 1e-12) {
    return {
      direction: "AT_MA",
      text: `Price is at MA(${input.maPeriod}) on ${input.timeframe} candles.`
    };
  }

  if (input.deviationPct > 0) {
    return {
      direction: "BELOW_MA",
      text: `Price is below MA(${input.maPeriod}) by ${formatPct(input.deviationPct)} on ${input.timeframe} candles.`
    };
  }

  return {
    direction: "ABOVE_MA",
    text: `Price is above MA(${input.maPeriod}) by ${formatPct(Math.abs(input.deviationPct))} on ${input.timeframe} candles.`
  };
};

export const classifyNetEdgeBand = (input: {
  netEdgePct: number;
  minNetEdgePct: number;
  marginalNetEdgePct: number;
}): ViabilityLabel => {
  if (input.netEdgePct < input.marginalNetEdgePct) {
    return "NOT_VIABLE";
  }

  if (input.netEdgePct < input.minNetEdgePct) {
    return "MARGINAL";
  }

  return "VIABLE";
};

export const evaluateSuggestionParameterSanity = (params: StrategyParams): SuggestionParameterSanity => {
  const maxPossibleNetEdgeNoSpreadPct =
    params.takeProfitPct - params.assumedFeePctRoundtrip - params.assumedSlippagePctRoundtrip;

  return {
    maxPossibleNetEdgeNoSpreadPct: roundTo(maxPossibleNetEdgeNoSpreadPct, 8),
    minNetEdgePct: roundTo(params.minNetEdgePct, 8),
    viableUnreachable: params.minNetEdgePct >= maxPossibleNetEdgeNoSpreadPct
  };
};

const resolveSizingFirstFail = (input: {
  entryPrice: number;
  instrument: InstrumentInfo | null;
  qtyRaw: number;
  qtyStep: number;
  qtyFloored: number;
  notional: number;
  targetNotionalAfterCap: number;
}): string | null => {
  if (input.entryPrice <= 0) {
    return "Entry price is unavailable.";
  }

  if (!input.instrument) {
    return "Instrument constraints are unavailable.";
  }

  if (input.targetNotionalAfterCap <= 0) {
    return "Target notional is zero, so quantity cannot be sized.";
  }

  if (input.qtyStep <= 0) {
    return "Quantity step is invalid.";
  }

  if (input.qtyRaw < input.qtyStep) {
    return "Raw quantity is below qty step, so floored quantity becomes zero.";
  }

  if (input.qtyFloored <= 0) {
    return "Floored quantity is zero after step-size rounding.";
  }

  if (input.qtyFloored < input.instrument.minOrderQty) {
    return "Floored quantity is below minimum order quantity.";
  }

  if (input.notional < input.instrument.minNotional) {
    return "Order notional is below minimum notional.";
  }

  return null;
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
  const waitReasons: string[] = [];
  const hardBlockingReasons: string[] = [];
  const whyBullets: string[] = [];
  const ma = movingAverage(input.candles, input.params.maPeriod);
  const ticker = input.ticker;
  const instrument = input.instrument;
  const mid = ticker ? (ticker.ask + ticker.bid) / 2 : 0;
  const spreadPct = ticker && mid > 0 ? (ticker.ask - ticker.bid) / mid : 0;
  const feePct = input.params.assumedFeePctRoundtrip;
  const slippagePct = input.params.assumedSlippagePctRoundtrip;
  const netEdgePct = input.params.takeProfitPct - spreadPct - feePct - slippagePct;
  const netEdgeBand = classifyNetEdgeBand({
    netEdgePct,
    minNetEdgePct: input.params.minNetEdgePct,
    marginalNetEdgePct: input.params.marginalNetEdgePct
  });
  const parameterSanity = evaluateSuggestionParameterSanity(input.params);
  const decimals = priceStepDecimals(instrument?.priceStep ?? 0.00000001);

  if (!ticker) {
    pushUnique(hardBlockingReasons, "Ticker data unavailable.");
  }

  if (!ma) {
    pushUnique(hardBlockingReasons, `Not enough candles to compute MA(${input.params.maPeriod}).`);
  }

  if (!instrument) {
    pushUnique(hardBlockingReasons, "Instrument constraints unavailable.");
  }

  const lastPrice = ticker?.last ?? 0;
  const deviationPct = ma && lastPrice > 0 ? (ma - lastPrice) / ma : 0;
  const deviationNarrative = describeDeviationVsMa({
    deviationPct,
    maPeriod: input.params.maPeriod,
    timeframe: input.params.timeframe
  });
  const hasSignal = deviationPct >= input.params.entryThresholdPct;
  const spreadOk = spreadPct <= input.params.maxSpreadAllowedPct;
  const entryPriceRaw = ticker ? roundTo((ticker.bid + ticker.ask) / 2, decimals) : 0;
  const targetNotionalRaw =
    input.params.stopLossPct > 0
      ? (input.tradingCapital * DEFAULT_RISK_PER_TRADE_PCT) / input.params.stopLossPct
      : 0;
  const targetNotionalAfterCap = Math.min(targetNotionalRaw, Math.max(input.tradingCapital, 0));
  const qtyRaw = entryPriceRaw > 0 ? targetNotionalAfterCap / entryPriceRaw : 0;
  const qtyStep = instrument?.qtyStep ?? 0;
  const qtyFloored = instrument ? floorToStep(qtyRaw, instrument.qtyStep) : 0;
  const notional = entryPriceRaw > 0 ? roundTo(qtyFloored * entryPriceRaw, 8) : 0;
  const minOrderQty = instrument?.minOrderQty ?? 0;
  const minNotional = instrument?.minNotional ?? 0;
  const sizingFirstFail = resolveSizingFirstFail({
    entryPrice: entryPriceRaw,
    instrument,
    qtyRaw,
    qtyStep,
    qtyFloored,
    notional,
    targetNotionalAfterCap
  });
  const minOrderOk = !sizingFirstFail;
  const entryPrice = entryPriceRaw > 0 ? entryPriceRaw : null;
  const suggestedQty = minOrderOk ? roundTo(qtyFloored, 8) : 0;
  const suggestedNotional = minOrderOk ? roundTo(notional, 8) : 0;
  const tpPrice = entryPrice ? roundTo(entryPrice * (1 + input.params.takeProfitPct), decimals) : null;
  const slPrice = entryPrice ? roundTo(entryPrice * (1 - input.params.stopLossPct), decimals) : null;
  const timeStopAt = new Date(nowMs + input.params.maxHoldMinutes * 60_000).toISOString();

  if (ticker && ma) {
    reasons.push(deviationNarrative.text);
    whyBullets.push(deviationNarrative.text);
  }

  if (!hasSignal && ma && ticker) {
    if (deviationNarrative.direction === "ABOVE_MA") {
      pushUnique(
        waitReasons,
        `Price is above MA by ${formatPct(Math.abs(deviationPct))}, so dip-entry signal is not met. Requires at least ${formatPct(input.params.entryThresholdPct)} below MA.`
      );
    } else {
      pushUnique(
        waitReasons,
        `Price is below MA by ${formatPct(deviationPct)}, but entry threshold is ${formatPct(input.params.entryThresholdPct)} below MA.`
      );
    }
  }

  if (!spreadOk) {
    pushUnique(
      hardBlockingReasons,
      `Spread too high: ${formatPct(spreadPct)} exceeds max ${formatPct(input.params.maxSpreadAllowedPct)}.`
    );
    whyBullets.push(`Spread is too wide: ${formatPct(spreadPct)} > ${formatPct(input.params.maxSpreadAllowedPct)}.`);
  } else if (ticker) {
    reasons.push(`Spread ${formatPct(spreadPct)} is within allowed threshold.`);
  }

  if (netEdgeBand === "NOT_VIABLE") {
    pushUnique(
      hardBlockingReasons,
      `Net edge too small after costs: ${formatPct(netEdgePct)} below marginal ${formatPct(input.params.marginalNetEdgePct)}.`
    );
    whyBullets.push(`Net edge is too small after costs: ${formatPct(netEdgePct)}.`);
  } else if (netEdgeBand === "MARGINAL") {
    pushUnique(
      waitReasons,
      `Net edge is marginal at ${formatPct(netEdgePct)}; viable target is ${formatPct(input.params.minNetEdgePct)}.`
    );
  } else {
    reasons.push(`Net edge after costs: ${formatPct(netEdgePct)}.`);
  }

  if (!minOrderOk) {
    pushUnique(
      hardBlockingReasons,
      `Order size is invalid: ${sizingFirstFail ?? "Suggested quantity is below exchange minimums."}`
    );
    whyBullets.push("Suggested order size does not meet Kraken minimums.");
  } else {
    reasons.push(`Risk-sized order: ${roundTo(suggestedQty, 8)} units (${roundTo(suggestedNotional, 4)} notional).`);
  }

  const viability: DeterministicSuggestion["viability"] = hardBlockingReasons.length > 0 ? "NOT_VIABLE" : netEdgeBand;
  const decision: DeterministicSuggestion["decision"] =
    hasSignal && viability === "VIABLE" ? "BUY" : viability === "NOT_VIABLE" ? "DO_NOT_TRADE" : "WAIT";
  const action: DeterministicSuggestion["action"] = decision === "BUY" ? "BUY" : "WAIT";

  if (decision === "BUY") {
    whyBullets.push("Signal is active and trade viability is VIABLE.");
  }

  const selectedReasons =
    decision === "DO_NOT_TRADE"
      ? hardBlockingReasons
      : decision === "WAIT"
        ? waitReasons.length > 0
          ? waitReasons
          : ["Conditions are not aligned for a BUY yet."]
        : reasons.length > 0
          ? reasons
          : ["Signal and viability conditions are aligned."];

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
    suggestedQty,
    viability,
    signalDetected: hasSignal,
    maValue: ma ? roundTo(ma, 8) : null,
    deviationPct: roundTo(deviationPct, 8),
    deviationBps: asBps(deviationPct),
    deviationDirection: deviationNarrative.direction,
    deviationText: deviationNarrative.text,
    reasons: selectedReasons,
    whyBullets: whyBullets.slice(0, 3),
    waitReasons,
    hardBlockingReasons,
    blockingReasons: hardBlockingReasons,
    minOrderOk,
    sizingAudit: {
      entryPrice: roundTo(entryPriceRaw, 8),
      targetNotionalRaw: roundTo(targetNotionalRaw, 8),
      targetNotionalAfterCap: roundTo(targetNotionalAfterCap, 8),
      qtyRaw: roundTo(qtyRaw, 12),
      qtyStep: roundTo(qtyStep, 12),
      qtyFloored: roundTo(qtyFloored, 12),
      minOrderQty: roundTo(minOrderQty, 12),
      minNotional: roundTo(minNotional, 8),
      notional: roundTo(notional, 8),
      firstFailingRule: sizingFirstFail
    },
    parameterSanity,
    buyChecklist: {
      netEdge: {
        met: viability === "VIABLE",
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
