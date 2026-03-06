import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedApiRequest } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authError = await requireAuthenticatedApiRequest(request);

  if (authError) {
    return authError;
  }

  return NextResponse.json({
    message: "Sync config endpoint is disabled in manual assistant phase."
  }, {
    status: 410
  });
}
