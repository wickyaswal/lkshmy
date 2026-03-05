import { addDecimals, maxDecimal, subtractDecimals } from "@/lib/decimal";
import { getKrakenHealthService } from "@/lib/health/kraken-health-service";
import { getSheetsHealthService } from "@/lib/health/sheets-health-service";
import { getGoogleSheetsRepository, type GoogleSheetsRepository } from "@/lib/sheets/google-sheets";
import { ConfigService } from "@/lib/trading/core/config-service";
import { createExchangeAdapter } from "@/lib/trading/exchange";
import { getQuoteCurrencyFromPair } from "@/lib/trading/symbol-normalization";
import type { DashboardActivityItem, DashboardStatePayload, ExchangeId } from "@/lib/trading/types";
import { formatIsoNow, toFixedString } from "@/lib/utils";

const DASHBOARD_POLLING_INTERVAL_SECONDS = 5;
const DASHBOARD_STATE_CACHE_MS = 5_000;
const BALANCE_CACHE_MS = 20_000;

type BalanceCacheEntry = {
  key: string;
  value: string | null;
  fetchedAt: number;
  lastError: string | null;
};

const derivePairState = (input: {
  dailyStopHit: boolean;
  openPosition: boolean;
  openPositionState?: DashboardStatePayload["status"]["state"];
}): DashboardStatePayload["status"]["state"] => {
  if (input.dailyStopHit) {
    return "STOPPED";
  }

  if (input.openPositionState) {
    return input.openPositionState;
  }

  return input.openPosition ? "IN_POSITION" : "IDLE";
};

const toActivity = (input: { lastError: string; lastHeartbeat: string; trades: DashboardStatePayload["recentTrades"] }): DashboardActivityItem[] => {
  const items: DashboardActivityItem[] = [];

  if (input.lastError) {
    items.push({
      at: formatIsoNow(),
      type: "ERROR",
      message: input.lastError
    });
  }

  if (input.lastHeartbeat) {
    items.push({
      at: input.lastHeartbeat,
      type: "HEARTBEAT",
      message: "Bot heartbeat updated."
    });
  }

  for (const trade of input.trades.slice(0, 10)) {
    items.push({
      at: trade.close_time || trade.open_time,
      type: "TRADE",
      message: `${trade.symbol} ${trade.exit_reason} net ${trade.net_pnl_usdt}`
    });
  }

  return items
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 10);
};

export class DashboardStateService {
  private readonly configService: ConfigService;
  private readonly sheetsHealthService = getSheetsHealthService();
  private readonly krakenHealthService = getKrakenHealthService();
  private balanceCache: BalanceCacheEntry = {
    key: "",
    value: null,
    fetchedAt: 0,
    lastError: null
  };
  private liveBalanceAdapter:
    | ReturnType<typeof createExchangeAdapter>
    | null = null;
  private liveBalanceAdapterKey: ExchangeId | null = null;
  private stateCache: { value: DashboardStatePayload; fetchedAt: number } | null = null;

  constructor(private readonly sheets: GoogleSheetsRepository = getGoogleSheetsRepository()) {
    this.configService = new ConfigService(sheets);
  }

  async getStateSafe(): Promise<DashboardStatePayload> {
    try {
      return await this.getState();
    } catch (error) {
      const now = formatIsoNow();
      const message = error instanceof Error ? error.message : "Dashboard state unavailable.";

      return {
        updatedAt: now,
        pollingIntervalSeconds: DASHBOARD_POLLING_INTERVAL_SECONDS,
        tradingCapital: {
          value: null,
          quoteCurrency: "USDT",
          formulaLabel: "TC = available_quote_balance - buffer_amount",
          availableQuoteBalance: null,
          virtualBufferEnabled: true
        },
        buffer: {
          value: "0",
          changeToday: "0"
        },
        status: {
          mode: "DEMO",
          botEnabled: false,
          exchange: "DEMO",
          activePairs: [],
          state: "STOPPED",
          todayRealizedPnl: "0",
          tradesToday: 0,
          dailyStopHit: false,
          lastError: message,
          lastHeartbeat: ""
        },
        connections: {
          sheets: {
            status: "DISCONNECTED",
            connected: false,
            lastSuccessAt: null,
            lastError: message,
            checkedAt: now,
            checkIntervalSeconds: 45,
            successWindowSeconds: 60
          },
          kraken: {
            status: "DISCONNECTED",
            connected: false,
            lastSuccessAt: null,
            lastError: "Kraken health check unavailable.",
            checkedAt: now,
            checkIntervalSeconds: 45,
            successWindowSeconds: 60
          }
        },
        recentActivity: [
          {
            at: now,
            type: "ERROR",
            message
          }
        ],
        recentTrades: []
      };
    }
  }

