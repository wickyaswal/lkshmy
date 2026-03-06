import { NextRequest, NextResponse } from "next/server";

import { getAssistantPositionsState, parseAssistantPairs } from "@/lib/assistant/data-providers";
import { requireAuthenticatedApiRequest } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authError = await requireAuthenticatedApiRequest(request);

  if (authError) {
    return authError;
  }

  try {
    const pairs = parseAssistantPairs(request.nextUrl.searchParams.get("pairs"), ["BTCUSDT"], 3);
    const forceRefresh = request.nextUrl.searchParams.get("force_refresh") === "true";
    const payload = await getAssistantPositionsState({
      pairs,
      forceRefresh
    });

    return NextResponse.json({
      state: payload
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Unable to fetch position state."
      },
      {
        status: 500
      }
    );
  }
}
