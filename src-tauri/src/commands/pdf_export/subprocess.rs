//! Windows / Linux native PDF export via child subprocess.
//!
//! WebView2 (Windows) and WebKitGTK (Linux) both deadlock when
//! `WebviewWindowBuilder.build()` is invoked synchronously from a Tauri
//! command handler — see the comment in `lib.rs` near the new-window
//! feature. We mirror that workaround: spawn a child Moraya process with
//! `--print-pdf-config=<tmp.json>` which detects the flag, creates a single
//! hidden window, renders the document, calls the platform-native
//! printToPDF API, writes the resulting bytes to disk, and exits.
//!
//! The parent process forwards progress events from the child's stdout
//! (ndjson) to the user-facing Channel<ProgressEvent>.

#![cfg(any(target_os = "windows", target_os = "linux"))]

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::ipc::Channel;

use super::{JobConfig, ProgressEvent};

const SUBPROCESS_TIMEOUT_BASE: Duration = Duration::from_secs(60);

pub async fn run(job: &JobConfig, progress: &Channel<ProgressEvent>) -> Result<(), String> {
    // 1. Write the job config to a tempfile the child can read.
    let cfg_path = write_temp_config(job)?;

    // 2. Build argv.
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let cfg_arg = format!("--print-pdf-config={}", cfg_path.display());

    let _ = progress.send(ProgressEvent::Rendering);

    // 3. Spawn child.
    let mut child = Command::new(&exe)
        .arg(&cfg_arg)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn child: {e}"))?;

    // 4. Stream stdout in a blocking task; forward ProgressEvents.
    let stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let progress_clone = progress.clone();
    let stdout_task = tokio::task::spawn_blocking(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(ev) = serde_json::from_str::<ProgressEvent>(&line) {
                let _ = progress_clone.send(ev);
            }
        }
    });

    // 5. Drain stderr (best-effort, for diagnostics on failure).
    let stderr = child.stderr.take();
    let stderr_task = tokio::task::spawn_blocking(move || {
        if let Some(s) = stderr {
            let reader = BufReader::new(s);
            reader.lines().flatten().collect::<Vec<_>>().join("\n")
        } else {
            String::new()
        }
    });

    // 6. Wait for exit with an overall timeout.
    let timeout = compute_timeout(job);
    let wait_handle = tokio::task::spawn_blocking(move || child.wait());
    let exit = tokio::time::timeout(timeout, wait_handle)
        .await
        .map_err(|_| "subprocess timed out".to_string())?
        .map_err(|e| format!("subprocess join: {e}"))?
        .map_err(|e| format!("subprocess wait: {e}"))?;

    // Drain remaining streams.
    let _ = stdout_task.await;
    let err_text = stderr_task.await.unwrap_or_default();

    // Clean up config tempfile.
    let _ = std::fs::remove_file(&cfg_path);

    if !exit.success() {
        return Err(format!(
            "subprocess exited with status {:?}; stderr: {}",
            exit.code(),
            err_text.chars().take(200).collect::<String>()
        ));
    }

    // The child writes the PDF directly to job.output_path before exiting,
    // so we only need to confirm the file exists.
    let meta = std::fs::metadata(&job.output_path)
        .map_err(|e| format!("output file missing: {e}"))?;
    if meta.len() == 0 {
        return Err("subprocess produced an empty PDF".to_string());
    }

    let _ = progress.send(ProgressEvent::Done);
    Ok(())
}

fn write_temp_config(job: &JobConfig) -> Result<std::path::PathBuf, String> {
    let mut path = std::env::temp_dir();
    let fname = format!("moraya-print-{}.json", job.job_id);
    path.push(fname);
    let mut f =
        std::fs::File::create(&path).map_err(|e| format!("create temp config: {e}"))?;
    let json = serde_json::to_vec(job).map_err(|e| format!("serialize job: {e}"))?;
    f.write_all(&json)
        .map_err(|e| format!("write temp config: {e}"))?;
    Ok(path)
}

/// Scale timeout with document size: 60s baseline + 30s per 10k chars.
fn compute_timeout(job: &JobConfig) -> Duration {
    let extra_secs = (job.markdown.len() / 10_000) as u64 * 30;
    SUBPROCESS_TIMEOUT_BASE + Duration::from_secs(extra_secs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::pdf_export::PdfExportOptions;

    fn fake_job(len: usize) -> JobConfig {
        JobConfig {
            job_id: "j1".to_string(),
            markdown: "x".repeat(len),
            output_path: "/tmp/out.pdf".to_string(),
            options: PdfExportOptions::default(),
        }
    }

    #[test]
    fn timeout_scales_with_size() {
        assert_eq!(compute_timeout(&fake_job(0)), Duration::from_secs(60));
        assert_eq!(compute_timeout(&fake_job(10_000)), Duration::from_secs(90));
        assert_eq!(compute_timeout(&fake_job(50_000)), Duration::from_secs(210));
    }
}
