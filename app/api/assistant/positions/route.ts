import { NextRequest, NextResponse } from "next/server";

import { getAssistantPositionsState, parseAssistantPairs } from "@/lib/assistant/data-providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const pairs = parseAssistantPairs(request.nextUrl.searchParams.get("pairs"), ["BTCUSDT"], 3);
    const payload = await getAssistantPositionsState({
      pairs
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
