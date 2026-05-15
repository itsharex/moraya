//! Native PDF export — print-to-PDF using each platform's WebView engine.
//!
//! Architecture: see `docs/iterations/v0.60.0-native-pdf-export.md`.
//!
//! - macOS: direct WKWebView `createPDF` via `WebviewWindow::with_webview` + objc2
//! - Windows / Linux: subprocess pattern (spawns a child Moraya process with
//!   `--print-pdf-config=<tmp.json>` which runs a hidden window and writes
//!   the PDF to disk before exiting)
//!
//! The frontend orchestrator falls back to the v0.59.x canvas-based path when
//! this command returns Err, so any failure here is recoverable.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::commands::file as file_cmd;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(any(target_os = "windows", target_os = "linux"))]
mod subprocess;

pub mod child_mode;

/// Per-job ready signal. Frontend's /print route calls `export_print_ready`
/// after rendering completes; that handler resolves the matching oneshot so
/// the native printToPDF call can proceed.
pub struct PdfExportState {
    /// JobId -> ready signal sender.
    pub ready_senders: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

impl PdfExportState {
    pub fn new() -> Self {
        Self {
            ready_senders: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for PdfExportState {
    fn default() -> Self {
        Self::new()
    }
}

/// Page-size preset (mapped to mm in `paper_size_mm`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PaperSize {
    A4,
    Letter,
    Legal,
    A3,
    A5,
}

impl PaperSize {
    /// Returns (width_mm, height_mm) for portrait orientation.
    ///
    /// Used by the /print SvelteKit route via the serialized job payload
    /// (frontend re-derives the same dimensions). Kept here as the
    /// authoritative source for documentation + future header/footer layout.
    pub fn dimensions_mm(&self) -> (f64, f64) {
        match self {
            PaperSize::A4 => (210.0, 297.0),
            PaperSize::Letter => (215.9, 279.4),
            PaperSize::Legal => (215.9, 355.6),
            PaperSize::A3 => (297.0, 420.0),
            PaperSize::A5 => (148.0, 210.0),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Margins {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

impl Default for Margins {
    fn default() -> Self {
        Margins {
            top: 20.0,
            right: 15.0,
            bottom: 20.0,
            left: 15.0,
        }
    }
}

/// Configuration sent from the frontend per export job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfExportOptions {
    pub paper_size: PaperSize,
    pub orientation: Orientation,
    pub margins: Margins,
    #[serde(default)]
    pub header_enabled: bool,
    #[serde(default)]
    pub header_template: String,
    #[serde(default)]
    pub footer_enabled: bool,
    #[serde(default)]
    pub footer_template: String,
    #[serde(default = "default_font_size")]
    pub font_size: f64,
    #[serde(default)]
    pub font_family: String,
    #[serde(default = "default_true")]
    pub enable_highlight: bool,
    #[serde(default = "default_true")]
    pub enable_mermaid: bool,
    #[serde(default = "default_true")]
    pub enable_math: bool,
    #[serde(default)]
    pub document_title: String,
}

fn default_font_size() -> f64 {
    11.0
}
fn default_true() -> bool {
    true
}

impl Default for PdfExportOptions {
    fn default() -> Self {
        PdfExportOptions {
            paper_size: PaperSize::A4,
            orientation: Orientation::Portrait,
            margins: Margins::default(),
            header_enabled: false,
            header_template: String::new(),
            footer_enabled: true,
            footer_template: String::from("{page} / {total}"),
            font_size: 11.0,
            font_family: String::new(),
            enable_highlight: true,
            enable_mermaid: true,
            enable_math: true,
            document_title: String::new(),
        }
    }
}

/// Full job descriptor — what the subprocess / hidden window needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobConfig {
    pub job_id: String,
    pub markdown: String,
    pub output_path: String,
    pub options: PdfExportOptions,
}

/// Progress events streamed back to the frontend via Channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ProgressEvent {
    Preparing,
    Rendering,
    Paginating { current: u32, total: u32 },
    Writing,
    Done,
    /// Surfaced when this code path is about to give up and let the frontend
    /// retry with the canvas-based path.
    Fallback { reason: String },
    Error { message: String },
}

/// Top-level export command. Dispatches to macOS direct path or subprocess
/// path based on target_os. Returns Err if native path fails — caller handles
/// fallback to canvas path on the frontend.
#[tauri::command]
pub async fn export_pdf_native(
    app: AppHandle,
    state: State<'_, PdfExportState>,
    job: JobConfig,
    on_progress: Channel<ProgressEvent>,
) -> Result<(), String> {
    // Validate output path safety up-front (rejects path traversal, symlinks
    // pointing outside the home dir, etc.).
    let _ = file_cmd::validate_path(&job.output_path)?;

    let _ = on_progress.send(ProgressEvent::Preparing);

    #[cfg(target_os = "macos")]
    {
        let _ = state; // unused on macOS path
        return macos::run(app, &job, &on_progress)
            .await
            .map_err(|e| {
                let _ = on_progress.send(ProgressEvent::Fallback {
                    reason: e.clone(),
                });
                e
            });
    }

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let _ = (app, state);
        return subprocess::run(&job, &on_progress).await.map_err(|e| {
            let _ = on_progress.send(ProgressEvent::Fallback {
                reason: e.clone(),
            });
            e
        });
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (app, state, job);
        let _ = on_progress.send(ProgressEvent::Fallback {
            reason: "unsupported platform".to_string(),
        });
        Err("Native PDF export not supported on this platform".to_string())
    }
}

/// Called by the /print SvelteKit route once rendering (Mermaid/hljs/images)
/// has completed. The matching `oneshot` is resolved so the native printToPDF
/// path can proceed.
#[tauri::command]
pub fn export_print_ready(
    state: State<'_, PdfExportState>,
    job_id: String,
) -> Result<(), String> {
    let mut senders = state
        .ready_senders
        .lock()
        .map_err(|e| format!("ready lock poisoned: {e}"))?;
    if let Some(tx) = senders.remove(&job_id) {
        let _ = tx.send(());
        Ok(())
    } else {
        Err(format!("no ready waiter for job {job_id}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_size_dimensions() {
        assert_eq!(PaperSize::A4.dimensions_mm(), (210.0, 297.0));
        assert_eq!(PaperSize::Letter.dimensions_mm(), (215.9, 279.4));
        assert_eq!(PaperSize::A5.dimensions_mm(), (148.0, 210.0));
    }

    #[test]
    fn margins_default() {
        let m = Margins::default();
        assert_eq!(m.top, 20.0);
        assert_eq!(m.left, 15.0);
    }

    #[test]
    fn options_default_safe_values() {
        let o = PdfExportOptions::default();
        assert_eq!(o.font_size, 11.0);
        assert!(o.enable_highlight);
        assert!(o.enable_mermaid);
        assert!(o.enable_math);
        assert!(o.footer_enabled);
        assert!(!o.header_enabled);
    }

    #[test]
    fn job_config_serde_roundtrip() {
        let job = JobConfig {
            job_id: "abc-123".to_string(),
            markdown: "# Hello".to_string(),
            output_path: "/tmp/test.pdf".to_string(),
            options: PdfExportOptions::default(),
        };
        let s = serde_json::to_string(&job).unwrap();
        let parsed: JobConfig = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed.job_id, "abc-123");
        assert_eq!(parsed.options.paper_size, PaperSize::A4);
    }

    #[test]
    fn progress_event_serde_tag() {
        let ev = ProgressEvent::Paginating {
            current: 12,
            total: 200,
        };
        let s = serde_json::to_string(&ev).unwrap();
        assert!(s.contains("\"type\":\"Paginating\""));
        assert!(s.contains("\"current\":12"));
    }
}
