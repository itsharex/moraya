import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { t } from '$lib/i18n';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import katex from 'katex';
import { settingsStore } from '$lib/stores/settings-store';
import { exportProgressStore } from '$lib/stores/export-progress-store';
import {
  exportPdfNative,
  defaultExportOptions,
  type PdfExportOptions,
} from './pdf-export-native';

export type ExportFormat =
  | 'pdf'
  | 'html'
  | 'html-plain'
  | 'doc'
  | 'latex'
  | 'image';

interface ExportOption {
  format: ExportFormat;
  labelKey: string;
  extension: string;
  mimeType: string;
}

export const exportOptions: ExportOption[] = [
  { format: 'pdf', labelKey: 'export.pdf', extension: 'pdf', mimeType: 'application/pdf' },
  { format: 'html', labelKey: 'export.html', extension: 'html', mimeType: 'text/html' },
  { format: 'html-plain', labelKey: 'export.htmlPlain', extension: 'html', mimeType: 'text/html' },
  { format: 'image', labelKey: 'export.image', extension: 'png', mimeType: 'image/png' },
  { format: 'doc', labelKey: 'export.doc', extension: 'doc', mimeType: 'application/msword' },
  { format: 'latex', labelKey: 'export.latex', extension: 'tex', mimeType: 'application/x-latex' },
];

/**
 * Convert Markdown to HTML with Moraya styling.
 * Uses KaTeX for math rendering and proper code block handling.
 */
export async function markdownToHtml(markdown: string, includeStyles: boolean = true): Promise<string> {
  const rawHtml = markdownToHtmlBody(markdown);
  const renderedHtml = await renderMermaidInHtml(rawHtml);
  const bodyHtml = sanitizeHtml(renderedHtml);

  if (!includeStyles) {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Exported from Moraya</title></head>
<body>${bodyHtml}</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Exported from Moraya</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.28/dist/katex.min.css">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    max-width: 800px;
    margin: 2rem auto;
    padding: 0 1rem;
    line-height: 1.75;
    color: #1a1a1a;
  }
  h1 { font-size: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; }
  h3 { font-size: 1.25em; }
  code { background: #f4f4f4; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f4f4f4; padding: 1em; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #4a90d9; padding-left: 1em; color: #666; margin: 1em 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 0.5em 0.8em; }
  th { background: #f4f4f4; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #eee; margin: 1.5em 0; }
  a { color: #4a90d9; }
  ul, ol { padding-left: 2em; }
  li { margin: 0.25em 0; }
  .math-block { text-align: center; margin: 1em 0; overflow-x: auto; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

/**
 * Convert markdown to HTML body content with KaTeX math and proper code blocks.
 */
export function markdownToHtmlBody(md: string): string {
  // Use a placeholder system to protect already-processed content
  const placeholders: string[] = [];
  function ph(content: string): string {
    const idx = placeholders.length;
    placeholders.push(content);
    return `\x00PH${idx}\x00`;
  }

  let html = md;

  // 1. Code blocks (``` ... ```) — protect from further processing
  // Mermaid blocks get a wrapper div for async SVG rendering during export
  html = html.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    if (lang === 'mermaid') {
      return ph(`<div class="mermaid-export"><pre><code class="language-mermaid">${escapeHtml(code.trimEnd())}</code></pre></div>`);
    }
    const escaped = escapeHtml(code.trimEnd());
    const langAttr = lang ? ` class="language-${lang}"` : '';
    return ph(`<pre><code${langAttr}>${escaped}</code></pre>`);
  });

  // 1b. Unclosed code blocks — common in truncated/streaming responses where closing ``` never arrived
  html = html.replace(/```([\w-]*)\n([\s\S]+)$/, (_m, lang, code) => {
    const escaped = escapeHtml(code.trimEnd());
    const langAttr = lang ? ` class="language-${lang}"` : '';
    return ph(`<pre><code${langAttr}>${escaped}</code></pre>`);
  });

  // 2. Math blocks ($$...$$) — render with KaTeX
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_m, tex) => {
    try {
      const rendered = katex.renderToString(tex.trim(), {
        displayMode: true,
        throwOnError: false,
      });
      return ph(`<div class="math-block">${rendered}</div>`);
    } catch {
      return ph(`<div class="math-block"><code>${escapeHtml(tex.trim())}</code></div>`);
    }
  });

  // 3. Inline math ($...$) — render with KaTeX
  html = html.replace(/\$([^\$\n]+?)\$/g, (_m, tex) => {
    try {
      const rendered = katex.renderToString(tex.trim(), {
        displayMode: false,
        throwOnError: false,
      });
      return ph(rendered);
    } catch {
      return ph(`<code>${escapeHtml(tex.trim())}</code>`);
    }
  });

  // 4. Inline code
  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    return ph(`<code>${escapeHtml(code)}</code>`);
  });

  // 5. Headers
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // 6. Bold & Italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 7. Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 8. Images (must be before links, so ![alt](url) isn't consumed by link regex)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    if (DANGEROUS_PROTOCOLS.test(src)) return '';
    return ph(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`);
  });

  // 9. Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
    if (DANGEROUS_PROTOCOLS.test(href)) return escapeHtml(text);
    return `<a href="${escapeHtml(href)}">${text}</a>`;
  });

  // 10. Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^\*\*\*$/gm, '<hr>');

  // 11. Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // 12a. Task list checkboxes (must come before generic list items)
  html = html.replace(/^(\s*)[-*]\s+\[x\]\s+(.+)$/gm, (_m, _indent, text) => {
    return ph(`<li class="task-item checked"><span class="task-checkbox checked">✓</span>${text}</li>`);
  });
  html = html.replace(/^(\s*)[-*]\s+\[ \]\s+(.+)$/gm, (_m, _indent, text) => {
    return ph(`<li class="task-item"><span class="task-checkbox"></span>${text}</li>`);
  });

  // 12b. Unordered lists
  html = html.replace(/^(\s*)[-*]\s+(.+)$/gm, '<li>$2</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // 13. Paragraphs — wrap remaining plain text lines
  html = html.replace(/^(?!<[a-zA-Z/]|\x00)(.+)$/gm, (match) => {
    const trimmed = match.trim();
    if (trimmed) {
      return `<p>${trimmed}</p>`;
    }
    return match;
  });

  // Restore placeholders
  for (let i = 0; i < placeholders.length; i++) {
    html = html.split(`\x00PH${i}\x00`).join(placeholders[i]);
  }

  // Clean up excessive empty lines
  html = html.replace(/\n{3,}/g, '\n\n');

  return html;
}

