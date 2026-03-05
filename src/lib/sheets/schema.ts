export const SHEET_SCHEMAS = {
  Status: ["key", "value", "notes"],
  Config: ["param", "value", "type", "description"],
  Trades: [
    "trade_id",
    "open_time",
    "close_time",
    "symbol",
    "side",
    "entry_price",
    "exit_price",
    "qty",
    "gross_pnl_usdt",
    "fees_usdt",
    "net_pnl_usdt",
    "exit_reason",
    "spread_at_entry_pct",
    "strategy_version",
    "notes"
  ],
  DailySummary: [
    "date",
    "starting_tc_usdt",
    "ending_tc_usdt",
    "starting_buffer_usdt",
    "ending_buffer_usdt",
    "daily_gross_pnl_usdt",
    "daily_fees_usdt",
    "daily_net_pnl_usdt",
    "trades_count",
    "wins",
    "losses",
    "win_rate",
    "max_drawdown_est",
    "daily_stop_triggered",
    "skim_to_buffer_usdt",
    "notes"
  ],
  BufferLedger: [
    "date",
    "event",
    "amount_usdt",
    "buffer_before",
    "buffer_after",
    "source",
    "notes"
  ],
  PairSelection: [
    "symbol",
    "turnover_24h_usdt",
    "avg_spread_pct",
    "volatility_score",
    "overall_score",
    "eligible",
    "selected",
    "last_updated",
    "notes"
  ],
  NetCostTracking: [
    "date",
    "symbol",
    "trade_id",
    "fee_est_usdt",
    "fee_actual_usdt",
    "spread_est_usdt",
    "slippage_est_usdt",
    "net_cost_usdt",
    "notes"
  ]
} as const;

export type SheetName = keyof typeof SHEET_SCHEMAS;
