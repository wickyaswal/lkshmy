import { DEFAULT_CONFIG_ROWS, DEFAULT_MEAN_REVERSION_THRESHOLD_PCT } from "@/lib/trading/defaults";
import { toInternalPair } from "@/lib/trading/symbol-normalization";
import type { BotConfig, ConfigRow, PairSelectionRow } from "@/lib/trading/types";
import { parseBooleanLike } from "@/lib/utils";

const defaultConfigMap = new Map(DEFAULT_CONFIG_ROWS.map((row) => [row.param, row.value]));

const getValue = (rows: ConfigRow[], param: string): string => {
  const row = rows.find((item) => item.param === param);
  return row?.value ?? defaultConfigMap.get(param) ?? "";
};

const getNumber = (rows: ConfigRow[], param: string): number => {
  const value = Number(getValue(rows, param));
  const defaultValue = Number(defaultConfigMap.get(param) ?? 0);
  return Number.isFinite(value) ? value : defaultValue;
};

const getBoolean = (rows: ConfigRow[], param: string, fallback: boolean): boolean => {
  const row = rows.find((item) => item.param === param);

  if (!row) {
    return fallback;
  }

  return parseBooleanLike(row.value);
};

export const parseBotConfig = (rows: ConfigRow[]): BotConfig => ({
  botEnabled: parseBooleanLike(getValue(rows, "bot_enabled")),
  mode: getValue(rows, "mode").toUpperCase() === "LIVE" ? "LIVE" : "DEMO",
  activeSymbol: toInternalPair(getValue(rows, "active_symbol") || "BTCUSDT"),
  virtualBufferEnabled: getBoolean(rows, "virtual_buffer_enabled", true),
  pairSelectionMode:
    getValue(rows, "pair_selection_mode").toUpperCase() === "SHEET_SELECTED" ? "SHEET_SELECTED" : "MANUAL",
  maxTradesPerDay: Math.max(0, Math.trunc(getNumber(rows, "max_trades_per_day"))),
  maxOpenPositions: Math.max(1, Math.trunc(getNumber(rows, "max_open_positions"))),
  takeProfitPct: Math.max(0.0001, getNumber(rows, "take_profit_pct")),
  stopLossPct: Math.max(0.0001, getNumber(rows, "stop_loss_pct")),
  maxHoldMinutes: Math.max(1, Math.trunc(getNumber(rows, "max_hold_minutes"))),
  dailyLossLimitPct: Math.max(0, getNumber(rows, "daily_loss_limit_pct")),
  riskPerTradePct: Math.max(0, getNumber(rows, "risk_per_trade_pct")),
  bufferPctOfNetProfit: Math.min(1, Math.max(0, getNumber(rows, "buffer_pct_of_net_profit"))),
  allowedHoursStartLocal: getValue(rows, "allowed_hours_start_local") || "00:00",
  allowedHoursEndLocal: getValue(rows, "allowed_hours_end_local") || "23:59",
  maxSpreadAllowedPct: Math.max(0, getNumber(rows, "max_spread_allowed_pct")),
  consecutiveLossesStop: Math.max(1, Math.trunc(getNumber(rows, "consecutive_losses_stop"))),
  heartbeatIntervalSeconds: Math.max(5, Math.trunc(getNumber(rows, "heartbeat_interval_seconds"))),
  meanReversionThresholdPct: DEFAULT_MEAN_REVERSION_THRESHOLD_PCT
});

export const buildConfigRows = (overrides?: Partial<Record<string, string>>): ConfigRow[] =>
  DEFAULT_CONFIG_ROWS.map((row) => ({
    ...row,
    value: overrides?.[row.param] ?? row.value
  }));

export const selectActiveSymbol = (config: BotConfig, pairRows: PairSelectionRow[]): string => {
  if (config.pairSelectionMode === "SHEET_SELECTED") {
    const selected = pairRows.find((row) => parseBooleanLike(row.selected));

    if (selected?.symbol) {
      return toInternalPair(selected.symbol);
    }
  }

  return toInternalPair(config.activeSymbol);
};