/**
 * Render mermaid code blocks in HTML to inline SVG.
 * Finds `<div class="mermaid-export" data-mermaid-index="N">` placeholders
 * and replaces their content with rendered SVG. Fails gracefully — unrenderable
 * blocks keep the original `<pre><code>` fallback.
 */
async function renderMermaidInHtml(html: string): Promise<string> {
  if (!html.includes('mermaid-export')) return html;
  try {
    const { renderMermaid } = await import('$lib/editor/plugins/mermaid-renderer');
    // Find all mermaid-export blocks and extract their code
    const regex = /<div class="mermaid-export"><pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre><\/div>/g;
    let match;
    const renders: { full: string; code: string }[] = [];
    while ((match = regex.exec(html)) !== null) {
      renders.push({ full: match[0], code: unescapeHtml(match[1]) });
    }
    for (const r of renders) {
      const result = await renderMermaid(r.code);
      if ('svg' in result) {
        html = html.replace(r.full, `<div class="mermaid-export">${result.svg}</div>`);
      }
    }
  } catch {
    // Mermaid not available — keep code blocks as-is
  }
  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function unescapeHtml(str: string): string {
  return str
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/** Dangerous URL protocols that must be rejected in href/src attributes */
const DANGEROUS_PROTOCOLS = /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i;

/** Event handler attributes that could execute scripts */
const EVENT_ATTRS = /^on/i;

/**
 * Sanitize an HTML string by removing dangerous elements and attributes.
 * Used on export output to prevent XSS in exported HTML files.
 */
function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Remove <script> and <iframe> elements
  doc.querySelectorAll('script, iframe, object, embed, applet').forEach(el => el.remove());

  // Clean all elements
  const allElements = doc.body.querySelectorAll('*');
  for (const el of allElements) {
    // Remove event handler attributes (onclick, onerror, onload, etc.)
    const attrsToRemove: string[] = [];
    for (const attr of el.attributes) {
      if (EVENT_ATTRS.test(attr.name)) {
        attrsToRemove.push(attr.name);
      }
    }
    for (const name of attrsToRemove) {
      el.removeAttribute(name);
    }

    // Validate src/href protocols
    for (const attrName of ['src', 'href']) {
      const val = el.getAttribute(attrName);
      if (val && DANGEROUS_PROTOCOLS.test(val)) {
        el.removeAttribute(attrName);
      }
    }
  }

  return doc.body.innerHTML;
}

// Container CSS width used for all export rendering. Keep stable so layout is
// reproducible across single-canvas and per-page paths.
const EXPORT_CONTAINER_WIDTH = 800;

// Conservative single-axis canvas dimension cap. Chromium hard-limits at 32767
// but falls back to blank above ~16384 on many GPUs; WebKit on macOS has
// similar behaviour. We treat anything above this as a hard error so the
// caller sees a real failure instead of a silently-blank PDF.
const BROWSER_CANVAS_MAX = 16384;

// A4 portrait, 10mm margins on each side → 190×277 mm content area.
const PDF_PAGE_WIDTH_MM = 210;
const PDF_PAGE_HEIGHT_MM = 297;
const PDF_MARGIN_MM = 10;
const PDF_CONTENT_WIDTH_MM = PDF_PAGE_WIDTH_MM - 2 * PDF_MARGIN_MM;
const PDF_CONTENT_HEIGHT_MM = PDF_PAGE_HEIGHT_MM - 2 * PDF_MARGIN_MM;

// CSS pixels of vertical container content that correspond to one PDF page
// (at the EXPORT_CONTAINER_WIDTH used for layout). Derived from the A4
// content aspect ratio so slicing is geometry-consistent.
const PAGE_CSS_PX_HEIGHT =
  EXPORT_CONTAINER_WIDTH * (PDF_CONTENT_HEIGHT_MM / PDF_CONTENT_WIDTH_MM);

/**
 * Build an offscreen container hosting the live editor clone, or null if the
 * editor isn't mounted. Caller is responsible for calling document.body.removeChild.
 */
function buildEditorContainer(): HTMLElement | null {
  const editorEl = document.querySelector('.moraya-editor') as HTMLElement | null;
  if (!editorEl) return null;

  const container = document.createElement('div');
  container.style.cssText =
    `position:fixed;left:-9999px;top:0;width:${EXPORT_CONTAINER_WIDTH}px;background:#fff;padding:2rem 1rem;`;

  const clone = editorEl.cloneNode(true) as HTMLElement;
  clone.removeAttribute('contenteditable');
  clone.style.outline = 'none';
  clone.style.caretColor = 'transparent';
  clone.querySelectorAll('.ProseMirror-selectednode, .ProseMirror-gapcursor').forEach((el) => el.remove());

  container.appendChild(clone);
  document.body.appendChild(container);
  return container;
}

/**
 * Build an offscreen container from rendered HTML (fallback path for source mode).
 */
function buildHtmlContainer(htmlContent: string): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText =
    `position:fixed;left:-9999px;top:0;width:${EXPORT_CONTAINER_WIDTH}px;background:#fff;padding:2rem 1rem;`;

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  doc.querySelectorAll('style').forEach((style) => {
    container.appendChild(style.cloneNode(true));
  });

  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = sanitizeHtml(doc.body.innerHTML);
  container.appendChild(contentDiv);

  document.body.appendChild(container);
  return container;
}

