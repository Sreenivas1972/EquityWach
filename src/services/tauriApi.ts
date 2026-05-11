import { invoke } from "@tauri-apps/api/core";
import type {
  AuthStatus,
  ChartDataResponse,
  ChartNote,
  ColorFilteredSymbol,
  FetchSettings,
  LastSelection,
  LongPosition,
  PivotSource,
  PriceAlert,
  RetentionSettings,
  SavedKiteCredentials,
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

  getSymbolsWithAlerts: () =>
    invoke<ColorFilteredSymbol[]>("get_symbols_with_alerts"),

  getSymbolsWithPositions: () =>
    invoke<ColorFilteredSymbol[]>("get_symbols_with_positions"),

  getSymbolsByHashtag: (hashtag: string) =>
    invoke<ColorFilteredSymbol[]>("get_symbols_by_hashtag", { hashtag }),

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

  // ── Kite auth ─────────────────────────────────────────────────────────────
  getAuthStatus: () => invoke<AuthStatus>("get_auth_status"),

  getSavedKiteCredentials: () =>
    invoke<SavedKiteCredentials | null>("get_saved_kite_credentials"),

  saveKiteCredentials: (apiKey: string, apiSecret: string) =>
    invoke<void>("save_kite_credentials", { apiKey, apiSecret }),

  kiteStartLogin: () => invoke<string>("kite_start_login"),

  kiteLogout: () => invoke<void>("kite_logout"),

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

  lookupInstrumentKeys: (symbols: Array<[string, string]>) =>
    invoke<Array<[string, string | null]>>("lookup_instrument_keys", { symbols }),

  // ── Chart Notes ───────────────────────────────────────────────────────────
  getChartNotes: (symbol: string, panelType: string) =>
    invoke<ChartNote[]>("get_chart_notes", { symbol, panelType }),

  addChartNote: (
    symbol: string,
    panelType: string,
    noteText: string,
    anchorTime: number,
    anchorPrice: number
  ) =>
    invoke<string>("add_chart_note", {
      symbol,
      panelType,
      noteText,
      anchorTime,
      anchorPrice,
    }),

  updateChartNote: (
    id: string,
    noteText: string,
    posX: number | null,
    posY: number | null
  ) =>
    invoke<void>("update_chart_note", { id, noteText, posX, posY }),

  updateChartNotePosition: (id: string, posX: number, posY: number) =>
    invoke<void>("update_chart_note_position", { id, posX, posY }),

  deleteChartNote: (id: string) =>
    invoke<void>("delete_chart_note", { id }),

  getAllHashtags: () =>
    invoke<string[]>("get_all_hashtags"),
};
