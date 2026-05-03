mod kite_api;
mod kite_auth;
mod models;
mod storage;
mod watchlists;

use models::{ChartDataResponse, FetchSettings, LastSelection, PivotSource, PriceAlert, RetentionSettings, SymbolSearchResult};
use tauri::Emitter;

// ─── Watchlist commands ───────────────────────────────────────────────────────

#[tauri::command]
fn list_watchlists() -> Vec<models::WatchlistEntry> {
    watchlists::list()
}

#[tauri::command]
fn add_watchlist(name: String, symbols: Vec<String>) -> Result<(), String> {
    watchlists::add(name, symbols)
}

#[tauri::command]
fn remove_watchlist(name: String) -> Result<(), String> {
    watchlists::remove(&name)
}

#[tauri::command]
fn load_symbols(watchlist_name: String) -> Result<Vec<models::WatchlistSymbol>, String> {
    watchlists::load_symbols(&watchlist_name)
}

#[tauri::command]
fn search_symbol(symbol: String) -> Result<Vec<SymbolSearchResult>, String> {
    watchlists::search_symbol(&symbol)
}

#[tauri::command]
fn update_symbol_color(watchlist_name: String, symbol: String, color: Option<String>) -> Result<(), String> {
    watchlists::update_symbol_color(&watchlist_name, &symbol, color.as_deref())
}

#[tauri::command]
fn update_symbol_tag_color(watchlist_name: String, symbol: String, tag_color: Option<String>) -> Result<(), String> {
    watchlists::update_symbol_tag_color(&watchlist_name, &symbol, tag_color.as_deref())
}

#[tauri::command]
fn remove_symbol(watchlist_name: String, symbol: String) -> Result<(), String> {
    watchlists::remove_symbol(&watchlist_name, &symbol)
}

#[tauri::command]
fn add_symbol_to_watchlist(watchlist_name: String, symbol: String) -> Result<(), String> {
    watchlists::add_symbol_to_watchlist(&watchlist_name, &symbol)
}

#[tauri::command]
fn migrate_watchlists() -> Result<(), String> {
    storage::migrate_watchlists_to_sqlite()
}

// ─── Last selection ───────────────────────────────────────────────────────────

#[tauri::command]
fn get_last_selection() -> LastSelection {
    storage::load_last_selection()
}

#[tauri::command]
fn set_last_selection(
    watchlist_name: Option<String>,
    symbol: Option<String>,
    interval: Option<String>,
    last_picked_watchlist: Option<String>,
) -> Result<(), String> {
    storage::save_last_selection(&LastSelection {
        watchlist_name,
        symbol,
        interval,
        last_picked_watchlist,
    })
}

// ─── Chart data ───────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_chart_data(symbol: String, interval: String) -> Result<ChartDataResponse, String> {
    kite_api::get_chart_data(&symbol, &interval).await
}
#[tauri::command]
async fn refresh_chart_data(symbol: String, interval: String) -> Result<ChartDataResponse, String> {
    kite_api::refresh_chart_data(&symbol, &interval).await
}
#[tauri::command]
async fn get_pivot_source(symbol: String, interval: String) -> Result<Option<PivotSource>, String> {
    kite_api::get_pivot_source(&symbol, &interval).await
}
// ─── Instruments ──────────────────────────────────────────────────────────────

#[tauri::command]
async fn refresh_instruments() -> Result<usize, String> {
    kite_api::refresh_instruments().await
}

#[tauri::command]
fn get_instruments_count() -> Result<i64, String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::get_instruments_count(&conn).map_err(|e| e.to_string())
}

// ─── Retention settings ───────────────────────────────────────────────────────

#[tauri::command]
fn get_retention_settings() -> RetentionSettings {
    storage::load_retention_settings()
}

#[tauri::command]
fn update_retention_settings(settings: RetentionSettings) -> Result<usize, String> {
    storage::save_retention_settings(&settings)?;
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::prune_candles(&settings, &conn).map_err(|e| e.to_string())
}

// ─── Fetch settings ───────────────────────────────────────────────────────────

#[tauri::command]
fn get_fetch_settings() -> FetchSettings {
    storage::load_fetch_settings()
}

#[tauri::command]
fn update_fetch_settings(settings: FetchSettings) -> Result<(), String> {
    storage::save_fetch_settings(&settings)
}

// ─── Kite auth ────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_auth_status() -> models::AuthStatus {
    kite_auth::get_auth_status()
}

#[tauri::command]
fn save_kite_credentials(api_key: String, api_secret: String) -> Result<(), String> {
    kite_auth::save_credentials(api_key, api_secret)
}

#[tauri::command]
fn get_saved_kite_credentials() -> Option<models::SavedKiteCredentials> {
    kite_auth::get_saved_credentials()
}

#[tauri::command]
async fn kite_start_login(app: tauri::AppHandle) -> Result<String, String> {
    let login_url = kite_auth::get_login_url()?;

    // Open the login page in the system browser
    open::that(&login_url).map_err(|e| format!("Failed to open browser: {}", e))?;

    // Spawn background task: wait for callback → exchange token → emit event
    let app_handle = app.clone();
    tokio::spawn(async move {
        let result = async {
            let request_token = kite_auth::start_callback_server().await?;
            kite_auth::exchange_request_token(&request_token).await
        }
        .await;

        let payload = match result {
            Ok(_) => serde_json::json!({ "success": true,  "message": "Authentication successful" }),
            Err(e) => serde_json::json!({ "success": false, "message": e }),
        };
        let _ = app_handle.emit("kite-auth-complete", payload);
    });

    Ok(format!(
        "Login page opened. Complete login in your browser. \
         (Redirect URL: http://127.0.0.1:{}/login)",
        kite_auth::KITE_CALLBACK_PORT
    ))
}

