use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::models::{AuthStatus, SavedKiteCredentials};
use crate::storage;

const KITE_API_BASE: &str = "https://api.kite.trade";
/// Port that Kite redirects to after login.
/// Register http://127.0.0.1:6010/login as the redirect URL in your Kite developer console.
pub const KITE_CALLBACK_PORT: u16 = 6010;

// ─── Status ──────────────────────────────────────────────────────────────────

pub fn get_auth_status() -> AuthStatus {
    let config = storage::load_kite_config();
    match config {
        Some(c) if c.access_token.is_some() => AuthStatus {
            is_authenticated: true,
            api_key: Some(c.api_key),
            message: "Authenticated".to_string(),
        },
        Some(c) => AuthStatus {
            is_authenticated: false,
            api_key: Some(c.api_key),
            message: "API key configured but not authenticated. Please click Login.".to_string(),
        },
        None => AuthStatus {
            is_authenticated: false,
            api_key: None,
            message: "Not configured. Enter API key and secret in Settings.".to_string(),
        },
    }
}

// ─── Credentials ─────────────────────────────────────────────────────────────

pub fn save_credentials(api_key: String, api_secret: String) -> Result<(), String> {
    // Preserve existing access_token if the key hasn't changed
    let existing = storage::load_kite_config();
    let access_token = existing
        .as_ref()
        .filter(|c| c.api_key == api_key)
        .and_then(|c| c.access_token.clone());

    storage::save_kite_config(&crate::models::KiteConfig {
        api_key,
        api_secret,
        access_token,
    })
}

pub fn get_saved_credentials() -> Option<SavedKiteCredentials> {
    let config = storage::load_kite_config()?;
    Some(SavedKiteCredentials {
        api_key: config.api_key,
        api_secret: config.api_secret,
    })
}

pub fn get_login_url() -> Result<String, String> {
    let config = storage::load_kite_config()
        .ok_or("Kite credentials not configured. Save API key and secret first.")?;
    Ok(format!(
        "https://kite.trade/connect/login?api_key={}&v=3",
        config.api_key
    ))
}

pub fn logout() -> Result<(), String> {
    storage::clear_access_token()
}

// ─── Local callback server ────────────────────────────────────────────────────

/// Binds a one-shot HTTP server on KITE_CALLBACK_PORT, waits for Kite's redirect,
/// and returns the `request_token` extracted from the query string.
pub async fn start_callback_server() -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind(format!("127.0.0.1:{}", KITE_CALLBACK_PORT))
        .await
        .map_err(|e| {
            format!(
                "Failed to start callback server on port {}: {}. \
                 Is another instance running?",
                KITE_CALLBACK_PORT, e
            )
        })?;

    // Wait up to 5 minutes for the browser callback
    let (mut stream, _) =
        tokio::time::timeout(std::time::Duration::from_secs(300), listener.accept())
            .await
            .map_err(|_| "Login timed out (5 minutes). Please try again.")?
            .map_err(|e| e.to_string())?;

    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]).to_string();

    // First line: "GET /?request_token=xxx&action=login&status=success HTTP/1.1"
    let first_line = request.lines().next().unwrap_or("");
    let status = extract_query_param(first_line, "status").unwrap_or_default();
    let request_token = extract_query_param(first_line, "request_token")
        .ok_or_else(|| "request_token not found in Kite callback".to_string())?;

    let body = if status == "success" {
        "<html><body style='font-family:sans-serif;padding:2em'>\
         <h2 style='color:#27ae60'>&#10003; Login successful!</h2>\
         <p>You can close this tab and return to EquityWatcher.</p>\
         </body></html>"
    } else {
        "<html><body style='font-family:sans-serif;padding:2em'>\
         <h2 style='color:#e74c3c'>&#10007; Login failed.</h2>\
         <p>Please return to EquityWatcher and try again.</p>\
         </body></html>"
    };

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;

    if status != "success" {
        return Err("Kite login was not successful".to_string());
    }

    Ok(request_token)
}

// ─── Token exchange ───────────────────────────────────────────────────────────

pub async fn exchange_request_token(request_token: &str) -> Result<String, String> {
    let config =
        storage::load_kite_config().ok_or("Kite credentials not found during token exchange")?;

    // checksum = SHA-256(api_key + request_token + api_secret)
    let mut hasher = Sha256::new();
    hasher.update(config.api_key.as_bytes());
    hasher.update(request_token.as_bytes());
    hasher.update(config.api_secret.as_bytes());
    let checksum = format!("{:x}", hasher.finalize());

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/session/token", KITE_API_BASE))
        .header("X-Kite-Version", "3")
        .form(&[
            ("api_key", config.api_key.as_str()),
            ("request_token", request_token),
            ("checksum", checksum.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Network error during token exchange: {}", e))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed: {}", text));
    }

    #[derive(Deserialize)]
    struct TokenResponse {
        data: TokenData,
    }
    #[derive(Deserialize)]
    struct TokenData {
        access_token: String,
    }

    let token_resp: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    storage::save_access_token(&token_resp.data.access_token)?;
    Ok(token_resp.data.access_token)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

fn extract_query_param(request_line: &str, param: &str) -> Option<String> {
    let start = request_line.find('?')? + 1;
    let end = request_line.rfind(" HTTP")?;
    let query = &request_line[start..end];

    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            if key == param {
                return Some(url_decode(value));
            }
        }
    }
    None
}

fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    result.push(byte as char);
                    i += 3;
                    continue;
                }
            }
        } else if bytes[i] == b'+' {
            result.push(' ');
            i += 1;
            continue;
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}
