import type { Candle } from "@/lib/trading/types";

export const movingAverage = (values: number[], period: number): number | null => {
  if (values.length < period) {
    return null;
  }

  const slice = values.slice(values.length - period);
  const sum = slice.reduce((total, value) => total + value, 0);
  return sum / period;
};

export const ma50FromCandles = (candles: Candle[]): number | null =>
  movingAverage(
    candles
      .slice()
      .sort((left, right) => left.startTimeMs - right.startTimeMs)
      .map((candle) => candle.close),
    50
  );
