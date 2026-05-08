import { invoke } from "@tauri-apps/api/core";
import type {
  AuthStatus,
  ChartDataResponse,
  ColorFilteredSymbol,
  FetchSettings,
  LastSelection,
  LongPosition,
  NewsResponse,
  PivotSource,
  PriceAlert,
  RetentionSettings,
  SavedUpstoxCredentials,
  SymbolSearchResult,
  WatchlistEntry,
  WatchlistSymbol,
} from "../types";

export const api = {
  // ── Watchlists ───────────────────────────────────────────────────────────
  listWatchlists: () => invoke<WatchlistEntry[]>("list_watchlists"),

  addWatchlist: (name: string, symbols: string[]) =>
    invoke<void>("add_watchlist", { name, symbols }),

  removeWatchlist: (name: string) => invoke<void>("remove_watchlist", { name }),

  loadSymbols: (watchlistName: string) =>
    invoke<WatchlistSymbol[]>("load_symbols", { watchlistName }),

  searchSymbol: (symbol: string) =>
    invoke<SymbolSearchResult[]>("search_symbol", { symbol }),

  getSymbolsByColor: (color: string | null, tagColor: string | null) =>
    invoke<ColorFilteredSymbol[]>("get_symbols_by_color", { color, tagColor }),

  updateSymbolColor: (watchlistName: string, symbol: string, color: string | null) =>
    invoke<void>("update_symbol_color", { watchlistName, symbol, color }),

  updateSymbolTagColor: (watchlistName: string, symbol: string, tagColor: string | null) =>
    invoke<void>("update_symbol_tag_color", { watchlistName, symbol, tagColor }),

  addSymbolToWatchlist: (watchlistName: string, symbol: string) =>
    invoke<void>("add_symbol_to_watchlist", { watchlistName, symbol }),

  removeSymbol: (watchlistName: string, symbol: string) =>
    invoke<void>("remove_symbol", { watchlistName, symbol }),

  migrateWatchlists: () => invoke<void>("migrate_watchlists"),

  // ── Last selection ────────────────────────────────────────────────────────
  getLastSelection: () => invoke<LastSelection>("get_last_selection"),

  setLastSelection: (
    watchlistName: string | null,
    symbol: string | null,
    interval: string | null,
    lastPickedWatchlist?: string | null
  ) =>
    invoke<void>("set_last_selection", { watchlistName, symbol, interval, lastPickedWatchlist }),

  // ── Chart data ────────────────────────────────────────────────────────────
  getChartData: (symbol: string, interval: string) =>
    invoke<ChartDataResponse>("get_chart_data", { symbol, interval }),

  refreshChartData: (symbol: string, interval: string) =>
    invoke<ChartDataResponse>("refresh_chart_data", { symbol, interval }),

  getPivotSource: (symbol: string, interval: string) =>
    invoke<PivotSource | null>("get_pivot_source", { symbol, interval }),

  // ── Instruments ───────────────────────────────────────────────────────────
  refreshInstruments: () => invoke<number>("refresh_instruments"),
  getInstrumentsCount: () => invoke<number>("get_instruments_count"),

  // ── Retention settings ────────────────────────────────────────────────────
  getRetentionSettings: () => invoke<RetentionSettings>("get_retention_settings"),

  updateRetentionSettings: (settings: RetentionSettings) =>
    invoke<number>("update_retention_settings", { settings }),

  // ── Fetch settings ──────────────────────────────────────────────────────────
  getFetchSettings: () => invoke<FetchSettings>("get_fetch_settings"),

  updateFetchSettings: (settings: FetchSettings) =>
    invoke<void>("update_fetch_settings", { settings }),

  // ── Upstox auth ─────────────────────────────────────────────────────────────
  getAuthStatus: () => invoke<AuthStatus>("get_auth_status"),

  getSavedUpstoxCredentials: () =>
    invoke<SavedUpstoxCredentials | null>("get_saved_upstox_credentials"),

  saveUpstoxCredentials: (apiKey: string, apiSecret: string) =>
    invoke<void>("save_upstox_credentials", { apiKey, apiSecret }),

  upstoxStartLogin: () => invoke<string>("upstox_start_login"),

  upstoxLogout: () => invoke<void>("upstox_logout"),

  saveAnalyticsToken: (token: string) =>
    invoke<void>("save_analytics_token", { token }),

  clearAnalyticsToken: () => invoke<void>("clear_analytics_token"),

  // ── Drawing Storage ───────────────────────────────────────────────────────
  loadSrDrawings: (symbol: string) => invoke<string[]>("load_sr_drawings", { symbol }),

  saveSrDrawings: (symbol: string, drawingsJson: string) =>
    invoke<void>("save_sr_drawings", { symbol, drawingsJson }),

  clearSrDrawings: (symbol: string) => invoke<void>("clear_sr_drawings", { symbol }),

  loadFibDrawings: (symbol: string) => invoke<string | null>("load_fib_drawings", { symbol }),

  saveFibDrawings: (symbol: string, drawingsJson: string) =>
    invoke<void>("save_fib_drawings", { symbol, drawingsJson }),

  clearFibDrawings: (symbol: string) => invoke<void>("clear_fib_drawings", { symbol }),

  // ── Trendline Logging ─────────────────────────────────────────────────────
  logTrendlineEvent: (eventType: string, symbol: string, trendlineId: string, aTime: number, aPrice: number, bTime: number, bPrice: number) =>
    invoke<void>("log_trendline_event", { eventType, symbol, trendlineId, aTime, aPrice, bTime, bPrice }),

  // ── Price Alerts ───────────────────────────────────────────────────────────
  addPriceAlert: (symbol: string, targetPrice: number, direction: string) =>
    invoke<void>("add_price_alert", { symbol, targetPrice, direction }),

  getPriceAlerts: (symbol: string) =>
    invoke<PriceAlert[]>("get_price_alerts", { symbol }),

  getAllPriceAlerts: () =>
    invoke<PriceAlert[]>("get_all_price_alerts"),

  deletePriceAlert: (id: string) =>
    invoke<void>("delete_price_alert", { id }),

  checkPriceAlerts: () =>
    invoke<void>("check_price_alerts"),

  // ── Long Positions ───────────────────────────────────────────────────────────
  addLongPosition: (
    symbol: string,
    entryPrice: number,
    slPrice: number,
    targetPrice: number,
    entryTime: number,
    interval: string
  ) =>
    invoke<string>("add_long_position", {
      symbol,
      entryPrice,
      slPrice,
      targetPrice,
      entryTime,
      interval,
    }),

  getLongPositions: (symbol: string, interval: string) =>
    invoke<LongPosition[]>("get_long_positions", { symbol, interval }),

  updateLongPosition: (id: string, slPrice: number, targetPrice: number) =>
    invoke<void>("update_long_position", { id, slPrice, targetPrice }),

  deleteLongPosition: (id: string) =>
    invoke<void>("delete_long_position", { id }),

  // ── News ─────────────────────────────────────────────────────────────────────
  getNews: (instrumentKeys: string[]) =>
    invoke<NewsResponse>("get_news", { instrumentKeys }),

  lookupInstrumentKeys: (symbols: Array<[string, string]>) =>
    invoke<Array<[string, string | null]>>("lookup_instrument_keys", { symbols }),
};
