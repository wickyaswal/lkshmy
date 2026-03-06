"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "react-modal";
import { Tooltip } from "react-tooltip";

import { AutomationTab } from "@/components/automation-tab";
import {
  buildAccountSuggestionPairUniverse,
  buildBalanceSuggestions,
  type BalanceSuggestion,
  type KrakenOrderTemplateType
} from "@/lib/assistant/account-suggestions";
import type { AiSnapshot } from "@/lib/assistant/ai/types";
import {
  computeMarketSentiment,
  SENTIMENT_GREEN_THRESHOLD_PCT,
  SENTIMENT_RED_THRESHOLD_PCT
} from "@/lib/assistant/dashboard-helpers";
import { DEFAULT_SELECTED_PAIRS, DEFAULT_STRATEGY_PARAMS } from "@/lib/assistant/defaults";
import { computeDeterministicSuggestion, evaluateSuggestionParameterSanity } from "@/lib/assistant/suggestion-engine";
import type {
  AssistantMarketResponse,
  AssistantPositionsResponse,
  StrategyParams
} from "@/lib/assistant/types";
import { splitInternalPair, toInternalPair, toKrakenWsPair } from "@/lib/trading/symbol-normalization";
import type { TickerSnapshot } from "@/lib/trading/types";
import { roundTo } from "@/lib/utils";

type TabId = "ASSISTANT" | "AUTOMATION" | "GLOSSARY";
type AssistantSubTabId = "KRAKEN";
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
  | "bps"
  | "limitOrder"
  | "stopLossOrder"
  | "takeProfitOrder"
  | "takeProfitLimitOrder"
  | "icebergOrder"
  | "trailingStopOrder"
  | "trailingStopLimitOrder";
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
  snapshot?: AiSnapshot;
  message?: string;
};

type DiagnosticEntry = {
  id: string;
  scope: "Account" | "Suggestions" | "Sentiment" | "Assistant";
  message: string;
  at: string;
};

type AccountSectionKey = "openOrders" | "latestActivity";
type PanelSectionKey = "balances" | "account" | "suggestions" | "assistant" | "sentiment" | "advancedStrategy";
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
  "bps",
  "limitOrder",
  "stopLossOrder",
  "takeProfitOrder",
  "takeProfitLimitOrder",
  "icebergOrder",
  "trailingStopOrder",
  "trailingStopLimitOrder"
];

const parseJson = async <T,>(response: Response): Promise<T> => (await response.json()) as T;

const formatPair = (pair: string): string => {
  const { base, quote } = splitInternalPair(pair);
  return `${base}-${quote}`;
};

const formatOrderTypeLabel = (value: KrakenOrderTemplateType): string =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");

const numberFormatters = {
  compact2: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }),
  compact4: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }),
  qty8: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8
  })
};

const toBps = (value: number): number => value * 10_000;
const formatPct = (value: number, decimals = 3): string => `${roundTo(value * 100, decimals)}%`;
const formatPctPrecise = (value: number): string => `${roundTo(value * 100, 4)}%`;
const formatBps = (value: number): string => {
  const bps = toBps(value);
  if (bps !== 0 && Math.abs(bps) < 0.1) {
    return `${roundTo(bps, 4)} bps`;
  }

  return `${roundTo(bps, 2)} bps`;
};
const formatMoney = (value: number): string => `${roundTo(value, 6)}`;
const formatDisplayPrice = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  if (Math.abs(value) >= 1000) {
    return numberFormatters.compact2.format(value);
  }

  return numberFormatters.compact4.format(value);
};
const formatDisplayAvailable = (value: number): string => {
  const abs = Math.abs(value);

  if (!Number.isFinite(value)) {
    return "n/a";
  }

  if (abs >= 1000) {
    return numberFormatters.compact2.format(value);
  }

  if (abs >= 1) {
    return numberFormatters.compact2.format(value);
  }

  if (abs >= 0.01) {
    return numberFormatters.compact4.format(value);
  }

  return numberFormatters.qty8.format(value);
};
const formatDisplayQty = (value: number): string => numberFormatters.qty8.format(value);
const formatShortDateTime = (value: string): string => {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return value;
  }

  return new Date(time).toLocaleString();
};
const formatPanelStatusLabel = (open: boolean): string => (open ? "Collapse" : "Expand");
const buildKrakenMarketUrl = (pair: string | null): string | null => {
  if (!pair) {
    return null;
  }

  const { base, quote } = splitInternalPair(pair);
  return `https://pro.kraken.com/app/trade/${base.toLowerCase()}-${quote.toLowerCase()}`;
};

const normalizeDecimalInput = (value: string): string => value.trim().replace(",", ".");

