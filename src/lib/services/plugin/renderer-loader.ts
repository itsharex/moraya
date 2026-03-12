/**
 * Renderer Plugin Loader
 *
 * Handles downloading (via Rust) and loading (via Blob URL) of renderer plugin
 * JS bundles.  Keeps a runtime module cache so each plugin is only loaded once
 * per app session even if the NodeView is destroyed and recreated.
 *
 * Loading strategy:
 *   - UMD plugins (exportName !== ''):  load via <script> tag using a Blob URL;
 *     access window[exportName] after load.
 *   - ESM plugins (exportName === ''):  load via dynamic import() with Blob URL.
 *
 * Why Blob URLs?
 *   `convertFileSrc` on macOS encodes path separators as %2F, e.g.
 *   asset://localhost/%2FUsers%2F...  which the browser cannot resolve.
 *   Reading the file via Tauri IPC (read_file) and wrapping in a Blob produces
 *   a blob:// URL that is same-origin and works with CSP `script-src blob:`.
 */

import { invoke } from '@tauri-apps/api/core';
import type { RendererPlugin } from './renderer-registry';

// ---------------------------------------------------------------------------
// Tauri API shim for ESM plugin bundles
// ---------------------------------------------------------------------------

/**
 * Some CDN plugin bundles (e.g. morcad) import @tauri-apps/api/core directly.
 * That bare specifier cannot be resolved inside a blob: module context.
 * We expose `invoke` on a well-known window key so the source-patch below can
 * redirect those imports to the already-loaded host copy.
 */
(window as unknown as Record<string, unknown>).__moraya_invoke__ = invoke;

/**
 * Rewrite `import { X } from '@tauri-apps/api/core'` → `const X = window.__moraya_invoke__;`
 * so that ESM bundles that reference Tauri APIs can load without errors.
 * Only the `invoke` export is remapped; others fall back to undefined gracefully.
 */
function patchTauriImports(source: string): string {
  return source.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]@tauri-apps\/api\/core['"]\s*;?/g,
    (_match, imports: string) =>
      imports
        .split(',')
        .map((raw) => {
          const part = raw.trim();
          // Handle aliased imports: `invoke as tauriInvoke`
          const [orig, alias] = part.split(/\s+as\s+/).map((s) => s.trim());
          const localName = alias ?? orig;
          if (orig === 'invoke') return `const ${localName} = window.__moraya_invoke__;`;
          return `const ${localName} = undefined; /* @tauri-apps/api/core#${orig} not available in renderer plugin context */`;
        })
        .join('\n') + '\n'
  );
}

// ---------------------------------------------------------------------------
// Module cache — keyed by plugin id
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moduleCache = new Map<string, any>();

/** Clear the in-memory module cache (used when a plugin is updated/removed). */
export function clearRendererModuleCache(id?: string): void {
  if (id) {
    moduleCache.delete(id);
  } else {
    moduleCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read a local JS file via Tauri IPC and return a temporary Blob URL.
 * When `patchTauri` is true, bare @tauri-apps/api/core imports are rewritten
 * to use the host-side `window.__moraya_invoke__` global.
 * Caller is responsible for calling URL.revokeObjectURL() after use.
 */
async function createBlobUrl(localPath: string, patchTauri = false): Promise<string> {
  let content = await invoke<string>('read_file', { path: localPath });
  if (patchTauri) content = patchTauriImports(content);
  const blob = new Blob([content], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

/** Load a script by inserting a <script> tag and waiting for load/error. */
function loadScript(blobUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = blobUrl;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load plugin script'));
    document.head.appendChild(script);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type LoadStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

export interface LoadResult {
  status: LoadStatus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  module?: any;
  error?: string;
}

/**
 * Ensure the plugin JS bundle is downloaded and loaded.
 *
 * 1. If already in moduleCache → return immediately.
 * 2. Call Rust `download_renderer_plugin` (idempotent — Rust skips re-download
 *    if the file already exists on disk).
 * 3. Read file content via `read_file` IPC, wrap in Blob URL.
 * 4. Load via <script> (UMD) or dynamic import() (ESM).
 * 5. Cache the resulting module.
 */
export async function loadRendererPlugin(
  plugin: RendererPlugin,
  cdnUrl: string,
  onStatus?: (s: LoadStatus) => void,
  fallbackCdnUrl?: string
): Promise<LoadResult> {
  // 1. Cache hit
  if (moduleCache.has(plugin.id)) {
    onStatus?.('ready');
    return { status: 'ready', module: moduleCache.get(plugin.id) };
  }

  // Try primary URL, then fallback if provided
  const urlsToTry = [cdnUrl, ...(fallbackCdnUrl ? [fallbackCdnUrl] : [])];
  let lastError = '';

  for (let i = 0; i < urlsToTry.length; i++) {
    const url = urlsToTry[i];
    const isFallback = i > 0;

    try {
      // 2. Download (Rust validates URL, caches to disk)
      onStatus?.('downloading');
      if (isFallback) {
        // Clear any partial/failed file before retrying with fallback
        await invoke('delete_renderer_plugin', { pluginId: plugin.id }).catch(() => {});
      }
      const localPath = await invoke<string>('download_renderer_plugin', {
        pluginId: plugin.id,
        url,
      });

      // 3. Read file and create Blob URL
      // For ESM plugins (exportName === '') patch bare @tauri-apps/api/core imports.
      onStatus?.('loading');
      const blobUrl = await createBlobUrl(localPath, !plugin.exportName);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mod: any;

      try {
        if (plugin.exportName) {
          // UMD: load via <script>, access window global
          await loadScript(blobUrl);
          mod = (window as unknown as Record<string, unknown>)[plugin.exportName];
          if (!mod) {
            throw new Error(`Global "${plugin.exportName}" not found after script load`);
          }
        } else {
          // ESM: use dynamic import()
          const imported = await import(/* @vite-ignore */ blobUrl);
          mod = imported.default ?? imported;
        }
      } finally {
        // Revoke Blob URL after load — script/module is already in memory
        URL.revokeObjectURL(blobUrl);
      }

      // 4. Cache and notify existing NodeViews that a new plugin is ready
      moduleCache.set(plugin.id, mod);
      window.dispatchEvent(new CustomEvent('renderer-plugin-ready', { detail: { pluginId: plugin.id } }));
      onStatus?.('ready');
      return { status: 'ready', module: mod };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      // If fallback available, continue to next iteration; otherwise fall through
    }
  }

  onStatus?.('error');
  return { status: 'error', error: lastError };
}