  async getState(): Promise<DashboardStatePayload> {
    const cacheNow = Date.now();
    if (this.stateCache && cacheNow - this.stateCache.fetchedAt < DASHBOARD_STATE_CACHE_MS) {
      return this.stateCache.value;
    }

    await this.configService.ensureReady();
    const config = await this.configService.getConfig();
    const [status, recentTrades] = await Promise.all([
      this.sheets.getStatus(config),
      this.sheets.getRecentTrades(10)
    ]);
    const writePipelineState = this.sheets.getWritePipelineState();
    const effectiveLastError = writePipelineState.inMemoryError ?? status.lastError;
    const discovery = this.configService.detectExchanges();
    const activePairs = await this.configService.getTrackedPairs(config);
    const selectedExchange = config.mode === "DEMO" ? "DEMO" : discovery.liveCapable[0] ?? null;
    const quoteCurrency = getQuoteCurrencyFromPair(config.activeSymbol);
    const [sheetsConnection, krakenConnection] = await Promise.all([
      this.sheetsHealthService.check(),
      this.krakenHealthService.check()
    ]);
    const availableQuoteBalance = await this.getAvailableQuoteBalance({
      mode: config.mode,
      selectedExchange,
      quoteCurrency,
      virtualBufferEnabled: config.virtualBufferEnabled,
      statusTc: toFixedString(status.tradingCapitalTcUsdt, 8),
      statusBuffer: toFixedString(status.bufferUsdt, 8)
    });
    const bufferValue = toFixedString(status.bufferUsdt, 8);
    const tradingCapital = this.computeTradingCapital({
      availableQuoteBalance,
      bufferValue,
      virtualBufferEnabled: config.virtualBufferEnabled
    });
    const state = derivePairState({
      dailyStopHit: status.dailyStopHit,
      openPosition: status.openPosition,
      openPositionState: status.openPositionMeta?.state
    });

    const payload: DashboardStatePayload = {
      updatedAt: formatIsoNow(),
      pollingIntervalSeconds: DASHBOARD_POLLING_INTERVAL_SECONDS,
      tradingCapital: {
        value: tradingCapital,
        quoteCurrency,
        availableQuoteBalance,
        virtualBufferEnabled: config.virtualBufferEnabled,
        formulaLabel: config.virtualBufferEnabled
          ? "TC = available_quote_balance - buffer_amount"
          : "TC = available_quote_balance"
      },
      buffer: {
        value: bufferValue,
        changeToday: toFixedString(status.dailyStateMeta.skimToBuffer, 8)
      },
      status: {
        mode: config.mode,
        botEnabled: config.botEnabled,
        exchange: selectedExchange,
        activePairs,
        state,
        todayRealizedPnl: toFixedString(status.todayRealizedPnlUsdt, 8),
        tradesToday: status.tradesToday,
        dailyStopHit: status.dailyStopHit,
        lastError: effectiveLastError,
        lastHeartbeat: status.lastHeartbeat
      },
      connections: {
        sheets: sheetsConnection,
        kraken: krakenConnection
      },
      recentActivity: toActivity({
        lastError: effectiveLastError,
        lastHeartbeat: status.lastHeartbeat,
        trades: recentTrades
      }),
      recentTrades
    };

    this.stateCache = {
      value: payload,
      fetchedAt: Date.now()
    };
    return payload;
  }

  private async getAvailableQuoteBalance(input: {
    mode: "DEMO" | "LIVE";
    selectedExchange: ExchangeId | "DEMO" | null;
    quoteCurrency: string;
    virtualBufferEnabled: boolean;
    statusTc: string;
    statusBuffer: string;
  }): Promise<string | null> {
    if (input.mode === "DEMO" || input.selectedExchange === "DEMO") {
      return input.virtualBufferEnabled ? addDecimals(input.statusTc, input.statusBuffer) : input.statusTc;
    }

    if (!input.selectedExchange) {
      return null;
    }

    const cacheKey = `${input.selectedExchange}:${input.quoteCurrency}`;
    const now = Date.now();

    if (this.balanceCache.key === cacheKey && now - this.balanceCache.fetchedAt < BALANCE_CACHE_MS) {
      return this.balanceCache.value;
    }

    try {
      const adapter = await this.getLiveBalanceAdapter(input.selectedExchange);
      const balances = await adapter.getBalances();
      const found = balances.find(
        (balance) => balance.asset.toUpperCase() === input.quoteCurrency.toUpperCase()
      );
      const value = found ? toFixedString(found.available, 8) : "0";

      this.balanceCache = {
        key: cacheKey,
        value,
        fetchedAt: now,
        lastError: null
      };
      return value;
    } catch (error) {
      this.balanceCache = {
        key: cacheKey,
        value: null,
        fetchedAt: now,
        lastError: error instanceof Error ? error.message : "Balance fetch failed."
      };
      return null;
    }
  }

  private computeTradingCapital(input: {
    availableQuoteBalance: string | null;
    bufferValue: string;
    virtualBufferEnabled: boolean;
  }): string | null {
    if (!input.availableQuoteBalance) {
      return null;
    }

    if (!input.virtualBufferEnabled) {
      return input.availableQuoteBalance;
    }

    return maxDecimal(subtractDecimals(input.availableQuoteBalance, input.bufferValue), "0");
  }

  private async getLiveBalanceAdapter(exchangeId: ExchangeId) {
    if (this.liveBalanceAdapter && this.liveBalanceAdapterKey === exchangeId) {
      return this.liveBalanceAdapter;
    }

    if (this.liveBalanceAdapter) {
      await this.liveBalanceAdapter.close().catch(() => undefined);
      this.liveBalanceAdapter = null;
      this.liveBalanceAdapterKey = null;
    }

    this.liveBalanceAdapter = createExchangeAdapter({
      mode: "LIVE",
      liveExchangeId: exchangeId
    });
    this.liveBalanceAdapterKey = exchangeId;
    return this.liveBalanceAdapter;
  }
}

let dashboardStateService: DashboardStateService | null = null;

export const getDashboardStateService = (): DashboardStateService => {
  if (!dashboardStateService) {
    dashboardStateService = new DashboardStateService();
  }

  return dashboardStateService;
};
