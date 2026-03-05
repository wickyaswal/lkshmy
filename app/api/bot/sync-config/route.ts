import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({
    message: "Sync config endpoint is disabled in manual assistant phase."
  }, {
    status: 410
  });
}
