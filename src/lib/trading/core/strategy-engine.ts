import { evaluateMeanReversionEntry } from "@/lib/trading/strategy";
import type { BotConfig, Candle, EntrySignal, TickerSnapshot } from "@/lib/trading/types";

export class StrategyEngine {
  evaluate(config: BotConfig, candles: Candle[], ticker: TickerSnapshot): EntrySignal {
    return evaluateMeanReversionEntry(config, candles, ticker);
  }
}
