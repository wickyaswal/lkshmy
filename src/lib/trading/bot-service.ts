import { getEnv } from "@/lib/env";
import { getGoogleSheetsRepository, type GoogleSheetsRepository } from "@/lib/sheets/google-sheets";
import { estimateRoundTripCosts } from "@/lib/trading/costs";
import { ConfigService } from "@/lib/trading/core/config-service";
import { PortfolioEngine } from "@/lib/trading/core/portfolio-engine";
import { RiskEngine } from "@/lib/trading/core/risk-engine";
import { SheetsLogger } from "@/lib/trading/core/sheets-logger";
import { PairStateMachine } from "@/lib/trading/core/state-machine";
import { StrategyEngine } from "@/lib/trading/core/strategy-engine";
import { DEFAULT_DAILY_STATE_META, STRATEGY_VERSION } from "@/lib/trading/defaults";
import { createExchangeAdapter, type ExchangeAdapter } from "@/lib/trading/exchange";
import { getRunnerController } from "@/lib/trading/runner";
import { buildTradeId } from "@/lib/trading/trade-id";
import type {
  BotMode,
  BotConfig,
  BotStatusSnapshot,
  ClosedTrade,
  DashboardSnapshot,
  DailyStateMeta,
  ExchangeDiscovery,
  ExchangeId,
  ExchangeOrder,
  ExitReason,
  OpenPositionMeta,
  TickResult
} from "@/lib/trading/types";
import { formatDateInTimeZone, formatIsoNow, formatTimeInTimeZone, isTimeWithinWindow, roundTo, sleep, toFixedString } from "@/lib/utils";

type RunnerResponse = {
  running: boolean;
  intervalSeconds: number | null;
  message: string;
};

const marketTickThrottleMs = 5000;

const fallbackStatus = (): BotStatusSnapshot => ({
  botEnabled: false,
  mode: "DEMO",
  activeSymbol: "BTCUSDT",
  tradingCapitalTcUsdt: 1000,
  bufferUsdt: 0,
  openPosition: false,
  openPositionSide: "",
  openPositionEntryPrice: 0,
  openPositionQty: 0,
  openPositionOpenTime: "",
  todayRealizedPnlUsdt: 0,
  tradesToday: 0,
  dailyStopHit: false,
  lastError: "",
  lastHeartbeat: "",
  openPositionMeta: null,
  dailyStateMeta: DEFAULT_DAILY_STATE_META(1000, 0, formatDateInTimeZone(new Date(), getEnv().botTimezone)),
  enabledExchanges: [],
  liveCapableExchanges: []
});

export class TradingBotService {
  private tickInFlight = false;
  private marketTickDebounceUntil = 0;
  private adapter: ExchangeAdapter | null = null;
  private adapterKey: string | null = null;

  private readonly configService: ConfigService;
  private readonly riskEngine = new RiskEngine();
  private readonly strategyEngine = new StrategyEngine();
  private readonly portfolioEngine = new PortfolioEngine();
  private readonly stateMachine = new PairStateMachine();
  private readonly sheetsLogger: SheetsLogger;

  constructor(private readonly sheets: GoogleSheetsRepository = getGoogleSheetsRepository()) {
    this.configService = new ConfigService(sheets);
    this.sheetsLogger = new SheetsLogger(sheets);
  }

  async syncConfig(): Promise<DashboardSnapshot> {
    await this.configService.ensureReady();
    const config = await this.configService.getConfig(true);
    const discovery = this.configService.detectExchanges();
    await this.updateStatusExchangeMeta(discovery, this.resolveLiveExchange(config.mode, discovery), config.mode);
    return this.getDashboardSnapshot();
  }

  async getDashboardSnapshot(): Promise<DashboardSnapshot> {
    const config = await this.configService.getConfig();
    const discovery = this.configService.detectExchanges();
    const liveExchange = this.resolveLiveExchange(config.mode, discovery);
    await this.updateStatusExchangeMeta(discovery, liveExchange, config.mode);
    const status = await this.sheets.getStatus(config);
    const runnerState = getRunnerController().getState();
    const recentTrades = await this.sheets.getRecentTrades(12);

    return {
      config,
      status: {
        ...status,
        enabledExchanges: discovery.available,
        liveCapableExchanges: discovery.liveCapable
      },
      runner: {
        running: runnerState.running,
        intervalSeconds: runnerState.intervalSeconds,
        mode: config.mode,
        activeExchange: config.mode === "DEMO" ? "DEMO" : liveExchange
      },
      recentTrades
    };
  }

