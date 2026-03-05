import { normalizePairForKraken } from "@/lib/trading/symbol-normalization";
import type { ExchangeAdapter } from "@/lib/trading/exchange";
import type {
  Candle,
  ExchangeBalance,
  ExchangeFill,
  ExchangeOrder,
  ExchangeOrderRequest,
  InstrumentInfo,
  TickerSnapshot
} from "@/lib/trading/types";

const buildNotImplementedError = (): Error =>
  new Error("CoinbaseAdapter is scaffolded for interface compliance and not implemented in v0.");

export class CoinbaseAdapter implements ExchangeAdapter {
  readonly id = "COINBASE" as const;
  readonly mode = "LIVE" as const;

  connectMarketData(): Promise<void> {
    return Promise.resolve();
  }

  subscribeTicker(): Promise<void> {
    return Promise.resolve();
  }

  getTicker(_pair: string): Promise<TickerSnapshot> {
    return Promise.reject(buildNotImplementedError());
  }

  getCandles(_pair: string, _timeframe: string, _limit: number): Promise<Candle[]> {
    return Promise.reject(buildNotImplementedError());
  }

  getInstrumentInfo(_pair: string): Promise<InstrumentInfo> {
    return Promise.reject(buildNotImplementedError());
  }

  getBalances(): Promise<ExchangeBalance[]> {
    return Promise.reject(buildNotImplementedError());
  }

  placeOrder(_order: ExchangeOrderRequest): Promise<ExchangeOrder> {
    return Promise.reject(buildNotImplementedError());
  }

  cancelOrder(_orderId: string): Promise<void> {
    return Promise.reject(buildNotImplementedError());
  }

  getOrder(_orderId: string, _pair: string): Promise<ExchangeOrder | null> {
    return Promise.reject(buildNotImplementedError());
  }

  listFills(_since?: string): Promise<ExchangeFill[]> {
    return Promise.reject(buildNotImplementedError());
  }

  normalizePair(pair: string) {
    return normalizePairForKraken(pair);
  }

  setTickerListener(): void {}

  async close(): Promise<void> {}
}