/**
 * Get an offscreen render container for the current document.
 * Prefers the live editor clone; falls back to re-rendered HTML.
 * Caller MUST detach the returned container from document.body when done.
 */
async function getDocumentContainer(markdown: string): Promise<HTMLElement> {
  const editorContainer = buildEditorContainer();
  if (editorContainer) return editorContainer;
  const htmlContent = await markdownToHtml(markdown, true);
  return buildHtmlContainer(htmlContent);
}

/**
 * Throw a descriptive error if a canvas would exceed the browser's renderable
 * dimension cap. Prevents the silent-blank-canvas failure mode behind blank
 * PDF exports for very long documents on Windows WebView2.
 */
function assertCanvasFits(width: number, height: number, where: string): void {
  if (width > BROWSER_CANVAS_MAX || height > BROWSER_CANVAS_MAX) {
    throw new Error(
      `Canvas too large for ${where} (${Math.round(width)}×${Math.round(height)}). ` +
        `Browsers cap canvas dimensions near ${BROWSER_CANVAS_MAX}px on each axis; ` +
        'try splitting the document or lowering the export scale.',
    );
  }
}

/**
 * Pick a render scale based on document length so long docs stay within memory
 * and per-page canvas budgets. Single-canvas paths use a stricter cap because
 * the entire document collapses to one canvas.
 */
