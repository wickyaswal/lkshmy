export type BotMode = "DEMO" | "LIVE";
export type ExchangeId = "KRAKEN" | "COINBASE";
export type RunnerTrigger = "MANUAL" | "SCHEDULED" | "MARKET_DATA";
export type PairState = "IDLE" | "ENTERING" | "IN_POSITION" | "EXITING" | "STOPPED";
export type ExitReason = "TAKE_PROFIT" | "STOP_LOSS" | "TIME_STOP" | "MANUAL" | "ERROR";

export type StatusKey =
  | "bot_enabled"
  | "mode"
  | "active_symbol"
  | "trading_capital_tc_usdt"
  | "buffer_usdt"
  | "open_position"
  | "open_position_side"
  | "open_position_entry_price"
  | "open_position_qty"
  | "open_position_open_time"
  | "today_realized_pnl_usdt"
  | "trades_today"
  | "daily_stop_hit"
  | "last_error"
  | "last_heartbeat";

export interface StatusRow {
  key: StatusKey;
  value: string;
  notes: string;
}

export interface ConfigRow {
  param: string;
  value: string;
  type: string;
  description: string;
}

export interface TradeRow {
  trade_id: string;
  open_time: string;
  close_time: string;
  symbol: string;
  side: string;
  entry_price: string;
  exit_price: string;
  qty: string;
  gross_pnl_usdt: string;
  fees_usdt: string;
  net_pnl_usdt: string;
  exit_reason: string;
  spread_at_entry_pct: string;
  strategy_version: string;
  notes: string;
}

export interface DailySummaryRow {
  date: string;
  starting_tc_usdt: string;
  ending_tc_usdt: string;
  starting_buffer_usdt: string;
  ending_buffer_usdt: string;
  daily_gross_pnl_usdt: string;
  daily_fees_usdt: string;
  daily_net_pnl_usdt: string;
  trades_count: string;
  wins: string;
  losses: string;
  win_rate: string;
  max_drawdown_est: string;
  daily_stop_triggered: string;
  skim_to_buffer_usdt: string;
  notes: string;
}

export interface BufferLedgerRow {
  date: string;
  event: string;
  amount_usdt: string;
  buffer_before: string;
  buffer_after: string;
  source: string;
  notes: string;
}

export interface PairSelectionRow {
  symbol: string;
  turnover_24h_usdt: string;
  avg_spread_pct: string;
  volatility_score: string;
  overall_score: string;
  eligible: string;
  selected: string;
  last_updated: string;
  notes: string;
}

export interface NetCostTrackingRow {
  date: string;
  symbol: string;
  trade_id: string;
  fee_est_usdt: string;
  fee_actual_usdt: string;
  spread_est_usdt: string;
  slippage_est_usdt: string;
  net_cost_usdt: string;
  notes: string;
}

