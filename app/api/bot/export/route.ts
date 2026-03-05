import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    message: "Legacy export endpoint is disabled in manual assistant phase."
  }, {
    status: 410
  });
}
