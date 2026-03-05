import crypto from "node:crypto";

import { getEnv } from "@/lib/env";
import { resolveKrakenSymbol } from "@/lib/kraken/symbol-resolver";
import { toInternalPair } from "@/lib/trading/symbol-normalization";
import type {
  Candle,
  ExchangeBalance,
  ExchangeFill,
  ExchangeOrder,
  ExchangeOrderRequest,
  ExchangeOrderSide,
  ExchangeOrderStatus,
  InstrumentInfo,
  TickerSnapshot
} from "@/lib/trading/types";
import { formatIsoNow, roundTo, sleep } from "@/lib/utils";

type KrakenPublicResponse<T> = {
  error: string[];
  result: T;
};

type KrakenPrivateCredentials = {
  apiKey?: string;
  apiSecret?: string;
};

type TickerListener = (pair: string, ticker: TickerSnapshot) => void;

const parseOrderStatus = (status: string): ExchangeOrderStatus => {
  switch (status) {
    case "open":
      return "OPEN";
    case "closed":
      return "FILLED";
    case "canceled":
      return "CANCELLED";
    case "expired":
      return "EXPIRED";
    default:
      return "REJECTED";
  }
};

const parseKrakenTimestamp = (value: string | number | undefined): string => {
  if (value === undefined) {
    return formatIsoNow();
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return formatIsoNow();
  }

  return new Date(numeric * 1000).toISOString();
};

const resolveOpenReference = (
  values?: string[]
): { openReferencePrice: number | null; openReferenceLabel: "OPEN_24H" | "DAY_OPEN" | null } => {
  const open24h = Number(values?.[1] ?? 0);
  if (Number.isFinite(open24h) && open24h > 0) {
    return {
      openReferencePrice: open24h,
      openReferenceLabel: "OPEN_24H"
    };
  }

  const dayOpen = Number(values?.[0] ?? 0);
  if (Number.isFinite(dayOpen) && dayOpen > 0) {
    return {
      openReferencePrice: dayOpen,
      openReferenceLabel: "DAY_OPEN"
    };
  }

  return {
    openReferencePrice: null,
    openReferenceLabel: null
  };
};

export class KrakenClient {
  private readonly restBaseUrl: string;
  private readonly wsUrl: string;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly subscribedPairs = new Set<string>();
  private readonly tickerCache = new Map<string, TickerSnapshot>();
  private tickerListener: TickerListener | null = null;

  constructor(private readonly credentials: KrakenPrivateCredentials = {}) {
    const env = getEnv();
    this.restBaseUrl = env.krakenRestBaseUrl;
    this.wsUrl = env.krakenWsUrl;
  }

  setTickerListener(listener: TickerListener | null): void {
    this.tickerListener = listener;
  }

  async connectTickerStream(pairs: string[]): Promise<void> {
    for (const pair of pairs) {
      this.subscribedPairs.add(toInternalPair(pair));
    }

    if (typeof WebSocket === "undefined") {
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN) {
        await this.subscribeAllPairs();
      }
      return;
    }

    this.ws = new WebSocket(this.wsUrl);

    this.ws.addEventListener("open", () => {
      void this.subscribeAllPairs();
    });

    this.ws.addEventListener("message", (event) => {
      this.handleWsMessage(String(event.data));
    });

    this.ws.addEventListener("close", () => {
      this.scheduleReconnect();
    });

