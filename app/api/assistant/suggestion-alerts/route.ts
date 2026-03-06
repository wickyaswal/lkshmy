import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedApiRequest } from "@/lib/auth/guard";
import {
  isSuggestionAlertSuppressionRecord,
  type SuggestionAlertSuppressionRecord
} from "@/lib/assistant/suggestion-alerts";
import {
  readSuggestionAlertSuppressions,
  removeSuggestionAlertSuppression,
  upsertSuggestionAlertSuppression
} from "@/lib/assistant/suggestion-alert-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SuggestionAlertsPayload = {
  suppressions?: SuggestionAlertSuppressionRecord[];
  message?: string;
};

const toStorageErrorResponse = (error: unknown): NextResponse<SuggestionAlertsPayload> => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const message =
    code === "EROFS" || code === "EACCES" || code === "EPERM"
      ? "Suggestion suppressions could not be written to the markdown store in this environment."
      : error instanceof Error
        ? error.message
        : "Suggestion suppression storage is unavailable.";

  return NextResponse.json(
    {
      message
    },
    {
      status: code === "EROFS" || code === "EACCES" || code === "EPERM" ? 503 : 500
    }
  );
};

export async function GET(request: NextRequest) {
  const authError = await requireAuthenticatedApiRequest(request);
  if (authError) {
    return authError;
  }

  try {
    const suppressions = await readSuggestionAlertSuppressions();
    return NextResponse.json({
      suppressions
    });
  } catch (error) {
    return toStorageErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuthenticatedApiRequest(request);
  if (authError) {
    return authError;
  }

  try {
    const body = (await request.json()) as {
      action?: "suppress" | "unsuppress";
      record?: unknown;
      id?: unknown;
    };

    if (body.action === "suppress") {
      if (!isSuggestionAlertSuppressionRecord(body.record)) {
        return NextResponse.json(
          {
            message: "Invalid suppression record."
          },
          {
            status: 400
          }
        );
      }

      const suppressions = await upsertSuggestionAlertSuppression(body.record);
      return NextResponse.json({
        suppressions
      });
    }

    if (body.action === "unsuppress") {
      if (typeof body.id !== "string" || body.id.trim().length === 0) {
        return NextResponse.json(
          {
            message: "Invalid suppression id."
          },
          {
            status: 400
          }
        );
      }

      const suppressions = await removeSuggestionAlertSuppression(body.id);
      return NextResponse.json({
        suppressions
      });
    }

    return NextResponse.json(
      {
        message: "Unsupported action."
      },
      {
        status: 400
      }
    );
  } catch (error) {
    return toStorageErrorResponse(error);
  }
}
