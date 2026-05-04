use crate::models::{WatchlistEntry, WatchlistSymbol};
use crate::storage;

pub fn list() -> Vec<WatchlistEntry> {
    storage::load_watchlists()
}

pub fn add(name: String, symbols: Vec<String>) -> Result<(), String> {
    let entries = storage::load_watchlists();
    if entries.iter().any(|e| e.name == name) {
        return Err(format!("Watchlist '{}' already exists", name));
    }
    let watchlist_symbols: Vec<WatchlistSymbol> = symbols
        .into_iter()
        .map(|s| WatchlistSymbol { symbol: s, color: None, tag_color: None })
        .collect();
    storage::save_watchlist(&name, &watchlist_symbols)
}

pub fn remove(name: &str) -> Result<(), String> {
    storage::remove_watchlist(name)
}

/// Reads trading symbols from the database for the given watchlist.
/// Symbols are stored in uppercase.
pub fn load_symbols(watchlist_name: &str) -> Result<Vec<WatchlistSymbol>, String> {
    storage::load_watchlist_symbols(watchlist_name)
}

pub fn update_symbol_color(watchlist_name: &str, symbol: &str, color: Option<&str>) -> Result<(), String> {
    storage::update_symbol_color(watchlist_name, symbol, color)
}

pub fn update_symbol_tag_color(watchlist_name: &str, symbol: &str, tag_color: Option<&str>) -> Result<(), String> {
    storage::update_symbol_tag_color(watchlist_name, symbol, tag_color)
}

pub fn remove_symbol(watchlist_name: &str, symbol: &str) -> Result<(), String> {
    storage::remove_symbol(watchlist_name, symbol)
}

pub fn add_symbol_to_watchlist(watchlist_name: &str, symbol: &str) -> Result<(), String> {
    storage::add_symbol_to_watchlist(watchlist_name, symbol)
}

pub fn search_symbol(symbol: &str) -> Result<Vec<crate::models::SymbolSearchResult>, String> {
    storage::search_symbols(symbol)
}

pub fn get_symbols_by_color(color: Option<&str>, tag_color: Option<&str>) -> Result<Vec<crate::models::ColorFilteredSymbol>, String> {
    storage::get_symbols_by_color(color, tag_color)
}