const parseDecimalInput = (value: string): number => {
  const parsed = Number(normalizeDecimalInput(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveOpenReference = (
  value?: string[] | string
): { openReferencePrice: number | null; openReferenceLabel: "OPEN_24H" | "DAY_OPEN" | null } => {
  if (Array.isArray(value)) {
    const open24h = Number(value[1] ?? 0);
    if (Number.isFinite(open24h) && open24h > 0) {
      return {
        openReferencePrice: open24h,
        openReferenceLabel: "OPEN_24H"
      };
    }

    const dayOpen = Number(value[0] ?? 0);
    if (Number.isFinite(dayOpen) && dayOpen > 0) {
      return {
        openReferencePrice: dayOpen,
        openReferenceLabel: "DAY_OPEN"
      };
    }
  } else if (typeof value === "string") {
    const dayOpen = Number(value);
    if (Number.isFinite(dayOpen) && dayOpen > 0) {
      return {
        openReferencePrice: dayOpen,
        openReferenceLabel: "DAY_OPEN"
      };
    }
  }

  return {
    openReferencePrice: null,
    openReferenceLabel: null
  };
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
    case "limitOrder":
      return {
        title: "Limit Order",
        definition: "A limit order only fills at your chosen price or better.",
        why: "It gives you price control, which is why the app uses it as the default copy form.",
        example: `Example: set a buy or sell at a fixed price such as ${roundTo(entry, 2)}.`
      };
    case "stopLossOrder":
      return {
        title: "Stop Loss Order",
        definition: "A stop loss triggers when price moves against you to a chosen level.",
        why: "It is the simplest way to cap downside when a trade goes wrong.",
        example: `Example: if entry is ${roundTo(entry, 2)}, a ${formatPct(context.params.stopLossPct)} stop sits near ${roundTo(sl, 2)}.`
      };
    case "takeProfitOrder":
      return {
        title: "Take Profit Order",
        definition: "A take profit triggers when price reaches your profit target.",
        why: "It helps lock in gains automatically once the market reaches your planned exit level.",
        example: `Example: if entry is ${roundTo(entry, 2)}, a ${formatPct(context.params.takeProfitPct)} target sits near ${roundTo(tp, 2)}.`
      };
    case "takeProfitLimitOrder":
      return {
        title: "Take Profit Limit",
        definition: "A take profit limit uses a trigger price plus a separate limit price.",
        why: "It gives more execution control than a plain take profit order.",
        example: "Example: trigger at the profit level, then cap the actual fill with a nearby limit price."
      };
    case "icebergOrder":
      return {
        title: "Iceberg Order",
        definition: "An iceberg order hides most of the order and only shows a small visible piece.",
        why: "It can reduce market signaling when the order size is large.",
        example: "Example: sell 10 units but show only 2 units at a time."
      };
    case "trailingStopOrder":
      return {
        title: "Trailing Stop",
        definition: "A trailing stop moves with the market by a fixed offset instead of using one fixed stop price.",
        why: "It can protect gains while still allowing price to keep trending in your favor.",
        example: "Example: keep the stop 1% below price as it rises."
      };
    case "trailingStopLimitOrder":
      return {
        title: "Trailing Stop Limit",
        definition: "A trailing stop limit adds a limit price to the trailing stop trigger.",
        why: "It gives more fill control, but there is a higher chance of not filling in fast markets.",
        example: "Example: trail the stop, then submit a limit order when the stop is triggered."
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
  const [activeGlossaryTerm, setActiveGlossaryTerm] = useState<GlossaryTermId | null>(null);
  const [selectedPairs, setSelectedPairs] = useState<string[]>(DEFAULT_SELECTED_PAIRS);
  const [params, setParams] = useState<StrategyParams>(DEFAULT_STRATEGY_PARAMS);
  const [marketState, setMarketState] = useState<AssistantMarketResponse | null>(null);
  const [positionsState, setPositionsState] = useState<AssistantPositionsResponse | null>(null);
  const [accountSuggestionMarketState, setAccountSuggestionMarketState] = useState<AssistantMarketResponse | null>(null);
  const [liveTickers, setLiveTickers] = useState<Record<string, TickerSnapshot>>({});
  const [feedback, setFeedback] = useState("Balance-driven suggestions are active.");
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiSimpleLanguage, setAiSimpleLanguage] = useState(true);
  const [aiIncludeRawCandles, setAiIncludeRawCandles] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAsOf, setAiAsOf] = useState<string | null>(null);
  const [aiResponse, setAiResponse] = useState<AiAssistantResponsePayload | null>(null);
  const [aiSnapshotPayload, setAiSnapshotPayload] = useState<AiSnapshot | null>(null);
  const [showAiSnapshot, setShowAiSnapshot] = useState(false);
  const [aiCooldownUntilMs, setAiCooldownUntilMs] = useState(0);
  const [advancedStrategyOpen, setAdvancedStrategyOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState<Record<PanelSectionKey, boolean>>({
    balances: true,
    account: true,
    suggestions: true,
    assistant: true,
    sentiment: true,
    advancedStrategy: false
  });
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [marketFetchError, setMarketFetchError] = useState<string | null>(null);
  const [positionsFetchError, setPositionsFetchError] = useState<string | null>(null);
  const [accountSuggestionFetchError, setAccountSuggestionFetchError] = useState<string | null>(null);
  const [refreshingAccountSnapshot, setRefreshingAccountSnapshot] = useState(false);
  const [accountSectionsOpen, setAccountSectionsOpen] = useState<Record<AccountSectionKey, boolean>>({
    openOrders: true,
    latestActivity: true
  });
  const [activeSuggestionKey, setActiveSuggestionKey] = useState<string | null>(null);
  const [activeSuggestionOrderType, setActiveSuggestionOrderType] = useState<KrakenOrderTemplateType | null>(null);
  const [copiedSuggestionFieldKey, setCopiedSuggestionFieldKey] = useState<string | null>(null);
  const diagnosticsLastSeenRef = useRef(new Map<string, number>());
  const glossaryRefs = useRef<Partial<Record<GlossaryTermId, HTMLElement | null>>>({});
  const wsSymbolsRef = useRef<Record<string, string>>({});
  const assistantPanelRef = useRef<HTMLElement | null>(null);
  const aiTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const pushDiagnostic = useCallback((scope: DiagnosticEntry["scope"], message: string) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const key = `${scope}:${trimmed}`;
    const now = Date.now();
    const lastSeen = diagnosticsLastSeenRef.current.get(key) ?? 0;
    if (now - lastSeen < 60_000) {
      return;
    }

    diagnosticsLastSeenRef.current.set(key, now);
    setDiagnostics((current) => [
      {
        id: `${key}:${now}`,
        scope,
        message: trimmed,
        at: new Date(now).toISOString()
      },
      ...current
    ].slice(0, 100));
  }, []);

  const redirectToLogin = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextPath = `${window.location.pathname}${window.location.search}`;
    const query = new URLSearchParams({
      next: nextPath
    });
    window.location.assign(`/login?${query.toString()}`);
  }, []);

  const tradingCapital = 1000;
  const selectedPairsKey = selectedPairs.join(",");

  const getMarketPair = (pair: string): AssistantMarketResponse["pairs"][number] | undefined =>
    marketState?.pairs.find((row) => row.pair === pair);

  const firstSelectedPair = selectedPairs[0] ?? "BTCUSDT";
  const referencePrice =
    liveTickers[firstSelectedPair]?.last ??
    getMarketPair(firstSelectedPair)?.ticker?.last ??
    null;

  useEffect(() => {
    const stored = window.localStorage.getItem("assistant:advanced-strategy-open");
    const open = stored === "true";
    setAdvancedStrategyOpen(open);
    setPanelOpen((current) => ({
      ...current,
      advancedStrategy: open
    }));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("assistant:advanced-strategy-open", advancedStrategyOpen ? "true" : "false");
  }, [advancedStrategyOpen]);

  useEffect(() => {
    Modal.setAppElement("body");
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

        if (response.status === 401) {
          redirectToLogin();
          return;
        }

        const payload = await parseJson<MarketApiPayload>(response);

        if (!response.ok || !payload.state) {
          throw new Error(payload.message ?? "Unable to fetch market snapshot.");
        }

        if (active) {
          setMarketState(payload.state);
          setMarketFetchError(null);
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : "Market feed unavailable.";
          setMarketFetchError(message);
          pushDiagnostic("Sentiment", message);
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
  }, [selectedPairs, selectedPairsKey, params.timeframe, params.maPeriod, pushDiagnostic, redirectToLogin]);

  const fetchPositionsState = useCallback(
    async (forceRefresh = false): Promise<boolean> => {
      try {
        const query = new URLSearchParams({
          pairs: selectedPairsKey
        });
        if (forceRefresh) {
          query.set("force_refresh", "true");
        }

        const response = await fetch(`/api/assistant/positions?${query.toString()}`, {
          cache: "no-store"
        });

        if (response.status === 401) {
          redirectToLogin();
          return false;
        }

        const payload = await parseJson<PositionsApiPayload>(response);

        if (!payload.state) {
          throw new Error(payload.message ?? "Unable to fetch position state.");
        }

        setPositionsState(payload.state);
        setPositionsFetchError(null);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Position monitor unavailable.";
        setPositionsFetchError(message);
        pushDiagnostic("Account", message);
        return false;
      }
    },
    [selectedPairsKey, pushDiagnostic, redirectToLogin]
  );

  useEffect(() => {
    let active = true;

    const syncPositions = async (forceRefresh = false) => {
      if (!active) {
        return;
      }
      await fetchPositionsState(forceRefresh);
    };

    void syncPositions();
    const interval = setInterval(() => {
      void syncPositions();
    }, 60_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [fetchPositionsState]);

  const accountSuggestionPairs = useMemo(
    () =>
      buildAccountSuggestionPairUniverse({
        portfolio: positionsState?.portfolio ?? [],
        latestActivity: positionsState?.latestActivity ?? null,
        openOrders: positionsState?.openOrders ?? [],
        selectedPairs
      }),
    [positionsState, selectedPairs]
  );

  useEffect(() => {
    let active = true;

    const fetchSuggestionMarkets = async () => {
      if (accountSuggestionPairs.length === 0) {
        if (active) {
          setAccountSuggestionMarketState(null);
          setAccountSuggestionFetchError(null);
        }
        return;
      }

      try {
        const query = new URLSearchParams({
          pairs: accountSuggestionPairs.join(","),
          timeframe: params.timeframe,
          limit: String(Math.max(120, params.maPeriod + 20))
        });
        const response = await fetch(`/api/assistant/market?${query.toString()}`, {
          cache: "no-store"
        });

        if (response.status === 401) {
          redirectToLogin();
          return;
        }

        const payload = await parseJson<MarketApiPayload>(response);

        if (!response.ok || !payload.state) {
          throw new Error(payload.message ?? "Unable to fetch suggestion market snapshot.");
        }

        if (active) {
          setAccountSuggestionMarketState(payload.state);
          setAccountSuggestionFetchError(null);
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : "Suggestion market feed unavailable.";
          setAccountSuggestionFetchError(message);
          pushDiagnostic("Suggestions", message);
        }
      }
    };

    void fetchSuggestionMarkets();
    const interval = setInterval(() => {
      void fetchSuggestionMarkets();
    }, 20_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [accountSuggestionPairs, params.timeframe, params.maPeriod, pushDiagnostic, redirectToLogin]);

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

  const portfolioRows = useMemo(() => positionsState?.portfolio ?? [], [positionsState?.portfolio]);
  const aiCooldownRemainingSec = Math.max(0, Math.ceil((aiCooldownUntilMs - Date.now()) / 1000));
  const aiSendDisabled = aiLoading || !aiQuestion.trim() || aiCooldownRemainingSec > 0;

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

  const netEdgeSanity = useMemo(() => evaluateSuggestionParameterSanity(params), [params]);
  const accountHasIssue = Boolean(
    positionsFetchError || (positionsState?.ok === false && positionsState.lastError)
  );
  const suggestionsHasIssue = Boolean(
    accountSuggestionFetchError || (accountSuggestionMarketState?.pairs ?? []).some((row) => Boolean(row.error))
  );
  const sentimentHasIssue = Boolean(
    marketFetchError || (marketState?.pairs ?? []).some((row) => Boolean(row.error))
  );
  const assistantHasIssue = Boolean(aiError);
  const balanceSuggestions = useMemo(
    () =>
      buildBalanceSuggestions({
        positionsState,
        marketPairs: accountSuggestionMarketState?.pairs ?? [],
        params,
        selectedPairs,
        sentiment: sentiment.classification
      }),
    [positionsState, accountSuggestionMarketState, params, selectedPairs, sentiment.classification]
  );
  const activeBalanceSuggestion = useMemo(
    () => balanceSuggestions.find((row) => row.key === activeSuggestionKey) ?? null,
    [balanceSuggestions, activeSuggestionKey]
  );

  const primarySuggestion = suggestions[0] ?? null;
  const glossaryContext: GlossaryContext = {
    referencePrice,
    sampleSpreadPct: primarySuggestion?.cost.spreadPct ?? null,
    sampleNetEdgePct: primarySuggestion?.cost.netEdgePct ?? params.takeProfitPct - params.assumedFeePctRoundtrip,
    sampleDeviationPct: primarySuggestion?.deviationPct ?? params.entryThresholdPct,
    sampleNotional: primarySuggestion?.suggestedNotional ?? tradingCapital,
    sampleQty: primarySuggestion?.suggestedQty ?? 0,
    params,
    sentimentLabel: sentiment.label,
    sentimentScorePct: sentiment.scorePct
  };
  const glossaryTerms: GlossaryTerm[] = GLOSSARY_ORDER.map((id) => ({
    id,
    ...glossaryTermContent(id, glossaryContext)
  }));

  useEffect(() => {
    for (const row of marketState?.pairs ?? []) {
      if (!row.error) {
        continue;
      }

      pushDiagnostic("Sentiment", `${formatPair(row.pair)}: ${row.error}`);
    }
  }, [marketState, pushDiagnostic]);

  useEffect(() => {
    for (const row of accountSuggestionMarketState?.pairs ?? []) {
      if (!row.error) {
        continue;
      }

      pushDiagnostic("Suggestions", `${formatPair(row.pair)}: ${row.error}`);
    }
  }, [accountSuggestionMarketState, pushDiagnostic]);

  useEffect(() => {
    if (positionsState?.ok === false && positionsState.lastError) {
      pushDiagnostic("Account", positionsState.lastError);
    }
  }, [positionsState, pushDiagnostic]);

  useEffect(() => {
    if (!activeSuggestionKey) {
      return;
    }

    if (!activeBalanceSuggestion) {
      setActiveSuggestionKey(null);
      setActiveSuggestionOrderType(null);
      return;
    }

    if (activeSuggestionOrderType) {
      const exists = activeBalanceSuggestion.templates.some((template) => template.type === activeSuggestionOrderType);
      if (exists) {
        return;
      }
    }

    setActiveSuggestionOrderType(
      activeBalanceSuggestion.primaryOrderType ?? activeBalanceSuggestion.templates[0]?.type ?? null
    );
  }, [activeSuggestionKey, activeSuggestionOrderType, activeBalanceSuggestion]);

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

  const refreshAccountSnapshot = async () => {
    if (refreshingAccountSnapshot) {
      return;
    }

    setRefreshingAccountSnapshot(true);
    const ok = await fetchPositionsState(true);
    if (ok) {
      setFeedback("Account refreshed from Kraken (cache bypassed).");
    } else {
      setFeedback("Account refresh failed. See Diagnostics.");
    }
    setRefreshingAccountSnapshot(false);
  };

  const togglePanel = (key: PanelSectionKey) => {
    setPanelOpen((current) => {
      const next = !current[key];
      if (key === "advancedStrategy") {
        setAdvancedStrategyOpen(next);
      }

      return {
        ...current,
        [key]: next
      };
    });
  };

  const toggleAccountSection = (key: AccountSectionKey) => {
    setAccountSectionsOpen((current) => ({
      ...current,
      [key]: !current[key]
    }));
  };

  const openSuggestionModal = (suggestion: BalanceSuggestion) => {
    setActiveSuggestionKey(suggestion.key);
    setActiveSuggestionOrderType(
      suggestion.primaryOrderType ?? suggestion.templates[0]?.type ?? null
    );
    setCopiedSuggestionFieldKey(null);
  };

  const closeSuggestionModal = () => {
    setActiveSuggestionKey(null);
    setActiveSuggestionOrderType(null);
    setCopiedSuggestionFieldKey(null);
  };

  const copySuggestionValue = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedSuggestionFieldKey(key);
      window.setTimeout(() => {
        setCopiedSuggestionFieldKey((current) => (current === key ? null : current));
      }, 1400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not copy the field value.";
      pushDiagnostic("Suggestions", message);
      setFeedback("Copy failed. See Diagnostics.");
    }
  };

  const scrollToAssistant = (focusComposer: boolean) => {
    setActiveTab("ASSISTANT");
    assistantPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    if (focusComposer) {
      requestAnimationFrame(() => {
        aiTextareaRef.current?.focus();
      });
    }
  };

  const buildSuggestionQuestion = (suggestion: BalanceSuggestion): string => {
    const pairLabel = suggestion.marketPair ? formatPair(suggestion.marketPair) : suggestion.asset;
    const statusLabel = suggestion.status.replace("_", " ");
    const metricParts = [
      suggestion.metrics.spreadBps !== null ? `spread ${roundTo(suggestion.metrics.spreadBps, 2)} bps` : null,
      suggestion.metrics.deviationBps !== null ? `deviation ${roundTo(suggestion.metrics.deviationBps, 2)} bps` : null,
      suggestion.metrics.netEdgeBps !== null ? `net edge ${roundTo(suggestion.metrics.netEdgeBps, 2)} bps` : null
    ].filter(Boolean);
    const valueParts = [
      suggestion.quantity > 0 ? `qty ${formatDisplayQty(suggestion.quantity)}` : null,
      suggestion.price !== null ? `price ${formatDisplayPrice(suggestion.price)}` : null,
      suggestion.triggerPrice !== null ? `trigger ${formatDisplayPrice(suggestion.triggerPrice)}` : null,
      suggestion.total > 0 ? `estimated total ${formatDisplayPrice(suggestion.total)}` : null
    ].filter(Boolean);

    return [
      `Explain this ${suggestion.side.toLowerCase()} suggestion for ${pairLabel}.`,
      `Status: ${statusLabel}.`,
      suggestion.primaryOrderType ? `Primary order type: ${formatOrderTypeLabel(suggestion.primaryOrderType)}.` : null,
      `Headline: ${suggestion.headline}`,
      `Summary: ${suggestion.summary}`,
      metricParts.length > 0 ? `Current metrics: ${metricParts.join(", ")}.` : null,
      valueParts.length > 0 ? `Current order values: ${valueParts.join(", ")}.` : null,
      suggestion.notes.length > 0 ? `Important notes: ${suggestion.notes.join(" ")}` : null,
      "Please explain why this suggestion exists, what the important numbers mean, what risks I should watch, and what I should double-check in the Kraken form before I copy anything."
    ]
      .filter(Boolean)
      .join(" ");
  };

  const clearAiAssistant = () => {
    setAiQuestion("");
    setAiError(null);
    setAiAsOf(null);
    setAiResponse(null);
    setAiSnapshotPayload(null);
  };

  const sendAiAssistant = async (overrideQuestion?: string): Promise<"sent" | "blocked" | "failed"> => {
    const questionToSend = (overrideQuestion ?? aiQuestion).trim();
    if (!questionToSend || aiLoading || aiCooldownUntilMs > Date.now()) {
      return "blocked";
    }

    setAiLoading(true);
    setAiError(null);
    if (overrideQuestion) {
      setAiQuestion(questionToSend);
    }

    try {
      const response = await fetch("/api/assistant/ai", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question: questionToSend,
          simpleLanguage: aiSimpleLanguage,
          includeRawCandles: aiIncludeRawCandles,
          includeSnapshot: true,
          context: {
            strategyParams: params
          }
        })
      });

      if (response.status === 401) {
        redirectToLogin();
        return "failed";
      }

      const payload = await parseJson<AiApiPayload>(response);

      if (!response.ok || !payload.response) {
        throw new Error(payload.message ?? "AI Assistant could not generate a response.");
      }

      setAiResponse(payload.response);
      setAiAsOf(payload.asOf ?? null);
      setAiSnapshotPayload(payload.snapshot ?? null);
      return "sent";
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI Assistant request failed.";
      setAiError(message);
      setAiSnapshotPayload(null);
      pushDiagnostic("Assistant", message);
      return "failed";
    } finally {
      setAiLoading(false);
      setAiCooldownUntilMs(Date.now() + 5000);
    }
  };

  const draftSuggestionQuestion = (suggestion: BalanceSuggestion) => {
    const prompt = buildSuggestionQuestion(suggestion);
    setAiQuestion(prompt);
    scrollToAssistant(true);
    setFeedback(`Drafted an Explain & Ask prompt for ${suggestion.marketPair ? formatPair(suggestion.marketPair) : suggestion.asset}.`);
  };

  const askAboutSuggestion = async (suggestion: BalanceSuggestion) => {
    const prompt = buildSuggestionQuestion(suggestion);
    setAiQuestion(prompt);
    scrollToAssistant(false);
    const result = await sendAiAssistant(prompt);

    if (result === "blocked") {
      setFeedback("AI request is cooling down. The prompt was drafted in Explain & Ask instead.");
      scrollToAssistant(true);
    }
  };

  const sentimentTooltipHtml = buildTooltipHtml("Market Sentiment", [
    "score = median((last - open_reference) / open_reference) across selected pairs.",
    `Risk-off if score <= ${formatPctPrecise(SENTIMENT_RED_THRESHOLD_PCT)}. Risk-on if score >= ${formatPctPrecise(SENTIMENT_GREEN_THRESHOLD_PCT)}. Otherwise Neutral.`,
    `Reference used: ${sentiment.referenceLabel}.`
  ]);

  const renderBalancesPanel = () => (
    <section className="panel assistant-layout-item balances-item">
      <div className="panel-inner">
        <div className="card-head">
          <h2>Balances</h2>
          <div className="card-head-actions">
            {accountHasIssue ? <span className="badge alert compact-chip">Data issue</span> : null}
            <button className="action-button compact" onClick={() => togglePanel("balances")}>
              {formatPanelStatusLabel(panelOpen.balances)}
            </button>
          </div>
        </div>
        {panelOpen.balances ? (
          <>
            <div className="subtle mono">
              {positionsState?.checkedAt ? new Date(positionsState.checkedAt).toLocaleTimeString() : "n/a"} •{" "}
              {positionsState?.cached.hit ? "cache hit" : "live"}
            </div>
            {!positionsState?.authenticated ? (
              <div className="subtle inline-status text-reading">Not connected. Add Kraken API keys for live balance reads.</div>
            ) : portfolioRows.length === 0 ? (
              <div className="subtle inline-status text-reading">No positive balances found in the account.</div>
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
                        <td className="balance">{roundTo(row.available, 8)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="subtle inline-status text-reading">Balances are collapsed.</div>
        )}
      </div>
    </section>
  );

  const renderAccountPanel = () => (
    <section className="panel assistant-layout-item account-item">
      <div className="panel-inner">
        <div className="card-head">
          <h2>Account</h2>
          <div className="card-head-actions">
            {accountHasIssue ? <span className="badge alert compact-chip">Data issue</span> : null}
            <button className="action-button compact" onClick={() => togglePanel("account")}>
              {formatPanelStatusLabel(panelOpen.account)}
            </button>
          </div>
        </div>
        {panelOpen.account ? (
        <div className="account-snapshot-stack">
          <article className="panel account-table-card">
            <div className="panel-inner">
              <div className="card-head">
                <h3>Open Orders</h3>
                <button className="action-button compact" onClick={() => toggleAccountSection("openOrders")}>
                  {formatPanelStatusLabel(accountSectionsOpen.openOrders)}
                </button>
              </div>
              {accountSectionsOpen.openOrders ? (
                positionsState?.openOrders.length ? (
                  <div className="table-wrap">
                    <table className="kv-table mono">
                      <thead>
                        <tr>
                          <th>Pair</th>
                          <th>Side</th>
                          <th>Type</th>
                          <th>Qty</th>
                          <th>Price</th>
                          <th>Opened</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positionsState.openOrders.map((order) => (
                          <tr key={order.orderId}>
                            <td>{formatPair(order.pair)}</td>
                            <td>{order.side}</td>
                            <td>{order.type}</td>
                            <td>{roundTo(order.qty, 8)}</td>
                            <td>{roundTo(order.price, 8)}</td>
                            <td>{formatShortDateTime(order.openedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="subtle inline-status text-reading">No open orders detected in Kraken.</div>
                )
              ) : (
                <div className="subtle inline-status text-reading">Open orders table collapsed.</div>
              )}
            </div>
          </article>

          <article className="panel account-table-card">
            <div className="panel-inner">
              <div className="card-head">
                <h3>Latest Activity</h3>
                <button className="action-button compact" onClick={() => toggleAccountSection("latestActivity")}>
                  {formatPanelStatusLabel(accountSectionsOpen.latestActivity)}
                </button>
              </div>
              {accountSectionsOpen.latestActivity ? (
                !positionsState?.authenticated ? (
                  <div className="subtle inline-status text-reading">Not connected. Add Kraken API keys for read-only activity.</div>
                ) : !positionsState.latestActivity ? (
                  <div className="subtle inline-status text-reading">No recent activity found.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="kv-table mono">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Side</th>
                          <th>Pair</th>
                          <th>Price</th>
                          <th>Qty</th>
                          <th>Status</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{positionsState.latestActivity.type.toUpperCase()}</td>
                          <td>{positionsState.latestActivity.side}</td>
                          <td>{formatPair(positionsState.latestActivity.pair)}</td>
                          <td>{roundTo(positionsState.latestActivity.price, 8)}</td>
                          <td>{roundTo(positionsState.latestActivity.qty, 8)}</td>
                          <td>{positionsState.latestActivity.status}</td>
                          <td>{formatShortDateTime(positionsState.latestActivity.timestamp)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <div className="subtle inline-status text-reading">Latest activity table collapsed.</div>
              )}
            </div>
          </article>
        </div>
        ) : (
          <div className="subtle inline-status text-reading">Account is collapsed.</div>
        )}
      </div>
    </section>
  );

  const renderSuggestionsPanel = () => (
    <section className="panel assistant-layout-item suggestions-item">
      <div className="panel-inner">
        <div className="card-head">
          <h2>Suggestions</h2>
          <div className="card-head-actions">
            {suggestionsHasIssue ? <span className="badge alert compact-chip">Data issue</span> : null}
            <button className="action-button compact" onClick={() => togglePanel("suggestions")}>
              {formatPanelStatusLabel(panelOpen.suggestions)}
            </button>
          </div>
        </div>
        {panelOpen.suggestions ? (
        <>
        <div className="subtle text-reading">{feedback}</div>
        {netEdgeSanity.viableUnreachable ? (
          <div className="warning text-reading">
            Your min net edge is unreachable unless spread is near 0. Max possible edge without spread is {formatBps(netEdgeSanity.maxPossibleNetEdgeNoSpreadPct)}
            {" "}while min net edge is {formatBps(netEdgeSanity.minNetEdgePct)}.
          </div>
        ) : null}
        {balanceSuggestions.length === 0 ? (
          <div className="subtle inline-status text-reading">No positive balances found, so there are no balance-driven suggestions yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="kv-table mono suggestions-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Available</th>
                  <th>Pair</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Explain</th>
                  <th>Kraken</th>
                  <th>Snapshot</th>
                  <th>Primary Order</th>
                  <th>Order Qty</th>
                  <th>Price</th>
                  <th>Trigger</th>
                  <th>Est. Total</th>
                </tr>
              </thead>
              <tbody>
                {balanceSuggestions.map((row) => (
                  <tr
                    key={row.key}
                    className={`interactive-row suggestion-row ${row.side.toLowerCase()}`}
                    onClick={() => openSuggestionModal(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openSuggestionModal(row);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td className="suggestion-asset-cell">{row.asset}</td>
                    <td className="numeric-cell">{formatDisplayAvailable(row.available)}</td>
                    <td className="pair-cell">{row.marketPair ? formatPair(row.marketPair) : "n/a"}</td>
                    <td>
                      <span className={`badge compact-chip suggestion-side ${row.side.toLowerCase()}`}>
                        {row.side}
                      </span>
                    </td>
                    <td>
                      <span className={`badge compact-chip suggestion-status ${row.status.toLowerCase()}`}>{row.status.replace("_", " ")}</span>
                    </td>
                    <td>
                      <div className="table-action-stack suggestion-actions-cell">
                        <button
                          type="button"
                          className="action-button compact"
                          onClick={(event) => {
                            event.stopPropagation();
                            draftSuggestionQuestion(row);
                          }}
                        >
                          Draft
                        </button>
                        <button
                          type="button"
                          className="action-button compact"
                          onClick={(event) => {
                            event.stopPropagation();
                            void askAboutSuggestion(row);
                          }}
                        >
                          Ask
                        </button>
                      </div>
                    </td>
                    <td>
                      {buildKrakenMarketUrl(row.marketPair) ? (
                        <a
                          className="action-button compact table-link-button suggestion-open-button"
                          href={buildKrakenMarketUrl(row.marketPair) ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          Open
                        </a>
                      ) : (
                        <span className="subtle">n/a</span>
                      )}
                    </td>
                    <td className="snapshot-cell">
                      <div className="suggestion-summary-cell">
                        <strong>{row.headline}</strong>
                        <span>{row.summary}</span>
                      </div>
                    </td>
                    <td>{row.primaryOrderType ? formatOrderTypeLabel(row.primaryOrderType) : "n/a"}</td>
                    <td className="numeric-cell">{row.quantity > 0 ? formatDisplayQty(row.quantity) : "n/a"}</td>
                    <td className="numeric-cell">{formatDisplayPrice(row.price)}</td>
                    <td className="numeric-cell">{formatDisplayPrice(row.triggerPrice)}</td>
                    <td className="numeric-cell">{row.total > 0 ? formatDisplayPrice(row.total) : "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>
        ) : (
          <div className="subtle inline-status text-reading">Suggestions are collapsed.</div>
        )}
      </div>
    </section>
  );

  const renderSentimentPanel = () => (
    <section className="panel assistant-layout-item context-item">
      <div className="panel-inner">
        <div className="card-head">
          <h2>Sentiment</h2>
          <div className="card-head-actions">
            {sentimentHasIssue ? <span className="badge alert compact-chip">Data issue</span> : null}
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
            <button className="action-button compact" onClick={() => setPanelOpen((current) => ({ ...current, sentiment: !current.sentiment }))}>
              {formatPanelStatusLabel(panelOpen.sentiment)}
            </button>
          </div>
        </div>
        {panelOpen.sentiment ? (
          <div className="sentiment-panel-body">
            <div className={`sentiment-pill ${sentiment.color.toLowerCase()}`}>{sentiment.label}</div>
            <div className="kpi-value metric">
              {formatPctPrecise(sentiment.scorePct)} ({formatBps(sentiment.scorePct)})
            </div>
            <div className="subtle mono">
              Basket size: {sentiment.sampleSize} • Reference: {sentiment.referenceLabel}
            </div>
            <div className="subtle mono">
              Thresholds: risk-off ≤ {formatPctPrecise(SENTIMENT_RED_THRESHOLD_PCT)} • risk-on ≥ {formatPctPrecise(SENTIMENT_GREEN_THRESHOLD_PCT)}
            </div>
          </div>
        ) : (
          <div className="subtle inline-status text-reading">Sentiment is collapsed.</div>
        )}
      </div>
    </section>
  );

  const renderControlsPanel = () => (
    <section className="panel assistant-layout-item controls-item strategy-panel">
      <div className="panel-inner">
        <div className="card-head">
          <h2>Advanced Strategy</h2>
          <div className="card-head-actions">
            <button className="action-button compact" onClick={resetToDefaults}>
              Reset to safe defaults
            </button>
            <button className="action-button compact" onClick={() => togglePanel("advancedStrategy")}>
              {formatPanelStatusLabel(panelOpen.advancedStrategy)}
            </button>
          </div>
        </div>
        {panelOpen.advancedStrategy ? (
          <>
            <div className="subtle advanced-head text-reading">These settings stay collapsed by default so the account workflow stays primary.</div>
            <div className="grid-two">
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
          </>
        ) : (
          <div className="subtle inline-status text-reading">Advanced settings are hidden.</div>
        )}
      </div>
    </section>
  );

  const renderAssistantPanel = () => (
    <section ref={assistantPanelRef} className="panel assistant-layout-item assistant-item">
      <div className="panel-inner">
        <div className="card-head">
          <h2>Explain & Ask</h2>
          <div className="ai-actions">
            {assistantHasIssue ? <span className="badge alert compact-chip">Data issue</span> : null}
            <button className="action-button secondary compact" onClick={() => togglePanel("assistant")}>
              {formatPanelStatusLabel(panelOpen.assistant)}
            </button>
            <button className="action-button secondary compact" onClick={() => setShowAiSnapshot((current) => !current)}>
              {showAiSnapshot ? "Hide Snapshot" : "Show Snapshot"}
            </button>
            <button className="action-button secondary compact" onClick={clearAiAssistant}>
              Clear
            </button>
          </div>
        </div>
        {panelOpen.assistant ? (
        <>
        <label className="field">
          <span>Ask a question</span>
          <textarea
            ref={aiTextareaRef}
            className="ai-input"
            value={aiQuestion}
            placeholder="Example: Which pairs are interesting to watch today and why?"
            onChange={(event) => setAiQuestion(event.target.value)}
          />
        </label>
        <div className="subtle text-reading">Use `Draft` or `Ask` from a suggestion row to turn that suggestion into a contextual Explain & Ask prompt.</div>

        <div className="grid-three assistant-options">
          <label className="check-row">
            <input type="checkbox" checked={aiSimpleLanguage} onChange={(event) => setAiSimpleLanguage(event.target.checked)} />
            <span>Use simple language</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={aiIncludeRawCandles} onChange={(event) => setAiIncludeRawCandles(event.target.checked)} />
            <span>Include raw candles</span>
          </label>
          <div className="field">
            <button className="action-button primary compact" disabled={aiSendDisabled} onClick={() => void sendAiAssistant()}>
              {aiLoading ? "Thinking..." : aiCooldownRemainingSec > 0 ? `Wait ${aiCooldownRemainingSec}s` : "Send"}
            </button>
          </div>
        </div>

        {aiAsOf ? <div className="subtle mono">Snapshot timestamp: {aiAsOf}</div> : null}
        {showAiSnapshot ? (
          <div className="snapshot-viewer">
            <div className="subtle mono">Snapshot payload sent to the AI route</div>
            <pre className="snapshot-json">{aiSnapshotPayload ? JSON.stringify(aiSnapshotPayload, null, 2) : "No snapshot available yet."}</pre>
          </div>
        ) : null}

        {aiResponse ? (
          <div className="ai-output">
            <h3>Answer</h3>
            <p>{aiResponse.answer}</p>

            <h3>Top candidates to consider</h3>
            {aiResponse.top_candidates.length === 0 ? (
              <div className="subtle text-reading">No candidates returned.</div>
            ) : (
              <div className="signal-grid">
                {aiResponse.top_candidates.map((candidate) => (
                  <article key={`ai-${candidate.pair}`} className="panel signal-card">
                    <div className="panel-inner">
                      <div className="card-head">
                        <h4>{formatPair(candidate.pair)}</h4>
                        <span className="badge compact-chip">{candidate.status}</span>
                      </div>
                      <div className="mini-grid mono">
                        <div>{candidate.why_interesting}</div>
                        <div>Spread: {roundTo(candidate.numbers.spread_bps, 2)} bps</div>
                        <div>Deviation: {roundTo(candidate.numbers.deviation_bps, 2)} bps</div>
                        <div>Net edge: {roundTo(candidate.numbers.net_edge_bps, 2)} bps</div>
                        <div>Min-order OK: {candidate.feasibility.min_order_ok ? "Yes" : "No"}</div>
                        <div>Feasibility notes: {candidate.feasibility.notes.join(" | ")}</div>
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

            <div className="subtle text-reading">{aiResponse.disclaimer}</div>
          </div>
        ) : (
          <div className="subtle text-reading">Ask a freeform question to get a grounded, educational summary from the current snapshot.</div>
        )}
        </>
        ) : (
          <div className="subtle inline-status text-reading">Explain & Ask is collapsed.</div>
        )}
      </div>
    </section>
  );

  const renderSuggestionModal = () => {
    const suggestion = activeBalanceSuggestion;
    const activeTemplate =
      suggestion?.templates.find((template) => template.type === activeSuggestionOrderType) ??
      suggestion?.templates[0] ??
      null;
    const krakenUrl = buildKrakenMarketUrl(suggestion?.marketPair ?? null);

    return (
      <Modal
        isOpen={Boolean(suggestion)}
        onRequestClose={closeSuggestionModal}
        className="kraken-modal"
        overlayClassName="kraken-modal-overlay"
        contentLabel="Kraken suggestion form"
      >
        {suggestion ? (
          <div className="kraken-modal-shell">
            <div className="kraken-modal-head">
              <div>
                <div className="subtle mono">Kraken copy form</div>
                <h2>{suggestion.marketPair ? formatPair(suggestion.marketPair) : suggestion.asset}</h2>
              </div>
              <div className="kraken-modal-head-actions">
                {krakenUrl ? (
                  <a className="kraken-open-link" href={krakenUrl} target="_blank" rel="noreferrer">
                    Open Kraken
                  </a>
                ) : null}
                <button className="kraken-close-button" onClick={closeSuggestionModal}>
                  x
                </button>
              </div>
            </div>

            <div className="kraken-segment-row">
              <button className={`kraken-segment ${suggestion.side === "BUY" ? "active buy" : ""}`}>Kopen</button>
              <button className={`kraken-segment ${suggestion.side === "SELL" ? "active sell" : ""}`}>Verkopen</button>
            </div>

            <div className="kraken-order-type-row">
              {suggestion.templates.length === 0 ? (
                <div className="subtle text-reading">No order templates available for this balance.</div>
              ) : (
                suggestion.templates.map((template) => (
                  <button
                    key={`${suggestion.key}-${template.type}`}
                    className={`kraken-order-type ${template.type === activeTemplate?.type ? "active" : ""}`}
                    onClick={() => setActiveSuggestionOrderType(template.type)}
                  >
                    {formatOrderTypeLabel(template.type)}
                  </button>
                ))
              )}
            </div>

            {activeTemplate ? (
              <>
                <div className="kraken-balance-strip">
                  <div className="subtle">Beschikbaar tegoed</div>
                  <div className="kraken-balance-value">{activeTemplate.availableText}</div>
                </div>

                <div className="kraken-form-grid">
                  {activeTemplate.fields.map((field) => (
                    <div key={`${activeTemplate.type}-${field.label}`} className="kraken-field-card">
                      <div className="kraken-field-head">
                        <div className="kraken-field-label">{field.label}</div>
                        <button
                          type="button"
                          className="kraken-copy-button"
                          onClick={() => copySuggestionValue(field.value, `${activeTemplate.type}-${field.label}`)}
                        >
                          {copiedSuggestionFieldKey === `${activeTemplate.type}-${field.label}` ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <div className="kraken-field-value">
                        <span>{field.value}</span>
                        {field.unit ? <span className="kraken-field-unit">{field.unit}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="kraken-meta-row">
                  <div>
                    TP/SL <strong>{activeTemplate.tpSlEnabled ? "Ja" : "Nee"}</strong>
                  </div>
                  <div>
                    Trailing mode <strong>{activeTemplate.tpSlMode ?? "n/a"}</strong>
                  </div>
                </div>

                <button className={`kraken-submit-button ${suggestion.side === "SELL" ? "sell" : "buy"}`}>
                  {activeTemplate.submitLabel}
                </button>

                <div className="kraken-notes">
                  <div className="subtle text-reading">Why this template</div>
                  <ul className="flat-list">
                    {[suggestion.summary, ...suggestion.notes, ...activeTemplate.notes].slice(0, 5).map((note) => (
                      <li key={`${suggestion.key}-${activeTemplate.type}-${note}`}>{note}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <div className="warning text-reading">No actionable order template is available for this balance yet.</div>
            )}
          </div>
        ) : null}
      </Modal>
    );
  };

  const renderDiagnosticsPanel = () => (
    <section className="panel assistant-layout-item diagnostics-item">
      <div className="panel-inner">
        <details className="diagnostics-drawer" open={diagnosticsOpen} onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}>
          <summary>
            Diagnostics {diagnostics.length > 0 ? <span className="badge alert compact-chip">{diagnostics.length}</span> : null}
          </summary>
          <div className="diagnostics-actions">
            <button className="action-button compact" onClick={() => setDiagnostics([])}>
              Clear Diagnostics
            </button>
          </div>
          {diagnostics.length === 0 ? (
            <div className="subtle text-reading">No diagnostics logged.</div>
          ) : (
            <ul className="flat-list mono">
              {diagnostics.map((entry) => (
                <li key={entry.id}>
                  [{entry.at}] {entry.scope}: {entry.message}
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </section>
  );

  return (
    <main className="page-shell">
      <div className="page-frame">
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
              <button className="action-button compact" onClick={refreshAccountSnapshot} disabled={refreshingAccountSnapshot}>
                {refreshingAccountSnapshot ? "Refreshing..." : "Refresh Kraken"}
              </button>
            </section>
            <div className="assistant-header-grid">
              <div className="assistant-top-stack">
                {renderBalancesPanel()}
                {renderSuggestionsPanel()}
              </div>
              <div className="assistant-top-right">
                {renderSentimentPanel()}
              </div>
            </div>
            <div className="assistant-layout-grid">
              <div className="assistant-main-column">
                {renderAssistantPanel()}
              </div>
              <div className="assistant-side-column">
                {renderAccountPanel()}
                {renderControlsPanel()}
                {renderDiagnosticsPanel()}
              </div>
            </div>
            {renderSuggestionModal()}
          </>
        ) : activeTab === "AUTOMATION" ? (
          <AutomationTab />
        ) : (
          <section className="panel">
            <div className="panel-inner text-reading">
              <h2>Glossary</h2>
              <div className="subtle text-reading">Plain-language explanations for trading terms used across the Assistant.</div>
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
