/**
 * Picora Knowledge Base sync commands.
 *
 * All HTTP calls go through reqwest in this module so the frontend CSP
 * `connect-src` remains locked to IPC only. Credentials are passed as
 * (apiBase, apiKey) from the frontend — they are retrieved by the frontend
 * from the imageHostTargets store (same pattern as image_hosting_picora.rs).
 *
 * Security:
 *  - validate_relative_path() enforces path safety on all caller-supplied
 *    relative_path values before any file I/O.
 *  - Error messages are sanitized (no Bearer tokens, no absolute paths).
 */

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::command;

const DEFAULT_TIMEOUT_SECS: u64 = 60;
const MAX_RELATIVE_PATH_LEN: usize = 1024;

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PicoraKb {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    #[serde(rename = "docCount")]
    pub doc_count: i64,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: i64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestEntry {
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    #[serde(rename = "sourceHash")]
    pub source_hash: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncOp {
    pub op: String, // "upsert" | "delete"
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    // Optional fields use `skip_serializing_if` so missing values are
    // omitted from the wire format entirely. Picora's validator rejects
    // `null` for these fields ("Expected string, received null") — only
    // "present string" or "absent" are accepted. In particular:
    //   • `delete` ops carry only op + relativePath
    //   • first-sync `upsert` ops have no baseUpdatedAt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(rename = "sourceHash", skip_serializing_if = "Option::is_none")]
    pub source_hash: Option<String>,
    #[serde(rename = "baseUpdatedAt", skip_serializing_if = "Option::is_none")]
    pub base_updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConflictEntry {
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    #[serde(rename = "localUpdatedAt")]
    pub local_updated_at: String,
    #[serde(rename = "remoteUpdatedAt")]
    pub remote_updated_at: String,
    #[serde(rename = "localSizeBytes")]
    pub local_size_bytes: i64,
    #[serde(rename = "remoteSizeBytes")]
    pub remote_size_bytes: i64,
    #[serde(rename = "localPreview")]
    pub local_preview: String,
    #[serde(rename = "remotePreview")]
    pub remote_preview: String,
    #[serde(rename = "localHash")]
    pub local_hash: String,
    #[serde(rename = "remoteHash")]
    pub remote_hash: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncBatchResult {
    pub applied: Vec<String>,
    pub conflicts: Vec<ConflictEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileScanEntry {
    pub path: String,
    pub relative_path: String,
    pub size: u64,
    pub mtime: u64,
    pub sha256: String,
}

// ── Path validation ────────────────────────────────────────────────────

/// Validate that a caller-supplied relative path is safe:
///   - not empty
///   - does not contain `..` segments
///   - does not start with `/`
///   - no backslashes (must be POSIX-style)
///   - length ≤ 1024
pub fn validate_relative_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Relative path must not be empty".to_string());
    }
    if path.len() > MAX_RELATIVE_PATH_LEN {
        return Err(format!(
            "Relative path exceeds maximum length of {}",
            MAX_RELATIVE_PATH_LEN
        ));
    }
    if path.starts_with('/') {
        return Err("Relative path must not start with '/'".to_string());
    }
    if path.contains('\\') {
        return Err("Relative path must use forward slashes only".to_string());
    }
    for segment in path.split('/') {
        if segment == ".." {
            return Err("Relative path must not contain '..' segments".to_string());
        }
    }
    Ok(())
}

// ── HTTP client ───────────────────────────────────────────────────────

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()
        .map_err(|_| "Failed to initialize HTTP client".to_string())
}

fn sanitize_status(status: u16, ctx: &str) -> String {
    match status {
        401 | 403 => format!("Picora authentication failed ({ctx})"),
        402 => format!("Picora quota exceeded — upgrade your plan ({ctx})"),
        404 => format!("Picora resource not found ({ctx})"),
        408 | 504 => format!("Picora request timed out ({ctx})"),
        409 => format!("Picora resource already exists ({ctx})"),
        422 => format!("Picora rejected request — validation failed ({ctx})"),
        429 => format!("Picora rate limit exceeded ({ctx})"),
        500..=599 => format!("Picora service unavailable ({ctx})"),
        _ => format!("Picora request failed with status {status} ({ctx})"),
    }
}

/// Build a user-facing error from a non-2xx Picora response. Strips Bearer
/// tokens / sk_live prefixes from the body, caps body length at 200 chars,
/// and falls back to the status-only message when the body is empty.
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
        sanitize_status(status, ctx)
    } else {
        format!("{} — {}", sanitize_status(status, ctx), cleaned)
    }
}

