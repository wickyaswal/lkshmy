import type { NormalizedPair } from "@/lib/trading/types";

const QUOTES = ["USDT", "USD", "EUR", "GBP", "BTC", "ETH"] as const;
const BASE_ALIASES: Record<string, string> = {
  XBT: "BTC",
  XDG: "DOGE"
};

const toInternalAsset = (asset: string): string => BASE_ALIASES[asset] ?? asset;
const toKrakenAsset = (asset: string): string => (asset === "BTC" ? "XBT" : asset);

const splitBaseQuote = (pair: string): { base: string; quote: string } => {
  const normalized = pair.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (!normalized) {
    return {
      base: "BTC",
      quote: "USDT"
    };
  }

  if (normalized.length === 8 && normalized.startsWith("X") && normalized[4] === "Z") {
    const base = normalized.slice(0, 4).replace(/^X/, "");
    const quote = normalized.slice(4).replace(/^Z/, "");
    return {
      base,
      quote
    };
  }

  for (const quote of QUOTES) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return {
        base: normalized.slice(0, normalized.length - quote.length),
        quote
      };
    }
  }

  if (normalized.length === 7 && normalized.startsWith("X")) {
    return {
      base: normalized.slice(0, 3).replace(/^X/, ""),
      quote: normalized.slice(3).replace(/^Z/, "")
    };
  }

  return {
    base: normalized.slice(0, 3),
    quote: normalized.slice(3) || "USDT"
  };
};

export const splitInternalPair = (pair: string): { base: string; quote: string } => {
  const normalized = toInternalPair(pair);
  return splitBaseQuote(normalized);
};

export const getQuoteCurrencyFromPair = (pair: string): string => splitInternalPair(pair).quote;

export const toInternalPair = (pair: string): string => {
  const { base, quote } = splitBaseQuote(pair);
  return `${toInternalAsset(base)}${toInternalAsset(quote)}`;
};

export const toKrakenRestPair = (internalPair: string): string => {
  const { base, quote } = splitBaseQuote(toInternalPair(internalPair));
  return `${toKrakenAsset(base)}${toKrakenAsset(quote)}`;
};

export const toKrakenWsPair = (internalPair: string): string => {
  const { base, quote } = splitBaseQuote(toInternalPair(internalPair));
  return `${toKrakenAsset(base)}/${toKrakenAsset(quote)}`;
};

export const normalizePairForKraken = (pair: string): NormalizedPair => {
  const internal = toInternalPair(pair);
  return {
    internal,
    exchangeRest: toKrakenRestPair(internal),
    exchangeWs: toKrakenWsPair(internal)
  };
};
