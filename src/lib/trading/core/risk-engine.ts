import { applyClosedTradeToDailyState, shouldStopTradingForDay } from "@/lib/trading/risk";
import type { BotConfig, BotStatusSnapshot, ClosedTrade, DailyStateMeta } from "@/lib/trading/types";

export class RiskEngine {
  shouldStopForDay(status: BotStatusSnapshot, config: BotConfig): { stop: boolean; reason: string } {
    return shouldStopTradingForDay(status, config);
  }

  applyTrade(meta: DailyStateMeta, status: BotStatusSnapshot, trade: ClosedTrade): DailyStateMeta {
    return applyClosedTradeToDailyState(meta, status, trade);
  }
}