fn api_url(api_base: &str, path: &str) -> String {
    format!("{}/{}", api_base.trim_end_matches('/'), path.trim_start_matches('/'))
}

// ── Commands ──────────────────────────────────────────────────────────

/// List all Knowledge Bases for the authenticated user.
#[command]
pub async fn picora_kb_list(api_base: String, api_key: String) -> Result<Vec<PicoraKb>, String> {
    if api_base.trim().is_empty() || api_key.trim().is_empty() {
        return Err("Picora endpoint or API key is empty".to_string());
    }

    let client = http_client()?;
    let url = api_url(&api_base, "/v1/kbs");

    let res = client
        .get(&url)
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|_| "Network error contacting Picora".to_string())?;

    if !res.status().is_success() {
        return Err(sanitize_status(res.status().as_u16(), "list-kbs"));
    }

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "Picora returned invalid JSON".to_string())?;

    // Picora `/v1/kbs` may return any of three shapes:
    //   1. `[...]`                                  (bare array)
    //   2. `{ "data": [...] }`                      (legacy wrapper)
    //   3. `{ "data": { "items": [...], ... } }`    (paginated wrapper, v0.17.1+)
    // Match the same defensive parsing that `picora_media_list` uses so the
    // KB picker doesn't break when the server-side response shape evolves.
    let data = body.get("data").unwrap_or(&body);
    let items_val = data
        .get("items")
        .cloned()
        .or_else(|| data.as_array().map(|arr| serde_json::Value::Array(arr.clone())))
        .unwrap_or(serde_json::Value::Array(vec![]));

    serde_json::from_value::<Vec<PicoraKb>>(items_val)
        .map_err(|e| format!("Failed to parse Picora KB list: {}", e))
}

/// Create a new Knowledge Base on Picora.
#[command]
pub async fn picora_kb_create(
    api_base: String,
    api_key: String,
    name: String,
    slug: Option<String>,
) -> Result<PicoraKb, String> {
    if api_base.trim().is_empty() || api_key.trim().is_empty() {
        return Err("Picora endpoint or API key is empty".to_string());
    }
    if name.trim().is_empty() {
        return Err("KB name must not be empty".to_string());
    }

    let client = http_client()?;
    let url = api_url(&api_base, "/v1/kbs");

    let mut payload = serde_json::json!({ "name": name.trim() });
    if let Some(s) = slug {
        if !s.trim().is_empty() {
            payload["slug"] = serde_json::Value::String(s.trim().to_string());
        }
    }

    let res = client
        .post(&url)
        .bearer_auth(&api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|_| "Network error contacting Picora".to_string())?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(build_error_with_body(status, &body, "create-kb"));
    }

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "Picora returned invalid JSON".to_string())?;

    serde_json::from_value(
        body.get("data")
            .cloned()
            .ok_or("Picora response missing KB data")?,
    )
    .map_err(|_| "Failed to parse created KB".to_string())
}

/// Fetch the full manifest for a KB (all active docs with hashes).
#[command]
pub async fn picora_kb_manifest(
    api_base: String,
    api_key: String,
    kb_id: String,
) -> Result<Vec<ManifestEntry>, String> {
    if api_base.trim().is_empty() || api_key.trim().is_empty() {
        return Err("Picora endpoint or API key is empty".to_string());
    }

    let client = http_client()?;
    let url = api_url(&api_base, &format!("/v1/kbs/{}/manifest", kb_id));

    let res = client
        .get(&url)
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|_| "Network error contacting Picora".to_string())?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(build_error_with_body(status, &body, "manifest"));
    }

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "Picora returned invalid JSON".to_string())?;

    // Picora `/v1/kbs/{id}/manifest` may return any of three shapes (mirrors
    // the evolution of `/v1/kbs` itself — see `picora_kb_list`):
    //   1. `[...]`                                  (bare array)
    //   2. `{ "data": [...] }`                      (legacy wrapper)
    //   3. `{ "data": { "items": [...], ... } }`    (paginated wrapper, v0.17.1+)
    let data = body.get("data").unwrap_or(&body);
    let items_val = data
        .get("items")
        .cloned()
        .or_else(|| data.as_array().map(|arr| serde_json::Value::Array(arr.clone())))
        .unwrap_or(serde_json::Value::Array(vec![]));

    serde_json::from_value::<Vec<ManifestEntry>>(items_val)
        .map_err(|e| format!("Failed to parse KB manifest: {}", e))
}