export interface Candle {
  startTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickerSnapshot {
  pair: string;
  bid: number;
  ask: number;
  last: number;
  spreadPct: number;
  openReferencePrice?: number | null;
  openReferenceLabel?: "OPEN_24H" | "DAY_OPEN" | null;
  timestamp: string;
}

export interface InstrumentInfo {
  pair: string;
  minOrderQty: number;
  qtyStep: number;
  priceStep: number;
  minNotional: number;
}

export interface NormalizedPair {
  internal: string;
  exchangeRest: string;
  exchangeWs: string;
}

export interface ExchangeBalance {
  asset: string;
  available: number;
}

export type ExchangeOrderSide = "BUY" | "SELL";
export type ExchangeOrderType = "MARKET" | "LIMIT" | "STOP_LOSS";
export type ExchangeOrderStatus = "OPEN" | "FILLED" | "CANCELLED" | "REJECTED" | "EXPIRED";

export interface ExchangeOrderRequest {
  pair: string;
  side: ExchangeOrderSide;
  type: ExchangeOrderType;
  qty: number;
  price?: number;
  triggerPrice?: number;
  clientOrderId: string;
  timeInForce?: "IOC" | "GTC";
}

export interface ExchangeOrder {
  orderId: string;
  clientOrderId: string;
  pair: string;
  side: ExchangeOrderSide;
  type: ExchangeOrderType;
  status: ExchangeOrderStatus;
  requestedQty: number;
  filledQty: number;
  avgFillPrice: number;
  feePaid: number;
  createdAt: string;
  updatedAt: string;
  rawStatus?: string;
}

export interface ExchangeFill {
  orderId: string;
  tradeId: string;
  pair: string;
  side: ExchangeOrderSide;
  qty: number;
  price: number;
  fee: number;
  timestamp: string;
}

export interface ExchangeAvailability {
  id: ExchangeId;
  hasCredentials: boolean;
  canTradeLive: boolean;
  reason: string;
}

export interface ExchangeDiscovery {
  available: ExchangeAvailability[];
  liveCapable: ExchangeId[];
}

export interface OpenPositionMeta {
  tradeId: string;
  pair: string;
  exchangeId: ExchangeId | "DEMO";
  state: PairState;
  tpPrice: number;
  slPrice: number;
  feeEstimateUsdt: number;
  spreadAtEntryPct: number;
  strategyVersion: string;
  entryOrderId: string;
  tpOrderId?: string;
  slOrderId?: string;
  entryNotes?: string;
}

export interface DailyStateMeta {
  date: string;
  tcStartOfDay: number;
  bufferStartOfDay: number;
  consecutiveLosses: number;
  dailyGrossPnl: number;
  dailyFees: number;
  wins: number;
  losses: number;
  skimToBuffer: number;
  maxDrawdownEst: number;
}

export interface BotConfig {
  botEnabled: boolean;
  mode: BotMode;
  activeSymbol: string;
  virtualBufferEnabled: boolean;
  pairSelectionMode: "MANUAL" | "SHEET_SELECTED";
  maxTradesPerDay: number;
  maxOpenPositions: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldMinutes: number;
  dailyLossLimitPct: number;
  riskPerTradePct: number;
  bufferPctOfNetProfit: number;
  allowedHoursStartLocal: string;
  allowedHoursEndLocal: string;
  maxSpreadAllowedPct: number;
  consecutiveLossesStop: number;
  heartbeatIntervalSeconds: number;
  meanReversionThresholdPct: number;
}

export interface BotStatusSnapshot {
  botEnabled: boolean;
  mode: BotMode;
  activeSymbol: string;
  tradingCapitalTcUsdt: number;
  bufferUsdt: number;
  openPosition: boolean;
  openPositionSide: "LONG" | "";
  openPositionEntryPrice: number;
  openPositionQty: number;
  openPositionOpenTime: string;
  todayRealizedPnlUsdt: number;
  tradesToday: number;
  dailyStopHit: boolean;
  lastError: string;
  lastHeartbeat: string;
  openPositionMeta: OpenPositionMeta | null;
  dailyStateMeta: DailyStateMeta;
  enabledExchanges: ExchangeAvailability[];
  liveCapableExchanges: ExchangeId[];
}

export interface EntrySignal {
  shouldEnter: boolean;
  reason: string;
  ma50: number;
  deviationPct: number;
}

export interface PositionSizingResult {
  shouldTrade: boolean;
  qty: number;
  notionalUsdt: number;
  riskAmountUsdt: number;
  skipReason?: string;
}

export interface ClosedTrade {
  tradeId: string;
  pair: string;
  exchangeId: ExchangeId | "DEMO";
  openTime: string;
  closeTime: string;
  side: "LONG";
  entryPrice: number;
  exitPrice: number;
  qty: number;
  grossPnlUsdt: number;
  feesUsdt: number;
  netPnlUsdt: number;
  exitReason: ExitReason;
  spreadAtEntryPct: number;
  strategyVersion: string;
  notes: string;
}

export interface CostEstimate {
  feeEstUsdt: number;
  feeActualUsdt: number;
  spreadEstUsdt: number;
  slippageEstUsdt: number;
  netCostUsdt: number;
}

export interface TickResult {
  ok: boolean;
  action: string;
  message: string;
}

export interface DashboardSnapshot {
  config: BotConfig;
  status: BotStatusSnapshot;
  runner: {
    running: boolean;
    mode: BotMode;
    intervalSeconds: number | null;
    activeExchange: ExchangeId | "DEMO" | null;
  };
  recentTrades: TradeRow[];
}

export type ConnectionIndicatorStatus = "CONNECTED" | "DISCONNECTED" | "DEGRADED";

export interface ConnectionIndicator {
  status: ConnectionIndicatorStatus;
  connected: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  checkedAt: string;
  checkIntervalSeconds: number;
  successWindowSeconds: number;
}

export interface DashboardStatusView {
  mode: BotMode;
  botEnabled: boolean;
  exchange: ExchangeId | "DEMO" | null;
  activePairs: string[];
  state: PairState;
  todayRealizedPnl: string;
  tradesToday: number;
  dailyStopHit: boolean;
  lastError: string;
  lastHeartbeat: string;
}

export interface DashboardActivityItem {
  at: string;
  type: string;
  message: string;
}

export interface DashboardStatePayload {
  updatedAt: string;
  pollingIntervalSeconds: number;
  tradingCapital: {
    value: string | null;
    quoteCurrency: string;
    formulaLabel: string;
    availableQuoteBalance: string | null;
    virtualBufferEnabled: boolean;
  };
  buffer: {
    value: string;
    changeToday: string;
  };
  status: DashboardStatusView;
  connections: {
    sheets: ConnectionIndicator;
    kraken: ConnectionIndicator;
  };
  recentActivity: DashboardActivityItem[];
  recentTrades: TradeRow[];
}
