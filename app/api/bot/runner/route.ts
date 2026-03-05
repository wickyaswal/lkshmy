import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    message: "Automation runner endpoint is disabled in manual assistant phase."
  }, {
    status: 410
  });
}

export async function POST(_request: NextRequest) {
  return NextResponse.json({
    message: "Automation runner endpoint is disabled in manual assistant phase."
  }, {
    status: 410
  });
}
