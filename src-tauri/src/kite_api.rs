use chrono::{Datelike, Timelike, Duration, TimeZone, Utc};
use serde::Deserialize;
use rusqlite::params;

use crate::models::{CandleData, ChartDataResponse, FetchSettings, KiteInstrumentInfo, PivotSource};
use crate::storage;

const KITE_API_BASE: &str = "https://api.kite.trade";

// ─── Public entry points ──────────────────────────────────────────────────────

/// Downloads the full NSE EQ instruments list and caches it locally.
/// Returns the number of instruments saved.
pub async fn refresh_instruments() -> Result<usize, String> {
    let (api_key, access_token) = get_auth()?;

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/instruments/NSE", KITE_API_BASE))
        .header("X-Kite-Version", "3")
        .header("Authorization", format!("token {}:{}", api_key, access_token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Instruments fetch failed: {}", text));
    }

    let csv_text = resp.text().await.map_err(|e| e.to_string())?;

    // Parse only NSE EQ instruments
    // Columns: instrument_token,exchange_token,tradingsymbol,name,last_price,
    //          expiry,strike,tick_size,lot_size,instrument_type,segment,exchange
    let mut instruments: Vec<KiteInstrumentInfo> = Vec::new();
    let mut reader = csv::Reader::from_reader(csv_text.as_bytes());
    for result in reader.records() {
        let rec = result.map_err(|e| e.to_string())?;
        if rec.len() < 12 {
            continue;
        }
        let instrument_type = &rec[9];
        let exchange = &rec[11];
        if instrument_type != "EQ" || exchange != "NSE" {
            continue;
        }
        let token: u32 = rec[0].parse().unwrap_or(0);
        if token == 0 {
            continue;
        }
        instruments.push(KiteInstrumentInfo {
            instrument_token: token,
            tradingsymbol: rec[2].to_string(),
            exchange: exchange.to_string(),
            name: rec[3].to_string(),
        });
    }

    let count = instruments.len();
    tokio::task::spawn_blocking(move || {
        let conn = storage::open_db().map_err(|e| e.to_string())?;
        storage::save_instruments(&instruments, &conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(count)
}

/// Open chart for `symbol` (e.g. "INFY" or "NSE:INFY") at `interval`.
/// Loads cached data first, then fetches only the missing tail from Kite.
pub async fn get_chart_data(symbol: &str, interval: &str) -> Result<ChartDataResponse, String> {
    let symbol = symbol.to_string();
    let interval = interval.to_string();

    // ── Step 1: read everything from the local DB (blocking) ──────────────────
    let (tradingsymbol, exchange) = parse_symbol(&symbol);
    let sym_clone = tradingsymbol.clone();
    let exc_clone = exchange.clone();
    let int_clone = interval.clone();

    let (cached, latest_ts, last_sync, instrument_token) =
        tokio::task::spawn_blocking(move || -> Result<(Vec<CandleData>, Option<i64>, Option<i64>, Option<u32>), String> {
            let conn = storage::open_db().map_err(|e| e.to_string())?;
            let cached = storage::get_cached_candles(&sym_clone, &int_clone, &conn)
                .map_err(|e| e.to_string())?;
            let latest_ts = storage::get_latest_candle_timestamp(&sym_clone, &int_clone, &conn)
                .map_err(|e| e.to_string())?;
            let last_sync = storage::get_last_synced(&sym_clone, &int_clone, &conn)
                .map_err(|e| e.to_string())?;
            let instrument_token =
                storage::lookup_instrument_token(&sym_clone, &exc_clone, &conn)
                    .map_err(|e| e.to_string())?;
            Ok((cached, latest_ts, last_sync, instrument_token))
        })
        .await
        .map_err(|e| e.to_string())??;

    let last_sync_str = last_sync.map(storage::ts_to_rfc3339);

    // ── Step 2: check auth and instrument token ───────────────────────────────
    let auth = get_auth();
    if auth.is_err() {
        return serve_cached_or_error(
            cached,
            last_sync_str,
            "Not authenticated. Showing cached data.",
        );
    }
    let (api_key, access_token) = auth.unwrap();

    let instrument_token = match instrument_token {
        Some(t) => t,
        None => {
            return serve_cached_or_error(
                cached,
                last_sync_str,
                &format!(
                    "Symbol '{}' not in instruments cache. Please refresh instruments in Settings.",
                    tradingsymbol
                ),
            );
        }
    };

    // ── Step 3: fetch missing tail from Kite (async) ──────────────────────────
    let fetch_settings = tokio::task::spawn_blocking(storage::load_fetch_settings)
        .await
        .map_err(|e| e.to_string())?;

    let from = match latest_ts {
        Some(ts) => {
            let base = Utc.timestamp_opt(ts, 0).single().unwrap_or_else(Utc::now);
            // Re-fetch one bucket back for aggregate intervals so we can recompute
            // the latest week/month candle accurately.
            base - refresh_backfill_duration(&interval)
        }
        None => fetch_from(&interval, &fetch_settings),
    };
    let to = Utc::now();

    let url = format!(
        "{}/instruments/historical/{}/{}",
        KITE_API_BASE,
        instrument_token,
        request_interval_for_kite(&interval)
    );

    let new_candles = match fetch_candles(&url, &api_key, &access_token, from, to).await {
        Ok(c) => normalize_interval_candles(c, &interval),
        Err(e) => {
            return serve_cached_or_error(
                cached,
                last_sync_str,
                &format!("Network refresh failed: {}. Showing cached data.", e),
            );
        }
    };

    // ── Step 4: persist and reload (blocking) ─────────────────────────────────
    let sym2 = tradingsymbol.clone();
    let int2 = interval.clone();
    let cached_was_empty = cached.is_empty();
    let new_count = new_candles.len();

    let all_candles = tokio::task::spawn_blocking(move || -> Result<Vec<CandleData>, String> {
        let conn = storage::open_db().map_err(|e| e.to_string())?;
        if !new_candles.is_empty() {
            storage::upsert_candles(&sym2, &int2, &new_candles, &conn)
                .map_err(|e| e.to_string())?;
            storage::update_sync_metadata(&sym2, &int2, &conn)
                .map_err(|e| e.to_string())?;
        }
        storage::get_cached_candles(&sym2, &int2, &conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let freshness = if cached_was_empty {
        "network_fetched"
    } else if new_count > 0 {
        "partially_refreshed"
    } else {
        "fully_cached"
    };

    Ok(ChartDataResponse {
        candles: all_candles,
        freshness: freshness.to_string(),
        last_sync: Some(storage::ts_to_rfc3339(Utc::now().timestamp())),
        warning: None,
    })
}

pub async fn refresh_chart_data(symbol: &str, interval: &str) -> Result<ChartDataResponse, String> {
    let symbol = symbol.to_string();
    let interval = interval.to_string();

    let (tradingsymbol, exchange) = parse_symbol(&symbol);
    let sym_clone = tradingsymbol.clone();
    let exc_clone = exchange.clone();
    let int_clone = interval.clone();

    let (cached, _, last_sync, instrument_token) =
        tokio::task::spawn_blocking(move || -> Result<(Vec<CandleData>, Option<i64>, Option<i64>, Option<u32>), String> {
            let conn = storage::open_db().map_err(|e| e.to_string())?;
            let cached = storage::get_cached_candles(&sym_clone, &int_clone, &conn)
                .map_err(|e| e.to_string())?;
            let last_sync = storage::get_last_synced(&sym_clone, &int_clone, &conn)
                .map_err(|e| e.to_string())?;
            let instrument_token = storage::lookup_instrument_token(&sym_clone, &exc_clone, &conn)
                .map_err(|e| e.to_string())?;
            Ok((cached, None, last_sync, instrument_token))
        })
        .await
        .map_err(|e| e.to_string())??;

    let last_sync_str = last_sync.map(storage::ts_to_rfc3339);

    let auth = get_auth();
    if auth.is_err() {
        return serve_cached_or_error(
            cached,
            last_sync_str,
            "Not authenticated. Showing cached data.",
        );
    }
    let (api_key, access_token) = auth.unwrap();

    let instrument_token = match instrument_token {
        Some(t) => t,
        None => {
            return serve_cached_or_error(
                cached,
                last_sync_str,
                &format!(
                    "Symbol '{}' not in instruments cache. Please refresh instruments in Settings.",
                    tradingsymbol
                ),
            );
        }
    };

    let fetch_settings = tokio::task::spawn_blocking(storage::load_fetch_settings)
        .await
        .map_err(|e| e.to_string())?;

    let from = fetch_from(&interval, &fetch_settings);
    let to = Utc::now();

    let url = format!(
        "{}/instruments/historical/{}/{}",
        KITE_API_BASE,
        instrument_token,
        request_interval_for_kite(&interval)
    );

    let new_candles = match fetch_candles(&url, &api_key, &access_token, from, to).await {
        Ok(c) => normalize_interval_candles(c, &interval),
        Err(e) => {
            return serve_cached_or_error(
                cached,
                last_sync_str,
                &format!("Network refresh failed: {}. Showing cached data.", e),
            );
        }
    };

    let sym2 = tradingsymbol.clone();
    let int2 = interval.clone();

    let all_candles = tokio::task::spawn_blocking(move || -> Result<Vec<CandleData>, String> {
        let conn = storage::open_db().map_err(|e| e.to_string())?;
        if !new_candles.is_empty() {
            storage::upsert_candles(&sym2, &int2, &new_candles, &conn)
                .map_err(|e| e.to_string())?;
            storage::update_sync_metadata(&sym2, &int2, &conn)
                .map_err(|e| e.to_string())?;
        }
        storage::get_cached_candles(&sym2, &int2, &conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(ChartDataResponse {
        candles: all_candles,
        freshness: "network_fetched".to_string(),
        last_sync: Some(storage::ts_to_rfc3339(Utc::now().timestamp())),
        warning: None,
    })
}

pub async fn get_pivot_source(symbol: &str, interval: &str) -> Result<Option<PivotSource>, String> {
    if interval == "month" {
        return Ok(None);
    }

    let symbol_str = symbol.to_string();
    let interval_str = interval.to_string();
    let (tradingsymbol, exchange) = parse_symbol(&symbol_str);
    let trading_sym_clone = tradingsymbol.clone();
    let exchange_clone = exchange.clone();
    let interval_clone = interval_str.clone();

    let (cached_meta, instrument_token) = tokio::task::spawn_blocking(move || -> Result<(Option<storage::PivotMeta>, Option<u32>), String> {
        let conn = storage::open_db().map_err(|e| e.to_string())?;
        let pivot_type = if interval_clone == "day" { "month" } else { "quarter" };
        let meta = storage::get_pivot_meta(&trading_sym_clone, pivot_type, &conn).map_err(|e| e.to_string())?;
        let token = storage::lookup_instrument_token(&trading_sym_clone, &exchange_clone, &conn).map_err(|e| e.to_string())?;
        Ok((meta, token))
    })
    .await
    .map_err(|e| e.to_string())??;

    let instrument_token = instrument_token.ok_or_else(|| {
        format!(
            "Symbol '{}' not in instruments cache. Please refresh instruments in Settings.",
            tradingsymbol
        )
    })?;

    let now = Utc::now();
    let current_period_start = if interval_str == "day" {
        month_start(now)
    } else {
        quarter_start(now)
    };

    let pivot_type = if interval_str == "day" { "month" } else { "quarter" };

    if let Some(meta) = cached_meta {
        if meta.period_start == current_period_start.timestamp() {
            let draw_from = get_current_period_first_trading_day(&tradingsymbol, interval_str.as_str(), current_period_start, now).await?;
            return Ok(Some(PivotSource {
                high: meta.high,
                low: meta.low,
                close: meta.close,
                draw_from,
            }));
        }
    }

    let (prev_start, prev_end) = if interval_str == "day" {
        let current_start = month_start(now);
        let prev_start = previous_month_start(current_start);
        let prev_end = current_start - Duration::seconds(1);
        (prev_start, prev_end)
    } else {
        let current_start = quarter_start(now);
        let prev_start = previous_quarter_start(current_start);
        let prev_end = current_start - Duration::seconds(1);
        (prev_start, prev_end)
    };

    let prev_candles = load_or_fetch_day_candles(
        &tradingsymbol,
        instrument_token,
        prev_start,
        prev_end,
    )
    .await?;

    if prev_candles.is_empty() {
        return Err("Previous period pivot data is unavailable.".to_string());
    }

    let (high, low, close) = compute_high_low_close(&prev_candles).ok_or_else(|| {
        "Unable to compute pivot levels from previous period data.".to_string()
    })?;

    let draw_from = get_current_period_first_trading_day(&tradingsymbol, &interval_str, current_period_start, now).await?;

    let trading_sym_clone2 = tradingsymbol.clone();
    let pivot_type_clone = pivot_type.to_string();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = storage::open_db().map_err(|e| e.to_string())?;
        storage::save_pivot_meta(
            &trading_sym_clone2,
            &pivot_type_clone,
            current_period_start.timestamp(),
            high,
            low,
            close,
            &conn,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(Some(PivotSource {
        high,
        low,
        close,
        draw_from,
    }))
}

async fn get_current_period_first_trading_day(
    symbol: &str,
    _interval: &str,
    period_start: chrono::DateTime<Utc>,
    now: chrono::DateTime<Utc>,
) -> Result<i64, String> {
    let end_ts = now.timestamp();
    let start_ts = period_start.timestamp();
    let symbol_str = symbol.to_string();

    let result = tokio::task::spawn_blocking(move || -> Result<Option<i64>, String> {
        let conn = storage::open_db().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT timestamp FROM candles
             WHERE symbol = ?1 AND interval = 'day' AND timestamp >= ?2 AND timestamp <= ?3
             ORDER BY timestamp ASC
             LIMIT 1",
        ).map_err(|e| e.to_string())?;
        match stmt.query_row(params![symbol_str, start_ts, end_ts], |row| row.get(0)) {
            Ok(ts) => Ok(Some(ts)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result.unwrap_or(start_ts))
}

fn month_start(dt: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    dt.with_day(1).unwrap().with_hour(0).unwrap().with_minute(0).unwrap().with_second(0).unwrap()
}

fn quarter_start(dt: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    let quarter_month = ((dt.month() - 1) / 3) * 3 + 1;
    dt.with_month(quarter_month).unwrap().with_day(1).unwrap().with_hour(0).unwrap().with_minute(0).unwrap().with_second(0).unwrap()
}

fn previous_month_start(current_month_start: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    let year = current_month_start.year();
    let month = current_month_start.month();
    let target = if month == 1 {
        current_month_start.with_year(year - 1).unwrap().with_month(12).unwrap()
    } else {
        current_month_start.with_month(month - 1).unwrap()
    };
    target.with_day(1).unwrap().with_hour(0).unwrap().with_minute(0).unwrap().with_second(0).unwrap()
}

fn previous_quarter_start(current_quarter_start: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    let year = current_quarter_start.year();
    let month = current_quarter_start.month();
    let target = if month <= 3 {
        current_quarter_start.with_year(year - 1).unwrap().with_month(10).unwrap()
    } else {
        current_quarter_start.with_month(month - 3).unwrap()
    };
    target.with_day(1).unwrap().with_hour(0).unwrap().with_minute(0).unwrap().with_second(0).unwrap()
}

async fn load_or_fetch_day_candles(
    symbol: &str,
    instrument_token: u32,
    from: chrono::DateTime<Utc>,
    to: chrono::DateTime<Utc>,
) -> Result<Vec<CandleData>, String> {
    let symbol_str = symbol.to_string();
    let from_ts = from.timestamp();
    let to_ts = to.timestamp();
    let symbol_clone = symbol_str.clone();

    let cached = tokio::task::spawn_blocking(move || -> Result<Vec<CandleData>, String> {
        let conn = storage::open_db().map_err(|e| e.to_string())?;
        storage::get_cached_candles_range(&symbol_clone, "day", from_ts, to_ts, &conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    if !cached.is_empty() {
        return Ok(cached);
    }

    let auth = get_auth()?;
    let url = format!(
        "{}/instruments/historical/{}/day",
        KITE_API_BASE,
        instrument_token,
    );
    let fetched = fetch_candles(&url, &auth.0, &auth.1, from, to).await?;
    if fetched.is_empty() {
        return Ok(Vec::new());
    }

    let symbol_clone2 = symbol_str.clone();
    let fetched_clone = fetched.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = storage::open_db().map_err(|e| e.to_string())?;
        storage::upsert_candles(&symbol_clone2, "day", &fetched_clone, &conn).map_err(|e| e.to_string())?;
        storage::update_sync_metadata(&symbol_clone2, "day", &conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(fetched)
}

fn compute_high_low_close(candles: &[CandleData]) -> Option<(f64, f64, f64)> {
    let mut high = f64::MIN;
    let mut low = f64::MAX;
    let mut close = None;

    for candle in candles {
        if candle.high > high {
            high = candle.high;
        }
        if candle.low < low {
            low = candle.low;
        }
        close = Some(candle.close);
    }

    if let Some(last_close) = close {
        Some((high, low, last_close))
    } else {
        None
    }
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async fn fetch_candles(
    url: &str,
    api_key: &str,
    access_token: &str,
    from: chrono::DateTime<Utc>,
    to: chrono::DateTime<Utc>,
) -> Result<Vec<CandleData>, String> {
    let from_str = from.format("%Y-%m-%d %H:%M:%S").to_string();
    let to_str = to.format("%Y-%m-%d %H:%M:%S").to_string();

    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header("X-Kite-Version", "3")
        .header(
            "Authorization",
            format!("token {}:{}", api_key, access_token),
        )
        .query(&[
            ("from", from_str.as_str()),
            ("to", to_str.as_str()),
            ("continuous", "0"),
            ("oi", "0"),
        ])
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if status == 403 {
            return Err("Authentication expired. Please login again.".to_string());
        }
        return Err(format!("Kite API error {}: {}", status, text));
    }

    #[derive(Deserialize)]
    struct KiteResp {
        data: KiteData,
    }
    #[derive(Deserialize)]
    struct KiteData {
        candles: Vec<serde_json::Value>,
    }

    let kite: KiteResp = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    // Each candle: [datetime_str, open, high, low, close, volume, oi?]
    let candles = kite
        .data
        .candles
        .iter()
        .filter_map(|c| {
            let arr = c.as_array()?;
            if arr.len() < 6 {
                return None;
            }
            let time_str = arr[0].as_str()?;
            let dt = chrono::DateTime::parse_from_rfc3339(time_str)
                .or_else(|_| {
                    chrono::DateTime::parse_from_str(time_str, "%Y-%m-%dT%H:%M:%S%z")
                })
                .ok()?;
            Some(CandleData {
                time: dt.timestamp(),
                open: arr[1].as_f64()?,
                high: arr[2].as_f64()?,
                low: arr[3].as_f64()?,
                close: arr[4].as_f64()?,
                volume: arr[5].as_u64().unwrap_or(0),
            })
        })
        .collect();

    Ok(candles)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

fn get_auth() -> Result<(String, String), String> {
    let config = storage::load_kite_config().ok_or("Kite not configured")?;
    let token = config
        .access_token
        .ok_or("Not authenticated. Please login in Settings.")?;
    Ok((config.api_key, token))
}

fn parse_symbol(s: &str) -> (String, String) {
    if let Some((exchange, symbol)) = s.split_once(':') {
        (symbol.to_uppercase(), exchange.to_uppercase())
    } else {
        (s.to_uppercase(), "NSE".to_string())
    }
}

fn request_interval_for_kite(_interval: &str) -> &'static str {
    // Kite historical API supports day candles for equities; week/month are derived locally.
    "day"
}

fn fetch_from(interval: &str, s: &FetchSettings) -> chrono::DateTime<Utc> {
    let now = Utc::now();
    match interval {
        "week" => now - Duration::weeks(s.week_fetch_weeks as i64),
        "month" => now - Duration::days(s.month_fetch_months as i64 * 30),
        _ => now - Duration::days(s.day_fetch_days as i64),
    }
}

fn refresh_backfill_duration(interval: &str) -> Duration {
    match interval {
        "week" => Duration::days(7),
        "month" => Duration::days(31),
        _ => Duration::zero(),
    }
}

fn normalize_interval_candles(candles: Vec<CandleData>, interval: &str) -> Vec<CandleData> {
    match interval {
        "week" => aggregate_candles(candles, "week"),
        "month" => aggregate_candles(candles, "month"),
        _ => candles,
    }
}

fn aggregate_candles(mut candles: Vec<CandleData>, interval: &str) -> Vec<CandleData> {
    if candles.is_empty() {
        return candles;
    }

    candles.sort_by_key(|c| c.time);

    let mut out: Vec<CandleData> = Vec::new();
    let mut current_bucket: Option<i64> = None;
    let mut current: Option<CandleData> = None;

    for c in candles {
        let bucket = bucket_start_ts(c.time, interval).unwrap_or(c.time);

        match (current_bucket, current.take()) {
            (Some(b), Some(mut agg)) if b == bucket => {
                if c.high > agg.high {
                    agg.high = c.high;
                }
                if c.low < agg.low {
                    agg.low = c.low;
                }
                agg.close = c.close;
                agg.volume = agg.volume.saturating_add(c.volume);
                current = Some(agg);
            }
            (_, Some(prev)) => {
                out.push(prev);
                current_bucket = Some(bucket);
                current = Some(CandleData {
                    time: bucket,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                    volume: c.volume,
                });
            }
            (_, None) => {
                current_bucket = Some(bucket);
                current = Some(CandleData {
                    time: bucket,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                    volume: c.volume,
                });
            }
        }
    }

    if let Some(last) = current {
        out.push(last);
    }

    out
}

fn bucket_start_ts(ts: i64, interval: &str) -> Option<i64> {
    let dt = Utc.timestamp_opt(ts, 0).single()?;
    let date = dt.date_naive();

    let start = match interval {
        "week" => {
            let offset = date.weekday().num_days_from_monday() as i64;
            date - Duration::days(offset)
        }
        "month" => date.with_day(1)?,
        _ => date,
    };

    let bucket_dt = start.and_hms_opt(0, 0, 0)?;
    Some(bucket_dt.and_utc().timestamp())
}

fn serve_cached_or_error(
    cached: Vec<CandleData>,
    last_sync: Option<String>,
    warning: &str,
) -> Result<ChartDataResponse, String> {
    if cached.is_empty() {
        Err(warning.to_string())
    } else {
        Ok(ChartDataResponse {
            candles: cached,
            freshness: "cached_only".to_string(),
            last_sync,
            warning: Some(warning.to_string()),
        })
    }
}