// ─── Drawing Storage Commands ───────────────────────────────────────────────

#[tauri::command]
fn load_sr_drawings(symbol: String) -> Result<Vec<String>, String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::load_sr_drawings(&symbol, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_sr_drawings(symbol: String, drawings_json: String) -> Result<(), String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::save_sr_drawings(&symbol, &drawings_json, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_sr_drawings(symbol: String) -> Result<(), String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::clear_sr_drawings(&symbol, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_fib_drawings(symbol: String) -> Result<Option<String>, String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::load_fib_drawings(&symbol, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_fib_drawings(symbol: String, drawings_json: String) -> Result<(), String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::save_fib_drawings(&symbol, &drawings_json, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_fib_drawings(symbol: String) -> Result<(), String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::clear_fib_drawings(&symbol, &conn).map_err(|e| e.to_string())
}

// ─── Price Alert Commands ─────────────────────────────────────────────────

#[tauri::command]
fn add_price_alert(symbol: String, target_price: f64, direction: String) -> Result<(), String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::add_price_alert(&symbol, target_price, &direction, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_price_alerts(symbol: String) -> Result<Vec<PriceAlert>, String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::get_price_alerts_for_symbol(&symbol, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_all_price_alerts() -> Result<Vec<PriceAlert>, String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::load_price_alerts(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_price_alert(id: String) -> Result<(), String> {
    let conn = storage::open_db().map_err(|e| e.to_string())?;
    storage::delete_price_alert(&id, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_price_alerts() -> Result<(), String> {
    let watchlist_name = "PriceAlerts";
    storage::remove_watchlist(watchlist_name).ok();

    let conn = storage::open_db().map_err(|e| e.to_string())?;
    let alerts = storage::load_price_alerts(&conn).map_err(|e| e.to_string())?;

    if alerts.is_empty() {
        return Ok(());
    }

    let mut symbol_map: std::collections::HashMap<String, Vec<PriceAlert>> = std::collections::HashMap::new();
    for alert in alerts {
        symbol_map.entry(alert.symbol.clone()).or_default().push(alert);
    }

    let mut triggered_symbols: Vec<String> = Vec::new();

    for (symbol, symbol_alerts) in symbol_map {
        match kite_api::get_chart_data(&symbol, "day").await {
            Ok(resp) => {
                println!("Price alerts check for {}", symbol);
                if let Some(candle) = resp.candles.last() {
                    let prices = [candle.close, candle.open, candle.high, candle.low];
                    for alert in &symbol_alerts {
                        for price in prices {
                            let diff = (price - alert.target_price).abs();
                            let threshold = alert.target_price * 0.01;
                            if diff <= threshold {
                                if !triggered_symbols.contains(&symbol) {
                                    triggered_symbols.push(symbol.clone());
                                }
                                break;
                            }
                        }
                    }
                }
            }
            Err(_) => continue,
        }
    }

    if triggered_symbols.is_empty() {
        storage::remove_watchlist(watchlist_name).ok();
    } else {
        let symbols: Vec<models::WatchlistSymbol> = triggered_symbols
            .iter()
            .map(|s| models::WatchlistSymbol {
                symbol: s.clone(),
                color: None,
                tag_color: None,
            })
            .collect();
        storage::save_watchlist(watchlist_name, &symbols).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ─── Auth Commands ──────────────────────────────────────────────────────────

#[tauri::command]
fn kite_logout() -> Result<(), String> {
    kite_auth::logout()
}

// ─── App entry point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    storage::ensure_app_dir().ok();

    // Prune drawings that haven't been accessed in the past 180 days
    if let Ok(conn) = storage::open_db() {
        storage::prune_stale_drawings(&conn).ok();
    }

    tauri::Builder::default()
        
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
            let alerts_item = MenuItem::with_id(app, "check_price_alerts", "Check price alerts", true, None::<&str>)?;
            let alerts_menu = SubmenuBuilder::new(app, "Alerts")
                .item(&alerts_item)
                .build()?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit EquityWatcher", true, Some("CmdO+Q"))?;
            let menu = MenuBuilder::new(app)
                .item(&alerts_menu)
                .separator()
                .item(&quit_item)
                .build()?;
            menu.set_as_app_menu()?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().0.as_str() {
                "check_price_alerts" => {
                    tauri::async_runtime::spawn(async move {
                        match check_price_alerts().await {
                            Ok(()) => {
                                println!("Price alerts check completed");
                            }
                            Err(e) => {
                                eprintln!("Price alerts check failed: {}", e);
                            }
                        }
                    });
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_watchlists,
            add_watchlist,
            remove_watchlist,
            load_symbols,
            search_symbol,
            update_symbol_color,
            update_symbol_tag_color,
            remove_symbol,
            migrate_watchlists,
            add_symbol_to_watchlist,
            get_last_selection,
            set_last_selection,
            get_chart_data,
            refresh_chart_data,
            get_pivot_source,
            refresh_instruments,
            get_instruments_count,
            get_retention_settings,
            update_retention_settings,
            get_fetch_settings,
            update_fetch_settings,
            get_auth_status,
            save_kite_credentials,
            get_saved_kite_credentials,
            kite_start_login,
            kite_logout,
            load_sr_drawings,
            save_sr_drawings,
            clear_sr_drawings,
            load_fib_drawings,
            save_fib_drawings,
            clear_fib_drawings,
            add_price_alert,
            get_price_alerts,
            get_all_price_alerts,
            delete_price_alert,
            check_price_alerts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
