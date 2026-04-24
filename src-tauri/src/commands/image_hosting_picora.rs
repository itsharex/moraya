/**
 * Picora image hosting commands.
 *
 * Picora is the recommended SaaS image host for Moraya. It exposes:
 *   - POST /v1/images           multipart/form-data upload, Bearer auth
 *   - GET  /v1/user/me          current user info (for V1 deep-link verify)
 *   - POST /v1/auth/exchange-export-token   one-time token → real config (V2)
 *
 * All Picora HTTP requests go through this module so frontend CSP `connect-src`
 * stays locked. Errors are sanitized — the Bearer token / OTT never appears in
 * the message returned to the renderer.
 */

use serde::{Deserialize, Serialize};
use tauri::command;

const DEFAULT_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PicoraUserInfo {
    pub email: String,
    pub plan: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PicoraImportPayload {
    #[serde(rename = "apiUrl")]
    pub api_url: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    #[serde(rename = "imgDomain")]
    pub img_domain: String,
    pub user: PicoraUserInfo,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()
        .map_err(|_| "Failed to initialize HTTP client".to_string())
}

fn sanitize_status(status: u16) -> String {
    match status {
        401 | 403 => format!("Picora authentication failed ({})", status),
        404 => "Picora resource not found (404)".to_string(),
        408 | 504 => format!("Picora request timed out ({})", status),
        410 => "Picora import token expired (410)".to_string(),
        429 => "Picora rate limit exceeded (429)".to_string(),
        500..=599 => format!("Picora service unavailable ({})", status),
        _ => format!("Picora request failed ({})", status),
    }
}

/// Sanitize a server error body for safe surfacing to the user. Strips Bearer
/// tokens / sk_live prefixes, caps length at 200 chars, and falls back to the
/// status-only message when the body is empty.
fn build_error_with_body(status: u16, body: &str, ctx: &str) -> String {
    let cleaned: String = body
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(200)
        .collect();
    let cleaned = cleaned
        .replace("sk_live_", "sk_***_")
        .replace("Bearer ", "Bearer ***");
    if cleaned.is_empty() {
        format!("[{}] {}", ctx, sanitize_status(status))
    } else {
        format!("[{}] {} — {}", ctx, sanitize_status(status), cleaned)
    }
}

/// Upload a single image to Picora. Returns the public URL of the uploaded asset.
#[command]
pub async fn upload_to_picora(
    api_url: String,
    api_key: String,
    file_bytes: Vec<u8>,
    mime_type: String,
    filename: String,
) -> Result<String, String> {
    if api_url.trim().is_empty() {
        return Err("Picora endpoint is empty".to_string());
    }
    if api_key.trim().is_empty() {
        return Err("Picora API key is empty".to_string());
    }

    let client = http_client()?;
    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(filename)
        .mime_str(&mime_type)
        .map_err(|_| "Invalid image MIME type".to_string())?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let res = client
        .post(&api_url)
        .bearer_auth(&api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|_| "Network error contacting Picora".to_string())?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(build_error_with_body(status, &body, "upload"));
    }

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "Picora returned invalid JSON".to_string())?;

    body.get("data")
        .and_then(|d| d.get("url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Picora response missing image URL".to_string())
}

/// Verify a Picora API key by calling /v1/user/me. Returns lightweight user info.
#[command]
pub async fn verify_picora_token(
    api_base: String,
    api_key: String,
) -> Result<PicoraUserInfo, String> {
    if api_base.trim().is_empty() {
        return Err("Picora endpoint is empty".to_string());
    }
    if api_key.trim().is_empty() {
        return Err("Picora API key is empty".to_string());
    }

    let url = format!("{}/v1/user/me", api_base.trim_end_matches('/'));
    let client = http_client()?;
    let res = client
        .get(&url)
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|_| "Network error contacting Picora".to_string())?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(build_error_with_body(status, &body, "verify"));
    }

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "Picora returned invalid JSON".to_string())?;

    let data = body
        .get("data")
        .ok_or_else(|| "Picora response missing user data".to_string())?;

    Ok(PicoraUserInfo {
        email: data
            .get("email")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        plan: data
            .get("plan")
            .and_then(|v| v.as_str())
            .unwrap_or("free")
            .to_string(),
        nickname: data
            .get("nickname")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

/// Exchange a one-time export token for the full Picora import payload (V2 flow).
#[command]
pub async fn exchange_picora_export_token(
    api_base: String,
    ott: String,
) -> Result<PicoraImportPayload, String> {
    if api_base.trim().is_empty() {
        return Err("Picora endpoint is empty".to_string());
    }
    if ott.trim().is_empty() {
        return Err("Picora import token is empty".to_string());
    }

    let url = format!(
        "{}/v1/auth/exchange-export-token",
        api_base.trim_end_matches('/')
    );
    let client = http_client()?;
    let res = client
        .post(&url)
        .json(&serde_json::json!({ "ott": ott }))
        .send()
        .await
        .map_err(|_| "Network error contacting Picora".to_string())?;

    if !res.status().is_success() {
        return Err(sanitize_status(res.status().as_u16()));
    }

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "Picora returned invalid JSON".to_string())?;
    let data = body
        .get("data")
        .ok_or_else(|| "Picora response missing payload".to_string())?;

    let api_url = data
        .get("apiUrl")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Picora payload missing apiUrl".to_string())?
        .to_string();
    let api_key = data
        .get("apiKey")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Picora payload missing apiKey".to_string())?
        .to_string();
    let img_domain = data
        .get("imgDomain")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let user = data
        .get("user")
        .ok_or_else(|| "Picora payload missing user".to_string())?;

    Ok(PicoraImportPayload {
        api_url,
        api_key,
        img_domain,
        user: PicoraUserInfo {
            email: user
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            plan: user
                .get("plan")
                .and_then(|v| v.as_str())
                .unwrap_or("free")
                .to_string(),
            nickname: user
                .get("nickname")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_status_redacts_credentials() {
        for code in [401u16, 403, 410, 429, 500] {
            let msg = sanitize_status(code);
            assert!(!msg.contains("sk_live_"), "must not leak api key marker");
            assert!(!msg.contains("ott_"), "must not leak ott marker");
            assert!(!msg.contains("Bearer"), "must not leak header value");
            assert!(!msg.is_empty());
        }
    }

    #[test]
    fn sanitize_status_known_codes() {
        assert!(sanitize_status(401).contains("authentication"));
        assert!(sanitize_status(410).contains("expired"));
        assert!(sanitize_status(429).contains("rate"));
        assert!(sanitize_status(503).contains("unavailable"));
    }

    #[test]
    fn upload_payload_structure_serializes() {
        let payload = PicoraImportPayload {
            api_url: "https://api.picora.me/v1/images".to_string(),
            api_key: "sk_live_test".to_string(),
            img_domain: "https://media.picora.me".to_string(),
            user: PicoraUserInfo {
                email: "test@example.com".to_string(),
                plan: "pro".to_string(),
                nickname: None,
            },
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"apiUrl\""));
        assert!(json.contains("\"apiKey\""));
        assert!(json.contains("\"imgDomain\""));
        assert!(!json.contains("nickname"));
    }
}
