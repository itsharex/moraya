import { invoke, Channel } from '@tauri-apps/api/core';
import type { ExportProgressState } from '$lib/stores/export-progress-store';

/**
 * v0.60.0 — Native PDF export client.
 *
 * Calls the `export_pdf_native` Rust command, which dispatches to platform
 * native print-to-PDF APIs (WKWebView createPDF on macOS, WebView2
 * PrintToPdfStream on Windows, WebKitGTK print_to_stream on Linux).
 *
 * Returns normally on success. Throws on any failure — caller is expected
 * to fall back to the canvas-based path.
 */

export type PaperSize = 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
export type PaperOrientation = 'portrait' | 'landscape';

export interface PdfExportMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PdfExportOptions {
  paper_size: PaperSize;
  orientation: PaperOrientation;
  margins: PdfExportMargins;
  header_enabled: boolean;
  header_template: string;
  footer_enabled: boolean;
  footer_template: string;
  font_size: number;
  font_family: string;
  enable_highlight: boolean;
  enable_mermaid: boolean;
  enable_math: boolean;
  document_title: string;
}

/** Backend `ProgressEvent` (tagged serde enum). */
export type RustProgressEvent =
  | { type: 'Preparing' }
  | { type: 'Rendering' }
  | { type: 'Paginating'; current: number; total: number }
  | { type: 'Writing' }
  | { type: 'Done' }
  | { type: 'Fallback'; reason: string }
  | { type: 'Error'; message: string };

export type ProgressHandler = (state: Partial<ExportProgressState>) => void;

export function defaultExportOptions(
  documentTitle: string = '',
): PdfExportOptions {
  return {
    paper_size: 'a4',
    orientation: 'portrait',
    margins: { top: 20, right: 15, bottom: 20, left: 15 },
    header_enabled: false,
    header_template: '{title}',
    footer_enabled: true,
    footer_template: '{page} / {total}',
    font_size: 11,
    font_family: '',
    enable_highlight: true,
    enable_mermaid: true,
    enable_math: true,
    document_title: documentTitle,
  };
}

/** Map a Rust ProgressEvent into a partial ExportProgressState update. */
function eventToState(
  ev: RustProgressEvent,
): Partial<ExportProgressState> | null {
  switch (ev.type) {
    case 'Preparing':
      return { phase: 'preparing' };
    case 'Rendering':
      return { phase: 'rendering' };
    case 'Paginating':
      return { phase: 'paginating', current: ev.current, total: ev.total };
    case 'Writing':
      return { phase: 'writing' };
    case 'Done':
      return { phase: 'done' };
    case 'Fallback':
      // Signaled by Rust when it gives up; orchestrator switches to canvas.
      return null;
    case 'Error':
      return { phase: 'error', message: ev.message };
  }
}

/**
 * Run the native PDF export.
 *
 * @param markdown   Markdown content to render.
 * @param outputPath Absolute filesystem path (validated server-side).
 * @param options    Page size / margins / toggles.
 * @param onProgress Receives partial state updates as the export progresses.
 * @throws on any failure; caller should fall back to canvas path.
 */
export async function exportPdfNative(
  markdown: string,
  outputPath: string,
  options: PdfExportOptions,
  onProgress: ProgressHandler,
): Promise<void> {
  const jobId = generateJobId();

  const channel = new Channel<RustProgressEvent>();
  channel.onmessage = (ev) => {
    const update = eventToState(ev);
    if (update) onProgress(update);
  };

  await invoke('export_pdf_native', {
    job: {
      job_id: jobId,
      markdown,
      output_path: outputPath,
      options,
    },
    onProgress: channel,
  });
}

function generateJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (extremely unlikely in Tauri).
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
