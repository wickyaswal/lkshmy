import { afterEach, describe, expect, it } from "vitest";

import {
  createSessionCookieValue,
  hasValidSessionCookie,
  isPasswordProtectionConfigured,
  sanitizeNextPath,
  verifyPassword
} from "@/lib/auth/session";

const ORIGINAL_PASSWORD = process.env.APP_PASSWORD;

describe("auth session helpers", () => {
  afterEach(() => {
    if (ORIGINAL_PASSWORD === undefined) {
      delete process.env.APP_PASSWORD;
      return;
    }

    process.env.APP_PASSWORD = ORIGINAL_PASSWORD;
  });

  it("verifies the configured password and rejects the wrong one", async () => {
    process.env.APP_PASSWORD = "top-secret";

    await expect(verifyPassword("top-secret")).resolves.toBe(true);
    await expect(verifyPassword("wrong-secret")).resolves.toBe(false);
    expect(isPasswordProtectionConfigured()).toBe(true);
  });

  it("creates and validates the session cookie value", async () => {
    process.env.APP_PASSWORD = "persist-me";

    const cookieValue = await createSessionCookieValue();

    expect(cookieValue).toBeTruthy();
    await expect(hasValidSessionCookie(cookieValue)).resolves.toBe(true);
    await expect(hasValidSessionCookie("invalid-cookie")).resolves.toBe(false);
  });

  it("sanitizes redirect targets to internal paths only", () => {
    expect(sanitizeNextPath("/")).toBe("/");
    expect(sanitizeNextPath("/assistant?tab=kraken")).toBe("/assistant?tab=kraken");
    expect(sanitizeNextPath("https://example.com")).toBe("/");
    expect(sanitizeNextPath("//evil.example")).toBe("/");
    expect(sanitizeNextPath("/login")).toBe("/");
    expect(sanitizeNextPath("/api/auth/login")).toBe("/");
  });
});
