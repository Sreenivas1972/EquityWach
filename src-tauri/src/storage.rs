use std::path::PathBuf;

use chrono::{Duration, TimeZone, Utc};
use rusqlite::{params, Connection, Result as SqlResult};

use crate::models::{
    CandleData, FetchSettings, InstrumentInfo, KiteConfig, LastSelection, RetentionSettings,
    WatchlistEntry,
};

// ─── Paths ──────────────────────────────────────────────────────────────────

pub fn get_app_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("equitywatcher")
}

pub fn ensure_app_dir() -> std::io::Result<()> {
    std::fs::create_dir_all(get_app_data_dir())
}

fn db_path() -> PathBuf {
    get_app_data_dir().join("candles.db")
}
fn settings_path() -> PathBuf {
    get_app_data_dir().join("settings.json")
}
fn watchlists_path() -> PathBuf {
    get_app_data_dir().join("watchlists.json")
}
fn selection_path() -> PathBuf {
    get_app_data_dir().join("last_selection.json")
}
fn kite_config_path() -> PathBuf {
    get_app_data_dir().join("kite_config.json")
}
fn fetch_settings_path() -> PathBuf {
    get_app_data_dir().join("fetch_settings.json")
}

// ─── Database ────────────────────────────────────────────────────────────────

pub fn open_db() -> SqlResult<Connection> {
    let conn = Connection::open(db_path())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS candles (
            symbol    TEXT    NOT NULL,
            interval  TEXT    NOT NULL,
            timestamp INTEGER NOT NULL,
            open      REAL    NOT NULL,
            high      REAL    NOT NULL,
            low       REAL    NOT NULL,
            close     REAL    NOT NULL,
            volume    INTEGER NOT NULL,
            PRIMARY KEY (symbol, interval, timestamp)
        );
        CREATE TABLE IF NOT EXISTS sync_metadata (
            symbol      TEXT    NOT NULL,
            interval    TEXT    NOT NULL,
            last_synced INTEGER NOT NULL,
            PRIMARY KEY (symbol, interval)
        );
        CREATE TABLE IF NOT EXISTS instruments (
            instrument_token INTEGER NOT NULL,
            tradingsymbol    TEXT    NOT NULL,
            exchange         TEXT    NOT NULL,
            name             TEXT    NOT NULL,
            PRIMARY KEY (instrument_token)
        );
        CREATE INDEX IF NOT EXISTS idx_instruments_sym
            ON instruments(tradingsymbol, exchange);
        CREATE INDEX IF NOT EXISTS idx_candles_lookup
            ON candles(symbol, interval, timestamp);
        
        -- Drawing storage tables
        CREATE TABLE IF NOT EXISTS sr_drawings (
            id          TEXT    NOT NULL,
            symbol      TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            data        TEXT    NOT NULL,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            PRIMARY KEY (id, symbol)
        );
        CREATE INDEX IF NOT EXISTS idx_sr_symbol ON sr_drawings(symbol);
        
        CREATE TABLE IF NOT EXISTS fib_drawings (
            id          TEXT    NOT NULL,
            symbol      TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            data        TEXT    NOT NULL,
            defaults    TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            PRIMARY KEY (id, symbol)
        );
        CREATE INDEX IF NOT EXISTS idx_fib_symbol ON fib_drawings(symbol);
        ",
    )?;
    Ok(conn)
}

// ─── Candles ─────────────────────────────────────────────────────────────────

