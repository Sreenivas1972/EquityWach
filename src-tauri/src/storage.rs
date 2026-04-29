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
