use std::path::Path;

use crate::models::WatchlistEntry;
use crate::storage;

pub fn list() -> Vec<WatchlistEntry> {
    storage::load_watchlists()
}

pub fn add(name: String, file_path: String) -> Result<(), String> {
    if !Path::new(&file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }
    let mut entries = storage::load_watchlists();
    if entries.iter().any(|e| e.name == name) {
        return Err(format!("Watchlist '{}' already exists", name));
    }
    entries.push(WatchlistEntry { name, file_path });
    storage::save_watchlists(&entries)
}

pub fn remove(name: &str) -> Result<(), String> {
    let mut entries = storage::load_watchlists();
    entries.retain(|e| e.name != name);
    storage::save_watchlists(&entries)
}

/// Reads trading symbols from the CSV file associated with `watchlist_name`.
/// One symbol per line; lines starting with '#' are treated as comments.
/// Supports optional "EXCHANGE:SYMBOL" format (e.g. "NSE:INFY").
pub fn load_symbols(watchlist_name: &str) -> Result<Vec<String>, String> {
    let entries = storage::load_watchlists();
    let entry = entries
        .iter()
        .find(|e| e.name == watchlist_name)
        .ok_or_else(|| format!("Watchlist '{}' not found", watchlist_name))?;

    let content = std::fs::read_to_string(&entry.file_path)
        .map_err(|e| format!("Failed to read '{}': {}", entry.file_path, e))?;

    let symbols: Vec<String> = content
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| {
            // Normalise: uppercase but keep exchange prefix intact
            l.to_uppercase()
        })
        .collect();

    Ok(symbols)
}
