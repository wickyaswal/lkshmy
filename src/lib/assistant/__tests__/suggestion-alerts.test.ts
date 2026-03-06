import { describe, expect, it } from "vitest";

import {
  buildSuggestionAlertId,
  createSuggestionAlertSuppressionRecord,
  mergeSuggestionAlertSuppressions,
  type SuggestionAlertSuppressionRecord
} from "@/lib/assistant/suggestion-alerts";
import {
  parseSuggestionAlertMarkdown,
  serializeSuggestionAlertMarkdown
} from "@/lib/assistant/suggestion-alert-store";

const baseSuggestion = {
  key: "quote-EUR",
  asset: "EUR",
  marketPair: "BTCEUR",
  side: "BUY" as const,
  status: "READY" as const,
  primaryOrderType: "LIMIT" as const,
  headline: "EUR can fund a deterministic BTC buy setup.",
};

describe("suggestion alert helpers", () => {
  it("builds a stable alert id from material suggestion fields", () => {
    const left = buildSuggestionAlertId(baseSuggestion);
    const right = buildSuggestionAlertId({
      ...baseSuggestion
    });

    expect(left).toBe(right);
  });

  it("changes the alert id when the semantic action changes", () => {
    const current = buildSuggestionAlertId(baseSuggestion);
    const changed = buildSuggestionAlertId({
      ...baseSuggestion,
      primaryOrderType: "TRAILING_STOP_LIMIT",
      headline: "EUR is now better used for a protective trailing setup."
    });

    expect(changed).not.toBe(current);
  });

  it("deduplicates suppression records by id and keeps the newest timestamp", () => {
    const older: SuggestionAlertSuppressionRecord = {
      ...createSuggestionAlertSuppressionRecord(baseSuggestion),
      ignoredAt: "2026-03-06T10:00:00.000Z"
    };
    const newer: SuggestionAlertSuppressionRecord = {
      ...older,
      ignoredAt: "2026-03-06T10:05:00.000Z"
    };

    const merged = mergeSuggestionAlertSuppressions([older, newer]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.ignoredAt).toBe("2026-03-06T10:05:00.000Z");
  });

  it("serializes and parses markdown suppression records", () => {
    const records: SuggestionAlertSuppressionRecord[] = [
      {
        ...createSuggestionAlertSuppressionRecord(baseSuggestion),
        ignoredAt: "2026-03-06T10:10:00.000Z"
      }
    ];

    const markdown = serializeSuggestionAlertMarkdown(records);
    const parsed = parseSuggestionAlertMarkdown(markdown);

    expect(markdown).toContain("# Ignored READY Suggestion Notifications");
    expect(parsed).toEqual(records);
  });
});
