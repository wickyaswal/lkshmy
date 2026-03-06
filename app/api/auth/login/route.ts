import { NextRequest, NextResponse } from "next/server";

import {
  APP_AUTH_COOKIE_MAX_AGE_SECONDS,
  APP_AUTH_COOKIE_NAME,
  createSessionCookieValue,
  isPasswordProtectionConfigured,
  sanitizeNextPath,
  verifyPassword
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const isJsonRequest = (request: NextRequest): boolean =>
  request.headers.get("content-type")?.includes("application/json") ?? false;

const buildRedirectResponse = (request: NextRequest, nextPath: string, error?: string): NextResponse => {
  const target = new URL(error ? "/login" : nextPath, request.url);

  if (error) {
    target.searchParams.set("error", error);
    target.searchParams.set("next", nextPath);
  }

  return NextResponse.redirect(target, {
    status: 303
  });
};

export async function POST(request: NextRequest) {
  let password = "";
  let nextPath = "/";

  if (isJsonRequest(request)) {
    const payload = await request.json().catch(() => ({}));
    password = typeof payload.password === "string" ? payload.password : "";
    nextPath = sanitizeNextPath(typeof payload.next === "string" ? payload.next : "/");
  } else {
    const formData = await request.formData();
    password = typeof formData.get("password") === "string" ? String(formData.get("password")) : "";
    nextPath = sanitizeNextPath(typeof formData.get("next") === "string" ? String(formData.get("next")) : "/");
  }

  if (!isPasswordProtectionConfigured()) {
    if (isJsonRequest(request)) {
      return NextResponse.json(
        {
          message: "APP_PASSWORD is not configured."
        },
        {
          status: 503
        }
      );
    }

    return buildRedirectResponse(request, nextPath, "config");
  }

  const valid = await verifyPassword(password);

  if (!valid) {
    if (isJsonRequest(request)) {
      return NextResponse.json(
        {
          message: "Invalid password."
        },
        {
          status: 401
        }
      );
    }

    return buildRedirectResponse(request, nextPath, "invalid");
  }

  const sessionValue = await createSessionCookieValue();

  if (!sessionValue) {
    if (isJsonRequest(request)) {
      return NextResponse.json(
        {
          message: "APP_PASSWORD is not configured."
        },
        {
          status: 503
        }
      );
    }

    return buildRedirectResponse(request, nextPath, "config");
  }

  const response = isJsonRequest(request)
    ? NextResponse.json({
      ok: true,
      next: nextPath
    })
    : buildRedirectResponse(request, nextPath);

  response.cookies.set({
    name: APP_AUTH_COOKIE_NAME,
    value: sessionValue,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: APP_AUTH_COOKIE_MAX_AGE_SECONDS
  });

  return response;
}
