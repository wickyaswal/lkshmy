import type {
  AccountSuggestionStatus,
  BalanceSuggestion,
  KrakenOrderTemplateType
} from "@/lib/assistant/account-suggestions";

export type SuggestionAlertSuppressionRecord = {
  id: string;
  suggestionKey: string;
  asset: string;
  marketPair: string | null;
  side: "BUY" | "SELL";
  status: AccountSuggestionStatus;
  primaryOrderType: KrakenOrderTemplateType | null;
  headline: string;
  ignoredAt: string;
};

type SuggestionAlertIdentityInput = Pick<
  BalanceSuggestion,
  "key" | "asset" | "marketPair" | "side" | "status" | "primaryOrderType" | "headline"
>;

export const isSuggestionAlertSuppressionRecord = (
  value: unknown
): value is SuggestionAlertSuppressionRecord => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<SuggestionAlertSuppressionRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.suggestionKey === "string" &&
    typeof record.asset === "string" &&
    (record.marketPair === null || typeof record.marketPair === "string") &&
    (record.side === "BUY" || record.side === "SELL") &&
    (record.status === "READY" || record.status === "WATCH" || record.status === "NO_ACTION") &&
    (record.primaryOrderType === null || typeof record.primaryOrderType === "string") &&
    typeof record.headline === "string" &&
    typeof record.ignoredAt === "string"
  );
};

export const buildSuggestionAlertId = (suggestion: SuggestionAlertIdentityInput): string =>
  [
    suggestion.key,
    suggestion.asset.toUpperCase(),
    suggestion.marketPair ?? "n/a",
    suggestion.side,
    suggestion.status,
    suggestion.primaryOrderType ?? "n/a",
    suggestion.headline
  ].join("|");

export const createSuggestionAlertSuppressionRecord = (
  suggestion: Pick<
    BalanceSuggestion,
    "key" | "asset" | "marketPair" | "side" | "status" | "primaryOrderType" | "headline"
  >
): SuggestionAlertSuppressionRecord => ({
  id: buildSuggestionAlertId(suggestion),
  suggestionKey: suggestion.key,
  asset: suggestion.asset,
  marketPair: suggestion.marketPair,
  side: suggestion.side,
  status: suggestion.status,
  primaryOrderType: suggestion.primaryOrderType,
  headline: suggestion.headline,
  ignoredAt: new Date().toISOString()
});

export const mergeSuggestionAlertSuppressions = (
  records: SuggestionAlertSuppressionRecord[]
): SuggestionAlertSuppressionRecord[] => {
  const merged = new Map<string, SuggestionAlertSuppressionRecord>();

  for (const record of records) {
    const existing = merged.get(record.id);
    if (!existing || record.ignoredAt > existing.ignoredAt) {
      merged.set(record.id, record);
    }
  }

  return Array.from(merged.values()).sort((left, right) => right.ignoredAt.localeCompare(left.ignoredAt));
};
