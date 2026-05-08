export interface CandleData {
  time: number; // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchlistSymbol {
  symbol: string;
  color: string | null;
  tag_color: string | null;
}

export interface WatchlistEntry {
  name: string;
}

export interface LastSelection {
  watchlist_name: string | null;
  symbol: string | null;
  interval: string | null;
  last_picked_watchlist: string | null;
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

export interface PivotSource {
  high: number;
  low: number;
  close: number;
  draw_from: number;
}

export interface SymbolSearchResult {
  symbol: string;
  watchlists: string[];
}

export interface AuthStatus {
  is_authenticated: boolean;
  api_key: string | null;
  has_oauth_token: boolean;
  has_analytics_token: boolean;
  message: string;
}

export interface SavedUpstoxCredentials {
  api_key: string;
  api_secret: string;
  analytics_token?: string;
}

export type Interval = "day" | "week" | "month";

export interface PriceAlert {
  id: string;
  symbol: string;
  target_price: number;
  direction: string;
  created_at: string;
}

export interface ColorFilteredSymbol {
  symbol: string;
  watchlist_name: string;
  color: string | null;
  tag_color: string | null;
}

export interface NewsArticle {
  heading: string;
  summary: string;
  thumbnail: string | null;
  article_link: string;
  published_time: number;
}

export interface NewsResponse {
  data: Record<string, NewsArticle[]>;
  page_number: number;
  page_size: number;
  total_records: number;
  total_pages: number;
}