function pickAdaptiveScale(totalCssHeight: number, mode: 'single' | 'paged'): number {
  if (mode === 'single') {
    // Tightest constraint: full doc height × scale must stay under canvas cap.
    const maxByCanvas = BROWSER_CANVAS_MAX / Math.max(1, totalCssHeight);
    if (maxByCanvas >= 2) return 2;
    if (maxByCanvas >= 1.5) return 1.5;
    if (maxByCanvas >= 1) return 1;
    return Math.max(0.5, maxByCanvas);
  }
  // Paged: each page canvas is small; scale only affects memory/PDF size.
  const totalPages = Math.ceil(totalCssHeight / PAGE_CSS_PX_HEIGHT);
  if (totalPages > 300) return 1;
  if (totalPages > 100) return 1.5;
  return 2;
}

/**
 * Capture an offscreen container as a single canvas. Used for PNG export.
 * Throws if the resulting canvas would exceed the browser's dimension cap.
 */
async function captureContainerAsSingleCanvas(container: HTMLElement): Promise<HTMLCanvasElement> {
  const totalHeight = container.offsetHeight;
  const scale = pickAdaptiveScale(totalHeight, 'single');
  assertCanvasFits(EXPORT_CONTAINER_WIDTH * scale, totalHeight * scale, 'image export');
  return await html2canvas(container, {
    backgroundColor: '#ffffff',
    scale,
    useCORS: true,
    logging: false,
    windowWidth: EXPORT_CONTAINER_WIDTH,
  });
}

/**
 * Capture an offscreen container as N small page-sized canvases by clipping
 * with html2canvas's `y` + `height` options. This avoids producing a single
 * giant canvas (root cause of the 200-page blank-PDF bug — the per-axis canvas
 * cap is hit and Chromium/WebKit silently return an empty canvas).
 */
async function captureContainerAsPages(container: HTMLElement): Promise<{
  canvases: HTMLCanvasElement[];
  scale: number;
}> {
  const totalHeight = container.offsetHeight;
  if (totalHeight <= 0) {
    throw new Error('Document container has zero height; nothing to export.');
  }

  const scale = pickAdaptiveScale(totalHeight, 'paged');
  const pageCount = Math.max(1, Math.ceil(totalHeight / PAGE_CSS_PX_HEIGHT));

  // Sanity check: per-page output canvas dimensions.
  assertCanvasFits(EXPORT_CONTAINER_WIDTH * scale, PAGE_CSS_PX_HEIGHT * scale, 'PDF page');

  const canvases: HTMLCanvasElement[] = [];
  for (let i = 0; i < pageCount; i++) {
    const y = i * PAGE_CSS_PX_HEIGHT;
    const h = Math.min(PAGE_CSS_PX_HEIGHT, totalHeight - y);
    if (h <= 0) break;
    const pageCanvas = await html2canvas(container, {
      backgroundColor: '#ffffff',
      scale,
      useCORS: true,
      logging: false,
      y,
      height: h,
      windowWidth: EXPORT_CONTAINER_WIDTH,
    });
    // Defensive: html2canvas should respect `height`, but verify the canvas
    // isn't silently blank (zero-dim) before adding it.
    if (pageCanvas.width === 0 || pageCanvas.height === 0) {
      throw new Error(`Page ${i + 1}/${pageCount} captured as empty canvas.`);
    }
    canvases.push(pageCanvas);
  }
  return { canvases, scale };
}

