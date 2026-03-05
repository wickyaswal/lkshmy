import { getEnv } from "@/lib/env";
import { CoinbaseAdapter } from "@/lib/trading/coinbase-adapter";
import { DemoAdapter } from "@/lib/trading/demo-adapter";
import { KrakenAdapter } from "@/lib/trading/kraken-adapter";
import { toInternalPair } from "@/lib/trading/symbol-normalization";
import type {
  BotMode,
  Candle,
  ExchangeAvailability,
  ExchangeBalance,
  ExchangeDiscovery,
  ExchangeFill,
  ExchangeId,
  ExchangeOrder,
  ExchangeOrderRequest,
  InstrumentInfo,
  NormalizedPair,
  TickerSnapshot
} from "@/lib/trading/types";

export interface ExchangeAdapter {
  readonly id: ExchangeId | "DEMO";
  readonly mode: BotMode;
  connectMarketData(pairs: string[]): Promise<void>;
  subscribeTicker(pair: string): Promise<void>;
  getTicker(pair: string): Promise<TickerSnapshot>;
  getCandles(pair: string, timeframe: string, limit: number): Promise<Candle[]>;
  getInstrumentInfo(pair: string): Promise<InstrumentInfo>;
  getBalances(): Promise<ExchangeBalance[]>;
  placeOrder(order: ExchangeOrderRequest): Promise<ExchangeOrder>;
  cancelOrder(orderId: string, pair?: string): Promise<void>;
  getOrder(orderId: string, pair: string): Promise<ExchangeOrder | null>;
  listFills(since?: string): Promise<ExchangeFill[]>;
  normalizePair(pair: string): NormalizedPair;
  setTickerListener(listener: ((pair: string, ticker: TickerSnapshot) => void) | null): void;
  close(): Promise<void>;
}

const buildAvailability = (
  id: ExchangeId,
  hasCredentials: boolean,
  canTradeLive: boolean,
  reason: string
): ExchangeAvailability => ({
  id,
  hasCredentials,
  canTradeLive,
  reason
});

export const detectExchangeAvailability = (): ExchangeDiscovery => {
  const env = getEnv();
  const krakenHasCredentials = Boolean(env.krakenApiKey && env.krakenApiSecret);
  const coinbaseHasCredentials = Boolean(env.coinbaseApiKey && env.coinbaseApiSecret && env.coinbasePassphrase);
  const available: ExchangeAvailability[] = [
    buildAvailability(
      "KRAKEN",
      krakenHasCredentials,
      krakenHasCredentials,
      krakenHasCredentials
        ? "Kraken credentials detected."
        : "Missing KRAKEN_API_KEY or KRAKEN_API_SECRET."
    ),
    buildAvailability(
      "COINBASE",
      coinbaseHasCredentials,
      false,
      coinbaseHasCredentials
        ? "Credentials detected, adapter scaffold only in v0."
        : "Missing Coinbase API credentials."
    )
  ];

  return {
    available,
    liveCapable: available.filter((item) => item.canTradeLive).map((item) => item.id)
  };
};

export const resolveTrackedPairs = (input: { activeSymbol: string; selectedPairs?: string[] }): string[] => {
  const pairs = [...(input.selectedPairs ?? []), input.activeSymbol]
    .map((pair) => toInternalPair(pair))
    .filter(Boolean);

  return Array.from(new Set(pairs)).slice(0, 5);
};

type AdapterFactoryInput = {
  mode: BotMode;
  liveExchangeId?: ExchangeId;
};

export const createExchangeAdapter = (input: AdapterFactoryInput): ExchangeAdapter => {
  if (input.mode === "DEMO") {
    return new DemoAdapter();
  }

  if (input.liveExchangeId === "KRAKEN") {
    return new KrakenAdapter();
  }

  if (input.liveExchangeId === "COINBASE") {
    return new CoinbaseAdapter();
  }

  throw new Error("No supported LIVE exchange adapter is available.");
};
