import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isSuggestionAlertSuppressionRecord,
  mergeSuggestionAlertSuppressions,
  type SuggestionAlertSuppressionRecord
} from "@/lib/assistant/suggestion-alerts";

const MARKDOWN_STORE_PATH = path.join(process.cwd(), "data", "ignored-ready-suggestions.md");
const JSON_FENCE_PATTERN = /```json\n([\s\S]*?)\n```/;

export const getSuggestionAlertStorePath = (): string => MARKDOWN_STORE_PATH;

export const parseSuggestionAlertMarkdown = (content: string): SuggestionAlertSuppressionRecord[] => {
  const jsonBlock = content.match(JSON_FENCE_PATTERN)?.[1];
  if (!jsonBlock) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonBlock) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return mergeSuggestionAlertSuppressions(parsed.filter(isSuggestionAlertSuppressionRecord));
  } catch {
    return [];
  }
};

export const serializeSuggestionAlertMarkdown = (
  records: SuggestionAlertSuppressionRecord[]
): string => {
  const merged = mergeSuggestionAlertSuppressions(records);
  const body = JSON.stringify(merged, null, 2);

  return [
    "# Ignored READY Suggestion Notifications",
    "",
    "This markdown file acts as a local database for READY suggestions that the user suppressed in the Assistant UI.",
    "When the app runs on a writable local filesystem, suppression changes are persisted here.",
    "",
    "```json",
    body,
    "```",
    ""
  ].join("\n");
};

export const readSuggestionAlertSuppressions = async (): Promise<SuggestionAlertSuppressionRecord[]> => {
  try {
    const content = await readFile(MARKDOWN_STORE_PATH, "utf8");
    return parseSuggestionAlertMarkdown(content);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

export const writeSuggestionAlertSuppressions = async (
  records: SuggestionAlertSuppressionRecord[]
): Promise<SuggestionAlertSuppressionRecord[]> => {
  const merged = mergeSuggestionAlertSuppressions(records);
  await mkdir(path.dirname(MARKDOWN_STORE_PATH), {
    recursive: true
  });
  await writeFile(MARKDOWN_STORE_PATH, serializeSuggestionAlertMarkdown(merged), "utf8");
  return merged;
};

export const upsertSuggestionAlertSuppression = async (
  record: SuggestionAlertSuppressionRecord
): Promise<SuggestionAlertSuppressionRecord[]> => {
  const current = await readSuggestionAlertSuppressions();
  return writeSuggestionAlertSuppressions([...current, record]);
};

export const removeSuggestionAlertSuppression = async (
  id: string
): Promise<SuggestionAlertSuppressionRecord[]> => {
  const current = await readSuggestionAlertSuppressions();
  return writeSuggestionAlertSuppressions(current.filter((record) => record.id !== id));
};
