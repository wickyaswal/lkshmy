type AppEnv = {
  spreadsheetId: string;
  googleApplicationCredentialsPath?: string;
  googleServiceAccountJson?: string;
  googleServiceAccountEmail?: string;
  googleServiceAccountPrivateKey?: string;
  sheetsFlushIntervalSeconds: number;
  sheetsStatusWriteIntervalSeconds: number;
  liveTradingEnabled: boolean;
  krakenApiKey?: string;
  krakenApiSecret?: string;
  krakenRestBaseUrl: string;
  krakenWsUrl: string;
  coinbaseApiKey?: string;
  coinbaseApiSecret?: string;
  coinbasePassphrase?: string;
  botTimezone: string;
  demoFeePct: number;
  demoSlippagePct: number;
  openaiApiKey?: string;
  openaiModel: string;
};

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (!value) {
    return defaultValue;
  }

  return value.trim().toLowerCase() === "true";
};

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

let cachedEnv: AppEnv | null = null;

export const getEnv = (): AppEnv => {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = {
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "",
    googleApplicationCredentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    googleServiceAccountPrivateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    sheetsFlushIntervalSeconds: Math.max(5, Math.trunc(parseNumber(process.env.SHEETS_FLUSH_INTERVAL_SECONDS, 20))),
    sheetsStatusWriteIntervalSeconds: Math.max(
      10,
      Math.trunc(parseNumber(process.env.SHEETS_STATUS_WRITE_INTERVAL_SECONDS, 60))
    ),
    liveTradingEnabled: parseBoolean(process.env.LIVE_TRADING_ENABLED, false),
    krakenApiKey: process.env.KRAKEN_API_KEY,
    krakenApiSecret: process.env.KRAKEN_API_SECRET,
    krakenRestBaseUrl: process.env.KRAKEN_REST_BASE_URL ?? "https://api.kraken.com",
    krakenWsUrl: process.env.KRAKEN_WS_URL ?? "wss://ws.kraken.com",
    coinbaseApiKey: process.env.COINBASE_API_KEY,
    coinbaseApiSecret: process.env.COINBASE_API_SECRET,
    coinbasePassphrase: process.env.COINBASE_API_PASSPHRASE,
    botTimezone: process.env.BOT_TIMEZONE ?? "Europe/Amsterdam",
    demoFeePct: parseNumber(process.env.DEMO_FEE_PCT, 0.001),
    demoSlippagePct: parseNumber(process.env.DEMO_SLIPPAGE_PCT, 0.0005),
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini"
  };

  return cachedEnv;
};

export const requireSpreadsheetId = (): string => {
  const { spreadsheetId } = getEnv();

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID is required.");
  }

  return spreadsheetId;
};
