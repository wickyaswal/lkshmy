import { applyClosedTradeToCapital, calculatePositionSize } from "@/lib/trading/risk";
import type { BotConfig, BotStatusSnapshot, ClosedTrade, InstrumentInfo, PositionSizingResult } from "@/lib/trading/types";

export class PortfolioEngine {
  calculateSize(input: {
    tradingCapitalUsdt: number;
    stopLossPct: number;
    riskPerTradePct: number;
    askPrice: number;
    instrument: InstrumentInfo;
    maxAffordableNotional?: number;
  }): PositionSizingResult {
    return calculatePositionSize({
      tradingCapitalUsdt: input.tradingCapitalUsdt,
      stopLossPct: input.stopLossPct,
      riskPerTradePct: input.riskPerTradePct,
      price: input.askPrice,
      qtyStep: input.instrument.qtyStep,
      minNotional: input.instrument.minNotional,
      maxAffordableNotional: input.maxAffordableNotional
    });
  }

  applyClosedTrade(status: BotStatusSnapshot, config: BotConfig, trade: ClosedTrade): {
    updatedTradingCapital: number;
    updatedBuffer: number;
    skimmedToBuffer: number;
  } {
    return applyClosedTradeToCapital(status, config, trade);
  }
}
