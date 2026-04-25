import { invoke } from "@tauri-apps/api/core";
import type {
  AuthStatus,
  ChartDataResponse,
  FetchSettings,
  LastSelection,
  RetentionSettings,
  SavedKiteCredentials,
  WatchlistEntry,
} from "../types";

export const api = {
  // ── Watchlists ───────────────────────────────────────────────────────────
  listWatchlists: () => invoke<WatchlistEntry[]>("list_watchlists"),

  addWatchlist: (name: string, filePath: string) =>
    invoke<void>("add_watchlist", { name, filePath }),

  removeWatchlist: (name: string) => invoke<void>("remove_watchlist", { name }),

  loadSymbols: (watchlistName: string) =>
    invoke<string[]>("load_symbols", { watchlistName }),

  // ── Last selection ────────────────────────────────────────────────────────
  getLastSelection: () => invoke<LastSelection>("get_last_selection"),

  setLastSelection: (
    watchlistName: string | null,
    symbol: string | null,
    interval: string | null
  ) =>
    invoke<void>("set_last_selection", { watchlistName, symbol, interval }),

  // ── Chart data ────────────────────────────────────────────────────────────
  getChartData: (symbol: string, interval: string) =>
    invoke<ChartDataResponse>("get_chart_data", { symbol, interval }),

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
};
