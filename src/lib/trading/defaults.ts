import type { ConfigRow, DailyStateMeta, StatusRow } from "@/lib/trading/types";

export const STRATEGY_VERSION = "mean-reversion-v0";
export const DEFAULT_MEAN_REVERSION_THRESHOLD_PCT = 0.0035;

export const DEFAULT_CONFIG_ROWS: ConfigRow[] = [
  {
    param: "bot_enabled",
    value: "FALSE",
    type: "boolean",
    description: "Master switch. Keep FALSE until config and logs are validated."
  },
  {
    param: "mode",
    value: "DEMO",
    type: "enum",
    description: "DEMO is the safe default. LIVE requires LIVE_TRADING_ENABLED=true and Kraken credentials."
  },
  {
    param: "active_symbol",
    value: "BTCUSDT",
    type: "string",
    description: "Exactly one active trading symbol at a time."
  },
  {
    param: "pair_selection_mode",
    value: "MANUAL",
    type: "enum",
    description: "MANUAL uses active_symbol. SHEET_SELECTED uses the selected row from PairSelection."
  },
  {
    param: "max_trades_per_day",
    value: "3",
    type: "number",
    description: "Hard cap on new entries per local trading day."
  },
  {
    param: "max_open_positions",
    value: "1",
    type: "number",
    description: "v0 supports only a single spot long position."
  },
  {
    param: "take_profit_pct",
    value: "0.006",
    type: "number",
    description: "Take profit as decimal. 0.006 = 0.6%."
  },
  {
    param: "stop_loss_pct",
    value: "0.004",
    type: "number",
    description: "Stop loss as decimal. 0.004 = 0.4%."
  },
  {
    param: "max_hold_minutes",
    value: "90",
    type: "number",
    description: "Time stop if TP or SL do not trigger in time."
  },
  {
    param: "daily_loss_limit_pct",
    value: "0.015",
    type: "number",
    description: "Stop opening new trades when realized daily loss breaches this fraction of start-of-day TC."
  },
  {
    param: "risk_per_trade_pct",
    value: "0.005",
    type: "number",
    description: "Position risk as fraction of TC. Used with stop_loss_pct for sizing."
  },
  {
    param: "buffer_pct_of_net_profit",
    value: "0.5",
    type: "number",
    description: "Skim this fraction of positive net profit into Buffer."
  },
  {
    param: "allowed_hours_start_local",
    value: "07:00",
    type: "time",
    description: "Local-time trading window start."
  },
  {
    param: "allowed_hours_end_local",
    value: "22:00",
    type: "time",
    description: "Local-time trading window end."
  },
  {
    param: "max_spread_allowed_pct",
    value: "0.0025",
    type: "number",
    description: "Skip entries when spread exceeds this decimal fraction."
  },
  {
    param: "consecutive_losses_stop",
    value: "2",
    type: "number",
    description: "Stop opening new trades after this many consecutive losses."
  },
  {
    param: "heartbeat_interval_seconds",
    value: "60",
    type: "number",
    description: "Runner heartbeat interval."
  }
];

export const DEFAULT_DAILY_STATE_META = (tradingCapitalTcUsdt: number, bufferUsdt: number, date: string): DailyStateMeta => ({
  date,
  tcStartOfDay: tradingCapitalTcUsdt,
  bufferStartOfDay: bufferUsdt,
  consecutiveLosses: 0,
  dailyGrossPnl: 0,
  dailyFees: 0,
  wins: 0,
  losses: 0,
  skimToBuffer: 0,
  maxDrawdownEst: 0
});

export const DEFAULT_STATUS_ROWS = (date: string): StatusRow[] => [
  { key: "bot_enabled", value: "FALSE", notes: "" },
  { key: "mode", value: "DEMO", notes: "" },
  { key: "active_symbol", value: "BTCUSDT", notes: "" },
  { key: "trading_capital_tc_usdt", value: "1000", notes: "" },
  { key: "buffer_usdt", value: "0", notes: "" },
  { key: "open_position", value: "FALSE", notes: "" },
  { key: "open_position_side", value: "", notes: "" },
  { key: "open_position_entry_price", value: "", notes: "" },
  { key: "open_position_qty", value: "", notes: "" },
  { key: "open_position_open_time", value: "", notes: "" },
  {
    key: "today_realized_pnl_usdt",
    value: "0",
    notes: JSON.stringify(DEFAULT_DAILY_STATE_META(1000, 0, date))
  },
  { key: "trades_today", value: "0", notes: "" },
  { key: "daily_stop_hit", value: "FALSE", notes: "" },
  { key: "last_error", value: "", notes: "" },
  { key: "last_heartbeat", value: "", notes: "" }
];