/// Batch sync operations (upsert + delete) against a KB.
#[command]
pub async fn picora_kb_sync_batch(
    api_base: String,
    api_key: String,
    kb_id: String,
    ops: Vec<SyncOp>,
) -> Result<SyncBatchResult, String> {
    if api_base.trim().is_empty() || api_key.trim().is_empty() {
        return Err("Picora endpoint or API key is empty".to_string());
    }

    // Validate all relative paths before sending to the network
    for op in &ops {
        validate_relative_path(&op.relative_path)?;
    }

    let client = http_client()?;
    let url = api_url(&api_base, &format!("/v1/kbs/{}/sync", kb_id));

    let res = client
        .post(&url)
        .bearer_auth(&api_key)
        .json(&serde_json::json!({ "ops": ops }))
        .send()
        .await
        .map_err(|_| "Network error contacting Picora".to_string())?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(build_error_with_body(status, &body, "sync-batch"));
    }

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|_| "Picora returned invalid JSON".to_string())?;

    let data = body.get("data").ok_or("Picora response missing data")?;
    Ok(SyncBatchResult {
        applied: serde_json::from_value(
            data.get("applied").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        )
        .unwrap_or_default(),
        conflicts: serde_json::from_value(
            data.get("conflicts").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        )
        .unwrap_or_default(),
    })
}

/// Fetch raw content of a single doc by relativePath.
#[command]
pub async fn picora_kb_raw(
    api_base: String,
    api_key: String,
    kb_id: String,
    relative_path: String,
) -> Result<String, String> {
    if api_base.trim().is_empty() || api_key.trim().is_empty() {
        return Err("Picora endpoint or API key is empty".to_string());
    }
    validate_relative_path(&relative_path)?;

    let client = http_client()?;
    let url = api_url(&api_base, &format!("/v1/kbs/{}/raw", kb_id));

    let res = client
        .get(&url)
        .query(&[("path", relative_path.as_str())])
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|_| "Network error contacting Picora".to_string())?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(build_error_with_body(status, &body, "raw"));
    }

    res.text()
        .await
        .map_err(|_| "Failed to read Picora response body".to_string())
}

/// Scan a local KB directory, returning file stat + SHA-256 hash for each file.
/// This is the Rust-side counterpart to buildLocalManifest() on the frontend.
#[command]
pub async fn kb_sync_scan_dir(
    root_path: String,
    scope: String,
    exclude_patterns: Vec<String>,
) -> Result<Vec<FileScanEntry>, String> {
    use sha2::{Digest, Sha256};
    use std::fs;

    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err("KB root directory not found".to_string());
    }

    let mut results = Vec::new();
    scan_dir_recursive(root, root, &scope, &exclude_patterns, &mut results)
        .map_err(|_| "Failed to scan KB directory".to_string())?;

    // Compute SHA-256 for each file
    let mut entries = Vec::with_capacity(results.len());
    for (abs_path, rel_path, meta) in results {
        let data = match fs::read(&abs_path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let hash = format!("{:x}", Sha256::digest(&data));
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        entries.push(FileScanEntry {
            path: abs_path.to_string_lossy().into_owned(),
            relative_path: rel_path,
            size: meta.len(),
            mtime,
            sha256: hash,
        });
    }

    Ok(entries)
}

fn scan_dir_recursive(
    root: &Path,
    current: &Path,
    scope: &str,
    excludes: &[String],
    results: &mut Vec<(PathBuf, String, std::fs::Metadata)>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let meta = entry.metadata()?;

        // Skip symlinks
        if meta.is_symlink() {
            continue;
        }

        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        // Apply exclude patterns (simple prefix/suffix matching)
        if matches_any_exclude(&rel, excludes) {
            continue;
        }

        // Skip hidden directories unless scope allows it
        let file_name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();

        if meta.is_dir() {
            let is_hidden = file_name.starts_with('.');
            if is_hidden && scope != "all-including-hidden" {
                continue;
            }
            scan_dir_recursive(root, &path, scope, excludes, results)?;
        } else if meta.is_file() {
            if should_include_file(&rel, &file_name, scope) {
                results.push((path, rel, meta));
            }
        }
    }
    Ok(())
}

