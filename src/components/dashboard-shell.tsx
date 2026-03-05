"use client";

import { useEffect, useState, useTransition } from "react";

import type { DashboardStatePayload } from "@/lib/trading/types";

type ActionResponse = {
  message?: string;
  result?: {
    ok?: boolean;
    message?: string;
  };
};

type DashboardStateResponse = {
  state?: DashboardStatePayload;
  message?: string;
};

const parseJson = async <T,>(response: Response): Promise<T> => (await response.json()) as T;

const formatConnection = (status: DashboardStatePayload["connections"]["sheets"]["status"]): string => {
  if (status === "CONNECTED") {
    return "Connected";
  }

  if (status === "DEGRADED") {
    return "Degraded";
  }

  return "Disconnected";
};

export function DashboardShell({ initialState }: { initialState: DashboardStatePayload }) {
  const [state, setState] = useState(initialState);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const refreshState = async () => {
    const response = await fetch("/api/dashboard-state", {
      method: "GET",
      cache: "no-store"
    });
    const payload = await parseJson<DashboardStateResponse>(response);

    if (!response.ok || !payload.state) {
      throw new Error(payload.message ?? "Failed to refresh dashboard state.");
    }

    setState(payload.state);
  };

  useEffect(() => {
    let mounted = true;
    const pollMs = Math.max(2000, state.pollingIntervalSeconds * 1000);

    const poll = async () => {
      try {
        const response = await fetch("/api/dashboard-state", {
          method: "GET",
          cache: "no-store"
        });
        const payload = await parseJson<DashboardStateResponse>(response);

        if (mounted && response.ok && payload.state) {
          setState(payload.state);
        }
      } catch {}
    };

    const intervalId = setInterval(() => {
      void poll();
    }, pollMs);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [state.pollingIntervalSeconds]);

  const runAction = (callback: () => Promise<void>) => {
    startTransition(() => {
      void callback().catch((error) => {
        setFeedback(error instanceof Error ? error.message : "Action failed.");
      });
    });
  };

  const onSyncConfig = () =>
    runAction(async () => {
      const response = await fetch("/api/bot/sync-config", {
        method: "POST"
      });
      const payload = await parseJson<ActionResponse>(response);

      if (!response.ok) {
        throw new Error(payload.message ?? "Sync failed.");
      }

      await refreshState();
      setFeedback(payload.message ?? "Config synchronized.");
    });

  const onTick = () =>
    runAction(async () => {
      const response = await fetch("/api/bot/tick", {
        method: "POST"
      });
      const payload = await parseJson<ActionResponse>(response);

      if (!response.ok || payload.result?.ok === false) {
        throw new Error(payload.result?.message ?? payload.message ?? "Tick failed.");
      }

      await refreshState();
      setFeedback(payload.result?.message ?? "Tick completed.");
    });

  const onRunner = (action: "start" | "stop") =>
    runAction(async () => {
      const response = await fetch("/api/bot/runner", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action })
      });
      const payload = await parseJson<ActionResponse>(response);

      if (!response.ok) {
        throw new Error(payload.message ?? `Runner ${action} failed.`);
      }

      await refreshState();
      setFeedback(payload.message ?? `Runner ${action} completed.`);
    });

  const onExport = () =>
    runAction(async () => {
      const response = await fetch("/api/bot/export", {
        method: "GET"
      });

      if (!response.ok) {
        const payload = await parseJson<ActionResponse>(response);
        throw new Error(payload.message ?? "Export failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fiat-buffer-trading-logs-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setFeedback("Logs exported.");
      await refreshState();
    });

  return (
    <main className="page-shell">
      <div className="page-frame">
        <section className="hero">
          <h1>Fiat Buffer Trading</h1>
          <p>Live dashboard for capital, buffer, bot runtime status, and exchange/service connectivity.</p>
          <div className="badge-row">
            <span className="badge">Updated: {state.updatedAt}</span>
            <span className="badge">Polling: {state.pollingIntervalSeconds}s</span>
            <span className={`badge ${state.status.lastError ? "alert" : ""}`}>
              Last Error: {state.status.lastError || "None"}
            </span>
          </div>
        </section>

        <div className={`status-banner ${state.status.lastError ? "error" : ""}`}>
          <strong>Bot Feedback</strong>
          <div className="subtle">{feedback || "Dashboard is updating live."}</div>
        </div>

        <section className="control-row">
          <button className="action-button" onClick={onSyncConfig} disabled={isPending}>
            Sync Config
          </button>
          <button className="action-button primary" onClick={onTick} disabled={isPending}>
            Run Tick Once (DEMO)
          </button>
          <button className="action-button" onClick={() => onRunner("start")} disabled={isPending}>
            Start Runner (DEMO)
          </button>
          <button className="action-button danger" onClick={() => onRunner("stop")} disabled={isPending}>
            Stop Runner
          </button>
          <button className="action-button" onClick={onExport} disabled={isPending}>
            Export Logs
          </button>
        </section>

        <section className="grid-five">
          <article className="panel">
            <div className="panel-inner">
              <h3>Trading Capital (TC)</h3>
              <div className="kpi-value mono">
                {state.tradingCapital.value ?? "n/a"} {state.tradingCapital.quoteCurrency}
              </div>
              <div className="subtle mono">Formula: {state.tradingCapital.formulaLabel}</div>
              <div className="subtle mono">
                Available Quote: {state.tradingCapital.availableQuoteBalance ?? "n/a"} {state.tradingCapital.quoteCurrency}
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-inner">
              <h3>Buffer</h3>
              <div className="kpi-value mono">
                {state.buffer.value} {state.tradingCapital.quoteCurrency}
              </div>
              <div className="subtle mono">
                Change Today: {state.buffer.changeToday} {state.tradingCapital.quoteCurrency}
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-inner">
              <h3>Status</h3>
              <div className="mini-grid mono">
                <div>mode: {state.status.mode}</div>
                <div>bot_enabled: {String(state.status.botEnabled)}</div>
                <div>exchange: {state.status.exchange ?? "n/a"}</div>
                <div>active_pairs: {state.status.activePairs.join(", ") || "n/a"}</div>
                <div>state: {state.status.state}</div>
                <div>today_realized_pnl: {state.status.todayRealizedPnl}</div>
                <div>trades_today: {state.status.tradesToday}</div>
                <div>daily_stop_hit: {String(state.status.dailyStopHit)}</div>
                <div>last_error: {state.status.lastError || "None"}</div>
                <div>last_heartbeat: {state.status.lastHeartbeat || "n/a"}</div>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-inner">
              <h3>Google Sheets Connection</h3>
              <div className={`connection-badge ${state.connections.sheets.status.toLowerCase()}`}>
                {formatConnection(state.connections.sheets.status)}
              </div>
              <div className="subtle mono">last_success_at: {state.connections.sheets.lastSuccessAt || "n/a"}</div>
              <div className="subtle mono">last_error: {state.connections.sheets.lastError || "none"}</div>
              <div className="subtle mono">checked_at: {state.connections.sheets.checkedAt}</div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-inner">
              <h3>Kraken Connection</h3>
              <div className={`connection-badge ${state.connections.kraken.status.toLowerCase()}`}>
                {formatConnection(state.connections.kraken.status)}
              </div>
              <div className="subtle mono">last_success_at: {state.connections.kraken.lastSuccessAt || "n/a"}</div>
              <div className="subtle mono">last_error: {state.connections.kraken.lastError || "none"}</div>
              <div className="subtle mono">checked_at: {state.connections.kraken.checkedAt}</div>
            </div>
          </article>
        </section>

        <section className="grid-two">
          <article className="panel">
            <div className="panel-inner">
              <h3>Recent Activity</h3>
              <div className="table-wrap">
                <table className="kv-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.recentActivity.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="mono">
                          No recent activity.
                        </td>
                      </tr>
                    ) : (
                      state.recentActivity.map((item) => (
                        <tr key={`${item.type}-${item.at}-${item.message}`}>
                          <td className="mono">{item.at}</td>
                          <td className="mono">{item.type}</td>
                          <td className="mono">{item.message}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-inner">
              <h3>Recent Trades</h3>
              <div className="table-wrap">
                <table className="kv-table">
                  <thead>
                    <tr>
                      <th>Trade ID</th>
                      <th>Pair</th>
                      <th>Net PnL</th>
                      <th>Exit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.recentTrades.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="mono">
                          No trades logged yet.
                        </td>
                      </tr>
                    ) : (
                      state.recentTrades.map((trade) => (
                        <tr key={trade.trade_id}>
                          <td className="mono">{trade.trade_id}</td>
                          <td className="mono">{trade.symbol}</td>
                          <td className="mono">{trade.net_pnl_usdt}</td>
                          <td className="mono">{trade.exit_reason}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
