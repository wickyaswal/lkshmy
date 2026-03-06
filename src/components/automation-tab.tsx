"use client";

import { useEffect, useState } from "react";

type EndpointStatus = {
  label: string;
  method: "GET" | "POST";
  url: string;
  status: string;
};

const INITIAL_ENDPOINTS: EndpointStatus[] = [
  { label: "Tick Once", method: "POST", url: "/api/bot/tick", status: "checking..." },
  { label: "Runner State", method: "GET", url: "/api/bot/runner", status: "checking..." },
  { label: "Sync Config", method: "POST", url: "/api/bot/sync-config", status: "checking..." },
  { label: "Export Logs", method: "GET", url: "/api/bot/export", status: "checking..." }
];

const parseJson = async <T,>(response: Response): Promise<T> => (await response.json()) as T;

export function AutomationTab() {
  const [endpoints, setEndpoints] = useState<EndpointStatus[]>(INITIAL_ENDPOINTS);

  useEffect(() => {
    let active = true;

    const checkEndpoints = async () => {
      const updated = await Promise.all(
        INITIAL_ENDPOINTS.map(async (endpoint) => {
          try {
            const response = await fetch(endpoint.url, {
              method: endpoint.method,
              cache: "no-store",
              headers: {
                "Content-Type": "application/json"
              },
              body: endpoint.method === "POST" ? "{}" : undefined
            });
            const payload = await parseJson<{ message?: string }>(response).catch(() => ({ message: "" }));
            const label = payload.message ? `${response.status} - ${payload.message}` : String(response.status);

            return {
              ...endpoint,
              status: label
            };
          } catch (error) {
            return {
              ...endpoint,
              status: error instanceof Error ? `error - ${error.message}` : "error"
            };
          }
        })
      );

      if (active) {
        setEndpoints(updated);
      }
    };

    void checkEndpoints();

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="panel">
      <div className="panel-inner">
        <h2>Automation (Later phase)</h2>
        <p className="text-reading">
          All legacy auto-trading features have been moved under this tab. In this manual-assistant phase, automation
          execution remains disabled.
        </p>

        <div className="grid-two">
          <article className="panel">
            <div className="panel-inner">
              <h3>Legacy Bot Controls</h3>
              <div className="control-row">
                <button className="action-button" disabled>
                  Sync Config
                </button>
                <button className="action-button" disabled>
                  Run Tick Once
                </button>
                <button className="action-button" disabled>
                  Start Runner
                </button>
                <button className="action-button" disabled>
                  Stop Runner
                </button>
                <button className="action-button" disabled>
                  Export Logs
                </button>
              </div>
              <div className="subtle text-reading">Execution is intentionally disabled until the automation phase is re-enabled.</div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-inner">
              <h3>Automation API Status</h3>
              <ul className="flat-list mono">
                {endpoints.map((endpoint) => (
                  <li key={`${endpoint.method}-${endpoint.url}`}>
                    {endpoint.method} {endpoint.url}: {endpoint.status}
                  </li>
                ))}
              </ul>
              <div className="subtle text-reading">Expected status during this phase: `410 Gone`.</div>
            </div>
          </article>
        </div>

        <article className="panel">
          <div className="panel-inner text-reading">
            <h3>Moved Automation Scope</h3>
            <ul className="flat-list">
              <li>Runner scheduling and autonomous tick orchestration</li>
              <li>Exchange order placement/cancel workflows</li>
              <li>Legacy bot status dashboard and automation telemetry</li>
              <li>Historical automation export/report workflows</li>
            </ul>
          </div>
        </article>
      </div>
    </section>
  );
}