/**
 * Write binary data to a file via raw-body IPC. Sends bytes directly without
 * base64 encoding — the previous data-URI path inflated payload by 33% and
 * required JS↔Rust string conversion of arbitrarily large strings.
 */
async function writeBinary(path: string, bytes: Uint8Array): Promise<void> {
  await invoke('write_file_bytes', bytes, { headers: { 'X-File-Path': path } });
}

/**
 * Export as PNG image
 */
async function exportAsImage(markdown: string, path: string): Promise<void> {
  const container = await getDocumentContainer(markdown);
  let canvas: HTMLCanvasElement;
  try {
    canvas = await captureContainerAsSingleCanvas(container);
  } finally {
    container.parentNode?.removeChild(container);
  }

  // Convert canvas → PNG bytes via Blob (avoids the dataURL base64 hop).
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG'))),
      'image/png',
    );
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeBinary(path, bytes);
}

/**
 * Export as PDF using the canvas-based pipeline.
 *
 * Used as a fallback when the native print-to-PDF path fails (or as the
 * primary path on platforms where the native path isn't available yet).
 *
 * Emits `paginating` progress events so the StatusBar can show realtime
 * page progress for long documents.
 */
async function exportAsCanvasPdf(markdown: string, path: string): Promise<void> {
  exportProgressStore.setPhase('rendering');
  const container = await getDocumentContainer(markdown);
  let pages: { canvases: HTMLCanvasElement[]; scale: number };
  try {
    pages = await captureContainerAsPages(container);
  } finally {
    container.parentNode?.removeChild(container);
  }

  if (pages.canvases.length === 0) {
    throw new Error('No pages were rendered for PDF export.');
  }

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const totalPages = pages.canvases.length;
  for (let i = 0; i < totalPages; i++) {
    const canvas = pages.canvases[i];
    if (i > 0) pdf.addPage();

    exportProgressStore.setPaginating(i + 1, totalPages);

    // Each page canvas was captured from PAGE_CSS_PX_HEIGHT CSS pixels of
    // content (except possibly the last, which can be shorter). Translate
    // its pixel height back to mm so partial pages don't get stretched.
    const cssPxHeight = canvas.height / pages.scale;
    const drawHeightMm = (cssPxHeight / PAGE_CSS_PX_HEIGHT) * PDF_CONTENT_HEIGHT_MM;

    const dataUrl = canvas.toDataURL('image/png');
    pdf.addImage(dataUrl, 'PNG', PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_CONTENT_WIDTH_MM, drawHeightMm);
  }

  exportProgressStore.setPhase('writing');
  const buf = pdf.output('arraybuffer') as ArrayBuffer;
  await writeBinary(path, new Uint8Array(buf));
}

/**
 * Build a PdfExportOptions value from the user's settings + the document title.
 */
function buildNativeOptions(documentTitle: string): PdfExportOptions {
  const opts = defaultExportOptions(documentTitle);
  const settings = get(settingsStore);
  const e = settings.exportSettings;
  if (!e) return opts;
  return {
    paper_size: e.pageSize,
    orientation: e.orientation,
    margins: { ...e.margins },
    header_enabled: e.headerEnabled,
    header_template: e.headerTemplate,
    footer_enabled: e.footerEnabled,
    footer_template: e.footerTemplate,
    font_size: e.fontSize,
    font_family: e.fontFamily,
    enable_highlight: e.enableHighlight,
    enable_mermaid: e.enableMermaid,
    enable_math: e.enableMath,
    document_title: documentTitle,
  };
}

/**
 * Top-level PDF export. Tries the native print-to-PDF path first (selectable
 * text, vector fonts, real CSS pagination); falls back to the canvas path on
 * any failure if `autoFallbackOnFailure` is enabled in settings.
 */
