import { getEnv } from "@/lib/env";
import { normalizePairForKraken, toInternalPair } from "@/lib/trading/symbol-normalization";
import type { NormalizedPair } from "@/lib/trading/types";

type KrakenAssetPairRow = {
  altname?: string;
  wsname?: string;
};

type KrakenPublicResponse<T> = {
  error: string[];
  result: T;
};

type SymbolCache = {
  expiresAt: number;
  byInternal: Map<string, NormalizedPair>;
};

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
let cache: SymbolCache | null = null;

const getRestBaseUrl = (): string => getEnv().krakenRestBaseUrl;

const buildPairMap = (rows: Record<string, KrakenAssetPairRow>): Map<string, NormalizedPair> => {
  const byInternal = new Map<string, NormalizedPair>();

  for (const [exchangeKey, row] of Object.entries(rows)) {
    const restSymbol = row.altname?.trim() || exchangeKey;
    const wsSymbol = row.wsname?.trim();
    const internal = toInternalPair(wsSymbol || restSymbol || exchangeKey);

    if (!internal || byInternal.has(internal)) {
      continue;
    }

    const fallback = normalizePairForKraken(internal);
    byInternal.set(internal, {
      internal,
      exchangeRest: restSymbol,
      exchangeWs: wsSymbol || fallback.exchangeWs
    });
  }

  return byInternal;
};

const fetchAssetPairsMap = async (restBaseUrl: string): Promise<Map<string, NormalizedPair>> => {
  const response = await fetch(`${restBaseUrl}/0/public/AssetPairs`, {
    method: "GET",
    cache: "no-store"
  });
  const payload = (await response.json()) as KrakenPublicResponse<Record<string, KrakenAssetPairRow>>;
  const message = payload.error.join(", ");

  if (!response.ok || payload.error.length > 0) {
    throw new Error(`Kraken AssetPairs API error: ${message || `${response.status} ${response.statusText}`}`);
  }

  return buildPairMap(payload.result ?? {});
};

const getCachedMap = async (restBaseUrl: string): Promise<Map<string, NormalizedPair>> => {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.byInternal;
  }

  const byInternal = await fetchAssetPairsMap(restBaseUrl);
  cache = {
    expiresAt: now + DEFAULT_CACHE_TTL_MS,
    byInternal
  };

  return byInternal;
};

export const resolveKrakenSymbol = async (pair: string, restBaseUrl = getRestBaseUrl()): Promise<NormalizedPair> => {
  const internal = toInternalPair(pair);

  try {
    const byInternal = await getCachedMap(restBaseUrl);
    return byInternal.get(internal) ?? normalizePairForKraken(internal);
  } catch {
    return normalizePairForKraken(internal);
  }
};

export const clearKrakenSymbolCache = (): void => {
  cache = null;
};
