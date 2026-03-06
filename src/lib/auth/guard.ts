import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  APP_AUTH_COOKIE_NAME,
  hasValidSessionCookie,
  isPasswordProtectionConfigured
} from "@/lib/auth/session";

export const requireAuthenticatedApiRequest = async (request: NextRequest): Promise<NextResponse | null> => {
  if (!isPasswordProtectionConfigured()) {
    return NextResponse.json(
      {
        message: "APP_PASSWORD is not configured."
      },
      {
        status: 503
      }
    );
  }

  const isAuthenticated = await hasValidSessionCookie(request.cookies.get(APP_AUTH_COOKIE_NAME)?.value);

  if (isAuthenticated) {
    return null;
  }

  return NextResponse.json(
    {
      message: "Authentication required."
    },
    {
      status: 401
    }
  );
};
