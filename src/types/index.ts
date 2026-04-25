export interface CandleData {
  time: number; // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchlistEntry {
  name: string;
  file_path: string;
}

export interface LastSelection {
  watchlist_name: string | null;
  symbol: string | null;
  interval: string | null;
}

export interface RetentionSettings {
  day_retention_days: number;
  week_retention_weeks: number;
  month_retention_months: number;
}

export interface FetchSettings {
  day_fetch_days: number;
  week_fetch_weeks: number;
  month_fetch_months: number;
}

export interface ChartDataResponse {
  candles: CandleData[];
  /** "fully_cached" | "partially_refreshed" | "network_fetched" | "cached_only" */
  freshness: string;
  last_sync: string | null;
  warning: string | null;
}

export interface AuthStatus {
  is_authenticated: boolean;
  api_key: string | null;
  message: string;
}

export interface SavedKiteCredentials {
  api_key: string;
  api_secret: string;
}

export type Interval = "day" | "week" | "month";
