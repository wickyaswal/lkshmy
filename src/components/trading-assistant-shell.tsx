"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "react-tooltip";

import { AutomationTab } from "@/components/automation-tab";
import { computeMarketSentiment, rankScannerOpportunities } from "@/lib/assistant/dashboard-helpers";
import { DEFAULT_ASSISTANT_PAIRS, DEFAULT_SELECTED_PAIRS, DEFAULT_STRATEGY_PARAMS } from "@/lib/assistant/defaults";
import { computeDeterministicSuggestion } from "@/lib/assistant/suggestion-engine";
import type {
  AssistantMarketResponse,
  AssistantPair,
  AssistantPositionsResponse,
  DeterministicSuggestion,
  MonitoredPosition,
  StrategyParams
} from "@/lib/assistant/types";
import { splitInternalPair, toInternalPair, toKrakenWsPair } from "@/lib/trading/symbol-normalization";
import type { TickerSnapshot } from "@/lib/trading/types";
import { roundTo } from "@/lib/utils";

type TabId = "ASSISTANT" | "AUTOMATION" | "GLOSSARY";
type AssistantSubTabId = "KRAKEN";
type AlertType = "TAKE_PROFIT" | "STOP_LOSS" | "TIME_STOP" | "SPREAD_WARNING";
type AlertItem = {
  id: string;
  type: AlertType;
  pair: string;
  message: string;
  at: string;
};
type TooltipKey =
  | "takeProfitPct"
  | "stopLossPct"
  | "maxHoldMinutes"
  | "timeframe"
  | "maPeriod"
  | "entryThresholdPct"
  | "maxSpreadAllowedPct"
  | "assumedFeePctRoundtrip"
  | "assumedSlippagePctRoundtrip"
  | "minNetEdgePct"
  | "marginalNetEdgePct";
type ExecutedDraft = {
  marked: boolean;
  entryPrice: string;
  qty: string;
  openedAt: string;
};
type GlossaryTermId =
  | "spread"
  | "mid"
  | "fee"
  | "slippage"
  | "netEdge"
  | "ma50"
  | "deviation"
  | "signal"
  | "viability"
  | "tp"
  | "sl"
  | "timeStop"
  | "notional"
  | "quantity"
  | "bps";
type GlossaryTerm = {
  id: GlossaryTermId;
  title: string;
  definition: string;
  why: string;
  example: string;
};
type GlossaryContext = {
  referencePrice: number | null;
  sampleSpreadPct: number | null;
  sampleNetEdgePct: number;
  sampleDeviationPct: number;
  sampleNotional: number;
  sampleQty: number;
  params: StrategyParams;
  sentimentLabel: string;
  sentimentScorePct: number;
};

type MarketApiPayload = {
  state?: AssistantMarketResponse;
  message?: string;
};

type PositionsApiPayload = {
  state?: AssistantPositionsResponse;
  message?: string;
};

type AiAssistantResponsePayload = {
  answer: string;
  top_candidates: Array<{
    pair: string;
    status: "VIABLE" | "MARGINAL" | "NOT_VIABLE";
    why_interesting: string;
    numbers: {
      spread_bps: number;
      deviation_bps: number;
      net_edge_bps: number;
    };
    feasibility: {
      min_order_ok: boolean;
      notes: string[];
    };
    if_user_wants_to_simulate: {
      entry: number;
      tp: number;
      sl: number;
      notional: number;
      qty: number;
    };
  }>;
  risks: string[];
  learning_corner: Array<{
    term: string;
    simple: string;
  }>;
  disclaimer: string;
};

type AiApiPayload = {
  asOf?: string;
  response?: AiAssistantResponsePayload;
  message?: string;
};

const ALERT_COOLDOWN_MS = 120_000;
const fallbackExampleEntry = 71_429;
const SENTIMENT_TOOLTIP_ID = "assistant-sentiment-tooltip";
const GLOSSARY_ORDER: GlossaryTermId[] = [
  "spread",
  "mid",
  "fee",
  "slippage",
  "netEdge",
  "ma50",
  "deviation",
  "signal",
  "viability",
  "tp",
  "sl",
  "timeStop",
  "notional",
  "quantity",
  "bps"
];

const parseJson = async <T,>(response: Response): Promise<T> => (await response.json()) as T;

const formatPair = (pair: string): string => {
  const { base, quote } = splitInternalPair(pair);
  return `${base}-${quote}`;
};

const toBps = (value: number): number => value * 10_000;
const formatPct = (value: number, decimals = 3): string => `${roundTo(value * 100, decimals)}%`;
const formatPctPrecise = (value: number): string => `${roundTo(value * 100, 4)}%`;
const formatBps = (value: number): string => `${roundTo(toBps(value), 2)} bps`;
const formatMoney = (value: number): string => `${roundTo(value, 6)}`;

const normalizeDecimalInput = (value: string): string => value.trim().replace(",", ".");

