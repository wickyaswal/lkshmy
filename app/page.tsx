import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { TradingAssistantShell } from "@/components/trading-assistant-shell";
import { APP_AUTH_COOKIE_NAME, hasValidSessionCookie, sanitizeNextPath } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  const cookieStore = await cookies();
  const isAuthenticated = await hasValidSessionCookie(cookieStore.get(APP_AUTH_COOKIE_NAME)?.value);

  if (!isAuthenticated) {
    redirect(`/login?next=${encodeURIComponent(sanitizeNextPath("/"))}`);
  }

  return <TradingAssistantShell />;
}
