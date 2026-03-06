import { isPasswordProtectionConfigured, sanitizeNextPath } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = Record<string, string | string[] | undefined>;

const readString = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : null;

const getErrorMessage = (errorCode: string | null, passwordConfigured: boolean): string | null => {
  if (!passwordConfigured) {
    return "APP_PASSWORD is not configured. Set it in .env.local before using the app.";
  }

  if (errorCode === "invalid") {
    return "Incorrect password.";
  }

  if (errorCode === "config") {
    return "Password protection is enabled but APP_PASSWORD is missing.";
  }

  return null;
};

export default async function LoginPage(input: {
  searchParams?: Promise<SearchParams>;
}) {
  const searchParams: SearchParams = (await input.searchParams) ?? {};
  const passwordConfigured = isPasswordProtectionConfigured();
  const nextPath = sanitizeNextPath(readString(searchParams.next));
  const errorMessage = getErrorMessage(readString(searchParams.error), passwordConfigured);

  return (
    <main className="page-shell auth-page">
      <div className="page-frame auth-frame">
        <section className="panel auth-card">
          <div className="panel-inner">
            <h1>Fiat Buffer Trading Assistant</h1>
            <p className="text-reading auth-copy">
              Enter the application password to access the Kraken assistant. The session stays active until the cookie
              is cleared or the password changes.
            </p>
            {errorMessage ? <div className="warning text-reading auth-alert">{errorMessage}</div> : null}
            <form className="auth-form" method="POST" action="/api/auth/login">
              <input type="hidden" name="next" value={nextPath} />
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter password"
                  disabled={!passwordConfigured}
                  required
                />
              </label>
              <button className="action-button primary" type="submit" disabled={!passwordConfigured}>
                Unlock
              </button>
            </form>
            <div className="subtle text-reading auth-hint">
              Configure <code>APP_PASSWORD</code> in <code>.env.local</code> and in Vercel environment variables for
              production.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
