mod kite_api;
mod kite_auth;
mod models;
mod storage;
mod watchlists;

use models::{ChartDataResponse, FetchSettings, LastSelection, RetentionSettings};
use tauri::Emitter;

// ─── Watchlist commands ───────────────────────────────────────────────────────

#[tauri::command]
fn list_watchlists() -> Vec<models::WatchlistEntry> {
    watchlists::list()
}

#[tauri::command]
fn add_watchlist(name: String, file_path: String) -> Result<(), String> {
    watchlists::add(name, file_path)
}

#[tauri::command]
fn remove_watchlist(name: String) -> Result<(), String> {
    watchlists::remove(&name)
}

#[tauri::command]
fn load_symbols(watchlist_name: String) -> Result<Vec<String>, String> {
    watchlists::load_symbols(&watchlist_name)
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
) -> Result<(), String> {
    storage::save_last_selection(&LastSelection {
        watchlist_name,
        symbol,
        interval,
    })
}

// ─── Chart data ───────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_chart_data(symbol: String, interval: String) -> Result<ChartDataResponse, String> {
    kite_api::get_chart_data(&symbol, &interval).await
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

// ─── Auth Commands ──────────────────────────────────────────────────────────

#[tauri::command]
fn kite_logout() -> Result<(), String> {
    kite_auth::logout()
}

// ─── App entry point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    storage::ensure_app_dir().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_watchlists,
            add_watchlist,
            remove_watchlist,
            load_symbols,
            get_last_selection,
            set_last_selection,
            get_chart_data,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
