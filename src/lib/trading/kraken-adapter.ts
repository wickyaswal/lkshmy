import { getEnv } from "@/lib/env";
import { KrakenClient } from "@/lib/kraken/kraken-client";
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

export class KrakenAdapter implements ExchangeAdapter {
  readonly id = "KRAKEN" as const;
  readonly mode = "LIVE" as const;
  private readonly client: KrakenClient;

  constructor() {
    const env = getEnv();
    this.client = new KrakenClient({
      apiKey: env.krakenApiKey,
      apiSecret: env.krakenApiSecret
    });
  }

  async connectMarketData(pairs: string[]): Promise<void> {
    await this.client.connectTickerStream(pairs);
  }

  async subscribeTicker(pair: string): Promise<void> {
    await this.client.subscribeTicker(pair);
  }

  getTicker(pair: string): Promise<TickerSnapshot> {
    return this.client.getTicker(pair);
  }

  getCandles(pair: string, timeframe: string, limit: number): Promise<Candle[]> {
    return this.client.getCandles(pair, timeframe, limit);
  }

  getInstrumentInfo(pair: string): Promise<InstrumentInfo> {
    return this.client.getInstrumentInfo(pair);
  }

  getBalances(): Promise<ExchangeBalance[]> {
    return this.client.getBalances();
  }

  async placeOrder(order: ExchangeOrderRequest): Promise<ExchangeOrder> {
    const created = await this.client.placeOrder(order);
    const latest = await this.client.getOrder(created.orderId, order.pair);
    return latest ?? created;
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.client.cancelOrder(orderId);
  }

  getOrder(orderId: string, pair: string): Promise<ExchangeOrder | null> {
    return this.client.getOrder(orderId, pair);
  }

  listFills(since?: string): Promise<ExchangeFill[]> {
    return this.client.listFills(since);
  }

  normalizePair(pair: string) {
    return normalizePairForKraken(pair);
  }

  setTickerListener(listener: ((pair: string, ticker: TickerSnapshot) => void) | null): void {
    this.client.setTickerListener(listener);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
