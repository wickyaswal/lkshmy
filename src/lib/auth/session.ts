const SESSION_NAMESPACE = "fiat-buffer-trading-assistant:session:v1";

export const APP_AUTH_COOKIE_NAME = "assistant_session";
export const APP_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const encoder = new TextEncoder();

const getConfiguredPassword = (): string => (process.env.APP_PASSWORD ?? "").trim();

const toHex = (input: ArrayBuffer): string =>
  Array.from(new Uint8Array(input))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const digestSha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(digest);
};

const safeEqual = (left: string, right: string): boolean => {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return mismatch === 0;
};

const buildSessionTokenForPassword = async (password: string): Promise<string> =>
  digestSha256(`${SESSION_NAMESPACE}:${password}`);

export const isPasswordProtectionConfigured = (): boolean => getConfiguredPassword().length > 0;

export const verifyPassword = async (submittedPassword: string): Promise<boolean> => {
  const configuredPassword = getConfiguredPassword();

  if (!configuredPassword) {
    return false;
  }

  const [submittedDigest, configuredDigest] = await Promise.all([
    digestSha256(submittedPassword),
    digestSha256(configuredPassword)
  ]);

  return safeEqual(submittedDigest, configuredDigest);
};

export const createSessionCookieValue = async (): Promise<string | null> => {
  const configuredPassword = getConfiguredPassword();

  if (!configuredPassword) {
    return null;
  }

  return buildSessionTokenForPassword(configuredPassword);
};

export const hasValidSessionCookie = async (cookieValue: string | null | undefined): Promise<boolean> => {
  if (!cookieValue) {
    return false;
  }

  const expected = await createSessionCookieValue();

  if (!expected) {
    return false;
  }

  return safeEqual(cookieValue, expected);
};

export const sanitizeNextPath = (value: string | null | undefined): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  if (value === "/login" || value.startsWith("/login?")) {
    return "/";
  }

  if (value.startsWith("/api/auth/login")) {
    return "/";
  }

  return value;
};
