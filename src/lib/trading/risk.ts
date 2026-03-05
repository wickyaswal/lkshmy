import type { BotConfig, BotStatusSnapshot, ClosedTrade, DailyStateMeta, PositionSizingResult } from "@/lib/trading/types";
import { floorToStep, roundTo } from "@/lib/utils";

export const calculatePositionSize = (input: {
  tradingCapitalUsdt: number;
  stopLossPct: number;
  riskPerTradePct: number;
  price: number;
  qtyStep: number;
  minNotional: number;
  maxAffordableNotional?: number;
}): PositionSizingResult => {
  const riskAmountUsdt = input.tradingCapitalUsdt * input.riskPerTradePct;

  if (input.stopLossPct <= 0 || input.price <= 0 || riskAmountUsdt <= 0) {
    return {
      shouldTrade: false,
      qty: 0,
      notionalUsdt: 0,
      riskAmountUsdt,
      skipReason: "Invalid sizing inputs."
    };
  }

  const targetNotionalUsdt = riskAmountUsdt / input.stopLossPct;
  const cappedNotionalUsdt = input.maxAffordableNotional
    ? Math.min(targetNotionalUsdt, input.maxAffordableNotional)
    : targetNotionalUsdt;

  if (cappedNotionalUsdt < input.minNotional) {
    return {
      shouldTrade: false,
      qty: 0,
      notionalUsdt: 0,
      riskAmountUsdt,
      skipReason: "Position notional falls below exchange minimum."
    };
  }

  const rawQty = cappedNotionalUsdt / input.price;
  const qty = floorToStep(rawQty, input.qtyStep);
  const notionalUsdt = roundTo(qty * input.price, 8);

  if (qty <= 0 || notionalUsdt < input.minNotional) {
    return {
      shouldTrade: false,
      qty: 0,
      notionalUsdt: 0,
      riskAmountUsdt,
      skipReason: "Rounded quantity falls below minimum tradeable size."
    };
  }

  return {
    shouldTrade: true,
    qty,
    notionalUsdt,
    riskAmountUsdt
  };
};

export const shouldStopTradingForDay = (status: BotStatusSnapshot, config: BotConfig): { stop: boolean; reason: string } => {
  const meta = status.dailyStateMeta;
  const lossLimit = meta.tcStartOfDay * config.dailyLossLimitPct;

  if (status.dailyStopHit) {
    return {
      stop: true,
      reason: "Daily stop is already active."
    };
  }

  if (status.todayRealizedPnlUsdt <= -lossLimit && lossLimit > 0) {
    return {
      stop: true,
      reason: "Daily loss limit reached."
    };
  }

  if (meta.consecutiveLosses >= config.consecutiveLossesStop) {
    return {
      stop: true,
      reason: "Consecutive loss stop reached."
    };
  }

  if (status.tradesToday >= config.maxTradesPerDay) {
    return {
      stop: true,
      reason: "Max trades per day reached."
    };
  }

  return {
    stop: false,
    reason: ""
  };
};

export const applyClosedTradeToCapital = (
  status: BotStatusSnapshot,
  config: BotConfig,
  trade: ClosedTrade
): {
  updatedTradingCapital: number;
  updatedBuffer: number;
  skimmedToBuffer: number;
} => {
  const skimmedToBuffer = trade.netPnlUsdt > 0 ? trade.netPnlUsdt * config.bufferPctOfNetProfit : 0;
  const updatedTradingCapital = roundTo(status.tradingCapitalTcUsdt + trade.netPnlUsdt - skimmedToBuffer, 8);
  const updatedBuffer = roundTo(status.bufferUsdt + skimmedToBuffer, 8);

  return {
    updatedTradingCapital,
    updatedBuffer,
    skimmedToBuffer: roundTo(skimmedToBuffer, 8)
  };
};

export const applyClosedTradeToDailyState = (meta: DailyStateMeta, status: BotStatusSnapshot, trade: ClosedTrade): DailyStateMeta => {
  const updated: DailyStateMeta = {
    ...meta,
    dailyGrossPnl: roundTo(meta.dailyGrossPnl + trade.grossPnlUsdt, 8),
    dailyFees: roundTo(meta.dailyFees + trade.feesUsdt, 8),
    skimToBuffer: meta.skimToBuffer,
    maxDrawdownEst: roundTo(Math.min(meta.maxDrawdownEst, status.todayRealizedPnlUsdt + trade.netPnlUsdt), 8)
  };

  if (trade.netPnlUsdt > 0) {
    updated.wins += 1;
    updated.consecutiveLosses = 0;
  } else {
    updated.losses += 1;
    updated.consecutiveLosses += 1;
  }

  return updated;
};
