use std::path::PathBuf;

use chrono::{Duration, TimeZone, Utc};
use rusqlite::{params, Connection, Result as SqlResult};

use crate::models::{
    CandleData, FetchSettings, InstrumentInfo, UpstoxConfig, LastSelection, RetentionSettings,
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
fn instruments_db_path() -> PathBuf {
    get_app_data_dir().join("upstox_instruments.db")
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
fn upstox_config_path() -> PathBuf {
    get_app_data_dir().join("upstox_config.json")
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
        CREATE INDEX IF NOT EXISTS idx_candles_lookup
            ON candles(symbol, interval, timestamp);
        
        -- Drawing storage tables
        CREATE TABLE IF NOT EXISTS sr_drawings (
            id            TEXT    NOT NULL,
            symbol        TEXT    NOT NULL,
            kind          TEXT    NOT NULL,
            data          TEXT    NOT NULL,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            last_accessed INTEGER,
            PRIMARY KEY (id, symbol)
        );
        CREATE INDEX IF NOT EXISTS idx_sr_symbol ON sr_drawings(symbol);
        
        CREATE TABLE IF NOT EXISTS fib_drawings (
            id            TEXT    NOT NULL,
            symbol        TEXT    NOT NULL,
            kind          TEXT    NOT NULL,
            data          TEXT    NOT NULL,
            defaults      TEXT,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL,
            last_accessed INTEGER,
            PRIMARY KEY (id, symbol)
        );
        CREATE INDEX IF NOT EXISTS idx_fib_symbol ON fib_drawings(symbol);
        
        -- Watchlist storage tables
        CREATE TABLE IF NOT EXISTS watchlists (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL UNIQUE,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS watchlist_symbols (
            watchlist_id INTEGER NOT NULL,
            symbol       TEXT    NOT NULL,
            color        TEXT,
            tag_color    TEXT,
            FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE,
            PRIMARY KEY (watchlist_id, symbol)
        );
        CREATE INDEX IF NOT EXISTS idx_watchlist_symbols_watchlist_id ON watchlist_symbols(watchlist_id);
        CREATE TABLE IF NOT EXISTS pivot_meta (
            symbol       TEXT    NOT NULL,
            pivot_type   TEXT    NOT NULL,
            period_start INTEGER NOT NULL,
            high         REAL    NOT NULL,
            low          REAL    NOT NULL,
            close        REAL    NOT NULL,
            updated_at   INTEGER NOT NULL,
            PRIMARY KEY (symbol, pivot_type)
        );
        
        -- Price alerts
        CREATE TABLE IF NOT EXISTS price_alerts (
            id            TEXT    NOT NULL PRIMARY KEY,
            symbol        TEXT    NOT NULL,
            target_price  REAL    NOT NULL,
            direction     TEXT    NOT NULL,
            created_at    TEXT    NOT NULL,
            created_ts    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_price_alerts_symbol ON price_alerts(symbol);
        
        -- Long positions
        CREATE TABLE IF NOT EXISTS long_positions (
            id            TEXT    NOT NULL PRIMARY KEY,
            symbol        TEXT    NOT NULL,
            entry_price   REAL    NOT NULL,
            sl_price      REAL    NOT NULL,
            target_price  REAL    NOT NULL,
            entry_time    INTEGER NOT NULL,
            interval      TEXT    NOT NULL,
            created_at    TEXT    NOT NULL,
            created_ts    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_long_positions_symbol ON long_positions(symbol);
        
        -- Chart notes
        CREATE TABLE IF NOT EXISTS chart_notes (
            id            TEXT    NOT NULL PRIMARY KEY,
            symbol        TEXT    NOT NULL,
            note_text     TEXT    NOT NULL,
            anchor_time   INTEGER NOT NULL,
            anchor_price  REAL    NOT NULL,
            pos_x         REAL,
            pos_y         REAL,
            created_at    TEXT    NOT NULL,
            created_ts    INTEGER NOT NULL,
            updated_ts    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chart_notes_symbol ON chart_notes(symbol);
        
        -- Note hashtags (unique list for autocomplete)
        CREATE TABLE IF NOT EXISTS note_hashtags (
            tag           TEXT    NOT NULL PRIMARY KEY,
            created_ts    INTEGER NOT NULL
        );
        ",
    )?;
    
    // Migration: Add color column to watchlist_symbols if it doesn't exist
    let has_color_column = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('watchlist_symbols') WHERE name='color'")?
        .query_row([], |row| row.get::<_, i64>(0))? > 0;
    
    if !has_color_column {
        conn.execute("ALTER TABLE watchlist_symbols ADD COLUMN color TEXT", [])?;
    }
    
    // Migration: Add tag_color column to watchlist_symbols if it doesn't exist
    let has_tag_color_column = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('watchlist_symbols') WHERE name='tag_color'")?
        .query_row([], |row| row.get::<_, i64>(0))? > 0;
        
    if !has_tag_color_column {
        conn.execute("ALTER TABLE watchlist_symbols ADD COLUMN tag_color TEXT", [])?;
    }

    // Migration: Add last_accessed to sr_drawings
    let has_sr_last_accessed = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sr_drawings') WHERE name='last_accessed'")?
        .query_row([], |row| row.get::<_, i64>(0))? > 0;

    if !has_sr_last_accessed {
        conn.execute("ALTER TABLE sr_drawings ADD COLUMN last_accessed INTEGER", [])?;
        // Backfill with updated_at so existing drawings are not immediately pruned
        conn.execute("UPDATE sr_drawings SET last_accessed = updated_at WHERE last_accessed IS NULL", [])?;
    }

    // Migration: Add last_accessed to fib_drawings
    let has_fib_last_accessed = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('fib_drawings') WHERE name='last_accessed'")?
        .query_row([], |row| row.get::<_, i64>(0))? > 0;

    if !has_fib_last_accessed {
        conn.execute("ALTER TABLE fib_drawings ADD COLUMN last_accessed INTEGER", [])?;
        // Backfill with updated_at so existing drawings are not immediately pruned
        conn.execute("UPDATE fib_drawings SET last_accessed = updated_at WHERE last_accessed IS NULL", [])?;
    }

    Ok(conn)
}

// ─── Instruments Database ─────────────────────────────────────────────────────

pub fn open_instruments_db() -> SqlResult<Connection> {
    let conn = Connection::open(instruments_db_path())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS instruments (
            instrument_token INTEGER NOT NULL,
            tradingsymbol    TEXT    NOT NULL,
            exchange         TEXT    NOT NULL,
            name             TEXT    NOT NULL,
            instrument_key   TEXT,
            PRIMARY KEY (instrument_token)
        );
        CREATE INDEX IF NOT EXISTS idx_instruments_sym
            ON instruments(tradingsymbol, exchange);
        CREATE INDEX IF NOT EXISTS idx_instruments_key
            ON instruments(instrument_key);
        ",
    )?;

    // Migration: Add instrument_key if not exists
    let has_instrument_key = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('instruments') WHERE name='instrument_key'")?
        .query_row([], |row| row.get::<_, i64>(0))? > 0;

    if !has_instrument_key {
        conn.execute("ALTER TABLE instruments ADD COLUMN instrument_key TEXT", [])?;
    }

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

pub fn get_cached_candles_range(
    symbol: &str,
    interval: &str,
    start_ts: i64,
    end_ts: i64,
    conn: &Connection,
) -> SqlResult<Vec<CandleData>> {
    let mut stmt = conn.prepare(
        "SELECT timestamp, open, high, low, close, volume
         FROM candles
         WHERE symbol = ?1 AND interval = ?2 AND timestamp >= ?3 AND timestamp <= ?4
         ORDER BY timestamp ASC",
    )?;
    let rows = stmt
        .query_map(params![symbol, interval, start_ts, end_ts], |row| {
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

pub struct PivotMeta {
    pub period_start: i64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
}

pub fn get_pivot_meta(
    symbol: &str,
    pivot_type: &str,
    conn: &Connection,
) -> SqlResult<Option<PivotMeta>> {
    let mut stmt = conn.prepare(
        "SELECT period_start, high, low, close
         FROM pivot_meta
         WHERE symbol = ?1 AND pivot_type = ?2",
    )?;
    match stmt.query_row(params![symbol, pivot_type], |row| {
        Ok(PivotMeta {
            period_start: row.get(0)?,
            high: row.get(1)?,
            low: row.get(2)?,
            close: row.get(3)?,
        })
    }) {
        Ok(meta) => Ok(Some(meta)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn save_pivot_meta(
    symbol: &str,
    pivot_type: &str,
    period_start: i64,
    high: f64,
    low: f64,
    close: f64,
    conn: &Connection,
) -> SqlResult<()> {
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT OR REPLACE INTO pivot_meta
         (symbol, pivot_type, period_start, high, low, close, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![symbol, pivot_type, period_start, high, low, close, now],
    )?;
    Ok(())
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
             (instrument_token, tradingsymbol, exchange, name, instrument_key)
             VALUES (?1,?2,?3,?4,?5)",
            params![inst.instrument_token, inst.tradingsymbol, inst.exchange, inst.name, inst.instrument_key],
        )?;
    }
    Ok(())
}
/*
This was used in kite API version (main branch)
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
}*/

pub fn lookup_instrument_key(
    tradingsymbol: &str,
    exchange: &str,
    conn: &Connection,
) -> SqlResult<Option<String>> {
    match conn.query_row(
        "SELECT instrument_key FROM instruments
         WHERE tradingsymbol = ?1 AND exchange = ?2",
        params![tradingsymbol, exchange],
        |row| row.get(0),
    ) {
        Ok(key) => Ok(Some(key)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn lookup_instrument_keys(
    symbols: &[(String, String)],
    conn: &Connection,
) -> SqlResult<Vec<(String, Option<String>)>> {
    let mut results = Vec::new();
    
    for (tradingsymbol, exchange) in symbols {
        let key = lookup_instrument_key(tradingsymbol, exchange, conn)?;
        results.push((tradingsymbol.clone(), key));
    }
    
    Ok(results)
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
    let rows: Vec<String> = stmt
        .query_map(params![symbol], |row| {
            Ok(row.get::<_, String>(0)?)
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Stamp last_accessed so stale-drawing pruning knows this was recently used
    if !rows.is_empty() {
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "UPDATE sr_drawings SET last_accessed = ?1 WHERE symbol = ?2",
            params![now, symbol],
        )?;
    }

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
        Ok((data, _defaults)) => {
            // Stamp last_accessed so stale-drawing pruning knows this was recently used
            let now = chrono::Utc::now().timestamp();
            conn.execute(
                "UPDATE fib_drawings SET last_accessed = ?1 WHERE symbol = ?2",
                params![now, symbol],
            )?;
            Ok(Some(data))
        },
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

/// Delete drawings that have not been accessed in the past 180 days.
/// Uses COALESCE(last_accessed, updated_at) so rows that predate the column
/// are judged by their last write time instead.
pub fn prune_stale_drawings(conn: &Connection) -> SqlResult<usize> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(180)).timestamp();
    let mut total = 0;
    total += conn.execute(
        "DELETE FROM sr_drawings  WHERE COALESCE(last_accessed, updated_at) < ?1",
        params![cutoff],
    )?;
    total += conn.execute(
        "DELETE FROM fib_drawings WHERE COALESCE(last_accessed, updated_at) < ?1",
        params![cutoff],
    )?;
    Ok(total)
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
    let conn = open_db().unwrap();
    let mut stmt = conn.prepare("SELECT name FROM watchlists ORDER BY name").unwrap();
    let watchlist_iter = stmt.query_map([], |row| {
        Ok(WatchlistEntry {
            name: row.get(0)?,
        })
    }).unwrap();
    
    watchlist_iter.map(|w| w.unwrap()).collect()
}

pub fn save_watchlist(name: &str, symbols: &[crate::models::WatchlistSymbol]) -> Result<(), String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();
    
    // Insert or replace watchlist
    conn.execute(
        "INSERT OR REPLACE INTO watchlists (name, created_at, updated_at) VALUES (?1, ?2, ?3)",
        params![name, now, now],
    ).map_err(|e| e.to_string())?;
    
    // Get watchlist id
    let watchlist_id: i64 = conn.query_row(
        "SELECT id FROM watchlists WHERE name = ?1",
        params![name],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    // Delete existing symbols
    conn.execute(
        "DELETE FROM watchlist_symbols WHERE watchlist_id = ?1",
        params![watchlist_id],
    ).map_err(|e| e.to_string())?;
    
    // Insert new symbols with colors
    for symbol in symbols {
        conn.execute(
            "INSERT INTO watchlist_symbols (watchlist_id, symbol, color, tag_color) VALUES (?1, ?2, ?3, ?4)",
            params![watchlist_id, symbol.symbol.to_uppercase(), symbol.color, symbol.tag_color],
        ).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

pub fn load_watchlist_symbols(watchlist_name: &str) -> Result<Vec<crate::models::WatchlistSymbol>, String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT ws.symbol, ws.color, ws.tag_color FROM watchlist_symbols ws 
         JOIN watchlists w ON ws.watchlist_id = w.id 
         WHERE w.name = ?1 ORDER BY ws.symbol"
    ).map_err(|e| e.to_string())?;
    
    let symbol_iter = stmt.query_map(params![watchlist_name], |row| {
        Ok(crate::models::WatchlistSymbol {
            symbol: row.get(0)?,
            color: row.get(1)?,
            tag_color: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let symbols: Result<Vec<crate::models::WatchlistSymbol>, _> = symbol_iter.collect();
    symbols.map_err(|e| e.to_string())
}

pub fn update_symbol_color(watchlist_name: &str, symbol: &str, color: Option<&str>) -> Result<(), String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE watchlist_symbols SET color = ?1 
         WHERE watchlist_id = (SELECT id FROM watchlists WHERE name = ?2) 
         AND symbol = ?3",
        params![color, watchlist_name, symbol.to_uppercase()],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_symbol_tag_color(watchlist_name: &str, symbol: &str, tag_color: Option<&str>) -> Result<(), String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE watchlist_symbols SET tag_color = ?1 
         WHERE watchlist_id = (SELECT id FROM watchlists WHERE name = ?2) 
         AND symbol = ?3",
        params![tag_color, watchlist_name, symbol.to_uppercase()],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_symbol(watchlist_name: &str, symbol: &str) -> Result<(), String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM watchlist_symbols 
         WHERE watchlist_id = (SELECT id FROM watchlists WHERE name = ?1) 
         AND symbol = ?2",
        params![watchlist_name, symbol.to_uppercase()],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn add_symbol_to_watchlist(watchlist_name: &str, symbol: &str) -> Result<(), String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    
    // Check if watchlist exists
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM watchlists WHERE name = ?1)",
        params![watchlist_name],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    if !exists {
        return Err(format!("Watchlist '{}' not found", watchlist_name));
    }
    
    // Check if symbol already exists
    let already_exists: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM watchlist_symbols ws
            JOIN watchlists w ON ws.watchlist_id = w.id
            WHERE w.name = ?1 AND ws.symbol = ?2
        )",
        params![watchlist_name, symbol.to_uppercase()],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    if already_exists {
        return Ok(()); // Already in watchlist, no-op
    }
    
    // Insert the symbol
    conn.execute(
        "INSERT INTO watchlist_symbols (watchlist_id, symbol, color, tag_color)
         VALUES ((SELECT id FROM watchlists WHERE name = ?1), ?2, NULL, NULL)",
        params![watchlist_name, symbol.to_uppercase()],
    ).map_err(|e| e.to_string())?;
    
    // Update the watchlist's updated_at
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE watchlists SET updated_at = ?1 WHERE name = ?2",
        params![now, watchlist_name],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn remove_watchlist(name: &str) -> Result<(), String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM watchlists WHERE name = ?1",
        params![name],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn migrate_watchlists_to_sqlite() -> Result<(), String> {
    // Check if migration already done
    let conn = open_db().map_err(|e| e.to_string())?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM watchlists",
        [],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    if count > 0 {
        return Ok(()); // Already migrated
    }
    
    // Define old watchlist entry for migration
    #[derive(serde::Deserialize)]
    struct OldWatchlistEntry {
        name: String,
        file_path: String,
    }
    
    // Load old watchlists from JSON
    let old_watchlists: Vec<OldWatchlistEntry> = read_json(&watchlists_path()).unwrap_or_default();
    
    for watchlist in old_watchlists {
        // Read symbols from file
        let content = match std::fs::read_to_string(&watchlist.file_path) {
            Ok(c) => c,
            Err(_) => continue, // Skip if file not found
        };
        
        let symbols: Vec<crate::models::WatchlistSymbol> = content
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(|l| crate::models::WatchlistSymbol {
                symbol: l.to_uppercase(),
                color: None,
                tag_color: None,
            })
            .collect();
        
        if let Err(_) = save_watchlist(&watchlist.name, &symbols) {
            // Continue with other watchlists even if one fails
            continue;
        }
    }
    
    Ok(())
}

pub fn search_symbols(pattern: &str) -> Result<Vec<crate::models::SymbolSearchResult>, String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    
    // Check if pattern contains regex meta characters
    let is_regex = pattern.chars().any(|c| ".^$*+?()[{\\|".contains(c));
    
    if is_regex {
        let regex_pattern = pattern.to_uppercase();
        let re = match regex::Regex::new(&regex_pattern) {
            Ok(r) => r,
            Err(_) => return Ok(vec![]), // If invalid regex, return empty
        };
        
        let mut stmt = conn.prepare(
            "SELECT ws.symbol, w.name FROM watchlist_symbols ws 
             JOIN watchlists w ON ws.watchlist_id = w.id 
             ORDER BY ws.symbol, w.name"
        ).map_err(|e| e.to_string())?;
        
        let mut results_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        
        let rows = stmt.query_map([], |row| {
            let symbol: String = row.get(0)?;
            let watchlist: String = row.get(1)?;
            Ok((symbol, watchlist))
        }).map_err(|e| e.to_string())?;
        
        for row in rows {
            if let Ok((sym, wl)) = row {
                if re.is_match(&sym) {
                    results_map.entry(sym).or_default().push(wl);
                }
            }
        }
        
        let mut final_results: Vec<crate::models::SymbolSearchResult> = results_map.into_iter().map(|(s, wls)| {
            crate::models::SymbolSearchResult {
                symbol: s,
                watchlists: wls,
            }
        }).collect();
        final_results.sort_by(|a, b| a.symbol.cmp(&b.symbol));
        Ok(final_results)
    } else {
        // Normal search (exact match)
        let symbol_upper = pattern.to_uppercase();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT w.name FROM watchlists w 
             JOIN watchlist_symbols ws ON w.id = ws.watchlist_id 
             WHERE ws.symbol = ?1 
             ORDER BY w.name"
        ).map_err(|e| e.to_string())?;
        
        let watchlist_iter = stmt.query_map(params![symbol_upper], |row| {
            row.get::<_, String>(0)
        }).map_err(|e| e.to_string())?;
        
        let watchlists: Result<Vec<String>, _> = watchlist_iter.collect();
        let wls = watchlists.map_err(|e| e.to_string())?;
        
        if wls.is_empty() {
            Ok(vec![])
        } else {
            Ok(vec![crate::models::SymbolSearchResult {
                symbol: symbol_upper,
                watchlists: wls,
            }])
        }
    }
}

// ─── Last selection ──────────────────────────────────────────────────────────

pub fn load_last_selection() -> LastSelection {
    read_json(&selection_path()).unwrap_or(LastSelection {
        watchlist_name: None,
        symbol: None,
        interval: None,
        last_picked_watchlist: None,
    })
}

pub fn save_last_selection(sel: &LastSelection) -> Result<(), String> {
    write_json(&selection_path(), sel)
}

// ─── Upstox config ─────────────────────────────────────────────────────────────

pub fn load_upstox_config() -> Option<UpstoxConfig> {
    read_json(&upstox_config_path())
}

pub fn save_upstox_config(config: &UpstoxConfig) -> Result<(), String> {
    write_json(&upstox_config_path(), config)
}

/// Update only the access_token field, preserving api_key/api_secret/analytics_token.
pub fn save_access_token(token: &str) -> Result<(), String> {
    let mut config = load_upstox_config().ok_or("Upstox credentials not configured")?;
    config.access_token = Some(token.to_string());
    save_upstox_config(&config)
}

pub fn clear_access_token() -> Result<(), String> {
    if let Some(mut config) = load_upstox_config() {
        config.access_token = None;
        save_upstox_config(&config)
    } else {
        Ok(())
    }
}

pub fn save_analytics_token(token: &str) -> Result<(), String> {
    let mut config = load_upstox_config().ok_or("Upstox credentials not configured")?;
    config.analytics_token = Some(token.to_string());
    save_upstox_config(&config)
}

pub fn clear_analytics_token() -> Result<(), String> {
    if let Some(mut config) = load_upstox_config() {
        config.analytics_token = None;
        save_upstox_config(&config)
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

// ─── Price Alerts (SQLite) ──────────────────────────────────────────────────

pub fn load_price_alerts(conn: &Connection) -> SqlResult<Vec<crate::models::PriceAlert>> {
    let mut stmt = conn.prepare(
        "SELECT id, symbol, target_price, direction, created_at FROM price_alerts ORDER BY created_ts ASC"
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(crate::models::PriceAlert {
                id: row.get(0)?,
                symbol: row.get(1)?,
                target_price: row.get(2)?,
                direction: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn get_price_alerts_for_symbol(symbol: &str, conn: &Connection) -> SqlResult<Vec<crate::models::PriceAlert>> {
    let mut stmt = conn.prepare(
        "SELECT id, symbol, target_price, direction, created_at FROM price_alerts WHERE symbol = ?1 ORDER BY created_ts ASC"
    )?;
    let rows = stmt
        .query_map(params![symbol], |row| {
            Ok(crate::models::PriceAlert {
                id: row.get(0)?,
                symbol: row.get(1)?,
                target_price: row.get(2)?,
                direction: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn add_price_alert(symbol: &str, target_price: f64, direction: &str, conn: &Connection) -> SqlResult<()> {
    let id = format!("alert_{}_{}", symbol, Utc::now().timestamp_millis());
    let created_at = ts_to_rfc3339(Utc::now().timestamp());
    let created_ts = Utc::now().timestamp();

    conn.execute(
        "INSERT INTO price_alerts (id, symbol, target_price, direction, created_at, created_ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, symbol, target_price, direction, created_at, created_ts],
    )?;
    Ok(())
}

pub fn delete_price_alert(id: &str, conn: &Connection) -> SqlResult<()> {
    conn.execute("DELETE FROM price_alerts WHERE id = ?1", params![id])?;
    Ok(())
}

// ─── Long Positions (SQLite) ─────────────────────────────────────────────────

pub fn get_long_positions_for_symbol(symbol: &str, interval: &str, conn: &Connection) -> SqlResult<Vec<crate::models::LongPosition>> {
    let mut stmt = conn.prepare(
        "SELECT id, symbol, entry_price, sl_price, target_price, entry_time, interval, created_at FROM long_positions WHERE symbol = ?1 AND interval = ?2 ORDER BY created_ts ASC"
    )?;
    let rows = stmt
        .query_map(params![symbol, interval], |row| {
            Ok(crate::models::LongPosition {
                id: row.get(0)?,
                symbol: row.get(1)?,
                entry_price: row.get(2)?,
                sl_price: row.get(3)?,
                target_price: row.get(4)?,
                entry_time: row.get(5)?,
                interval: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn add_long_position(
    symbol: &str,
    entry_price: f64,
    sl_price: f64,
    target_price: f64,
    entry_time: i64,
    interval: &str,
    conn: &Connection,
) -> SqlResult<String> {
    let id = format!("pos_{}_{}", symbol, Utc::now().timestamp_millis());
    let created_at = ts_to_rfc3339(Utc::now().timestamp());
    let created_ts = Utc::now().timestamp();

    conn.execute(
        "INSERT INTO long_positions (id, symbol, entry_price, sl_price, target_price, entry_time, interval, created_at, created_ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, symbol, entry_price, sl_price, target_price, entry_time, interval, created_at, created_ts],
    )?;
    Ok(id)
}

pub fn update_long_position(
    id: &str,
    sl_price: f64,
    target_price: f64,
    conn: &Connection,
) -> SqlResult<()> {
    conn.execute(
        "UPDATE long_positions SET sl_price = ?1, target_price = ?2 WHERE id = ?3",
        params![sl_price, target_price, id],
    )?;
    Ok(())
}

pub fn delete_long_position(id: &str, conn: &Connection) -> SqlResult<()> {
    conn.execute("DELETE FROM long_positions WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_symbols_by_color(color: Option<&str>, tag_color: Option<&str>) -> Result<Vec<crate::models::ColorFilteredSymbol>, String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    
    let mut results: Vec<crate::models::ColorFilteredSymbol> = Vec::new();

    let color_mappings: std::collections::HashMap<&str, Vec<&str>> = [
        ("#ff4d4d", vec!["#ff4d4d", "red"]),
        ("#ffcc00", vec!["#ffcc00", "yellow"]),
        ("#3fb950", vec!["#3fb950", "green"]),
        ("red", vec!["#ff4d4d", "red"]),
        ("yellow", vec!["#ffcc00", "yellow"]),
        ("green", vec!["#3fb950", "green"]),
    ].iter().cloned().collect();
    
    fn get_color_variants<'a>(color: &str, mappings: &'a std::collections::HashMap<&str, Vec<&str>>) -> Vec<String> {
        if let Some(variants) = mappings.get(color) {
            variants.iter().map(|s| s.to_string()).collect()
        } else {
            vec![color.to_string()]
        }
    }
    
    match (color, tag_color) {
        (Some(c), Some(t)) => {
            let color_values = get_color_variants(c, &color_mappings);
            let tag_values = get_color_variants(t, &color_mappings);
            
            let color_placeholders: Vec<String> = color_values.iter().map(|_| "?".to_string()).collect();
            let tag_placeholders: Vec<String> = tag_values.iter().map(|_| "?".to_string()).collect();
            
            let sql = format!(
                "SELECT ws.symbol, w.name, ws.color, ws.tag_color 
                 FROM watchlist_symbols ws 
                 JOIN watchlists w ON ws.watchlist_id = w.id 
                 WHERE ws.color IN ({}) 
                 AND ws.tag_color IN ({})
                 ORDER BY ws.symbol",
                color_placeholders.join(","),
                tag_placeholders.join(",")
            );
            
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            
            let mut params: Vec<String> = color_values;
            params.extend(tag_values);
            
            let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
            
            let rows = stmt.query_map(params_refs.as_slice(), |row| {
                Ok(crate::models::ColorFilteredSymbol {
                    symbol: row.get(0)?,
                    watchlist_name: row.get(1)?,
                    color: row.get(2)?,
                    tag_color: row.get(3)?,
                })
            }).map_err(|e| e.to_string())?;
            
            for row in rows {
                if let Ok(s) = row {
                    results.push(s);
                }
            }
        }
        (Some(c), None) => {
            let color_values = get_color_variants(c, &color_mappings);
            
            let placeholders: Vec<String> = color_values.iter().map(|_| "?".to_string()).collect();
            
            let sql = format!(
                "SELECT ws.symbol, w.name, ws.color, ws.tag_color 
                 FROM watchlist_symbols ws 
                 JOIN watchlists w ON ws.watchlist_id = w.id 
                 WHERE ws.color IN ({}) 
                 ORDER BY ws.symbol",
                placeholders.join(",")
            );
            
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            
            let params: Vec<&dyn rusqlite::ToSql> = color_values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
            
            let rows = stmt.query_map(params.as_slice(), |row| {
                Ok(crate::models::ColorFilteredSymbol {
                    symbol: row.get(0)?,
                    watchlist_name: row.get(1)?,
                    color: row.get(2)?,
                    tag_color: row.get(3)?,
                })
            }).map_err(|e| e.to_string())?;
            
            for row in rows {
                if let Ok(s) = row {
                    results.push(s);
                }
            }
        }
        (None, Some(t)) => {
            let tag_values = get_color_variants(t, &color_mappings);
            
            let placeholders: Vec<String> = tag_values.iter().map(|_| "?".to_string()).collect();
            
            let sql = format!(
                "SELECT ws.symbol, w.name, ws.color, ws.tag_color 
                 FROM watchlist_symbols ws 
                 JOIN watchlists w ON ws.watchlist_id = w.id 
                 WHERE ws.tag_color IN ({}) 
                 ORDER BY ws.symbol",
                placeholders.join(",")
            );
            
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            
            let params: Vec<&dyn rusqlite::ToSql> = tag_values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
            
            let rows = stmt.query_map(params.as_slice(), |row| {
                Ok(crate::models::ColorFilteredSymbol {
                    symbol: row.get(0)?,
                    watchlist_name: row.get(1)?,
                    color: row.get(2)?,
                    tag_color: row.get(3)?,
                })
            }).map_err(|e| e.to_string())?;
            
            for row in rows {
                if let Ok(s) = row {
                    results.push(s);
                }
            }
        }
        (None, None) => {
            return Err("Either color or tag_color must be provided".to_string());
        }
    }
    
    Ok(results)
}

pub fn get_symbols_with_alerts() -> Result<Vec<crate::models::ColorFilteredSymbol>, String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT DISTINCT pa.symbol, COALESCE(w.name, ''), ws.color, ws.tag_color 
         FROM price_alerts pa 
         LEFT JOIN watchlist_symbols ws ON pa.symbol = ws.symbol 
         LEFT JOIN watchlists w ON ws.watchlist_id = w.id 
         ORDER BY pa.symbol"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(crate::models::ColorFilteredSymbol {
            symbol: row.get(0)?,
            watchlist_name: row.get(1)?,
            color: row.get(2)?,
            tag_color: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut results: Vec<crate::models::ColorFilteredSymbol> = Vec::new();
    for row in rows {
        if let Ok(s) = row {
            results.push(s);
        }
    }
    
    Ok(results)
}

pub fn get_symbols_with_positions() -> Result<Vec<crate::models::ColorFilteredSymbol>, String> {
    let conn = open_db().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT DISTINCT lp.symbol, COALESCE(w.name, ''), ws.color, ws.tag_color 
         FROM long_positions lp 
         LEFT JOIN watchlist_symbols ws ON lp.symbol = ws.symbol 
         LEFT JOIN watchlists w ON ws.watchlist_id = w.id 
         ORDER BY lp.symbol"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(crate::models::ColorFilteredSymbol {
            symbol: row.get(0)?,
            watchlist_name: row.get(1)?,
            color: row.get(2)?,
            tag_color: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut results: Vec<crate::models::ColorFilteredSymbol> = Vec::new();
    for row in rows {
        if let Ok(s) = row {
            results.push(s);
        }
    }
    
    Ok(results)
}

// ─── Chart Notes (SQLite) ─────────────────────────────────────────────────────

pub fn get_chart_notes_for_symbol(symbol: &str, conn: &Connection) -> SqlResult<Vec<crate::models::ChartNote>> {
    let mut stmt = conn.prepare(
        "SELECT id, symbol, note_text, anchor_time, anchor_price, pos_x, pos_y, created_at 
         FROM chart_notes WHERE symbol = ?1 ORDER BY created_ts ASC"
    )?;
    let rows = stmt
        .query_map(params![symbol], |row| {
            Ok(crate::models::ChartNote {
                id: row.get(0)?,
                symbol: row.get(1)?,
                note_text: row.get(2)?,
                anchor_time: row.get(3)?,
                anchor_price: row.get(4)?,
                pos_x: row.get(5)?,
                pos_y: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn add_chart_note(
    symbol: &str,
    note_text: &str,
    anchor_time: i64,
    anchor_price: f64,
    conn: &Connection,
) -> SqlResult<String> {
    let id = format!("note_{}_{}", symbol, Utc::now().timestamp_millis());
    let created_at = ts_to_rfc3339(Utc::now().timestamp());
    let created_ts = Utc::now().timestamp();

    conn.execute(
        "INSERT INTO chart_notes (id, symbol, note_text, anchor_time, anchor_price, pos_x, pos_y, created_at, created_ts, updated_ts) 
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?7, ?7)",
        params![id, symbol, note_text, anchor_time, anchor_price, created_at, created_ts],
    )?;
    
    extract_and_save_hashtags(note_text, conn)?;
    
    Ok(id)
}

pub fn update_chart_note(
    id: &str,
    note_text: &str,
    pos_x: Option<f64>,
    pos_y: Option<f64>,
    conn: &Connection,
) -> SqlResult<()> {
    let updated_ts = Utc::now().timestamp();
    
    if let (Some(x), Some(y)) = (pos_x, pos_y) {
        conn.execute(
            "UPDATE chart_notes SET note_text = ?1, pos_x = ?2, pos_y = ?3, updated_ts = ?4 WHERE id = ?5",
            params![note_text, x, y, updated_ts, id],
        )?;
    } else {
        conn.execute(
            "UPDATE chart_notes SET note_text = ?1, updated_ts = ?2 WHERE id = ?3",
            params![note_text, updated_ts, id],
        )?;
    }
    
    extract_and_save_hashtags(note_text, conn)?;
    
    Ok(())
}

pub fn update_chart_note_position(
    id: &str,
    pos_x: f64,
    pos_y: f64,
    conn: &Connection,
) -> SqlResult<()> {
    let updated_ts = Utc::now().timestamp();
    conn.execute(
        "UPDATE chart_notes SET pos_x = ?1, pos_y = ?2, updated_ts = ?3 WHERE id = ?4",
        params![pos_x, pos_y, updated_ts, id],
    )?;
    Ok(())
}

pub fn delete_chart_note(id: &str, conn: &Connection) -> SqlResult<()> {
    conn.execute("DELETE FROM chart_notes WHERE id = ?1", params![id])?;
    Ok(())
}

fn extract_and_save_hashtags(note_text: &str, conn: &Connection) -> SqlResult<()> {
    let re = regex::Regex::new(r"#(\w+)").unwrap();
    let now = Utc::now().timestamp();
    
    for cap in re.captures_iter(note_text) {
        let tag = cap[1].to_lowercase();
        conn.execute(
            "INSERT OR IGNORE INTO note_hashtags (tag, created_ts) VALUES (?1, ?2)",
            params![tag, now],
        )?;
    }
    
    Ok(())
}

pub fn get_all_hashtags(conn: &Connection) -> SqlResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT tag FROM note_hashtags ORDER BY tag ASC")?;
    let rows = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}
