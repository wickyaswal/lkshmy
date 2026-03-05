import { getEnv } from "@/lib/env";
import { KrakenClient } from "@/lib/kraken/kraken-client";
import { normalizePairForKraken, toInternalPair } from "@/lib/trading/symbol-normalization";
import type { ExchangeAdapter } from "@/lib/trading/exchange";
import type {
  Candle,
  ExchangeBalance,
  ExchangeFill,
  ExchangeOrder,
  ExchangeOrderRequest,
  ExchangeOrderStatus,
  InstrumentInfo,
  TickerSnapshot
} from "@/lib/trading/types";
import { formatIsoNow, roundTo } from "@/lib/utils";

type DemoOrderRecord = ExchangeOrder & {
  limitPrice?: number;
  triggerPrice?: number;
};

const buildOrder = (input: {
  orderId: string;
  request: ExchangeOrderRequest;
  status: ExchangeOrderStatus;
  filledQty?: number;
  fillPrice?: number;
  feePaid?: number;
}): DemoOrderRecord => ({
  orderId: input.orderId,
  clientOrderId: input.request.clientOrderId,
  pair: toInternalPair(input.request.pair),
  side: input.request.side,
  type: input.request.type,
  status: input.status,
  requestedQty: input.request.qty,
  filledQty: input.filledQty ?? 0,
  avgFillPrice: input.fillPrice ?? 0,
  feePaid: input.feePaid ?? 0,
  createdAt: formatIsoNow(),
  updatedAt: formatIsoNow(),
  rawStatus: input.status.toLowerCase(),
  limitPrice: input.request.price,
  triggerPrice: input.request.triggerPrice
});

export class DemoAdapter implements ExchangeAdapter {
  readonly id = "DEMO" as const;
  readonly mode = "DEMO" as const;
  private readonly client = new KrakenClient();
  private readonly orders = new Map<string, DemoOrderRecord>();
  private readonly fills = new Map<string, ExchangeFill>();

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

  async getBalances(): Promise<ExchangeBalance[]> {
    return [
      {
        asset: "USDT",
        available: Number.POSITIVE_INFINITY
      }
    ];
  }

  async placeOrder(order: ExchangeOrderRequest): Promise<ExchangeOrder> {
    const orderId = `demo-${order.clientOrderId}`;
    const ticker = await this.getTicker(order.pair);
    let status: ExchangeOrderStatus = "OPEN";
    let fillPrice = 0;
    let filledQty = 0;

    if (order.type === "MARKET") {
      status = "FILLED";
      fillPrice = this.getMarketFillPrice(order.side, ticker);
      filledQty = order.qty;
    } else if (order.type === "LIMIT") {
      const buyFill = order.side === "BUY" && typeof order.price === "number" && ticker.ask <= order.price;
      const sellFill = order.side === "SELL" && typeof order.price === "number" && ticker.bid >= order.price;

      if (buyFill || sellFill) {
        status = "FILLED";
        fillPrice = order.side === "BUY" ? ticker.ask : ticker.bid;
        filledQty = order.qty;
      } else if (order.timeInForce === "IOC") {
        status = "CANCELLED";
      }
    }

    const feePaid = status === "FILLED" ? roundTo(fillPrice * filledQty * getEnv().demoFeePct, 8) : 0;
    const demoOrder = buildOrder({
      orderId,
      request: order,
      status,
      filledQty,
      fillPrice,
      feePaid
    });
    this.orders.set(orderId, demoOrder);

    if (status === "FILLED") {
      this.fills.set(orderId, {
        orderId,
        tradeId: `fill-${orderId}`,
        pair: toInternalPair(order.pair),
        side: order.side,
        qty: filledQty,
        price: fillPrice,
        fee: feePaid,
        timestamp: demoOrder.updatedAt
      });
    }

    return demoOrder;
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);

    if (!order || order.status === "FILLED") {
      return;
    }

    order.status = "CANCELLED";
    order.updatedAt = formatIsoNow();
    order.rawStatus = "cancelled";
    this.orders.set(orderId, order);
  }

  async getOrder(orderId: string, pair: string): Promise<ExchangeOrder | null> {
    const order = this.orders.get(orderId);

    if (!order) {
      return null;
    }

    if (order.status === "OPEN") {
      await this.tryFillPendingOrder(order, pair || order.pair);
    }

    return this.orders.get(orderId) ?? null;
  }

  async listFills(since?: string): Promise<ExchangeFill[]> {
    const fills = Array.from(this.fills.values());

    if (!since) {
      return fills;
    }

    const sinceMs = Date.parse(since);

    if (!Number.isFinite(sinceMs)) {
      return fills;
    }

    return fills.filter((fill) => Date.parse(fill.timestamp) >= sinceMs);
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

  private async tryFillPendingOrder(order: DemoOrderRecord, pair: string): Promise<void> {
    const ticker = await this.getTicker(pair);
    const now = formatIsoNow();
    const slippage = getEnv().demoSlippagePct;
    let shouldFill = false;
    let fillPrice = 0;

    if (order.type === "LIMIT" && order.side === "BUY") {
      shouldFill = typeof order.limitPrice === "number" ? ticker.ask <= order.limitPrice : false;
      fillPrice = roundTo(ticker.ask * (1 + slippage), 8);
    }

    if (order.type === "LIMIT" && order.side === "SELL") {
      shouldFill = typeof order.limitPrice === "number" ? ticker.bid >= order.limitPrice : false;
      fillPrice = roundTo(ticker.bid * (1 - slippage), 8);
    }

    if (order.type === "STOP_LOSS" && order.side === "SELL") {
      shouldFill = order.triggerPrice ? ticker.bid <= order.triggerPrice : false;
      fillPrice = roundTo(ticker.bid * (1 - slippage), 8);
    }

    if (!shouldFill) {
      return;
    }

    order.status = "FILLED";
    order.updatedAt = now;
    order.rawStatus = "filled";
    order.filledQty = order.requestedQty;
    order.avgFillPrice = fillPrice;
    order.feePaid = roundTo(fillPrice * order.filledQty * getEnv().demoFeePct, 8);
    this.orders.set(order.orderId, order);
    this.fills.set(order.orderId, {
      orderId: order.orderId,
      tradeId: `fill-${order.orderId}`,
      pair: order.pair,
      side: order.side,
      qty: order.filledQty,
      price: order.avgFillPrice,
      fee: order.feePaid,
      timestamp: order.updatedAt
    });
  }

  private getMarketFillPrice(side: "BUY" | "SELL", ticker: TickerSnapshot): number {
    const slippage = getEnv().demoSlippagePct;
    return side === "BUY" ? roundTo(ticker.ask * (1 + slippage), 8) : roundTo(ticker.bid * (1 - slippage), 8);
  }
}
