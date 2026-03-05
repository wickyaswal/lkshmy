import { ma50FromCandles } from "@/lib/trading/indicators";
import type { BotConfig, Candle, EntrySignal, TickerSnapshot } from "@/lib/trading/types";

export const evaluateMeanReversionEntry = (
  config: BotConfig,
  candles: Candle[],
  market: TickerSnapshot
): EntrySignal => {
  const ma50 = ma50FromCandles(candles);

  if (!ma50) {
    return {
      shouldEnter: false,
      reason: "Not enough candles for MA(50).",
      ma50: 0,
      deviationPct: 0
    };
  }

  const deviationPct = (ma50 - market.last) / ma50;

  if (market.spreadPct > config.maxSpreadAllowedPct) {
    return {
      shouldEnter: false,
      reason: "Spread exceeds configured maximum.",
      ma50,
      deviationPct
    };
  }

  if (deviationPct < config.meanReversionThresholdPct) {
    return {
      shouldEnter: false,
      reason: "Price is not far enough below MA(50).",
      ma50,
      deviationPct
    };
  }

  return {
    shouldEnter: true,
    reason: "Mean reversion criteria satisfied.",
    ma50,
    deviationPct
  };
};