fn should_include_file(rel: &str, file_name: &str, scope: &str) -> bool {
    let lower = file_name.to_lowercase();
    let is_md = lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".mdx");
    let is_rule = file_name == "MORAYA.md" || file_name == "CLAUDE.md";

    match scope {
        "markdown-only" => is_md,
        "markdown-plus-rules" => is_md || is_rule,
        "all-including-hidden" => {
            // Skip known binary extensions
            !is_known_binary(rel)
        }
        _ => is_md,
    }
}

fn is_known_binary(rel: &str) -> bool {
    let binary_exts = [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
        ".mp3", ".mp4", ".wav", ".ogg", ".flac",
        ".pdf", ".zip", ".tar", ".gz", ".7z",
        ".exe", ".dll", ".so", ".dylib",
        ".woff", ".woff2", ".ttf", ".otf",
    ];
    let lower = rel.to_lowercase();
    binary_exts.iter().any(|ext| lower.ends_with(ext))
}

fn matches_any_exclude(rel: &str, excludes: &[String]) -> bool {
    for pattern in excludes {
        // Simple glob: "**" means any depth, "*" means no slash
        if glob_match(pattern, rel) {
            return true;
        }
    }
    false
}

fn glob_match(pattern: &str, path: &str) -> bool {
    if pattern.ends_with("/**") {
        let prefix = &pattern[..pattern.len() - 3];
        return path.starts_with(prefix) || path == prefix;
    }
    if pattern.starts_with("**/") {
        let suffix = &pattern[3..];
        return path.ends_with(suffix) || path == suffix;
    }
    if pattern.contains('*') {
        // Simple wildcard: split on * and check starts_with/ends_with
        let parts: Vec<&str> = pattern.split('*').collect();
        if parts.len() == 2 {
            return path.starts_with(parts[0]) && path.ends_with(parts[1]);
        }
    }
    // Exact match or filename match
    path == pattern || path.ends_with(&format!("/{}", pattern))
}

