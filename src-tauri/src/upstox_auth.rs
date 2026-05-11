use serde::Deserialize;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};

use crate::models::{UpstoxAuthStatus, SavedUpstoxCredentials};
use crate::storage;

const UPSTOX_API_BASE: &str = "https://api.upstox.com/v2";
pub const UPSTOX_CALLBACK_PORT: u16 = 5050;

pub fn get_auth_status() -> UpstoxAuthStatus {
    let config = storage::load_upstox_config();
    match config {
        Some(c) => {
            let has_oauth = c.access_token.is_some();
            let has_analytics = c.analytics_token.is_some();
            let is_authenticated = has_oauth || has_analytics;
            
            let message = if has_oauth {
                "Authenticated via OAuth".to_string()
            } else if has_analytics {
                "Authenticated via Analytics Token (read-only)".to_string()
            } else {
                "API key configured but not authenticated. Please login or enter an Analytics Token.".to_string()
            };
            
            UpstoxAuthStatus {
                is_authenticated,
                api_key: Some(c.api_key),
                has_oauth_token: has_oauth,
                has_analytics_token: has_analytics,
                message,
            }
        }
        None => UpstoxAuthStatus {
            is_authenticated: false,
            api_key: None,
            has_oauth_token: false,
            has_analytics_token: false,
            message: "Not configured. Enter API key and secret in Settings.".to_string(),
        },
    }
}

pub fn save_credentials(api_key: String, api_secret: String) -> Result<(), String> {
    let existing = storage::load_upstox_config();
    let access_token = existing
        .as_ref()
        .filter(|c| c.api_key == api_key)
        .and_then(|c| c.access_token.clone());
    let analytics_token = existing
        .as_ref()
        .filter(|c| c.api_key == api_key)
        .and_then(|c| c.analytics_token.clone());

    storage::save_upstox_config(&crate::models::UpstoxConfig {
        api_key,
        api_secret,
        access_token,
        analytics_token,
    })
}

pub fn save_analytics_token(token: String) -> Result<(), String> {
    storage::save_analytics_token(&token)
}

pub fn get_saved_credentials() -> Option<SavedUpstoxCredentials> {
    let config = storage::load_upstox_config()?;
    Some(SavedUpstoxCredentials {
        api_key: config.api_key,
        api_secret: config.api_secret,
        analytics_token: config.analytics_token,
    })
}

pub fn get_login_url() -> Result<String, String> {
    let config = storage::load_upstox_config()
        .ok_or("Upstox credentials not configured. Save API key and secret first.")?;
    let redirect_uri = format!("http://127.0.0.1:{}/login", UPSTOX_CALLBACK_PORT);
    Ok(format!(
        "{}/login/authorization/dialog?client_id={}&redirect_uri={}&response_type=code",
        UPSTOX_API_BASE,
        config.api_key,
        urlencoding::encode(&redirect_uri)
    ))
}

pub fn logout() -> Result<(), String> {
    storage::clear_access_token()
}

pub async fn start_callback_server() -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind(format!("127.0.0.1:{}", UPSTOX_CALLBACK_PORT))
        .await
        .map_err(|e| {
            format!(
                "Failed to start callback server on port {}: {}. \
                 Is another instance running?",
                UPSTOX_CALLBACK_PORT, e
            )
        })?;

    let (mut stream, _) =
        tokio::time::timeout(std::time::Duration::from_secs(300), listener.accept())
            .await
            .map_err(|_| "Login timed out (5 minutes). Please try again.")?
            .map_err(|e| e.to_string())?;

    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]).to_string();

    let first_line = request.lines().next().unwrap_or("");
    let code = extract_query_param(first_line, "code")
        .ok_or_else(|| "Authorization code not found in Upstox callback".to_string())?;

    let body = "<html><body style='font-family:sans-serif;padding:2em'>\
         <h2 style='color:#27ae60'>&#10003; Login successful!</h2>\
         <p>You can close this tab and return to EquityWatcher.</p>\
         </body></html>";

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;

    Ok(code)
}

pub async fn exchange_auth_code(code: &str) -> Result<String, String> {
    let config =
        storage::load_upstox_config().ok_or("Upstox credentials not found during token exchange")?;

    let redirect_uri = format!("http://127.0.0.1:{}/login", UPSTOX_CALLBACK_PORT);
    
    let credentials = format!("{}:{}", config.api_key, config.api_secret);
    let encoded_credentials = BASE64_STANDARD.encode(credentials);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| format!("Client build error: {}", e))?;
    
    let resp = client
        .post(format!("{}/login/authorization/token", UPSTOX_API_BASE))
        .header("Authorization", format!("Basic {}", encoded_credentials))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("code", code),
            ("redirect_uri", redirect_uri.as_str()),
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
        access_token: String,
    }

    let token_resp: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    storage::save_access_token(&token_resp.access_token)?;
    Ok(token_resp.access_token)
}

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
