import { getGoogleSheetsRepository, type GoogleSheetsRepository } from "@/lib/sheets/google-sheets";
import { parseBotConfig } from "@/lib/trading/config";
import { detectExchangeAvailability, resolveTrackedPairs } from "@/lib/trading/exchange";
import { toInternalPair } from "@/lib/trading/symbol-normalization";
import type { BotConfig, BotStatusSnapshot, ExchangeDiscovery, PairSelectionRow } from "@/lib/trading/types";
import { parseBooleanLike } from "@/lib/utils";

const CONFIG_CACHE_MS = 15_000;
const PAIR_SELECTION_CACHE_MS = 15_000;

export class ConfigService {
  private configCache: { value: BotConfig; fetchedAt: number } | null = null;
  private pairSelectionCache: { value: PairSelectionRow[]; fetchedAt: number } | null = null;

  constructor(private readonly sheets: GoogleSheetsRepository = getGoogleSheetsRepository()) {}

  async ensureReady(): Promise<void> {
    await this.sheets.ensureTemplates();
  }

  async getConfig(forceRefresh = false): Promise<BotConfig> {
    const now = Date.now();
    if (!forceRefresh && this.configCache && now - this.configCache.fetchedAt < CONFIG_CACHE_MS) {
      return this.configCache.value;
    }

    const rows = await this.sheets.getConfigRows();
    const parsed = parseBotConfig(rows);
    this.configCache = {
      value: parsed,
      fetchedAt: now
    };
    return parsed;
  }

  getStatus(config?: BotConfig): Promise<BotStatusSnapshot> {
    return this.sheets.getStatus(config);
  }

  async getPairSelectionRows(forceRefresh = false): Promise<PairSelectionRow[]> {
    const now = Date.now();
    if (!forceRefresh && this.pairSelectionCache && now - this.pairSelectionCache.fetchedAt < PAIR_SELECTION_CACHE_MS) {
      return this.pairSelectionCache.value;
    }

    const rows = await this.sheets.getPairSelectionRows();
    this.pairSelectionCache = {
      value: rows,
      fetchedAt: now
    };
    return rows;
  }

  async getTrackedPairs(config: BotConfig, forceRefresh = false): Promise<string[]> {
    const rows = await this.getPairSelectionRows(forceRefresh);
    const selectedPairs = rows.filter((row) => parseBooleanLike(row.selected)).map((row) => toInternalPair(row.symbol));

    return resolveTrackedPairs({
      activeSymbol: config.activeSymbol,
      selectedPairs: config.pairSelectionMode === "SHEET_SELECTED" ? selectedPairs : undefined
    });
  }

  detectExchanges(): ExchangeDiscovery {
    return detectExchangeAvailability();
  }
}