    this.ws.addEventListener("error", () => {
      this.scheduleReconnect();
    });
  }

  async subscribeTicker(pair: string): Promise<void> {
    this.subscribedPairs.add(toInternalPair(pair));

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const normalized = await resolveKrakenSymbol(pair, this.restBaseUrl);
      await this.sendWs({
        event: "subscribe",
        pair: [normalized.exchangeWs],
        subscription: {
          name: "ticker"
        }
      });
    }
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  async getTicker(pair: string): Promise<TickerSnapshot> {
    const internal = toInternalPair(pair);
    const cached = this.tickerCache.get(internal);

    if (cached) {
      return cached;
    }

    const normalized = await resolveKrakenSymbol(internal, this.restBaseUrl);
    const response = await this.publicGet<Record<string, { a: string[]; b: string[]; c: string[]; o?: string[] }>>(
      "/0/public/Ticker",
      {
        pair: normalized.exchangeRest
      }
    );
    const ticker = Object.values(response)[0];

    if (!ticker) {
      throw new Error(`Kraken ticker is unavailable for ${internal}.`);
    }

    const bid = Number(ticker.b?.[0] ?? 0);
    const ask = Number(ticker.a?.[0] ?? 0);
    const last = Number(ticker.c?.[0] ?? 0);
    const open = resolveOpenReference(ticker.o);

    if (!bid || !ask || !last) {
      throw new Error(`Kraken ticker returned invalid prices for ${internal}.`);
    }

    const snapshot: TickerSnapshot = {
      pair: internal,
      bid,
      ask,
      last,
      spreadPct: ((ask + bid) / 2) > 0 ? (ask - bid) / ((ask + bid) / 2) : 0,
      openReferencePrice: open.openReferencePrice,
      openReferenceLabel: open.openReferenceLabel,
      timestamp: formatIsoNow()
    };
    this.tickerCache.set(internal, snapshot);
    return snapshot;
  }

  async getCandles(pair: string, timeframe: string, limit: number): Promise<Candle[]> {
    const interval = timeframe === "5m" ? 5 : 5;
    const normalized = await resolveKrakenSymbol(pair, this.restBaseUrl);
    const response = await this.publicGet<Record<string, Array<[number, string, string, string, string, string, string, number]>>>(
      "/0/public/OHLC",
      {
        pair: normalized.exchangeRest,
        interval
      }
    );
    const rows = Object.entries(response).find(([key]) => key !== "last")?.[1] ?? [];
    const closedRows = rows.length > 1 ? rows.slice(0, -1) : rows;

    return closedRows
      .slice(-limit)
      .map((entry) => ({
        startTimeMs: Number(entry[0]) * 1000,
        open: Number(entry[1]),
        high: Number(entry[2]),
        low: Number(entry[3]),
        close: Number(entry[4]),
        volume: Number(entry[6])
      }))
      .sort((left, right) => left.startTimeMs - right.startTimeMs);
  }

  async getInstrumentInfo(pair: string): Promise<InstrumentInfo> {
    const internal = toInternalPair(pair);
    const normalized = await resolveKrakenSymbol(internal, this.restBaseUrl);
    const response = await this.publicGet<Record<string, {
      lot_decimals?: number;
      pair_decimals?: number;
      ordermin?: string;
      costmin?: string;
    }>>("/0/public/AssetPairs", {
      pair: normalized.exchangeRest
    });
    const info = Object.values(response)[0];

    if (!info) {
      throw new Error(`Kraken instrument info is unavailable for ${internal}.`);
    }

    const lotDecimals = Number.isFinite(info.lot_decimals) ? Number(info.lot_decimals) : 8;
    const pairDecimals = Number.isFinite(info.pair_decimals) ? Number(info.pair_decimals) : 4;

    return {
      pair: internal,
      minOrderQty: Number(info.ordermin ?? "0.0001"),
      qtyStep: 10 ** -lotDecimals,
      priceStep: 10 ** -pairDecimals,
      minNotional: Number(info.costmin ?? "5")
    };
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const result = await this.privatePost<Record<string, string>>("/0/private/Balance", {});

    return Object.entries(result).map(([asset, available]) => ({
      asset: asset.replace(/^Z/, "").replace(/^X/, ""),
      available: Number(available)
    }));
  }

  async placeOrder(request: ExchangeOrderRequest): Promise<ExchangeOrder> {
    const normalized = await resolveKrakenSymbol(request.pair, this.restBaseUrl);
    const payload: Record<string, string | number> = {
      pair: normalized.exchangeRest,
      type: request.side === "BUY" ? "buy" : "sell",
      ordertype: request.type === "STOP_LOSS" ? "stop-loss" : request.type.toLowerCase(),
      volume: request.qty.toString()
    };

    if (request.type === "LIMIT" && request.price) {
      payload.price = request.price.toString();
    }

    if (request.type === "STOP_LOSS" && request.triggerPrice) {
      payload.price = request.triggerPrice.toString();
    }

    if (request.timeInForce) {
      payload.timeinforce = request.timeInForce;
    }

    const response = await this.privatePost<{ txid: string[] }>("/0/private/AddOrder", payload);
    const orderId = response.txid?.[0];

    if (!orderId) {
      throw new Error("Kraken did not return an order ID.");
    }

    return {
      orderId,
      clientOrderId: request.clientOrderId,
      pair: toInternalPair(request.pair),
      side: request.side,
      type: request.type,
      status: "OPEN",
      requestedQty: request.qty,
      filledQty: 0,
      avgFillPrice: 0,
      feePaid: 0,
      createdAt: formatIsoNow(),
      updatedAt: formatIsoNow(),
      rawStatus: "open"
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.privatePost("/0/private/CancelOrder", {
      txid: orderId
    });
  }

  async getOrder(orderId: string, pair: string): Promise<ExchangeOrder | null> {
    const response = await this.privatePost<Record<string, {
      status: string;
      vol: string;
      vol_exec: string;
      price: string;
      avg_price?: string;
      fee: string;
      opentm?: number;
      closetm?: number;
      descr?: {
        type?: string;
        ordertype?: string;
      };
      userref?: string;
    }>>("/0/private/QueryOrders", {
      txid: orderId
    });
    const row = response[orderId];

    if (!row) {
      return null;
    }

    const side: ExchangeOrderSide = row.descr?.type === "buy" ? "BUY" : "SELL";
    const type = row.descr?.ordertype?.toLowerCase() === "stop-loss" ? "STOP_LOSS" : row.descr?.ordertype === "limit" ? "LIMIT" : "MARKET";

    return {
      orderId,
      clientOrderId: row.userref ? String(row.userref) : orderId,
      pair: toInternalPair(pair),
      side,
      type,
      status: parseOrderStatus(row.status),
      requestedQty: Number(row.vol ?? "0"),
      filledQty: Number(row.vol_exec ?? "0"),
      avgFillPrice: Number(row.avg_price ?? row.price ?? "0"),
      feePaid: Number(row.fee ?? "0"),
      createdAt: parseKrakenTimestamp(row.opentm),
      updatedAt: parseKrakenTimestamp(row.closetm ?? row.opentm),
      rawStatus: row.status
    };
  }

  async listFills(since?: string): Promise<ExchangeFill[]> {
    const payload: Record<string, string> = {};

    if (since) {
      const sinceMs = Date.parse(since);
      if (Number.isFinite(sinceMs)) {
        payload.start = String(Math.floor(sinceMs / 1000));
      }
    }

    const response = await this.privatePost<{
      trades: Record<string, {
        ordertxid: string;
        pair: string;
        type: string;
        vol: string;
        price: string;
        fee: string;
        time: number;
      }>;
    }>("/0/private/TradesHistory", payload);

    return Object.entries(response.trades ?? {}).map(([tradeId, row]) => ({
      orderId: row.ordertxid,
      tradeId,
      pair: toInternalPair(row.pair),
      side: row.type === "buy" ? "BUY" : "SELL",
      qty: Number(row.vol),
      price: Number(row.price),
      fee: Number(row.fee),
      timestamp: parseKrakenTimestamp(row.time)
    }));
  }

  async getOpenOrders(): Promise<ExchangeOrder[]> {
    const response = await this.privatePost<{
      open: Record<string, {
        status?: string;
        vol?: string;
        vol_exec?: string;
        fee?: string;
        opentm?: number;
        descr?: {
          pair?: string;
          type?: string;
          ordertype?: string;
          price?: string;
        };
      }>;
    }>("/0/private/OpenOrders", {});
    const entries = Object.entries(response.open ?? {});

    return entries.map(([orderId, row]) => {
      const pair = row.descr?.pair ? toInternalPair(row.descr.pair) : "BTCUSDT";
      const side: ExchangeOrderSide = row.descr?.type === "sell" ? "SELL" : "BUY";
      const type =
        row.descr?.ordertype?.toLowerCase() === "stop-loss"
          ? "STOP_LOSS"
          : row.descr?.ordertype === "limit"
            ? "LIMIT"
            : "MARKET";

      return {
        orderId,
        clientOrderId: orderId,
        pair,
        side,
        type,
        status: "OPEN",
        requestedQty: Number(row.vol ?? "0"),
        filledQty: Number(row.vol_exec ?? "0"),
        avgFillPrice: Number(row.descr?.price ?? "0"),
        feePaid: Number(row.fee ?? "0"),
        createdAt: parseKrakenTimestamp(row.opentm),
        updatedAt: parseKrakenTimestamp(row.opentm),
        rawStatus: row.status ?? "open"
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectTickerStream(Array.from(this.subscribedPairs));
    }, 2000);
  }

  private async subscribeAllPairs(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.subscribedPairs.size === 0) {
      return;
    }

    const resolvedPairs = await Promise.all(
      Array.from(this.subscribedPairs).map(async (pair) => (await resolveKrakenSymbol(pair, this.restBaseUrl)).exchangeWs)
    );

    await this.sendWs({
      event: "subscribe",
      pair: resolvedPairs,
      subscription: {
        name: "ticker"
      }
    });
  }

  private async sendWs(payload: Record<string, unknown>): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(payload));
  }

  private handleWsMessage(raw: string): void {
    let payload: unknown;

    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (!Array.isArray(payload) || payload.length < 4) {
      return;
    }

    if (payload[2] !== "ticker") {
      return;
    }

    const data = payload[1] as {
      a?: string[];
      b?: string[];
      c?: string[];
      as?: string[];
      bs?: string[];
      o?: string[];
    };
    const exchangePair = String(payload[3]);
    const pair = toInternalPair(exchangePair);
    const ask = Number(data.a?.[0] ?? data.as?.[0] ?? 0);
    const bid = Number(data.b?.[0] ?? data.bs?.[0] ?? 0);
    const last = Number(data.c?.[0] ?? 0);
    const open = resolveOpenReference(data.o);

    if (!ask || !bid || !last) {
      return;
    }

    const ticker: TickerSnapshot = {
      pair,
      ask: roundTo(ask, 8),
      bid: roundTo(bid, 8),
      last: roundTo(last, 8),
      spreadPct: roundTo((((ask + bid) / 2) > 0 ? (ask - bid) / ((ask + bid) / 2) : 0), 8),
      openReferencePrice: open.openReferencePrice ? roundTo(open.openReferencePrice, 8) : null,
      openReferenceLabel: open.openReferenceLabel,
      timestamp: formatIsoNow()
    };
    this.tickerCache.set(pair, ticker);

    if (this.tickerListener) {
      this.tickerListener(pair, ticker);
    }
  }

  private async publicGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        query.set(key, String(value));
      }
    }

    const url = `${this.restBaseUrl}${path}?${query.toString()}`;

    return this.request<T>(async () => {
      const response = await fetch(url, {
        method: "GET"
      });
      const payload = (await response.json()) as KrakenPublicResponse<T>;

      if (!response.ok || payload.error.length > 0) {
        const message = payload.error.join(", ") || `${response.status} ${response.statusText}`;
        throw new Error(`Kraken public API error: ${message}`);
      }

      return payload.result;
    });
  }

  private async privatePost<T>(path: string, params: Record<string, string | number>): Promise<T> {
    return this.request<T>(async () => {
      const nonce = `${Date.now() * 1000}`;
      const bodyParams = new URLSearchParams();
      bodyParams.set("nonce", nonce);

      for (const [key, value] of Object.entries(params)) {
        bodyParams.set(key, String(value));
      }

      const body = bodyParams.toString();
      const headers = {
        "API-Key": this.requireApiKey(),
        "API-Sign": this.signKrakenRequest(path, nonce, body),
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"
      };
      const response = await fetch(`${this.restBaseUrl}${path}`, {
        method: "POST",
        headers,
        body
      });
      const payload = (await response.json()) as KrakenPublicResponse<T>;

      if (!response.ok || payload.error.length > 0) {
        const message = payload.error.join(", ") || `${response.status} ${response.statusText}`;
        throw new Error(`Kraken private API error: ${message}`);
      }

      return payload.result;
    });
  }

  private async request<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= 4) {
        throw error;
      }

      await sleep((2 ** attempt + Math.random()) * 250);
      return this.request(fn, attempt + 1);
    }
  }

  private signKrakenRequest(path: string, nonce: string, body: string): string {
    const secret = Buffer.from(this.requireApiSecret(), "base64");
    const hash = crypto.createHash("sha256").update(`${nonce}${body}`).digest();
    const message = Buffer.concat([Buffer.from(path), hash]);
    return crypto.createHmac("sha512", secret).update(message).digest("base64");
  }

  private requireApiKey(): string {
    if (!this.credentials.apiKey) {
      throw new Error("KRAKEN_API_KEY is required for LIVE mode.");
    }

    return this.credentials.apiKey;
  }

  private requireApiSecret(): string {
    if (!this.credentials.apiSecret) {
      throw new Error("KRAKEN_API_SECRET is required for LIVE mode.");
    }

    return this.credentials.apiSecret;
  }
}