pub fn get_cached_candles(
    symbol: &str,
    interval: &str,
    conn: &Connection,
) -> SqlResult<Vec<CandleData>> {
    let mut stmt = conn.prepare(
        "SELECT timestamp, open, high, low, close, volume
         FROM candles
         WHERE symbol = ?1 AND interval = ?2
         ORDER BY timestamp ASC",
    )?;
    let rows = stmt
        .query_map(params![symbol, interval], |row| {
            Ok(CandleData {
                time: row.get(0)?,
                open: row.get(1)?,
                high: row.get(2)?,
                low: row.get(3)?,
                close: row.get(4)?,
                volume: row.get::<_, i64>(5)? as u64,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn get_latest_candle_timestamp(
    symbol: &str,
    interval: &str,
    conn: &Connection,
) -> SqlResult<Option<i64>> {
    let mut stmt = conn.prepare(
        "SELECT MAX(timestamp) FROM candles WHERE symbol = ?1 AND interval = ?2",
    )?;
    stmt.query_row(params![symbol, interval], |row| row.get(0))
}

pub fn upsert_candles(
    symbol: &str,
    interval: &str,
    candles: &[CandleData],
    conn: &Connection,
) -> SqlResult<usize> {
    let mut count = 0;
    for c in candles {
        count += conn.execute(
            "INSERT OR REPLACE INTO candles
             (symbol, interval, timestamp, open, high, low, close, volume)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                symbol,
                interval,
                c.time,
                c.open,
                c.high,
                c.low,
                c.close,
                c.volume as i64
            ],
        )?;
    }
    Ok(count)
}

pub fn update_sync_metadata(symbol: &str, interval: &str, conn: &Connection) -> SqlResult<()> {
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT OR REPLACE INTO sync_metadata (symbol, interval, last_synced) VALUES (?1,?2,?3)",
        params![symbol, interval, now],
    )?;
    Ok(())
}

pub fn get_last_synced(
    symbol: &str,
    interval: &str,
    conn: &Connection,
) -> SqlResult<Option<i64>> {
    match conn.query_row(
        "SELECT last_synced FROM sync_metadata WHERE symbol = ?1 AND interval = ?2",
        params![symbol, interval],
        |row| row.get(0),
    ) {
        Ok(ts) => Ok(Some(ts)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn prune_candles(settings: &RetentionSettings, conn: &Connection) -> SqlResult<usize> {
    let now = Utc::now();
    let day_cutoff = (now - Duration::days(settings.day_retention_days as i64)).timestamp();
    let week_cutoff = (now - Duration::weeks(settings.week_retention_weeks as i64)).timestamp();
    let month_cutoff =
        (now - Duration::days(settings.month_retention_months as i64 * 30)).timestamp();

    let mut total = 0usize;
    total += conn.execute(
        "DELETE FROM candles WHERE interval = 'day' AND timestamp < ?1",
        params![day_cutoff],
    )?;
    total += conn.execute(
        "DELETE FROM candles WHERE interval = 'week' AND timestamp < ?1",
        params![week_cutoff],
    )?;
    total += conn.execute(
        "DELETE FROM candles WHERE interval = 'month' AND timestamp < ?1",
        params![month_cutoff],
    )?;
    Ok(total)
}

// ─── Instruments ─────────────────────────────────────────────────────────────

pub fn save_instruments(instruments: &[InstrumentInfo], conn: &Connection) -> SqlResult<()> {
    conn.execute_batch("DELETE FROM instruments")?;
    for inst in instruments {
        conn.execute(
            "INSERT OR REPLACE INTO instruments
             (instrument_token, tradingsymbol, exchange, name)
             VALUES (?1,?2,?3,?4)",
            params![inst.instrument_token, inst.tradingsymbol, inst.exchange, inst.name],
        )?;
    }
    Ok(())
}

pub fn lookup_instrument_token(
    tradingsymbol: &str,
    exchange: &str,
    conn: &Connection,
) -> SqlResult<Option<u32>> {
    match conn.query_row(
        "SELECT instrument_token FROM instruments
         WHERE tradingsymbol = ?1 AND exchange = ?2",
        params![tradingsymbol, exchange],
        |row| row.get(0),
    ) {
        Ok(token) => Ok(Some(token)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn get_instruments_count(conn: &Connection) -> SqlResult<i64> {
    conn.query_row("SELECT COUNT(*) FROM instruments", [], |row| row.get(0))
}

// ─── Drawing Storage ─────────────────────────────────────────────────────────

// SR Drawings

pub fn load_sr_drawings(symbol: &str, conn: &Connection) -> SqlResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT data FROM sr_drawings WHERE symbol = ?1 ORDER BY updated_at ASC"
    )?;
    let rows = stmt
        .query_map(params![symbol], |row| {
            Ok(row.get::<_, String>(0)?)
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn save_sr_drawings(symbol: &str, drawings_json: &str, conn: &Connection) -> SqlResult<()> {
    // For simplicity, we'll save the entire array as one record
    // In production, you might want to save individual drawings
    let now = chrono::Utc::now().timestamp();
    
    // First delete existing drawings for this symbol
    conn.execute(
        "DELETE FROM sr_drawings WHERE symbol = ?1",
        params![symbol],
    )?;
    
    // Insert the new consolidated record
    conn.execute(
        "INSERT INTO sr_drawings (id, symbol, kind, data, created_at, updated_at)
         VALUES (?1, ?2, 'sr_array', ?3, ?4, ?5)",
        params![format!("sr_{}", symbol), symbol, drawings_json, now, now],
    )?;
    Ok(())
}

pub fn clear_sr_drawings(symbol: &str, conn: &Connection) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM sr_drawings WHERE symbol = ?1",
        params![symbol],
    )?;
    Ok(())
}

// Fibonacci Drawings

pub fn load_fib_drawings(symbol: &str, conn: &Connection) -> SqlResult<Option<String>> {
    match conn.query_row(
        "SELECT data, defaults FROM fib_drawings WHERE symbol = ?1 ORDER BY updated_at DESC LIMIT 1",
        params![symbol],
        |row| {
            let data: String = row.get(0)?;
            let defaults: Option<String> = row.get(1)?;
            Ok((data, defaults))
        }
    ) {
        Ok((data, _defaults)) => Ok(Some(data)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn save_fib_drawings(symbol: &str, drawings_json: &str, conn: &Connection) -> SqlResult<()> {
    let now = chrono::Utc::now().timestamp();
    
    // Insert or replace the record
    conn.execute(
        "INSERT OR REPLACE INTO fib_drawings 
         (id, symbol, kind, data, defaults, created_at, updated_at)
         VALUES (?1, ?2, 'fib_set', ?3, NULL, ?4, ?5)",
        params![format!("fib_{}", symbol), symbol, drawings_json, now, now],
    )?;
    Ok(())
}

pub fn clear_fib_drawings(symbol: &str, conn: &Connection) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM fib_drawings WHERE symbol = ?1",
        params![symbol],
    )?;
    Ok(())
}

// ─── JSON persistence helpers ────────────────────────────────────────────────

fn read_json<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Option<T> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_json<T: serde::Serialize + ?Sized>(path: &PathBuf, value: &T) -> Result<(), String> {
    ensure_app_dir().map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

// ─── Retention settings ──────────────────────────────────────────────────────

pub fn load_retention_settings() -> RetentionSettings {
    read_json(&settings_path()).unwrap_or_default()
}

pub fn save_retention_settings(s: &RetentionSettings) -> Result<(), String> {
    write_json(&settings_path(), s)
}

// ─── Fetch settings ──────────────────────────────────────────────────────────

pub fn load_fetch_settings() -> FetchSettings {
    read_json(&fetch_settings_path()).unwrap_or_default()
}

pub fn save_fetch_settings(s: &FetchSettings) -> Result<(), String> {
    write_json(&fetch_settings_path(), s)
}

// ─── Watchlists ──────────────────────────────────────────────────────────────

pub fn load_watchlists() -> Vec<WatchlistEntry> {
    read_json(&watchlists_path()).unwrap_or_default()
}

pub fn save_watchlists(entries: &[WatchlistEntry]) -> Result<(), String> {
    write_json(&watchlists_path(), entries)
}

// ─── Last selection ──────────────────────────────────────────────────────────

pub fn load_last_selection() -> LastSelection {
    read_json(&selection_path()).unwrap_or(LastSelection {
        watchlist_name: None,
        symbol: None,
        interval: None,
    })
}

pub fn save_last_selection(sel: &LastSelection) -> Result<(), String> {
    write_json(&selection_path(), sel)
}

// ─── Kite config ─────────────────────────────────────────────────────────────

pub fn load_kite_config() -> Option<KiteConfig> {
    read_json(&kite_config_path())
}

pub fn save_kite_config(config: &KiteConfig) -> Result<(), String> {
    write_json(&kite_config_path(), config)
}

/// Update only the access_token field, preserving api_key/api_secret.
pub fn save_access_token(token: &str) -> Result<(), String> {
    let mut config = load_kite_config().ok_or("Kite credentials not configured")?;
    config.access_token = Some(token.to_string());
    save_kite_config(&config)
}

pub fn clear_access_token() -> Result<(), String> {
    if let Some(mut config) = load_kite_config() {
        config.access_token = None;
        save_kite_config(&config)
    } else {
        Ok(())
    }
}

// ─── Helper: timestamp → RFC3339 string ─────────────────────────────────────

pub fn ts_to_rfc3339(ts: i64) -> String {
    Utc.timestamp_opt(ts, 0)
        .single()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}
