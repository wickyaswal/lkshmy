import { NextRequest, NextResponse } from "next/server";

import { getAssistantMarketState, parseAssistantPairs } from "@/lib/assistant/data-providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const pairs = parseAssistantPairs(request.nextUrl.searchParams.get("pairs"), ["BTCUSDT"], 3);
    const timeframe = request.nextUrl.searchParams.get("timeframe") === "5m" ? "5m" : "5m";
    const parsedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "120");
    const safeLimit = Number.isFinite(parsedLimit) ? parsedLimit : 120;
    const limit = Math.max(60, Math.min(300, safeLimit));
    const payload = await getAssistantMarketState({
      pairs,
      timeframe,
      limit
    });

    return NextResponse.json({
      state: payload
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Unable to fetch market snapshot."
      },
      {
        status: 500
      }
    );
  }
}
