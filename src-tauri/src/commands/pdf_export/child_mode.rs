//! Subprocess child-mode helpers.
//!
//! These are scaffolding for the subprocess child-mode startup path that
//! lib.rs wires up at app launch on Windows/Linux. The macOS direct path
//! never invokes them, hence the dead-code allow.

#![allow(dead_code)]
//!
//! When Moraya is launched with `--print-pdf-config=<path>` the main process
//! detects the flag early and enters a minimal headless mode that loads the
//! /print route, drives WKWebView/WebView2/WebKitGTK printToPDF, writes the
//! PDF to the path specified in the config, and exits.
//!
//! This module exposes the argv detection and config loading; the actual
//! headless run loop lives in lib.rs (so it can reuse the same Tauri
//! infrastructure as the main path).

use super::JobConfig;

const ARG_PREFIX: &str = "--print-pdf-config=";

/// Detect `--print-pdf-config=<path>` in argv. Returns the path if present.
pub fn detect_child_mode<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    for a in args {
        let s = a.as_ref();
        if let Some(rest) = s.strip_prefix(ARG_PREFIX) {
            return Some(rest.to_string());
        }
    }
    None
}

/// Load the job config from a path written by the parent process.
pub fn load_config(path: &str) -> Result<JobConfig, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("read config {path}: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("parse config {path}: {e}"))
}

/// Emit a progress event line on stdout (ndjson). The parent process parses
/// each line as a `ProgressEvent`.
pub fn emit_progress(ev: &super::ProgressEvent) {
    if let Ok(s) = serde_json::to_string(ev) {
        println!("{s}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_simple() {
        let args = vec!["moraya".to_string(), "--print-pdf-config=/tmp/x.json".to_string()];
        assert_eq!(detect_child_mode(&args), Some("/tmp/x.json".to_string()));
    }

    #[test]
    fn detect_absent() {
        let args = vec!["moraya".to_string(), "--other-flag".to_string()];
        assert_eq!(detect_child_mode(&args), None);
    }

    #[test]
    fn detect_among_many() {
        let args = vec![
            "moraya".to_string(),
            "--verbose".to_string(),
            "--print-pdf-config=cfg.json".to_string(),
            "--debug".to_string(),
        ];
        assert_eq!(detect_child_mode(&args), Some("cfg.json".to_string()));
    }
}