  async getDashboardSnapshotSafe(): Promise<DashboardSnapshot> {
    try {
      return await this.getDashboardSnapshot();
    } catch (error) {
      const runnerState = getRunnerController().getState();
      const status = fallbackStatus();
      status.lastError = error instanceof Error ? error.message : "Unknown error";

      return {
        config: {
          botEnabled: false,
          mode: "DEMO",
          activeSymbol: "BTCUSDT",
          virtualBufferEnabled: true,
          pairSelectionMode: "MANUAL",
          maxTradesPerDay: 3,
          maxOpenPositions: 1,
          takeProfitPct: 0.006,
          stopLossPct: 0.004,
          maxHoldMinutes: 90,
          dailyLossLimitPct: 0.015,
          riskPerTradePct: 0.005,
          bufferPctOfNetProfit: 0.5,
          allowedHoursStartLocal: "07:00",
          allowedHoursEndLocal: "22:00",
          maxSpreadAllowedPct: 0.0025,
          consecutiveLossesStop: 2,
          heartbeatIntervalSeconds: 60,
          meanReversionThresholdPct: 0.0035
        },
        status,
        runner: {
          running: runnerState.running,
          intervalSeconds: runnerState.intervalSeconds,
          mode: "DEMO",
          activeExchange: "DEMO"
        },
        recentTrades: []
      };
    }
  }

