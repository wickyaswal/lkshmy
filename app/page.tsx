import { TradingAssistantShell } from "@/components/trading-assistant-shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  return <TradingAssistantShell />;
}
