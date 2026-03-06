import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedApiRequest } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authError = await requireAuthenticatedApiRequest(request);

  if (authError) {
    return authError;
  }

  return NextResponse.json({
    message: "Automation runner endpoint is disabled in manual assistant phase."
  }, {
    status: 410
  });
}

export async function POST(_request: NextRequest) {
  const authError = await requireAuthenticatedApiRequest(_request);

  if (authError) {
    return authError;
  }

  return NextResponse.json({
    message: "Automation runner endpoint is disabled in manual assistant phase."
  }, {
    status: 410
  });
}