const parseDecimalInput = (value: string): number => {
  const parsed = Number(normalizeDecimalInput(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const nowDateTimeLocal = (): string => {
  const date = new Date();
  const tzOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
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

const getSimpleReason = (suggestion: DeterministicSuggestion): string => {
  return suggestion.whyBullets[0] ?? suggestion.reasons[0] ?? "No clear setup yet.";
};

const getNextStep = (suggestion: DeterministicSuggestion): string => {
  if (suggestion.decision === "BUY") {
    return suggestion.entryPrice
      ? `Consider a limit buy near ${roundTo(suggestion.entryPrice, 6)} and pre-plan TP/SL.`
      : "Consider a limit entry only after validating spread and costs.";
  }

  if (suggestion.decision === "DO_NOT_TRADE") {
    return "Skip this setup for now and wait for cleaner conditions.";
  }

  return "Wait and monitor until deviation, spread, and net edge align.";
};

const glossaryTermContent = (id: GlossaryTermId, context: GlossaryContext): Omit<GlossaryTerm, "id"> => {
  const entry = context.referencePrice && context.referencePrice > 0 ? context.referencePrice : fallbackExampleEntry;
  const tp = entry * (1 + context.params.takeProfitPct);
  const sl = entry * (1 - context.params.stopLossPct);
  const spread = context.sampleSpreadPct ?? 0.001;
  const netEdge = context.sampleNetEdgePct;
  const deviation = context.sampleDeviationPct;

  switch (id) {
    case "spread":
      return {
        title: "Spread",
        definition: "Spread is the gap between the best ask and best bid price.",
        why: "A wider spread raises trading cost and can erase small edge trades.",
        example: `Example: spread is ${formatBps(spread)} (${formatPctPrecise(spread)}).`
      };
    case "mid":
      return {
        title: "Mid",
        definition: "Mid is the midpoint between bid and ask: (bid + ask) / 2.",
        why: "It is a neutral reference price used for spread and entry estimates.",
        example: `Example: if bid/ask are around ${roundTo(entry, 2)}, mid is near ${roundTo(entry, 2)}.`
      };
    case "fee":
      return {
        title: "Fee",
        definition: "Fee is the exchange cost paid for executing buy and sell orders.",
        why: "Fees directly reduce net edge and matter a lot for small TP strategies.",
        example: `Example: roundtrip fee assumption is ${formatPct(context.params.assumedFeePctRoundtrip)}.`
      };
    case "slippage":
      return {
        title: "Slippage",
        definition: "Slippage is the difference between expected and actual fill price.",
        why: "Higher slippage makes conservative setups less reliable.",
        example: `Example: roundtrip slippage assumption is ${formatPct(context.params.assumedSlippagePctRoundtrip)}.`
      };
    case "netEdge":
      return {
        title: "Net Edge",
        definition: "Net edge is expected profit after spread, fees, and slippage.",
        why: "It is the core viability gate for whether a setup is worth considering.",
        example: `Example: net edge is ${formatBps(netEdge)} (${formatPctPrecise(netEdge)}).`
      };
    case "ma50":
      return {
        title: "MA(50)",
        definition: "MA(50) is the average close price of the last 50 completed candles.",
        why: "It provides a stable baseline for mean-reversion entries.",
        example: `Example: with 5m candles, MA(50) covers about 250 minutes.`
      };
    case "deviation":
      return {
        title: "Deviation vs MA",
        definition: "Deviation is how far price is below MA: (MA - price) / MA.",
        why: "The signal uses this to detect meaningful pullbacks.",
        example: `Example: deviation is ${formatBps(deviation)} (${formatPctPrecise(deviation)}).`
      };
    case "signal":
      return {
        title: "Signal",
        definition: "Signal means the entry threshold condition is met for this strategy.",
        why: "Without signal, the setup should usually be ignored.",
        example: `Example: threshold is ${formatPct(context.params.entryThresholdPct)} below MA.`
      };
    case "viability":
      return {
        title: "Viability",
        definition: "Viability labels setup quality as VIABLE, MARGINAL, or NOT_VIABLE.",
        why: "It prevents trades when costs or constraints make expectancy too weak.",
        example: `Example: min viable net edge is ${formatPct(context.params.minNetEdgePct)}.`
      };
    case "tp":
      return {
        title: "TP",
        definition: "Take Profit (TP) is the planned exit price for profit.",
        why: "It defines expected upside and net edge.",
        example: `Example: at entry ${roundTo(entry, 2)}, TP is about ${roundTo(tp, 2)}.`
      };
    case "sl":
      return {
        title: "SL",
        definition: "Stop Loss (SL) is the planned exit price to cap downside.",
        why: "It controls risk per idea and prevents uncontrolled losses.",
        example: `Example: at entry ${roundTo(entry, 2)}, SL is about ${roundTo(sl, 2)}.`
      };
    case "timeStop":
      return {
        title: "Time Stop",
        definition: "Time stop exits a trade after max_hold_minutes if TP/SL is not hit.",
        why: "It avoids capital being tied up in stale trades.",
        example: `Example: current max hold is ${context.params.maxHoldMinutes} minutes.`
      };
    case "notional":
      return {
        title: "Notional",
        definition: "Notional is total order value in quote currency (price × quantity).",
        why: "It determines affordability and minimum order eligibility.",
        example: `Example: suggested notional is ${formatMoney(context.sampleNotional)}.`
      };
    case "quantity":
      return {
        title: "Quantity",
        definition: "Quantity is the amount of base asset you buy or sell.",
        why: "It must satisfy exchange minimum size and step rules.",
        example: `Example: suggested quantity is ${roundTo(context.sampleQty, 8)}.`
      };
    case "bps":
      return {
        title: "BPS",
        definition: "BPS means basis points: 1 bps = 0.01%.",
        why: "BPS makes small cost/edge values easier to compare.",
        example: `Example: sentiment is ${context.sentimentLabel} at ${formatPctPrecise(context.sentimentScorePct)}.`
      };
    default:
      return {
        title: "Term",
        definition: "Plain-language definition.",
        why: "Why it matters in this strategy.",
        example: "Example value."
      };
  }
};

const tooltipText = (
  key: TooltipKey,
  params: StrategyParams,
  referencePrice: number | null
): { title: string; lines: string[] } => {
  const entry = referencePrice && referencePrice > 0 ? referencePrice : fallbackExampleEntry;
  const tp = entry * (1 + params.takeProfitPct);
  const sl = entry * (1 - params.stopLossPct);

  switch (key) {
    case "takeProfitPct":
      return {
        title: "Take Profit",
        lines: [
          "Take Profit (TP). The target percentage gain where you plan to sell for profit.",
          `${params.takeProfitPct} = ${formatPct(params.takeProfitPct)}. If entry is ${roundTo(entry, 0)} then TP is ~${roundTo(tp, 0)}.`,
          "Higher TP = fewer wins but bigger wins. Lower TP = more wins but fees/spread matter more."
        ]
      };
    case "stopLossPct":
      return {
        title: "Stop Loss",
        lines: [
          "Stop Loss (SL). The percentage drop from entry where you exit to cap losses.",
          `${params.stopLossPct} = ${formatPct(params.stopLossPct)}. If entry is ${roundTo(entry, 0)} then SL is ~${roundTo(sl, 0)}.`,
          "Tighter SL = smaller losses but more stop-outs. Wider SL = fewer stop-outs but bigger losses."
        ]
      };
    case "maxHoldMinutes":
      return {
        title: "Max Hold Minutes",
        lines: [
          "Time stop. If TP/SL is not hit after this many minutes, you exit to avoid being stuck.",
          "Higher = you hold longer. Lower = you exit quicker and recycle capital."
        ]
      };
    case "timeframe":
      return {
        title: "Timeframe",
        lines: [
          "Candle timeframe used for indicators like the moving average.",
          "5m reacts faster; 15m is smoother but slower."
        ]
      };
    case "maPeriod":
      return {
        title: "MA Period",
        lines: [
          "Moving average length (number of candles). MA(50) on 5m uses ~250 minutes of history.",
          "Higher = smoother, slower signals. Lower = faster, noisier signals."
        ]
      };
    case "entryThresholdPct":
      return {
        title: "Entry Threshold",
        lines: [
          "How far price must be below the moving average to consider a BUY setup.",
          `${params.entryThresholdPct} = ${formatPct(params.entryThresholdPct)} below MA.`,
          "Higher threshold = fewer trades, stronger dips. Lower = more trades, weaker dips."
        ]
      };
    case "maxSpreadAllowedPct":
      return {
        title: "Max Spread Allowed",
        lines: [
          "Liquidity filter. If bid/ask spread is above this, do not trade.",
          `${params.maxSpreadAllowedPct} = ${formatPct(params.maxSpreadAllowedPct)}.`,
          "Lower = safer fills, fewer trades. Higher = more trades, worse execution risk."
        ]
      };
    case "assumedFeePctRoundtrip":
      return {
        title: "Assumed Fee (Roundtrip)",
        lines: [
          "Estimated total fees for buy + sell combined (roundtrip).",
          `${params.assumedFeePctRoundtrip} = ${formatPct(params.assumedFeePctRoundtrip)}.`,
          "If this estimate is too low, the assistant will overestimate profitability."
        ]
      };
    case "assumedSlippagePctRoundtrip":
      return {
        title: "Assumed Slippage (Roundtrip)",
        lines: [
          "Estimated slippage for buy + sell combined.",
          `${params.assumedSlippagePctRoundtrip} = ${formatPct(params.assumedSlippagePctRoundtrip)}.`,
          "Higher slippage makes small TP trades less viable."
        ]
      };
    case "minNetEdgePct":
      return {
        title: "Min Net Edge",
        lines: [
          "Minimum net profit margin required after costs to label a trade VIABLE.",
          "Net edge = TP − (spread + fees + slippage).",
          "Higher = stricter, safer. Lower = more trades, more cost sensitivity."
        ]
      };
    case "marginalNetEdgePct":
      return {
        title: "Marginal Net Edge",
        lines: [
          "Below this net edge, trades are NOT_VIABLE.",
          "Between marginal and min edge, trades are MARGINAL (watch but usually skip)."
        ]
      };
    default:
      return {
        title: "Parameter",
        lines: []
      };
  }
};

type ParameterFieldProps = {
  tooltipKey: TooltipKey;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  params: StrategyParams;
  referencePrice: number | null;
};

const tooltipIdFor = (key: TooltipKey): string => `assistant-tooltip-${key}`;
const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");

const buildTooltipHtml = (title: string, lines: string[]): string => {
  const escapedTitle = escapeHtml(title);
  const escapedLines = lines.map((line) => escapeHtml(line));
  return [`<strong>${escapedTitle}</strong>`, ...escapedLines].join("<br/>");
};

function TooltipInfoButton(input: { tooltipKey: TooltipKey; params: StrategyParams; referencePrice: number | null }) {
  const copy = tooltipText(input.tooltipKey, input.params, input.referencePrice);
  const tooltipId = tooltipIdFor(input.tooltipKey);
  const tooltipHtml = buildTooltipHtml(copy.title, copy.lines);

  return (
    <>
      <button
        type="button"
        className="info-button"
        data-tooltip-id={tooltipId}
        data-tooltip-html={tooltipHtml}
        aria-label={`Info for ${input.tooltipKey}`}
      >
        i
      </button>
      <Tooltip id={tooltipId} className="assistant-tooltip" place="top" />
    </>
  );
}

function TermHelpButton(input: {
  term: GlossaryTermId;
  onOpen: (term: GlossaryTermId) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="term-help-button"
      aria-label={input.label ? `Open glossary for ${input.label}` : `Open glossary for ${input.term}`}
      onClick={() => input.onOpen(input.term)}
    >
      ?
    </button>
  );
}

function ParameterField(input: ParameterFieldProps) {
  return (
    <label className="field">
      <span className="field-label-row">
        {input.label}
        <TooltipInfoButton tooltipKey={input.tooltipKey} params={input.params} referencePrice={input.referencePrice} />
      </span>
      <input type="text" inputMode="decimal" value={input.value} onChange={(event) => input.onChange(event.target.value)} />
      {input.hint ? <small>{input.hint}</small> : null}
    </label>
  );
}

export function TradingAssistantShell() {
  const [activeTab, setActiveTab] = useState<TabId>("ASSISTANT");
  const [assistantSubTab, setAssistantSubTab] = useState<AssistantSubTabId>("KRAKEN");
  const [learningMode, setLearningMode] = useState(true);
  const [activeGlossaryTerm, setActiveGlossaryTerm] = useState<GlossaryTermId | null>(null);
  const [tradingCapitalInput, setTradingCapitalInput] = useState<string>("1000");
  const [selectedPairs, setSelectedPairs] = useState<string[]>(DEFAULT_SELECTED_PAIRS);
  const [scannerWatchlist, setScannerWatchlist] = useState<string[]>(DEFAULT_ASSISTANT_PAIRS);
  const [scannerBalanceOverride, setScannerBalanceOverride] = useState<string>("");
  const [params, setParams] = useState<StrategyParams>(DEFAULT_STRATEGY_PARAMS);
  const [marketState, setMarketState] = useState<AssistantMarketResponse | null>(null);
  const [positionsState, setPositionsState] = useState<AssistantPositionsResponse | null>(null);
  const [liveTickers, setLiveTickers] = useState<Record<string, TickerSnapshot>>({});
  const [feedback, setFeedback] = useState("Assistant is running in deterministic mode.");
  const [manualOverride, setManualOverride] = useState(false);
  const [manualPair, setManualPair] = useState<string>(DEFAULT_SELECTED_PAIRS[0]);
  const [manualEntryPrice, setManualEntryPrice] = useState<string>("");
  const [manualQty, setManualQty] = useState<string>("");
  const [manualOpenedAt, setManualOpenedAt] = useState<string>("");
  const [executedDrafts, setExecutedDrafts] = useState<Record<string, ExecutedDraft>>({});
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiSimpleLanguage, setAiSimpleLanguage] = useState(true);
  const [aiIncludeRawCandles, setAiIncludeRawCandles] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAsOf, setAiAsOf] = useState<string | null>(null);
  const [aiResponse, setAiResponse] = useState<AiAssistantResponsePayload | null>(null);
  const [aiCooldownUntilMs, setAiCooldownUntilMs] = useState(0);
  const alertStateRef = useRef(new Map<string, { active: boolean; lastTriggeredAt: number }>());
  const glossaryRefs = useRef<Partial<Record<GlossaryTermId, HTMLElement | null>>>({});
  const wsSymbolsRef = useRef<Record<string, string>>({});

  const tradingCapital = parseDecimalInput(tradingCapitalInput);
  const selectedPairsKey = selectedPairs.join(",");

  const getMarketPair = (pair: string): AssistantMarketResponse["pairs"][number] | undefined =>
    marketState?.pairs.find((row) => row.pair === pair);

  const firstSelectedPair = selectedPairs[0] ?? "BTCUSDT";
  const referencePrice =
    liveTickers[firstSelectedPair]?.last ??
    getMarketPair(firstSelectedPair)?.ticker?.last ??
    null;

  useEffect(() => {
    setManualPair((current) => (selectedPairs.includes(current) ? current : selectedPairs[0] ?? "BTCUSDT"));
  }, [selectedPairs]);

  useEffect(() => {
    setManualOpenedAt((current) => (current ? current : nowDateTimeLocal()));
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("denied");
      return;
    }

    setNotificationPermission(Notification.permission);
  }, []);

  useEffect(() => {
    setLiveTickers((current) => {
      const next: Record<string, TickerSnapshot> = {};
      for (const pair of selectedPairs) {
        if (current[pair]) {
          next[pair] = current[pair];
        }
      }
      return next;
    });
  }, [selectedPairs]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const row of marketState?.pairs ?? []) {
      if (row.wsSymbol) {
        next[row.pair] = row.wsSymbol;
      }
    }
    wsSymbolsRef.current = next;
  }, [marketState]);

  useEffect(() => {
    let active = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket("wss://ws.kraken.com");

      ws.addEventListener("open", () => {
        if (!ws || ws.readyState !== WebSocket.OPEN || selectedPairs.length === 0) {
          return;
        }

        ws.send(
          JSON.stringify({
            event: "subscribe",
            pair: selectedPairs.map((pair) => wsSymbolsRef.current[pair] ?? toKrakenWsPair(pair)),
            subscription: {
              name: "ticker"
            }
          })
        );
      });

      ws.addEventListener("message", (event) => {
        let payload: unknown;

        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (!Array.isArray(payload) || payload.length < 4 || payload[2] !== "ticker") {
          return;
        }

        const rawPair = String(payload[3] ?? "");
        const pair = toInternalPair(rawPair);
        const data = payload[1] as {
          a?: string[];
          b?: string[];
          c?: string[];
          as?: string[];
          bs?: string[];
          o?: string[];
        };
        const ask = Number(data.a?.[0] ?? data.as?.[0] ?? 0);
        const bid = Number(data.b?.[0] ?? data.bs?.[0] ?? 0);
        const last = Number(data.c?.[0] ?? 0);
        const mid = (ask + bid) / 2;
        const spreadPct = mid > 0 ? (ask - bid) / mid : 0;
        const open = resolveOpenReference(data.o);

        if (!ask || !bid || !last) {
          return;
        }

        setLiveTickers((current) => ({
          ...current,
          [pair]: {
            pair,
            ask,
            bid,
            last,
            spreadPct,
            openReferencePrice: open.openReferencePrice,
            openReferenceLabel: open.openReferenceLabel,
            timestamp: new Date().toISOString()
          }
        }));
      });

      ws.addEventListener("close", () => {
        if (!active) {
          return;
        }

        reconnectTimer = setTimeout(connect, 1500);
      });

      ws.addEventListener("error", () => {
        ws?.close();
      });
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      ws?.close();
    };
  }, [selectedPairs, selectedPairsKey]);

  useEffect(() => {
    let active = true;

    const fetchMarket = async () => {
      try {
        const query = new URLSearchParams({
          pairs: selectedPairs.join(","),
          timeframe: params.timeframe,
          limit: String(Math.max(120, params.maPeriod + 20))
        });
        const response = await fetch(`/api/assistant/market?${query.toString()}`, {
          cache: "no-store"
        });
        const payload = await parseJson<MarketApiPayload>(response);

        if (!response.ok || !payload.state) {
          throw new Error(payload.message ?? "Unable to fetch market snapshot.");
        }

        if (active) {
          setMarketState(payload.state);
        }
      } catch (error) {
        if (active) {
          setFeedback(error instanceof Error ? error.message : "Market feed unavailable.");
        }
      }
    };

    void fetchMarket();
    const interval = setInterval(() => {
      void fetchMarket();
    }, 20_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [selectedPairs, selectedPairsKey, params.timeframe, params.maPeriod]);

  useEffect(() => {
    let active = true;

    const fetchPositions = async () => {
      try {
        const query = new URLSearchParams({
          pairs: selectedPairs.join(",")
        });
        const response = await fetch(`/api/assistant/positions?${query.toString()}`, {
          cache: "no-store"
        });
        const payload = await parseJson<PositionsApiPayload>(response);

        if (!payload.state) {
          throw new Error(payload.message ?? "Unable to fetch position state.");
        }

        if (active) {
          setPositionsState(payload.state);
        }
      } catch (error) {
        if (active) {
          setFeedback(error instanceof Error ? error.message : "Position monitor unavailable.");
        }
      }
    };

    void fetchPositions();
    const interval = setInterval(() => {
      void fetchPositions();
    }, 60_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [selectedPairs, selectedPairsKey]);

  const suggestions = selectedPairs.map((pair) => {
    const market = getMarketPair(pair);
    const ticker = liveTickers[pair] ?? market?.ticker ?? null;

    return computeDeterministicSuggestion({
      pair,
      tradingCapital,
      params,
      ticker,
      candles: market?.candles ?? [],
      instrument: market?.instrument ?? null
    });
  });

  const quoteAsset = splitInternalPair(firstSelectedPair).quote;
  const detectedQuoteBalance =
    positionsState?.quoteBalances.find((balance) => balance.asset.toUpperCase() === quoteAsset.toUpperCase())?.available ?? null;
  const portfolioRows = positionsState?.portfolio ?? [];
  const scannerBalance = scannerBalanceOverride.trim()
    ? parseDecimalInput(scannerBalanceOverride)
    : detectedQuoteBalance && detectedQuoteBalance > 0
      ? detectedQuoteBalance
      : 30;
  const aiCooldownRemainingSec = Math.max(0, Math.ceil((aiCooldownUntilMs - Date.now()) / 1000));
  const aiSendDisabled = aiLoading || !aiQuestion.trim() || aiCooldownRemainingSec > 0;

  const scannerSuggestions = scannerWatchlist.map((pair) => {
    const market = getMarketPair(pair);
    const ticker = liveTickers[pair] ?? market?.ticker ?? null;

    return computeDeterministicSuggestion({
      pair,
      tradingCapital: scannerBalance,
      params,
      ticker,
      candles: market?.candles ?? [],
      instrument: market?.instrument ?? null
    });
  });

  const sentiment = useMemo(() => {
    return computeMarketSentiment(
      selectedPairs.map((pair) => {
        const market = marketState?.pairs.find((row) => row.pair === pair);
        const ticker = liveTickers[pair] ?? market?.ticker ?? null;

        return {
          pair,
          lastPrice: ticker?.last ?? 0,
          openReferencePrice: ticker?.openReferencePrice ?? null,
          openReferenceLabel: ticker?.openReferenceLabel ?? null
        };
      })
    );
  }, [selectedPairs, liveTickers, marketState]);

  const scannerTop = useMemo(
    () =>
      rankScannerOpportunities({
        suggestions: scannerSuggestions,
        availableQuoteBalance: scannerBalance,
        sentiment: sentiment.classification,
        limit: 3
      }),
    [scannerSuggestions, scannerBalance, sentiment.classification]
  );

  const primarySuggestion = suggestions[0] ?? null;
  const glossaryContext: GlossaryContext = {
    referencePrice,
    sampleSpreadPct: primarySuggestion?.cost.spreadPct ?? null,
    sampleNetEdgePct: primarySuggestion?.cost.netEdgePct ?? params.takeProfitPct - params.assumedFeePctRoundtrip,
    sampleDeviationPct: primarySuggestion?.deviationPct ?? params.entryThresholdPct,
    sampleNotional: primarySuggestion?.suggestedNotional ?? scannerBalance,
    sampleQty: primarySuggestion?.suggestedQty ?? 0,
    params,
    sentimentLabel: sentiment.label,
    sentimentScorePct: sentiment.scorePct
  };
  const glossaryTerms: GlossaryTerm[] = GLOSSARY_ORDER.map((id) => ({
    id,
    ...glossaryTermContent(id, glossaryContext)
  }));

  const manualQtyNumber = parseDecimalInput(manualQty);
  const manualEntryPriceNumber = parseDecimalInput(manualEntryPrice);
  const parsedManualOpenedAt = manualOpenedAt ? Date.parse(manualOpenedAt) : Number.NaN;
  const manualOpenedAtIso = Number.isFinite(parsedManualOpenedAt)
    ? new Date(parsedManualOpenedAt).toISOString()
    : new Date().toISOString();
  const manualPosition: MonitoredPosition | null =
    !manualPair || manualQtyNumber <= 0 || manualEntryPriceNumber <= 0
      ? null
      : {
          pair: manualPair,
          qty: manualQtyNumber,
          entryPrice: manualEntryPriceNumber,
          openedAt: manualOpenedAtIso,
          source: "MANUAL"
        };

  const autoPositions = positionsState?.positions.filter((position) => selectedPairs.includes(position.pair)) ?? [];
  const basePositions = manualOverride
    ? manualPosition
      ? [manualPosition]
      : []
    : autoPositions.length > 0
      ? autoPositions
      : manualPosition
        ? [manualPosition]
        : [];

  const executedPositions: MonitoredPosition[] = [];
  for (const pair of selectedPairs) {
    const draft = executedDrafts[pair];
    if (!draft?.marked) {
      continue;
    }

    const entryPrice = parseDecimalInput(draft.entryPrice);
    const qty = parseDecimalInput(draft.qty);
    const openedAtMs = Date.parse(draft.openedAt);
    if (entryPrice <= 0 || qty <= 0 || !Number.isFinite(openedAtMs)) {
      continue;
    }

    executedPositions.push({
      pair,
      qty,
      entryPrice,
      openedAt: new Date(openedAtMs).toISOString(),
      source: "MARKED_EXECUTED"
    });
  }

  const monitoredMap = new Map<string, MonitoredPosition>();
  for (const position of basePositions) {
    monitoredMap.set(position.pair, position);
  }
  for (const position of executedPositions) {
    if (!monitoredMap.has(position.pair)) {
      monitoredMap.set(position.pair, position);
    }
  }
  const monitoredPositions = Array.from(monitoredMap.values());
  const positionByPair = new Map<string, MonitoredPosition>();
  for (const position of monitoredPositions) {
    positionByPair.set(position.pair, position);
  }

  useEffect(() => {
    const now = Date.now();
    const nextAlerts: AlertItem[] = [];

    const maybeTrigger = (pair: string, type: AlertType, condition: boolean, message: string) => {
      const key = `${pair}:${type}`;
      const previous = alertStateRef.current.get(key) ?? {
        active: false,
        lastTriggeredAt: 0
      };

      if (!condition) {
        if (previous.active) {
          alertStateRef.current.set(key, {
            ...previous,
            active: false
          });
        }
        return;
      }

      const canTrigger = !previous.active || now - previous.lastTriggeredAt >= ALERT_COOLDOWN_MS;
      alertStateRef.current.set(key, {
        active: true,
        lastTriggeredAt: canTrigger ? now : previous.lastTriggeredAt
      });

      if (!canTrigger) {
        return;
      }

      const alertItem: AlertItem = {
        id: `${key}:${now}`,
        type,
        pair,
        message,
        at: new Date().toISOString()
      };
      nextAlerts.push(alertItem);

      if (notificationPermission === "granted" && typeof Notification !== "undefined") {
        new Notification(`Fiat Buffer Assistant: ${type}`, {
          body: `${formatPair(pair)}: ${message}`
        });
      }
    };

    for (const position of monitoredPositions) {
      const market = marketState?.pairs.find((row) => row.pair === position.pair);
      const ticker = liveTickers[position.pair] ?? market?.ticker ?? null;

      if (!ticker || position.entryPrice <= 0) {
        continue;
      }

      const tpPrice = position.entryPrice * (1 + params.takeProfitPct);
      const slPrice = position.entryPrice * (1 - params.stopLossPct);
      const timeStopHit = now - Date.parse(position.openedAt) >= params.maxHoldMinutes * 60_000;

      maybeTrigger(
        position.pair,
        "TAKE_PROFIT",
        ticker.last >= tpPrice,
        `Take-profit condition met at ${roundTo(ticker.last, 6)} (target ${roundTo(tpPrice, 6)}).`
      );
      maybeTrigger(
        position.pair,
        "STOP_LOSS",
        ticker.last <= slPrice,
        `Stop-loss condition met at ${roundTo(ticker.last, 6)} (trigger ${roundTo(slPrice, 6)}).`
      );
      maybeTrigger(
        position.pair,
        "TIME_STOP",
        timeStopHit,
        `Time stop reached (${params.maxHoldMinutes} minutes).`
      );
      maybeTrigger(
        position.pair,
        "SPREAD_WARNING",
        ticker.spreadPct > params.maxSpreadAllowedPct * 2,
        `Spread warning: ${formatPct(ticker.spreadPct, 4)} is abnormally high.`
      );
    }

    if (nextAlerts.length > 0) {
      setAlerts((current) => [...nextAlerts, ...current].slice(0, 30));
    }
  }, [
    monitoredPositions,
    liveTickers,
    marketState,
    params.takeProfitPct,
    params.stopLossPct,
    params.maxHoldMinutes,
    params.maxSpreadAllowedPct,
    notificationPermission
  ]);

  useEffect(() => {
    if (activeTab !== "GLOSSARY" || !activeGlossaryTerm) {
      return;
    }

    const node = glossaryRefs.current[activeGlossaryTerm];
    if (!node) {
      return;
    }

    requestAnimationFrame(() => {
      node.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    });
  }, [activeTab, activeGlossaryTerm]);

  const openGlossaryTerm = (term: GlossaryTermId) => {
    setActiveTab("GLOSSARY");
    setActiveGlossaryTerm(term);
  };

  const togglePair = (pair: AssistantPair) => {
    setSelectedPairs((current) => {
      if (current.includes(pair)) {
        if (current.length === 1) {
          return current;
        }

        return current.filter((item) => item !== pair);
      }

      if (current.length >= 3) {
        return current;
      }

      return [...current, pair];
    });
  };

  const toggleScannerPair = (pair: AssistantPair) => {
    setScannerWatchlist((current) => {
      if (current.includes(pair)) {
        if (current.length === 1) {
          return current;
        }

        return current.filter((item) => item !== pair);
      }

      if (current.length >= 10) {
        return current;
      }

      return [...current, pair];
    });
  };

  const requestNotifications = async () => {
    if (typeof Notification === "undefined") {
      setFeedback("Browser notifications are not supported in this environment.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  const updateParam = <K extends keyof StrategyParams>(key: K, value: StrategyParams[K]) => {
    setParams((current) => ({
      ...current,
      [key]: value
    }));
  };

  const resetToDefaults = () => {
    setParams(DEFAULT_STRATEGY_PARAMS);
    setFeedback("Parameters reset to safe defaults.");
  };

  const pctHint = (value: number): string => `${formatPct(value, 3)} • ${formatBps(value)}`;

  const updateExecuted = (pair: string, update: Partial<ExecutedDraft>) => {
    setExecutedDrafts((current) => ({
      ...current,
      [pair]: Object.assign(
        {
          marked: false,
          entryPrice: "",
          qty: "",
          openedAt: nowDateTimeLocal()
        },
        current[pair] ?? {},
        update
      )
    }));
  };

  const markExecuted = (pair: string, suggestionEntry: number | null, suggestionQty: number) => {
    updateExecuted(pair, {
      marked: true,
      entryPrice: suggestionEntry ? String(roundTo(suggestionEntry, 8)) : "",
      qty: suggestionQty > 0 ? String(roundTo(suggestionQty, 8)) : "",
      openedAt: nowDateTimeLocal()
    });
  };

  const applyScannerPair = (pair: string) => {
    setSelectedPairs([pair]);
    setFeedback(`Scanner pair ${formatPair(pair)} selected in Assistant.`);
  };

  const clearAiAssistant = () => {
    setAiQuestion("");
    setAiError(null);
    setAiAsOf(null);
    setAiResponse(null);
  };

  const sendAiAssistant = async () => {
    if (aiSendDisabled) {
      return;
    }

    setAiLoading(true);
    setAiError(null);

    try {
      const response = await fetch("/api/assistant/ai", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question: aiQuestion.trim(),
          simpleLanguage: aiSimpleLanguage,
          includeRawCandles: aiIncludeRawCandles
        })
      });
      const payload = await parseJson<AiApiPayload>(response);

      if (!response.ok || !payload.response) {
        throw new Error(payload.message ?? "AI Assistant could not generate a response.");
      }

      setAiResponse(payload.response);
      setAiAsOf(payload.asOf ?? null);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI Assistant request failed.");
    } finally {
      setAiLoading(false);
      setAiCooldownUntilMs(Date.now() + 5000);
    }
  };

  const sentimentTooltipHtml = buildTooltipHtml("Market Sentiment", [
    "score = median((last - open_reference) / open_reference) across selected pairs.",
    "Risk-off if score <= -1.0%. Risk-on if score >= +1.0%. Otherwise Neutral.",
    `Reference used: ${sentiment.referenceLabel}.`
  ]);

  return (
    <main className="page-shell">
      <div className="page-frame">
        <section className="hero">
          <h1>Fiat Buffer Trading Assistant</h1>
          <p>Deterministic trade suggestions and read-only autopilot monitoring for manually placed Kraken trades.</p>
          <div className="badge-row">
            <span className="badge">Mode: Manual Autopilot</span>
            <span className="badge">Kraken Orders: Read-only</span>
            <span className="badge alert">AI suggestion: coming later</span>
          </div>
        </section>

        <section className="tabs-row">
          <button className={`tab-button ${activeTab === "ASSISTANT" ? "active" : ""}`} onClick={() => setActiveTab("ASSISTANT")}>
            Assistant
          </button>
          <button className={`tab-button ${activeTab === "AUTOMATION" ? "active" : ""}`} onClick={() => setActiveTab("AUTOMATION")}>
            System Automation
          </button>
          <button className={`tab-button ${activeTab === "GLOSSARY" ? "active" : ""}`} onClick={() => setActiveTab("GLOSSARY")}>
            Glossary
          </button>
        </section>

        {activeTab === "ASSISTANT" ? (
          <>
            <section className="tabs-row assistant-subtabs">
              <button
                className={`tab-button ${assistantSubTab === "KRAKEN" ? "active" : ""}`}
                onClick={() => setAssistantSubTab("KRAKEN")}
              >
                Kraken
              </button>
            </section>

            <section className="panel">
              <div className="panel-inner">
                <h2>Assistant Overview</h2>
                <div className="grid-two">
                  <article className="panel">
                    <div className="panel-inner">
                      <h3>Inputs</h3>
                      <div className="grid-four">
                        <label className="field">
                          <span>Trading Capital (TC)</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={tradingCapitalInput}
                            onChange={(event) => setTradingCapitalInput(event.target.value)}
                          />
                          <small>Quote currency: {quoteAsset}</small>
                        </label>

                        <div className="field">
                          <span>Pair selector (1-3)</span>
                          <div className="checklist">
                            {DEFAULT_ASSISTANT_PAIRS.map((pair) => (
                              <label key={pair} className="check-row">
                                <input type="checkbox" checked={selectedPairs.includes(pair)} onChange={() => togglePair(pair)} />
                                <span>{formatPair(pair)}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="field">
                          <span>Notifications</span>
                          <button className="action-button" onClick={requestNotifications}>
                            Enable Browser Notifications
                          </button>
                          <small>Permission: {notificationPermission}</small>
                        </div>

                        <label className="field">
                          <span>Learning Mode</span>
                          <select value={learningMode ? "ON" : "OFF"} onChange={(event) => setLearningMode(event.target.value === "ON")}>
                            <option value="ON">On</option>
                            <option value="OFF">Off</option>
                          </select>
                          <small>{learningMode ? "Simplified card view with progressive detail." : "Full detailed card view."}</small>
                        </label>
                      </div>
                    </div>
                  </article>

                  <article className="panel">
                    <div className="panel-inner">
                      <div className="grid-two">
                        <article className="panel">
                          <div className="panel-inner">
                            <div className="card-head">
                              <h3>Market Sentiment</h3>
                              <button
                                type="button"
                                className="info-button"
                                data-tooltip-id={SENTIMENT_TOOLTIP_ID}
                                data-tooltip-html={sentimentTooltipHtml}
                                aria-label="Sentiment calculation details"
                              >
                                i
                              </button>
                              <Tooltip id={SENTIMENT_TOOLTIP_ID} className="assistant-tooltip" place="top" />
                            </div>
                            <div className={`sentiment-pill ${sentiment.color.toLowerCase()}`}>{sentiment.label}</div>
                            <div className="kpi-value mono">
                              {formatPctPrecise(sentiment.scorePct)} ({formatBps(sentiment.scorePct)})
                            </div>
                            <div className="subtle mono">
                              Basket size: {sentiment.sampleSize} • Reference: {sentiment.referenceLabel}
                            </div>
                          </div>
                        </article>

                        <article className="panel">
                          <div className="panel-inner">
                            <h3>Latest Activity</h3>
                            {!positionsState?.authenticated ? (
                              <div className="warning">Not connected. Add Kraken API keys for read-only order/trade monitoring.</div>
                            ) : !positionsState.latestActivity ? (
                              <div className="subtle">No recent activity.</div>
                            ) : (
                              <div className="mini-grid mono">
                                <div>Type: {positionsState.latestActivity.type.toUpperCase()}</div>
                                <div>Side: {positionsState.latestActivity.side}</div>
                                <div>Pair: {formatPair(positionsState.latestActivity.pair)}</div>
                                <div>Price: {roundTo(positionsState.latestActivity.price, 8)}</div>
                                <div>Qty: {roundTo(positionsState.latestActivity.qty, 8)}</div>
                                <div>Status: {positionsState.latestActivity.status}</div>
                                <div>Time: {positionsState.latestActivity.timestamp}</div>
                                <div>Source: {positionsState.latestActivity.source}</div>
                              </div>
                            )}
                          </div>
                        </article>
                      </div>
                    </div>
                  </article>
                </div>

                <article className="panel">
                  <div className="panel-inner">
                    <div className="card-head">
                      <h3>Kraken Portfolio</h3>
                      <span className="subtle mono">
                        Refreshed {positionsState?.checkedAt ? new Date(positionsState.checkedAt).toLocaleTimeString() : "n/a"} •{" "}
                        {positionsState?.cached.hit ? "cache hit" : "live"}
                      </span>
                    </div>
                    {!positionsState?.authenticated ? (
                      <div className="warning">Not connected. Add Kraken API keys to read your live portfolio balances.</div>
                    ) : portfolioRows.length === 0 ? (
                      <div className="subtle">No positive balances found in the Kraken account.</div>
                    ) : (
                      <div className="table-wrap">
                        <table className="kv-table portfolio-table mono">
                          <thead>
                            <tr>
                              <th>Asset</th>
                              <th>Available</th>
                            </tr>
                          </thead>
                          <tbody>
                            {portfolioRows.map((row) => (
                              <tr key={`portfolio-${row.asset}`}>
                                <td>{row.asset}</td>
                                <td>{roundTo(row.available, 8)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </article>
              </div>
            </section>

            <section className="panel">
              <div className="panel-inner">
                <div className="card-head">
                  <h2>AI Assistant</h2>
                  <div className="ai-actions">
                    <button className="action-button secondary" onClick={clearAiAssistant}>
                      Clear
                    </button>
                  </div>
                </div>

                <label className="field">
                  <span>Ask a question</span>
                  <textarea
                    className="ai-input"
                    value={aiQuestion}
                    placeholder="Example: Which pairs are interesting to watch today and why?"
                    onChange={(event) => setAiQuestion(event.target.value)}
                  />
                </label>

                <div className="grid-three">
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={aiSimpleLanguage}
                      onChange={(event) => setAiSimpleLanguage(event.target.checked)}
                    />
                    <span>Use simple language</span>
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={aiIncludeRawCandles}
                      onChange={(event) => setAiIncludeRawCandles(event.target.checked)}
                    />
                    <span>Include raw candles</span>
                  </label>
                  <div className="field">
                    <button className="action-button primary" disabled={aiSendDisabled} onClick={sendAiAssistant}>
                      {aiLoading ? "Thinking..." : aiCooldownRemainingSec > 0 ? `Wait ${aiCooldownRemainingSec}s` : "Send"}
                    </button>
                  </div>
                </div>

                {aiAsOf ? <div className="subtle mono">Snapshot timestamp: {aiAsOf}</div> : null}
                {aiError ? <div className="warning">{aiError}</div> : null}

                {aiResponse ? (
                  <div className="ai-output">
                    <h3>Answer</h3>
                    <p>{aiResponse.answer}</p>

                    <h3>Top candidates to consider</h3>
                    {aiResponse.top_candidates.length === 0 ? (
                      <div className="subtle">No candidates returned.</div>
                    ) : (
                      <div className="grid-two">
                        {aiResponse.top_candidates.map((candidate) => (
                          <article key={`ai-${candidate.pair}`} className="panel">
                            <div className="panel-inner">
                              <div className="card-head">
                                <h4>{formatPair(candidate.pair)}</h4>
                                <span className="badge">{candidate.status}</span>
                              </div>
                              <div className="mini-grid mono">
                                <div>{candidate.why_interesting}</div>
                                <div>Spread: {roundTo(candidate.numbers.spread_bps, 2)} bps</div>
                                <div>Deviation: {roundTo(candidate.numbers.deviation_bps, 2)} bps</div>
                                <div>Net edge: {roundTo(candidate.numbers.net_edge_bps, 2)} bps</div>
                                <div>Min-order OK: {candidate.feasibility.min_order_ok ? "Yes" : "No"}</div>
                                <div>Feasibility notes: {candidate.feasibility.notes.join(" | ")}</div>
                                <div>
                                  Simulate only: entry {roundTo(candidate.if_user_wants_to_simulate.entry, 8)}, tp{" "}
                                  {roundTo(candidate.if_user_wants_to_simulate.tp, 8)}, sl{" "}
                                  {roundTo(candidate.if_user_wants_to_simulate.sl, 8)}
                                </div>
                                <div>
                                  Notional {roundTo(candidate.if_user_wants_to_simulate.notional, 8)}, qty{" "}
                                  {roundTo(candidate.if_user_wants_to_simulate.qty, 8)}
                                </div>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}

                    <h3>What could go wrong</h3>
                    <ul className="flat-list">
                      {aiResponse.risks.map((risk) => (
                        <li key={risk}>{risk}</li>
                      ))}
                    </ul>

                    <h3>Learning corner</h3>
                    <ul className="flat-list">
                      {aiResponse.learning_corner.map((item) => (
                        <li key={item.term}>
                          <strong>{item.term}:</strong> {item.simple}
                        </li>
                      ))}
                    </ul>

                    <div className="subtle">{aiResponse.disclaimer}</div>
                  </div>
                ) : (
                  <div className="subtle">Ask a freeform question to get a grounded, educational summary from the current snapshot.</div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-inner">
                <div className="card-head">
                  <h2>Strategy Parameters</h2>
                  <button className="action-button" onClick={resetToDefaults}>
                    Reset to safe defaults
                  </button>
                </div>
                <div className="grid-four">
                  <ParameterField
                    tooltipKey="takeProfitPct"
                    label="take_profit_pct"
                    value={String(params.takeProfitPct)}
                    onChange={(value) => updateParam("takeProfitPct", parseDecimalInput(value))}
                    hint={pctHint(params.takeProfitPct)}
                    params={params}
                    referencePrice={referencePrice}
                  />
                  <ParameterField
                    tooltipKey="stopLossPct"
                    label="stop_loss_pct"
                    value={String(params.stopLossPct)}
                    onChange={(value) => updateParam("stopLossPct", parseDecimalInput(value))}
                    hint={pctHint(params.stopLossPct)}
                    params={params}
                    referencePrice={referencePrice}
                  />
                  <ParameterField
                    tooltipKey="maxHoldMinutes"
                    label="max_hold_minutes"
                    value={String(params.maxHoldMinutes)}
                    onChange={(value) => updateParam("maxHoldMinutes", Math.max(1, Math.trunc(parseDecimalInput(value))))}
                    params={params}
                    referencePrice={referencePrice}
                  />
                  <label className="field">
                    <span className="field-label-row">
                      timeframe
                      <TooltipInfoButton tooltipKey="timeframe" params={params} referencePrice={referencePrice} />
                    </span>
                    <select value={params.timeframe} onChange={(event) => updateParam("timeframe", event.target.value === "5m" ? "5m" : "5m")}>
                      <option value="5m">5m</option>
                    </select>
                  </label>
                  <ParameterField
                    tooltipKey="maPeriod"
                    label="ma_period"
                    value={String(params.maPeriod)}
                    onChange={(value) => updateParam("maPeriod", Math.max(5, Math.trunc(parseDecimalInput(value))))}
                    params={params}
                    referencePrice={referencePrice}
                  />
                  <ParameterField
                    tooltipKey="entryThresholdPct"
                    label="entry_threshold_pct"
                    value={String(params.entryThresholdPct)}
                    onChange={(value) => updateParam("entryThresholdPct", parseDecimalInput(value))}
                    hint={pctHint(params.entryThresholdPct)}
                    params={params}
                    referencePrice={referencePrice}
                  />
                  <ParameterField
                    tooltipKey="maxSpreadAllowedPct"
                    label="max_spread_allowed_pct"
                    value={String(params.maxSpreadAllowedPct)}
                    onChange={(value) => updateParam("maxSpreadAllowedPct", parseDecimalInput(value))}
                    hint={pctHint(params.maxSpreadAllowedPct)}
                    params={params}
                    referencePrice={referencePrice}
                  />
                  <ParameterField
                    tooltipKey="assumedFeePctRoundtrip"
                    label="assumed_fee_pct_roundtrip"
                    value={String(params.assumedFeePctRoundtrip)}
                    onChange={(value) => updateParam("assumedFeePctRoundtrip", parseDecimalInput(value))}
                    hint={pctHint(params.assumedFeePctRoundtrip)}
                    params={params}
                    referencePrice={referencePrice}
                  />
                  <ParameterField
                    tooltipKey="assumedSlippagePctRoundtrip"
                    label="assumed_slippage_pct_roundtrip"
                    value={String(params.assumedSlippagePctRoundtrip)}
                    onChange={(value) => updateParam("assumedSlippagePctRoundtrip", parseDecimalInput(value))}
                    hint={pctHint(params.assumedSlippagePctRoundtrip)}
                    params={params}
                    referencePrice={referencePrice}
                  />
                  <ParameterField
                    tooltipKey="minNetEdgePct"
                    label="min_net_edge_pct"
                    value={String(params.minNetEdgePct)}
                    onChange={(value) => updateParam("minNetEdgePct", parseDecimalInput(value))}
                    hint={pctHint(params.minNetEdgePct)}
                    params={params}
                    referencePrice={referencePrice}
                  />
                  <ParameterField
                    tooltipKey="marginalNetEdgePct"
                    label="marginal_net_edge_pct"
                    value={String(params.marginalNetEdgePct)}
                    onChange={(value) => updateParam("marginalNetEdgePct", parseDecimalInput(value))}
                    hint={pctHint(params.marginalNetEdgePct)}
                    params={params}
                    referencePrice={referencePrice}
                  />
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-inner">
                <div className="card-head">
                  <h2>Deterministic Suggestions</h2>
                  {learningMode ? <span className="badge">Learning Mode</span> : null}
                </div>
                <div className="subtle mono">{feedback}</div>
                <div className="grid-two">
                  {suggestions.map((suggestion) => {
                    const market = getMarketPair(suggestion.pair);
                    const ticker = liveTickers[suggestion.pair] ?? market?.ticker ?? null;
                    const currentPosition = positionByPair.get(suggestion.pair);
                    const deadlineMs = currentPosition
                      ? Date.parse(currentPosition.openedAt) + params.maxHoldMinutes * 60_000
                      : null;
                    const remainingMinutes = deadlineMs ? Math.max(0, (deadlineMs - Date.now()) / 60_000) : null;
                    const decisionLabel =
                      suggestion.decision === "DO_NOT_TRADE"
                        ? "DO NOT TRADE"
                        : suggestion.decision;
                    const decisionClass =
                      suggestion.decision === "BUY"
                        ? "decision-buy"
                        : suggestion.decision === "DO_NOT_TRADE"
                          ? "decision-no-trade"
                          : "decision-wait";
                    const why = suggestion.whyBullets.length
                      ? suggestion.whyBullets.slice(0, 3)
                      : suggestion.reasons.slice(0, 3);
                    const checklist = [
                      {
                        label: `Net edge must be ≥ min_net_edge_pct (${formatPct(suggestion.buyChecklist.netEdge.requiredPct, 3)})`,
                        met: suggestion.buyChecklist.netEdge.met,
                        detail: `Current: ${formatPctPrecise(suggestion.buyChecklist.netEdge.currentPct)}`
                      },
                      {
                        label: `Spread must be ≤ max_spread_allowed_pct (${formatPct(suggestion.buyChecklist.spread.requiredPct, 3)})`,
                        met: suggestion.buyChecklist.spread.met,
                        detail: `Current: ${formatPctPrecise(suggestion.buyChecklist.spread.currentPct)}`
                      },
                      {
                        label: `Deviation must be ≥ entry_threshold_pct (${formatPct(suggestion.buyChecklist.deviation.requiredPct, 3)})`,
                        met: suggestion.buyChecklist.deviation.met,
                        detail: `Current: ${formatPctPrecise(suggestion.buyChecklist.deviation.currentPct)}`
                      }
                    ];
                    const draft = executedDrafts[suggestion.pair] ?? {
                      marked: false,
                      entryPrice: "",
                      qty: "",
                      openedAt: nowDateTimeLocal()
                    };

                    const advancedSections = (
                      <>
                        <div className="mini-grid mono">
                          <div>
                            Viability <TermHelpButton term="viability" onOpen={openGlossaryTerm} label="viability" />: {suggestion.viability}
                          </div>
                          <div>
                            Signal <TermHelpButton term="signal" onOpen={openGlossaryTerm} label="signal" />:{" "}
                            {suggestion.signalDetected ? "YES" : "NO"}
                          </div>
                          <div>
                            Deviation vs MA <TermHelpButton term="deviation" onOpen={openGlossaryTerm} label="deviation vs MA" />:{" "}
                            {formatPctPrecise(suggestion.deviationPct)}
                          </div>
                        </div>

                        <h4>Why</h4>
                        <ul className="flat-list mono">
                          {why.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>

                        <h4>What Needs To Change To BUY</h4>
                        <ul className="flat-list mono">
                          {checklist.map((item) => (
                            <li key={item.label} className={item.met ? "check-pass" : "check-fail"}>
                              {item.met ? "✓" : "•"} {item.label} ({item.detail})
                            </li>
                          ))}
                        </ul>

                        <details className="entry-details">
                          <summary>If you decide to enter anyway</summary>
                          <div className="mini-grid mono">
                            <div>Suggested entry type: {suggestion.entryType}</div>
                            <div>
                              Entry price: {suggestion.entryPrice ?? "n/a"} <TermHelpButton term="mid" onOpen={openGlossaryTerm} label="mid" />
                            </div>
                            <div>
                              TP price: {suggestion.tpPrice ?? "n/a"} <TermHelpButton term="tp" onOpen={openGlossaryTerm} label="TP" />
                            </div>
                            <div>
                              SL price: {suggestion.slPrice ?? "n/a"} <TermHelpButton term="sl" onOpen={openGlossaryTerm} label="SL" />
                            </div>
                            <div>
                              Suggested notional: {roundTo(suggestion.suggestedNotional, 6)}{" "}
                              <TermHelpButton term="notional" onOpen={openGlossaryTerm} label="notional" />
                            </div>
                            <div>
                              Suggested qty: {roundTo(suggestion.suggestedQty, 8)}{" "}
                              <TermHelpButton term="quantity" onOpen={openGlossaryTerm} label="quantity" />
                            </div>
                          </div>

                          <div className="execution-mark">
                            <button className="action-button" onClick={() => markExecuted(suggestion.pair, suggestion.entryPrice, suggestion.suggestedQty)}>
                              Mark Executed
                            </button>
                            {draft.marked ? (
                              <button className="action-button danger" onClick={() => updateExecuted(suggestion.pair, { marked: false })}>
                                Clear Executed Mark
                              </button>
                            ) : null}
                          </div>

                          {draft.marked ? (
                            <div className="grid-three">
                              <label className="field">
                                <span>Executed entry price</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={draft.entryPrice}
                                  onChange={(event) => updateExecuted(suggestion.pair, { entryPrice: event.target.value })}
                                />
                              </label>
                              <label className="field">
                                <span>Executed qty</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={draft.qty}
                                  onChange={(event) => updateExecuted(suggestion.pair, { qty: event.target.value })}
                                />
                              </label>
                              <label className="field">
                                <span>Entry time</span>
                                <input
                                  type="datetime-local"
                                  value={draft.openedAt}
                                  onChange={(event) => updateExecuted(suggestion.pair, { openedAt: event.target.value })}
                                />
                              </label>
                            </div>
                          ) : null}

                          {currentPosition && deadlineMs ? (
                            <div className="warning">
                              Time stop <TermHelpButton term="timeStop" onOpen={openGlossaryTerm} label="time stop" /> deadline:{" "}
                              {new Date(deadlineMs).toLocaleString()}. Minutes remaining: {roundTo(remainingMinutes ?? 0, 2)}.
                            </div>
                          ) : null}
                        </details>

                        <h4>Cost Breakdown</h4>
                        <div className="mini-grid mono">
                          <div>
                            Spread <TermHelpButton term="spread" onOpen={openGlossaryTerm} label="spread" />: {formatBps(suggestion.cost.spreadPct)} (
                            {formatPctPrecise(suggestion.cost.spreadPct)})
                          </div>
                          <div>
                            Fees <TermHelpButton term="fee" onOpen={openGlossaryTerm} label="fee" /> roundtrip: {formatBps(suggestion.cost.feePct)} (
                            {formatPctPrecise(suggestion.cost.feePct)})
                          </div>
                          <div>
                            Slippage <TermHelpButton term="slippage" onOpen={openGlossaryTerm} label="slippage" /> estimate:{" "}
                            {formatBps(suggestion.cost.slippagePct)} ({formatPctPrecise(suggestion.cost.slippagePct)})
                          </div>
                          <div>
                            Net edge <TermHelpButton term="netEdge" onOpen={openGlossaryTerm} label="net edge" />: {formatBps(suggestion.cost.netEdgePct)} (
                            {formatPctPrecise(suggestion.cost.netEdgePct)})
                          </div>
                        </div>
                        <div className="subtle mono">
                          net_edge = take_profit_pct − (spread_pct + fee_pct + slippage_pct)
                        </div>

                        {suggestion.viability === "NOT_VIABLE" ? (
                          <div className="warning">
                            {suggestion.blockingReasons.slice(0, 3).map((reason) => (
                              <div key={reason}>{reason}</div>
                            ))}
                          </div>
                        ) : null}

                        {market?.error ? <div className="warning">Market warning: {market.error}</div> : null}
                        {ticker ? (
                          <div className="subtle mono">
                            Live ticker: bid {roundTo(ticker.bid, 6)} / ask {roundTo(ticker.ask, 6)} / mid{" "}
                            {roundTo((ticker.bid + ticker.ask) / 2, 6)}
                          </div>
                        ) : (
                          <div className="warning">Live ticker unavailable.</div>
                        )}

                        <div className="ai-placeholder">
                          <strong>AI suggestion</strong>
                          <div className="subtle">AI suggestion coming later.</div>
                        </div>
                      </>
                    );

                    return (
                      <article key={suggestion.pair} className="panel suggestion-card">
                        <div className="panel-inner">
                          <div className="card-head">
                            <h3>{formatPair(suggestion.pair)}</h3>
                            <span className={`decision-banner ${decisionClass}`}>{decisionLabel}</span>
                          </div>

                          {learningMode ? (
                            <>
                              <div className="simple-reason mono">{getSimpleReason(suggestion)}</div>
                              <div className="next-step">{getNextStep(suggestion)}</div>
                              <details className="entry-details">
                                <summary>Show details</summary>
                                {advancedSections}
                              </details>
                            </>
                          ) : (
                            advancedSections
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-inner">
                <div className="card-head">
                  <h2>Opportunities (Scanner)</h2>
                  {sentiment.classification === "RISK_OFF" ? <span className="badge alert">Market is risk-off: be extra selective</span> : null}
                </div>

                <div className="grid-three">
                  <div className="field">
                    <span>Available {quoteAsset} balance</span>
                    {positionsState?.authenticated && detectedQuoteBalance !== null ? (
                      <small>Detected read-only balance: {roundTo(detectedQuoteBalance, 8)} {quoteAsset}</small>
                    ) : (
                      <small>Not connected. Using manual value.</small>
                    )}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={scannerBalanceOverride}
                      placeholder={String(roundTo(scannerBalance, 8))}
                      onChange={(event) => setScannerBalanceOverride(event.target.value)}
                    />
                    <small>Effective scanner balance: {roundTo(scannerBalance, 8)} {quoteAsset}</small>
                  </div>

                  <div className="field">
                    <span>Scanner watchlist</span>
                    <div className="checklist">
                      {DEFAULT_ASSISTANT_PAIRS.map((pair) => (
                        <label key={`scanner-${pair}`} className="check-row">
                          <input type="checkbox" checked={scannerWatchlist.includes(pair)} onChange={() => toggleScannerPair(pair)} />
                          <span>{formatPair(pair)}</span>
                        </label>
                      ))}
                    </div>
                    <small>Deterministic ranking only. No execution.</small>
                  </div>
                </div>

                <div className="subtle">Deterministic scanner, not financial advice.</div>
                {scannerTop.length === 0 ? (
                  <div className="warning">
                    {sentiment.classification === "RISK_OFF"
                      ? "No safe opportunities right now."
                      : "No eligible opportunities right now (constraints, costs, or affordability)."}
                  </div>
                ) : (
                  <div className="grid-two">
                    {scannerTop.map((row) => (
                      <article key={`scanner-${row.pair}`} className="panel">
                        <div className="panel-inner">
                          <div className="card-head">
                            <h3>{formatPair(row.pair)}</h3>
                            <span className="badge">Score {roundTo(row.scoreScaled / 100_000, 2)}</span>
                          </div>
                          <div className="mini-grid mono">
                            <div>Decision: {row.suggestion.decision === "DO_NOT_TRADE" ? "DO NOT TRADE" : row.suggestion.decision}</div>
                            <div>Viability: {row.suggestion.viability}</div>
                            <div>Net edge: {formatBps(row.suggestion.cost.netEdgePct)}</div>
                            <div>Deviation: {formatBps(row.suggestion.deviationPct)}</div>
                            <div>Spread: {formatBps(row.suggestion.cost.spreadPct)}</div>
                            <div>Suggested notional: {roundTo(row.suggestion.suggestedNotional, 6)}</div>
                            <div>Suggested qty: {roundTo(row.suggestion.suggestedQty, 8)}</div>
                          </div>
                          <button className="action-button" onClick={() => applyScannerPair(row.pair)}>
                            Use this pair in Assistant
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-inner">
                <h2>My Live Position</h2>
                <div className="grid-three">
                  <div className="field">
                    <span>Kraken authenticated</span>
                    <strong>{positionsState?.authenticated ? "Yes" : "No"}</strong>
                    <small>{positionsState?.lastError || "Read-only account monitor active."}</small>
                  </div>
                  <label className="field">
                    <span>Manual fallback / override</span>
                    <select value={manualOverride ? "manual" : "auto"} onChange={(event) => setManualOverride(event.target.value === "manual")}>
                      <option value="auto">Auto detect</option>
                      <option value="manual">Manual override</option>
                    </select>
                    <small>Use manual mode when keys are missing or detection is incomplete.</small>
                  </label>
                </div>

                {manualOverride || !positionsState?.authenticated ? (
                  <div className="grid-four">
                    <label className="field">
                      <span>Pair</span>
                      <select value={manualPair} onChange={(event) => setManualPair(event.target.value)}>
                        {selectedPairs.map((pair) => (
                          <option key={pair} value={pair}>
                            {formatPair(pair)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Entry Price</span>
                      <input type="text" inputMode="decimal" value={manualEntryPrice} onChange={(event) => setManualEntryPrice(event.target.value)} />
                    </label>
                    <label className="field">
                      <span>Quantity</span>
                      <input type="text" inputMode="decimal" value={manualQty} onChange={(event) => setManualQty(event.target.value)} />
                    </label>
                    <label className="field">
                      <span>Opened At</span>
                      <input type="datetime-local" value={manualOpenedAt} onChange={(event) => setManualOpenedAt(event.target.value)} />
                    </label>
                  </div>
                ) : null}

                <div className="grid-two">
                  {monitoredPositions.length === 0 ? (
                    <div className="warning">No live position detected. Place a manual trade on Kraken or enter manual position details.</div>
                  ) : (
                    monitoredPositions.map((position) => {
                      const ticker = liveTickers[position.pair] ?? getMarketPair(position.pair)?.ticker ?? null;
                      const tp = position.entryPrice * (1 + params.takeProfitPct);
                      const sl = position.entryPrice * (1 - params.stopLossPct);
                      const remainingMs = params.maxHoldMinutes * 60_000 - (Date.now() - Date.parse(position.openedAt));

                      return (
                        <article key={`${position.pair}-${position.openedAt}-${position.qty}`} className="panel">
                          <div className="panel-inner">
                            <div className="card-head">
                              <h3>{formatPair(position.pair)}</h3>
                              <span className="badge">{position.source}</span>
                            </div>
                            <div className="mini-grid mono">
                              <div>qty: {position.qty}</div>
                              <div>entry_price: {position.entryPrice}</div>
                              <div>opened_at: {position.openedAt}</div>
                              <div>tp_target: {roundTo(tp, 6)}</div>
                              <div>sl_trigger: {roundTo(sl, 6)}</div>
                              <div>time_remaining_min: {roundTo(Math.max(0, remainingMs) / 60_000, 2)}</div>
                              <div>last_price: {ticker ? roundTo(ticker.last, 6) : "n/a"}</div>
                              <div>spread: {ticker ? `${formatBps(ticker.spreadPct)} (${formatPctPrecise(ticker.spreadPct)})` : "n/a"}</div>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>

                <h3>Detected Open Orders</h3>
                {positionsState?.openOrders.length ? (
                  <ul className="flat-list mono">
                    {positionsState.openOrders.map((order) => (
                      <li key={order.orderId}>
                        {formatPair(order.pair)} {order.side} {order.type} qty {roundTo(order.qty, 8)} @ {roundTo(order.price, 8)} ({order.openedAt})
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="subtle">No open orders detected for selected pairs.</div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-inner">
                <div className="card-head">
                  <h2>Alerts</h2>
                  <button className="action-button" onClick={() => setAlerts([])}>
                    Clear Alerts
                  </button>
                </div>
                {alerts.length === 0 ? (
                  <div className="subtle">No alerts yet.</div>
                ) : (
                  <ul className="flat-list mono">
                    {alerts.map((alert) => (
                      <li key={alert.id}>
                        [{alert.at}] {formatPair(alert.pair)} {alert.type}: {alert.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        ) : activeTab === "AUTOMATION" ? (
          <AutomationTab />
        ) : (
          <section className="panel">
            <div className="panel-inner">
              <h2>Glossary</h2>
              <div className="subtle">Plain-language explanations for trading terms used across the Assistant.</div>
              <div className="glossary-grid">
                {glossaryTerms.map((term) => (
                  <article
                    key={term.id}
                    className={`glossary-item ${activeGlossaryTerm === term.id ? "active" : ""}`}
                    ref={(node) => {
                      glossaryRefs.current[term.id] = node;
                    }}
                  >
                    <h4>{term.title}</h4>
                    <p><strong>Definition:</strong> {term.definition}</p>
                    <p><strong>Why it matters:</strong> {term.why}</p>
                    <p><strong>Example:</strong> {term.example}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
