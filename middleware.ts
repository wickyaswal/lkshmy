import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  APP_AUTH_COOKIE_NAME,
  sanitizeNextPath
} from "@/lib/auth/session";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login"
]);

const isStaticAsset = (pathname: string): boolean =>
  pathname.startsWith("/_next/") ||
  pathname === "/favicon.ico" ||
  pathname === "/robots.txt" ||
  pathname === "/sitemap.xml";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isStaticAsset(pathname) || PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const hasSessionCookie = Boolean(request.cookies.get(APP_AUTH_COOKIE_NAME)?.value);

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        message: "Authentication required."
      },
      {
        status: 401
      }
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", sanitizeNextPath(`${pathname}${search}`));
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