/// Move a file to the trash directory (creates parent dirs as needed).
#[command]
pub async fn kb_sync_move_to_trash(
    src_path: String,
    dest_path: String,
) -> Result<(), String> {
    let src = Path::new(&src_path);
    if !src.exists() {
        return Ok(()); // Already gone
    }

    let dest = Path::new(&dest_path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "Failed to create trash directory".to_string())?;
    }

    std::fs::rename(src, dest)
        .or_else(|_| {
            // Fallback: cross-device copy + delete
            std::fs::copy(src, dest).map(|_| ())?;
            std::fs::remove_file(src)
        })
        .map_err(|_| "Failed to move file to trash".to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_relative_path_accepts_valid() {
        assert!(validate_relative_path("notes/foo.md").is_ok());
        assert!(validate_relative_path("MORAYA.md").is_ok());
        assert!(validate_relative_path(".moraya/index.json").is_ok());
        assert!(validate_relative_path("a/b/c/d.md").is_ok());
        assert!(validate_relative_path("notes/2026/04/foo bar.md").is_ok());
    }

    #[test]
    fn validate_relative_path_rejects_dotdot() {
        assert!(validate_relative_path("../secret.md").is_err());
        assert!(validate_relative_path("notes/../secret.md").is_err());
        assert!(validate_relative_path("notes/..").is_err());
    }

    #[test]
    fn validate_relative_path_rejects_absolute() {
        assert!(validate_relative_path("/etc/passwd").is_err());
        assert!(validate_relative_path("/Users/onela/secret").is_err());
    }

    #[test]
    fn validate_relative_path_rejects_backslash() {
        assert!(validate_relative_path("notes\\foo.md").is_err());
        assert!(validate_relative_path("a\\b\\c").is_err());
    }

    #[test]
    fn validate_relative_path_rejects_empty() {
        assert!(validate_relative_path("").is_err());
    }

    #[test]
    fn validate_relative_path_rejects_too_long() {
        let long_path = "a/".repeat(600);
        assert!(validate_relative_path(&long_path).is_err());
    }

    #[test]
    fn glob_match_double_star() {
        assert!(glob_match("node_modules/**", "node_modules/foo/bar.js"));
        assert!(glob_match("node_modules/**", "node_modules"));
        assert!(!glob_match("node_modules/**", "src/node_modules_copy/a.js"));
    }

    #[test]
    fn glob_match_extension_wildcard() {
        assert!(glob_match("*.tmp", "foo.tmp"));
        assert!(glob_match("*.tmp", "subdir/foo.tmp"));
        assert!(!glob_match("*.tmp", "foo.ts"));
    }

    #[test]
    fn glob_match_exact() {
        assert!(glob_match(".DS_Store", ".DS_Store"));
        assert!(glob_match(".DS_Store", "subdir/.DS_Store"));
    }

    #[test]
    fn sanitize_status_no_credentials() {
        for code in [401u16, 402, 404, 422, 429, 500, 503] {
            let msg = sanitize_status(code, "test");
            assert!(!msg.contains("sk_live"), "status {code} leaks api key");
            assert!(!msg.contains("Bearer"), "status {code} leaks header");
            assert!(!msg.is_empty());
        }
    }

    /// Inline replica of the picora_kb_list response-shape parsing logic so
    /// we can lock in support for all three known Picora response wrappers
    /// without spinning up an HTTP mock server. Keep in sync with the live
    /// parser in `picora_kb_list`.
    fn parse_kb_list_body(body: serde_json::Value) -> Result<Vec<PicoraKb>, String> {
        let data = body.get("data").unwrap_or(&body);
        let items_val = data
            .get("items")
            .cloned()
            .or_else(|| data.as_array().map(|arr| serde_json::Value::Array(arr.clone())))
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value::<Vec<PicoraKb>>(items_val)
            .map_err(|e| format!("Failed to parse Picora KB list: {}", e))
    }

    fn sample_kb_value() -> serde_json::Value {
        serde_json::json!({
            "id": "kb_abc",
            "name": "运营之光",
            "slug": "ops-light",
            "description": null,
            "docCount": 12,
            "sizeBytes": 4096,
            "createdAt": "2026-04-30T12:00:00Z",
            "updatedAt": "2026-04-30T12:00:00Z",
        })
    }

    #[test]
    fn picora_kb_list_parses_data_array_wrapper() {
        // Legacy shape: { "data": [...] }
        let body = serde_json::json!({ "data": [sample_kb_value()] });
        let kbs = parse_kb_list_body(body).expect("data-array shape should parse");
        assert_eq!(kbs.len(), 1);
        assert_eq!(kbs[0].name, "运营之光");
    }

    #[test]
    fn picora_kb_list_parses_data_items_pagination_wrapper() {
        // Paginated shape (Picora v0.17.1+): { "data": { "items": [...], "nextCursor": null } }
        let body = serde_json::json!({
            "data": { "items": [sample_kb_value()], "nextCursor": null, "total": 1 },
        });
        let kbs = parse_kb_list_body(body).expect("paginated shape should parse");
        assert_eq!(kbs.len(), 1);
        assert_eq!(kbs[0].slug, "ops-light");
    }

    #[test]
    fn picora_kb_list_parses_bare_array() {
        // Bare top-level array
        let body = serde_json::json!([sample_kb_value()]);
        let kbs = parse_kb_list_body(body).expect("bare array should parse");
        assert_eq!(kbs.len(), 1);
    }

    #[test]
    fn picora_kb_list_returns_empty_for_missing_data() {
        let body = serde_json::json!({});
        let kbs = parse_kb_list_body(body).expect("empty object falls back to []");
        assert!(kbs.is_empty());
    }

    #[test]
    fn picora_kb_list_surfaces_serde_error_message() {
        // Wrong field type — docCount is a string instead of number
        let bad = serde_json::json!({ "data": [{
            "id": "x", "name": "x", "slug": "x",
            "docCount": "twelve", "sizeBytes": 0,
            "createdAt": "", "updatedAt": "",
        }] });
        let err = parse_kb_list_body(bad).expect_err("should fail with descriptive message");
        assert!(err.starts_with("Failed to parse Picora KB list:"), "{err}");
        // serde error should describe what went wrong so we can debug
        // (mentions the offending value or expected type)
        assert!(err.contains("twelve") || err.contains("i64"), "{err}");
    }

    /// Inline replica of `picora_kb_manifest`'s response parser. Keep in sync
    /// with the live parser. Picora's manifest endpoint went through the
    /// same shape evolution as `/v1/kbs` — so we accept the same three forms.
    fn parse_kb_manifest_body(body: serde_json::Value) -> Result<Vec<ManifestEntry>, String> {
        let data = body.get("data").unwrap_or(&body);
        let items_val = data
            .get("items")
            .cloned()
            .or_else(|| data.as_array().map(|arr| serde_json::Value::Array(arr.clone())))
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value::<Vec<ManifestEntry>>(items_val)
            .map_err(|e| format!("Failed to parse KB manifest: {}", e))
    }

    fn sample_manifest_entry() -> serde_json::Value {
        serde_json::json!({
            "relativePath": "notes/foo.md",
            "sourceHash": "abc123",
            "sizeBytes": 1024,
            "updatedAt": "2026-04-30T12:00:00Z",
        })
    }

    #[test]
    fn picora_kb_manifest_parses_data_array_wrapper() {
        let body = serde_json::json!({ "data": [sample_manifest_entry()] });
        let entries = parse_kb_manifest_body(body).expect("data-array shape should parse");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].relative_path, "notes/foo.md");
    }

    #[test]
    fn picora_kb_manifest_parses_data_items_pagination_wrapper() {
        // Paginated shape — this is the case that was producing
        // "Failed to parse KB manifest" before the fix.
        let body = serde_json::json!({
            "data": { "items": [sample_manifest_entry()], "nextCursor": null, "total": 1 },
        });
        let entries = parse_kb_manifest_body(body).expect("paginated shape should parse");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source_hash, "abc123");
    }

    #[test]
    fn picora_kb_manifest_parses_bare_array() {
        let body = serde_json::json!([sample_manifest_entry()]);
        let entries = parse_kb_manifest_body(body).expect("bare array should parse");
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn picora_kb_manifest_returns_empty_for_missing_data() {
        let body = serde_json::json!({});
        let entries = parse_kb_manifest_body(body).expect("empty object falls back to []");
        assert!(entries.is_empty());
    }

    #[test]
    fn sync_op_upsert_first_sync_omits_base_updated_at() {
        // First-time upsert: no baseUpdatedAt. Picora rejects `null` for
        // string fields, so the serialized JSON must omit the key entirely.
        let op = SyncOp {
            op: "upsert".to_string(),
            relative_path: "notes/foo.md".to_string(),
            content: Some("# hello".to_string()),
            source_hash: Some("abc123".to_string()),
            base_updated_at: None,
        };
        let json = serde_json::to_value(&op).unwrap();
        assert_eq!(json["op"], "upsert");
        assert_eq!(json["relativePath"], "notes/foo.md");
        assert_eq!(json["content"], "# hello");
        assert_eq!(json["sourceHash"], "abc123");
        assert!(
            json.get("baseUpdatedAt").is_none(),
            "baseUpdatedAt must be absent (not null) when None: {}",
            json
        );
        // Verify no field anywhere in the JSON is null
        let s = serde_json::to_string(&op).unwrap();
        assert!(!s.contains("null"), "serialized op must contain no null values: {s}");
    }

    #[test]
    fn sync_op_upsert_subsequent_sync_includes_base_updated_at() {
        let op = SyncOp {
            op: "upsert".to_string(),
            relative_path: "notes/foo.md".to_string(),
            content: Some("# updated".to_string()),
            source_hash: Some("def456".to_string()),
            base_updated_at: Some("2026-04-30T12:00:00Z".to_string()),
        };
        let json = serde_json::to_value(&op).unwrap();
        assert_eq!(json["baseUpdatedAt"], "2026-04-30T12:00:00Z");
    }

    #[test]
    fn sync_op_delete_omits_all_optional_fields() {
        // Delete ops carry only op + relativePath. None of the three optional
        // fields should appear in the wire format.
        let op = SyncOp {
            op: "delete".to_string(),
            relative_path: "notes/old.md".to_string(),
            content: None,
            source_hash: None,
            base_updated_at: None,
        };
        let json = serde_json::to_value(&op).unwrap();
        assert_eq!(json["op"], "delete");
        assert_eq!(json["relativePath"], "notes/old.md");
        assert!(json.get("content").is_none(), "delete must omit content: {json}");
        assert!(json.get("sourceHash").is_none(), "delete must omit sourceHash: {json}");
        assert!(json.get("baseUpdatedAt").is_none(), "delete must omit baseUpdatedAt: {json}");
        let s = serde_json::to_string(&op).unwrap();
        assert!(!s.contains("null"), "serialized delete op must contain no null values: {s}");
    }

    #[test]
    fn picora_kb_manifest_surfaces_serde_error_message() {
        // sizeBytes as string — should produce a descriptive error
        let bad = serde_json::json!({ "data": { "items": [{
            "relativePath": "x.md",
            "sourceHash": "h",
            "sizeBytes": "big",
            "updatedAt": "",
        }] } });
        let err = parse_kb_manifest_body(bad).expect_err("should fail with descriptive message");
        assert!(err.starts_with("Failed to parse KB manifest:"), "{err}");
        assert!(err.contains("big") || err.contains("i64"), "{err}");
    }
}
