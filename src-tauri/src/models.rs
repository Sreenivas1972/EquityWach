use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandleData {
    pub time: i64, // Unix timestamp (seconds)
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PivotSource {
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub draw_from: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchlistSymbol {
    pub symbol: String,
    pub color: Option<String>,
    pub tag_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchlistEntry {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastSelection {
    pub watchlist_name: Option<String>,
    pub symbol: Option<String>,
    pub interval: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionSettings {
    /// Keep this many days of day-interval candles
    pub day_retention_days: u32,
    /// Keep this many weeks of week-interval candles
    pub week_retention_weeks: u32,
    /// Keep this many months of month-interval candles
    pub month_retention_months: u32,
}

impl Default for RetentionSettings {
    fn default() -> Self {
        RetentionSettings {
            day_retention_days: 365,
            week_retention_weeks: 104,
            month_retention_months: 60,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchSettings {
    /// How many days of day-interval candles to fetch on first load
    pub day_fetch_days: u32,
    /// How many weeks of week-interval candles to fetch on first load
    pub week_fetch_weeks: u32,
    /// How many months of month-interval candles to fetch on first load
    pub month_fetch_months: u32,
}

impl Default for FetchSettings {
    fn default() -> Self {
        FetchSettings {
            day_fetch_days: 365,
            week_fetch_weeks: 104,
            month_fetch_months: 60,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartDataResponse {
    pub candles: Vec<CandleData>,
    /// One of: "fully_cached", "partially_refreshed", "network_fetched", "cached_only"
    pub freshness: String,
    pub last_sync: Option<String>,
    /// Non-blocking warning (e.g. network failed but cache served)
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KiteConfig {
    pub api_key: String,
    pub api_secret: String,
    pub access_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthStatus {
    pub is_authenticated: bool,
    pub api_key: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedKiteCredentials {
    pub api_key: String,
    pub api_secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstrumentInfo {
    pub instrument_token: u32,
    pub tradingsymbol: String,
    pub exchange: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolSearchResult {
    pub symbol: String,
    pub watchlists: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceAlert {
    pub id: String,
    pub symbol: String,
    pub target_price: f64,
    pub direction: String,
    pub created_at: String,
}