async function exportAsPdf(markdown: string, path: string): Promise<void> {
  exportProgressStore.start();
  const settings = get(settingsStore);
  const documentTitle = inferDocumentTitle(markdown);
  const opts = buildNativeOptions(documentTitle);
  const autoFallback = settings.exportSettings?.autoFallbackOnFailure ?? true;

  try {
    await exportPdfNative(markdown, path, opts, (update) => {
      if (update.phase) exportProgressStore.setPhase(update.phase);
      if (update.phase === 'paginating' && update.current != null && update.total != null) {
        exportProgressStore.setPaginating(update.current, update.total);
      }
    });
    exportProgressStore.done();
  } catch (nativeErr) {
    if (!autoFallback) {
      exportProgressStore.error(
        nativeErr instanceof Error ? nativeErr.message : String(nativeErr),
      );
      throw nativeErr;
    }
    // Native failed — switch to canvas path and mark as fallback.
    exportProgressStore.fallback();
    try {
      await exportAsCanvasPdf(markdown, path);
      exportProgressStore.done();
    } catch (canvasErr) {
      exportProgressStore.error(
        canvasErr instanceof Error ? canvasErr.message : String(canvasErr),
      );
      throw canvasErr;
    }
  }
}

/** Extract document title from the first H1, falling back to first non-blank line. */
function inferDocumentTitle(markdown: string): string {
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) return h1[1].trim();
    if (!line.startsWith('#')) return line.slice(0, 80);
  }
  return 'Document';
}

/**
 * Export markdown content to the specified format.
 *
 * Accepts either a markdown string OR a lazy getter. For huge documents,
 * markdown serialization (ProseMirror → text) can take seconds-to-minutes;
 * passing a getter lets us show the save dialog FIRST and only pay that
 * cost after the user has actually committed to exporting.
 */
export async function exportDocument(
  markdownOrGetter: string | (() => string),
  format: ExportFormat,
): Promise<boolean> {
  const option = exportOptions.find(o => o.format === format);
  if (!option) return false;

  const tr = get(t);
  const label = tr(option.labelKey);
  // Show the save dialog FIRST. It only depends on the format, not the
  // content — so it can appear instantly even while the editor is still
  // busy. Resolving the markdown beforehand would block the JS main thread
  // and delay the dialog by however long serialization takes.
  const path = await saveDialog({
    title: tr('export.exportAs', { format: label }),
    defaultPath: `document.${option.extension}`,
    filters: [{ name: label, extensions: [option.extension] }],
  });

  if (!path || typeof path !== 'string') return false;

  // User committed — show "preparing" in the StatusBar BEFORE the blocking
  // markdown serialization. For huge documents `getCurrentContent()` can
  // freeze the JS main thread for tens of seconds; without this yield the
  // user sees a totally unresponsive UI between picking a path and the
  // first real progress event.
  if (format === 'pdf') {
    exportProgressStore.start();
    // Yield one frame so Svelte renders the status pill before we block.
    await new Promise((r) => setTimeout(r, 0));
  }

  const markdown =
    typeof markdownOrGetter === 'function' ? markdownOrGetter() : markdownOrGetter;

  switch (format) {
    case 'html':
      await invoke('write_file', { path, content: await markdownToHtml(markdown, true) });
      break;
    case 'html-plain':
      await invoke('write_file', { path, content: await markdownToHtml(markdown, false) });
      break;
    case 'latex':
      await invoke('write_file', { path, content: markdownToLatex(markdown) });
      break;
    case 'pdf':
      await exportAsPdf(markdown, path);
      break;
    case 'image':
      await exportAsImage(markdown, path);
      break;
    case 'doc':
      await invoke('write_file', { path, content: await markdownToHtml(markdown, true) });
      break;
    default:
      await invoke('write_file', { path, content: markdown });
  }

  return true;
}

/**
 * Basic Markdown to LaTeX converter
 */
function markdownToLatex(md: string): string {
  let tex = md;

  tex = tex.replace(/^#\s+(.+)$/gm, '\\section{$1}');
  tex = tex.replace(/^##\s+(.+)$/gm, '\\subsection{$1}');
  tex = tex.replace(/^###\s+(.+)$/gm, '\\subsubsection{$1}');
  tex = tex.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');
  tex = tex.replace(/\*(.+?)\*/g, '\\textit{$1}');
  tex = tex.replace(/`([^`]+)`/g, '\\texttt{$1}');
  tex = tex.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\\href{$2}{$1}');

  return `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{hyperref}
\\usepackage{amsmath}
\\begin{document}

${tex}

\\end{document}`;
}