  async runTick(trigger: "MANUAL" | "SCHEDULED" | "MARKET_DATA" = "MANUAL"): Promise<TickResult> {
    if (this.tickInFlight) {
      return {
        ok: false,
        action: "SKIP",
        message: "A tick is already in progress."
      };
    }

    if (trigger === "MARKET_DATA" && Date.now() < this.marketTickDebounceUntil) {
      return {
        ok: true,
        action: "DEBOUNCED",
        message: "Market-data tick ignored due to debounce."
      };
    }

    if (trigger === "MARKET_DATA") {
      this.marketTickDebounceUntil = Date.now() + marketTickThrottleMs;
    }

    this.tickInFlight = true;

    try {
      await this.configService.ensureReady();
      const config = await this.configService.getConfig();
      const discovery = this.configService.detectExchanges();
      const liveExchange = this.resolveLiveExchange(config.mode, discovery);
      const trackedPairs = await this.configService.getTrackedPairs(config);

      this.assertModeSafety(config, discovery, liveExchange);
      await this.updateStatusExchangeMeta(discovery, liveExchange, config.mode);

      await this.sheets.updateStatusEntries({
        bot_enabled: { value: config.botEnabled ? "TRUE" : "FALSE" },
        last_heartbeat: { value: formatIsoNow() }
      });

      let status = await this.sheets.getStatus(config);
      status = await this.rollDailyStateIfNeeded(status);
      status = {
        ...status,
        enabledExchanges: discovery.available,
        liveCapableExchanges: discovery.liveCapable
      };

      if (!config.botEnabled) {
        await this.clearLastError();
        return {
          ok: true,
          action: "IDLE",
          message: "bot_enabled is FALSE. Tick ended safely."
        };
      }

      const adapter = await this.ensureAdapter(config.mode, liveExchange);
      await adapter.connectMarketData(trackedPairs);
      for (const pair of trackedPairs) {
        await adapter.subscribeTicker(pair);
      }

      if (status.openPosition) {
        return await this.manageOpenPosition(config, status, adapter);
      }

      const stopForDay = this.riskEngine.shouldStopForDay(status, config);
      if (stopForDay.stop) {
        this.forcePairStates(trackedPairs, "STOPPED");
        await this.sheets.updateStatusEntries({
          daily_stop_hit: { value: "TRUE" },
          last_error: { value: "" }
        });
        return {
          ok: true,
          action: "STOPPED",
          message: stopForDay.reason
        };
      }

      const localTime = formatTimeInTimeZone(new Date(), getEnv().botTimezone);
      if (!isTimeWithinWindow(localTime, config.allowedHoursStartLocal, config.allowedHoursEndLocal)) {
        await this.clearLastError();
        return {
          ok: true,
          action: "WAIT",
          message: "Outside configured trading hours."
        };
      }

      for (const pair of trackedPairs) {
        const entryResult = await this.tryEnterPosition({
          pair,
          config,
          status,
          adapter,
          exchangeId: adapter.id
        });

        if (entryResult) {
          await this.clearLastError();
          return entryResult;
        }
      }

      await this.clearLastError();
      return {
        ok: true,
        action: "NO_ENTRY",
        message: "No eligible entry signal."
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown tick failure";
      await this.sheets.updateStatusEntries({
        last_error: { value: message },
        last_heartbeat: { value: formatIsoNow() }
      });
      return {
        ok: false,
        action: "ERROR",
        message
      };
    } finally {
      this.tickInFlight = false;
    }
  }

  async startRunner(): Promise<RunnerResponse> {
    const config = await this.configService.getConfig();
    if (config.mode !== "DEMO") {
      return {
        running: false,
        intervalSeconds: null,
        message: "Runner start is restricted to DEMO mode."
      };
    }

    const discovery = this.configService.detectExchanges();
    const trackedPairs = await this.configService.getTrackedPairs(config);
    const adapter = await this.ensureAdapter("DEMO", this.resolveLiveExchange("DEMO", discovery));
    await adapter.connectMarketData(trackedPairs);
    adapter.setTickerListener(() => {
      void this.runTick("MARKET_DATA");
    });
    const runner = getRunnerController();
    runner.start(config.heartbeatIntervalSeconds, async () => {
      await this.runTick("SCHEDULED");
    });

    const state = runner.getState();
    return {
      running: state.running,
      intervalSeconds: state.intervalSeconds,
      message: "Runner started with market-data triggers and periodic safety ticks."
    };
  }

  async stopRunner(): Promise<RunnerResponse> {
    const runner = getRunnerController();
    runner.stop();

    if (this.adapter) {
      this.adapter.setTickerListener(null);
    }

    const state = runner.getState();
    return {
      running: state.running,
      intervalSeconds: state.intervalSeconds,
      message: "Runner stopped."
    };
  }

  async exportLogs(): Promise<Record<string, unknown>> {
    return this.sheets.exportTabs();
  }

  private async tryEnterPosition(input: {
    pair: string;
    config: BotConfig;
    status: BotStatusSnapshot;
    adapter: ExchangeAdapter;
    exchangeId: ExchangeId | "DEMO";
  }): Promise<TickResult | null> {
    const { pair, config, status, adapter } = input;
    this.stateMachine.force(pair, "IDLE");

    const [ticker, candles, instrument] = await Promise.all([
      adapter.getTicker(pair),
      adapter.getCandles(pair, "5m", 120),
      adapter.getInstrumentInfo(pair)
    ]);
    const signal = this.strategyEngine.evaluate(config, candles, ticker);

    if (!signal.shouldEnter) {
      return null;
    }

    const balances = await adapter.getBalances();
    const usdtBalance =
      balances.find((balance) => balance.asset === "USDT" || balance.asset === "USD")?.available ?? Number.POSITIVE_INFINITY;
    const sizing = this.portfolioEngine.calculateSize({
      tradingCapitalUsdt: status.tradingCapitalTcUsdt,
      stopLossPct: config.stopLossPct,
      riskPerTradePct: config.riskPerTradePct,
      askPrice: ticker.ask,
      instrument,
      maxAffordableNotional: Math.min(usdtBalance, status.tradingCapitalTcUsdt)
    });

    if (!sizing.shouldTrade) {
      return null;
    }

    this.stateMachine.transition(pair, "ENTERING");
    const tradeId = buildTradeId(pair, formatIsoNow());
    const entryOrder = await adapter.placeOrder({
      pair,
      side: "BUY",
      type: "LIMIT",
      qty: sizing.qty,
      price: roundTo(ticker.ask, 8),
      clientOrderId: `${tradeId}-entry`,
      timeInForce: "IOC"
    });
    const entryFill = await this.waitForOrderFill(adapter, pair, entryOrder.orderId, 7);

    if (!entryFill) {
      await adapter.cancelOrder(entryOrder.orderId, pair).catch(() => undefined);
      this.stateMachine.transition(pair, "IDLE");
      return null;
    }

    const tpPrice = roundTo(entryFill.avgFillPrice * (1 + config.takeProfitPct), 8);
    const slPrice = roundTo(entryFill.avgFillPrice * (1 - config.stopLossPct), 8);
    const [tpOrder, slOrder] = await Promise.all([
      adapter.placeOrder({
        pair,
        side: "SELL",
        type: "LIMIT",
        qty: entryFill.filledQty,
        price: tpPrice,
        clientOrderId: `${tradeId}-tp`,
        timeInForce: "GTC"
      }),
      adapter.placeOrder({
        pair,
        side: "SELL",
        type: "STOP_LOSS",
        qty: entryFill.filledQty,
        triggerPrice: slPrice,
        clientOrderId: `${tradeId}-sl`
      })
    ]);

    this.stateMachine.transition(pair, "IN_POSITION");

    const costEstimate = estimateRoundTripCosts({
      notionalUsdt: entryFill.avgFillPrice * entryFill.filledQty,
      spreadPct: ticker.spreadPct,
      actualFeeUsdt: entryFill.feePaid
    });

    const openMeta: OpenPositionMeta = {
      tradeId,
      pair,
      exchangeId: input.exchangeId,
      state: "IN_POSITION",
      tpPrice,
      slPrice,
      feeEstimateUsdt: costEstimate.feeActualUsdt,
      spreadAtEntryPct: ticker.spreadPct,
      strategyVersion: STRATEGY_VERSION,
      entryOrderId: entryFill.orderId,
      tpOrderId: tpOrder.orderId,
      slOrderId: slOrder.orderId,
      entryNotes: signal.reason
    };

    await this.sheets.updateStatusEntries({
      active_symbol: { value: pair },
      open_position: { value: "TRUE", notes: JSON.stringify(openMeta) },
      open_position_side: { value: "LONG" },
      open_position_entry_price: { value: toFixedString(entryFill.avgFillPrice, 8) },
      open_position_qty: { value: toFixedString(entryFill.filledQty, 8) },
      open_position_open_time: { value: entryFill.updatedAt },
      trades_today: { value: String(status.tradesToday + 1) },
      last_error: { value: "" }
    });

    await this.sheetsLogger.upsertNetCost({
      date: status.dailyStateMeta.date,
      symbol: pair,
      trade_id: tradeId,
      fee_est_usdt: toFixedString(costEstimate.feeEstUsdt, 8),
      fee_actual_usdt: toFixedString(costEstimate.feeActualUsdt, 8),
      spread_est_usdt: toFixedString(costEstimate.spreadEstUsdt, 8),
      slippage_est_usdt: toFixedString(costEstimate.slippageEstUsdt, 8),
      net_cost_usdt: toFixedString(costEstimate.netCostUsdt, 8),
      notes: `${adapter.id} ${config.mode} entry.`
    });

    return {
      ok: true,
      action: "ENTERED",
      message: `Opened ${pair} long on ${adapter.id}.`
    };
  }

  private async manageOpenPosition(config: BotConfig, status: BotStatusSnapshot, adapter: ExchangeAdapter): Promise<TickResult> {
    const meta = status.openPositionMeta;
    if (!meta) {
      await this.sheets.updateStatusEntries({
        open_position: { value: "FALSE", notes: "" }
      });
      return {
        ok: true,
        action: "RESET",
        message: "Open position metadata was missing and has been reset."
      };
    }

    this.stateMachine.force(meta.pair, "IN_POSITION");
    const tpOrder = meta.tpOrderId ? await adapter.getOrder(meta.tpOrderId, meta.pair) : null;
    const slOrder = meta.slOrderId ? await adapter.getOrder(meta.slOrderId, meta.pair) : null;
    let exitOrder: ExchangeOrder | null = null;
    let exitReason: ExitReason | null = null;

    if (tpOrder?.status === "FILLED") {
      exitOrder = tpOrder;
      exitReason = "TAKE_PROFIT";
      if (meta.slOrderId) {
        await adapter.cancelOrder(meta.slOrderId, meta.pair).catch(() => undefined);
      }
    } else if (slOrder?.status === "FILLED") {
      exitOrder = slOrder;
      exitReason = "STOP_LOSS";
      if (meta.tpOrderId) {
        await adapter.cancelOrder(meta.tpOrderId, meta.pair).catch(() => undefined);
      }
    }

    if (!exitOrder && this.isTimeStopTriggered(status.openPositionOpenTime, config.maxHoldMinutes)) {
      this.stateMachine.transition(meta.pair, "EXITING");
      if (meta.tpOrderId) {
        await adapter.cancelOrder(meta.tpOrderId, meta.pair).catch(() => undefined);
      }
      if (meta.slOrderId) {
        await adapter.cancelOrder(meta.slOrderId, meta.pair).catch(() => undefined);
      }
      const marketExit = await adapter.placeOrder({
        pair: meta.pair,
        side: "SELL",
        type: "MARKET",
        qty: status.openPositionQty,
        clientOrderId: `${meta.tradeId}-time`
      });
      exitOrder = (await this.waitForOrderFill(adapter, meta.pair, marketExit.orderId, 8)) ?? marketExit;
      exitReason = "TIME_STOP";
    }

    if (!exitOrder || !exitReason) {
      return {
        ok: true,
        action: "HOLD",
        message: "Position remains open."
      };
    }

    await this.finalizeClosedTrade(config, status, meta, exitOrder, exitReason);
    this.stateMachine.force(meta.pair, "IDLE");

    return {
      ok: true,
      action: "EXITED",
      message: `Closed ${meta.pair} with ${exitReason}.`
    };
  }

  private async finalizeClosedTrade(
    config: BotConfig,
    status: BotStatusSnapshot,
    meta: OpenPositionMeta,
    exitOrder: ExchangeOrder,
    exitReason: ExitReason
  ): Promise<void> {
    const grossPnlUsdt = roundTo((exitOrder.avgFillPrice - status.openPositionEntryPrice) * status.openPositionQty, 8);
    const feesUsdt = roundTo(meta.feeEstimateUsdt + exitOrder.feePaid, 8);
    const netPnlUsdt = roundTo(grossPnlUsdt - feesUsdt, 8);
    const closedTrade: ClosedTrade = {
      tradeId: meta.tradeId,
      pair: meta.pair,
      exchangeId: meta.exchangeId,
      openTime: status.openPositionOpenTime,
      closeTime: exitOrder.updatedAt,
      side: "LONG",
      entryPrice: status.openPositionEntryPrice,
      exitPrice: exitOrder.avgFillPrice,
      qty: status.openPositionQty,
      grossPnlUsdt,
      feesUsdt,
      netPnlUsdt,
      exitReason,
      spreadAtEntryPct: meta.spreadAtEntryPct,
      strategyVersion: meta.strategyVersion,
      notes: meta.entryNotes ?? ""
    };
    const capital = this.portfolioEngine.applyClosedTrade(status, config, closedTrade);
    const dailyState = this.riskEngine.applyTrade(status.dailyStateMeta, status, closedTrade);
    dailyState.skimToBuffer = roundTo(dailyState.skimToBuffer + capital.skimmedToBuffer, 8);
    const todayPnl = roundTo(status.todayRealizedPnlUsdt + closedTrade.netPnlUsdt, 8);
    const lossLimit = dailyState.tcStartOfDay * config.dailyLossLimitPct;
    const stopForDay =
      todayPnl <= -lossLimit ||
      dailyState.consecutiveLosses >= config.consecutiveLossesStop ||
      status.tradesToday >= config.maxTradesPerDay;

    await this.sheetsLogger.appendTradeIdempotent({
      trade_id: closedTrade.tradeId,
      open_time: closedTrade.openTime,
      close_time: closedTrade.closeTime,
      symbol: closedTrade.pair,
      side: closedTrade.side,
      entry_price: toFixedString(closedTrade.entryPrice, 8),
      exit_price: toFixedString(closedTrade.exitPrice, 8),
      qty: toFixedString(closedTrade.qty, 8),
      gross_pnl_usdt: toFixedString(closedTrade.grossPnlUsdt, 8),
      fees_usdt: toFixedString(closedTrade.feesUsdt, 8),
      net_pnl_usdt: toFixedString(closedTrade.netPnlUsdt, 8),
      exit_reason: closedTrade.exitReason,
      spread_at_entry_pct: toFixedString(closedTrade.spreadAtEntryPct, 8),
      strategy_version: closedTrade.strategyVersion,
      notes: closedTrade.notes
    });

    const notional = closedTrade.entryPrice * closedTrade.qty;
    const costs = estimateRoundTripCosts({
      notionalUsdt: notional,
      spreadPct: closedTrade.spreadAtEntryPct,
      actualFeeUsdt: closedTrade.feesUsdt
    });
    await this.sheetsLogger.upsertNetCost({
      date: dailyState.date,
      symbol: closedTrade.pair,
      trade_id: closedTrade.tradeId,
      fee_est_usdt: toFixedString(costs.feeEstUsdt, 8),
      fee_actual_usdt: toFixedString(costs.feeActualUsdt, 8),
      spread_est_usdt: toFixedString(costs.spreadEstUsdt, 8),
      slippage_est_usdt: toFixedString(costs.slippageEstUsdt, 8),
      net_cost_usdt: toFixedString(costs.netCostUsdt, 8),
      notes: `Exit ${closedTrade.exitReason}`
    });

    if (capital.skimmedToBuffer > 0) {
      await this.sheetsLogger.appendBufferLedger({
        date: dailyState.date,
        event: "PROFIT_SKIM",
        amount_usdt: toFixedString(capital.skimmedToBuffer, 8),
        buffer_before: toFixedString(status.bufferUsdt, 8),
        buffer_after: toFixedString(capital.updatedBuffer, 8),
        source: closedTrade.tradeId,
        notes: `Skimmed ${config.bufferPctOfNetProfit * 100}% of net profit.`
      });
    }

    await this.sheets.updateStatusEntries({
      trading_capital_tc_usdt: { value: toFixedString(capital.updatedTradingCapital, 8) },
      buffer_usdt: { value: toFixedString(capital.updatedBuffer, 8) },
      open_position: { value: "FALSE", notes: "" },
      open_position_side: { value: "" },
      open_position_entry_price: { value: "" },
      open_position_qty: { value: "" },
      open_position_open_time: { value: "" },
      today_realized_pnl_usdt: { value: toFixedString(todayPnl, 8), notes: JSON.stringify(dailyState) },
      daily_stop_hit: { value: stopForDay ? "TRUE" : "FALSE" },
      last_error: { value: "" }
    });

    await this.sheetsLogger.upsertDailySummary({
      date: dailyState.date,
      starting_tc_usdt: toFixedString(dailyState.tcStartOfDay, 8),
      ending_tc_usdt: toFixedString(capital.updatedTradingCapital, 8),
      starting_buffer_usdt: toFixedString(dailyState.bufferStartOfDay, 8),
      ending_buffer_usdt: toFixedString(capital.updatedBuffer, 8),
      daily_gross_pnl_usdt: toFixedString(dailyState.dailyGrossPnl, 8),
      daily_fees_usdt: toFixedString(dailyState.dailyFees, 8),
      daily_net_pnl_usdt: toFixedString(todayPnl, 8),
      trades_count: String(status.tradesToday),
      wins: String(dailyState.wins),
      losses: String(dailyState.losses),
      win_rate:
        dailyState.wins + dailyState.losses > 0
          ? toFixedString(dailyState.wins / (dailyState.wins + dailyState.losses), 4)
          : "0",
      max_drawdown_est: toFixedString(dailyState.maxDrawdownEst, 8),
      daily_stop_triggered: stopForDay ? "TRUE" : "FALSE",
      skim_to_buffer_usdt: toFixedString(dailyState.skimToBuffer, 8),
      notes: ""
    });
  }

  private async ensureAdapter(mode: BotMode, liveExchange: ExchangeId | null): Promise<ExchangeAdapter> {
    const key = mode === "DEMO" ? "DEMO" : liveExchange;

    if (!key) {
      throw new Error("No LIVE exchange adapter can be selected.");
    }

    if (this.adapter && this.adapterKey === key) {
      return this.adapter;
    }

    if (this.adapter) {
      await this.adapter.close();
      this.adapter = null;
      this.adapterKey = null;
    }

    const liveExchangeId = mode === "LIVE" ? liveExchange ?? undefined : undefined;
    this.adapter = createExchangeAdapter({
      mode,
      liveExchangeId
    });
    this.adapterKey = key;
    return this.adapter;
  }

  private resolveLiveExchange(mode: BotMode, discovery: ExchangeDiscovery): ExchangeId | null {
    if (mode === "DEMO") {
      return null;
    }

    return discovery.liveCapable[0] ?? null;
  }

  private assertModeSafety(config: BotConfig, discovery: ExchangeDiscovery, liveExchange: ExchangeId | null): void {
    if (config.mode !== "LIVE") {
      return;
    }

    const env = getEnv();
    if (!env.liveTradingEnabled) {
      throw new Error("LIVE mode refused: set LIVE_TRADING_ENABLED=true.");
    }

    if (!liveExchange) {
      throw new Error("LIVE mode refused: no live-capable exchange credentials detected. Kraken keys are required.");
    }

    if (!discovery.liveCapable.includes("KRAKEN")) {
      throw new Error("LIVE mode refused: Kraken is the only v0 LIVE adapter.");
    }
  }

  private async waitForOrderFill(
    adapter: ExchangeAdapter,
    pair: string,
    orderId: string,
    attempts: number
  ): Promise<ExchangeOrder | null> {
    for (let index = 0; index < attempts; index += 1) {
      const order = await adapter.getOrder(orderId, pair);
      if (order?.status === "FILLED") {
        return order;
      }
      if (order && ["CANCELLED", "REJECTED", "EXPIRED"].includes(order.status)) {
        return null;
      }
      await sleep(400 * (index + 1));
    }

    return null;
  }

  private isTimeStopTriggered(openedAt: string, maxHoldMinutes: number): boolean {
    if (!openedAt) {
      return false;
    }

    const openedAtMs = Date.parse(openedAt);
    if (!Number.isFinite(openedAtMs)) {
      return false;
    }

    return Date.now() - openedAtMs >= maxHoldMinutes * 60_000;
  }

  private async rollDailyStateIfNeeded(status: BotStatusSnapshot): Promise<BotStatusSnapshot> {
    const date = formatDateInTimeZone(new Date(), getEnv().botTimezone);
    if (status.dailyStateMeta.date === date) {
      return status;
    }

    const nextMeta: DailyStateMeta = DEFAULT_DAILY_STATE_META(status.tradingCapitalTcUsdt, status.bufferUsdt, date);
    await this.sheets.updateStatusEntries({
      today_realized_pnl_usdt: { value: "0", notes: JSON.stringify(nextMeta) },
      trades_today: { value: "0" },
      daily_stop_hit: { value: "FALSE" }
    });

    return {
      ...status,
      todayRealizedPnlUsdt: 0,
      tradesToday: 0,
      dailyStopHit: false,
      dailyStateMeta: nextMeta
    };
  }

  private async updateStatusExchangeMeta(
    discovery: ExchangeDiscovery,
    selectedLiveExchange: ExchangeId | null,
    mode: BotMode
  ): Promise<void> {
    await this.sheets.updateStatusEntries({
      mode: {
        value: mode,
        notes: JSON.stringify({
          enabledExchanges: discovery.available,
          liveCapableExchanges: discovery.liveCapable,
          selectedLiveExchange,
          pairStates: this.stateMachine.snapshot()
        })
      }
    });
  }

  private forcePairStates(pairs: string[], state: "STOPPED" | "IDLE"): void {
    for (const pair of pairs) {
      this.stateMachine.force(pair, state);
    }
  }

  private async clearLastError(): Promise<void> {
    await this.sheets.updateStatusEntries({
      last_error: { value: "" }
    });
  }
}

let botService: TradingBotService | null = null;

export const getBotService = (): TradingBotService => {
  if (!botService) {
    botService = new TradingBotService();
  }

  return botService;
};
