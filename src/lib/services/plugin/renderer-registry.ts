import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/**
 * Built-in renderer plugin registry.
 *
 * Each entry describes a third-party JS library that can render a custom
 * code block language inside the editor's ProseMirror NodeView.
 *
 * CDN URLs point to cdn.jsdelivr.net (primary).  The Rust command
 * `download_renderer_plugin` validates the URL against an allowlist and
 * caches the file under `{appDataDir}/renderer-plugins/{id}/index.js`.
 *
 * @see src-tauri/src/commands/plugin_manager.rs  download_renderer_plugin
 */

export interface RendererPlugin {
  /** Unique short ID (alphanumeric, hyphen, underscore) */
  id: string;
  /** Display name shown in the UI */
  name: string;
  /** One-line description shown in the plugin card */
  description: string;
  /** Approximate GitHub star count (static, updated with each release) */
  stars: number;
  /** npm package name (used by sync-renderer-plugins.mjs for version tracking) */
  npmPackage: string;
  /** UMD global export name. Empty string = ESM-only, loaded via dynamic import() */
  exportName: string;
  /** Approximate bundle size in KB (shown as warning when > 500 KB) */
  sizeKb: number;
  /** Code block language identifiers that trigger this renderer */
  languages: string[];
  /** Brief homepage / docs URL */
  homepage: string;
  /** CDN URL template. Use the frozen version from renderer-versions.json */
  cdnUrl: string;
  /**
   * English-only hint injected into the AI system prompt when this plugin is
   * enabled.  Tells the AI which code block format to use.
   */
  aiHint: string;
  /**
   * Render function: given a container element, the raw source string, and the
   * loaded module (UMD global or ESM default), produce visual output.
   * Must be idempotent — container is cleared before each call.
   */
  render(
    container: HTMLElement,
    source: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mod: any
  ): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Vega-Lite data URL resolver
// ---------------------------------------------------------------------------

/**
 * Recursively walk a Vega-Lite spec and replace any `data: {url: "..."}` with
 * inline `data: {values: [...]}` fetched via Tauri HTTP (bypasses WebView CSP).
 */
async function resolveVegaDataUrls(spec: unknown): Promise<unknown> {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  const s = { ...(spec as Record<string, unknown>) };

  if (s.data && typeof s.data === 'object' && !Array.isArray(s.data)) {
    const data = s.data as Record<string, unknown>;
    if (typeof data.url === 'string') {
      try {
        const resp = await tauriFetch(data.url);
        const text = await resp.text();
        s.data = { values: JSON.parse(text) };
      } catch {
        // Keep original data reference; vega will fail with its own error
      }
    }
  }

  // Recurse into composite views
  for (const key of ['layer', 'concat', 'vconcat', 'hconcat']) {
    if (Array.isArray(s[key])) {
      s[key] = await Promise.all((s[key] as unknown[]).map(resolveVegaDataUrls));
    }
  }
  if (s.spec && typeof s.spec === 'object') {
    s.spec = await resolveVegaDataUrls(s.spec);
  }

  return s;
}

// ---------------------------------------------------------------------------
// Registry — 10 built-in renderer plugins
// ---------------------------------------------------------------------------

export const RENDERER_PLUGINS: RendererPlugin[] = [
  // ── WaveDrom ──────────────────────────────────────────────────────────────
  {
    id: 'wavedrom',
    name: 'WaveDrom',
    description: 'Digital timing diagram and waveform renderer for hardware / RTL design.',
    stars: 3700,
    npmPackage: 'wavedrom',
    exportName: 'WaveDrom',
    sizeKb: 110,
    languages: ['wavedrom'],
    homepage: 'https://wavedrom.com',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/wavedrom@{version}/wavedrom.min.js',
    aiHint:
      'Use ```wavedrom code blocks to draw digital timing diagrams (signal waveforms). ' +
      'Format: JSON with a "signal" array, e.g. {"signal":[{"name":"clk","wave":"p..."}]}.',
    render(container, source, mod) {
      const WaveDrom = mod as {
        // RenderWaveForm(index, waveJSON, outputPrefix) — internally calls
        // getElementById(outputPrefix + index), so the DOM element must have
        // id = outputPrefix + "0" (when index === 0).
        RenderWaveForm: (idx: number, waveJson: unknown, outputPrefix: string) => void;
      };
      const prefix = `wd-${Math.random().toString(36).slice(2)}`;
      container.id = `${prefix}0`;
      // WaveDrom uses JS object literal syntax (unquoted keys), not strict JSON.
      // Use Function constructor to safely evaluate JS object notation.
      // eslint-disable-next-line no-new-func
      const waveJson = new Function(`"use strict"; return (${source.trim()})`)();
      WaveDrom.RenderWaveForm(0, waveJson, prefix);
    },
  },

  // ── Nomnoml ───────────────────────────────────────────────────────────────
  {
    id: 'nomnoml',
    name: 'Nomnoml',
    description: 'Readable UML class and component diagrams from plain text notation.',
    stars: 1800,
    npmPackage: 'nomnoml',
    exportName: 'nomnoml',
    sizeKb: 95,
    languages: ['nomnoml'],
    homepage: 'https://nomnoml.com',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/nomnoml@{version}/dist/nomnoml.min.js',
    aiHint:
      'Use ```nomnoml code blocks to draw UML-style class and component diagrams. ' +
      'Example: [Customer|name;email]->[Order|id;total].',
    render(container, source, mod) {
      const nomnoml = mod as { renderSvg: (src: string) => string };
      container.innerHTML = nomnoml.renderSvg(source);
    },
  },

  // ── ECharts ───────────────────────────────────────────────────────────────
  {
    id: 'echarts',
    name: 'ECharts',
    description: 'Feature-rich interactive chart library by Apache — line, bar, pie, scatter and more.',
    stars: 60000,
    npmPackage: 'echarts',
    exportName: 'echarts',
    sizeKb: 980,
    languages: ['echarts'],
    homepage: 'https://echarts.apache.org',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/echarts@{version}/dist/echarts.min.js',
    aiHint:
      'Use ```echarts code blocks for rich interactive charts (line, bar, pie, scatter, etc.). ' +
      'Content must be a valid ECharts option JSON object.',
    render(container, source, mod) {
      const echarts = mod as {
        init: (el: HTMLElement) => { setOption: (opt: unknown) => void };
      };
      if (!container.style.height) container.style.height = '360px';
      const chart = echarts.init(container);
      chart.setOption(JSON.parse(source));
    },
  },

  // ── Vega-Lite (via vega-embed) ────────────────────────────────────────────
  {
    id: 'vega-lite',
    name: 'Vega-Lite',
    description: 'Declarative statistical visualization grammar for charts and linked views.',
    stars: 3800,
    // jsdelivr combine: vega (runtime) + vega-lite (compiler) + vega-embed (renderer)
    // vega-embed@6 treats vega/vega-lite as peer deps — must load all three together
    npmPackage: 'vega-embed',
    exportName: 'vegaEmbed',
    sizeKb: 2500,
    languages: ['vega-lite', 'vegalite', 'vega-embed', 'vega'],
    homepage: 'https://vega.github.io/vega-lite',
    cdnUrl:
      'https://cdn.jsdelivr.net/combine/' +
      'npm/vega@5.30.0/build/vega.min.js,' +
      'npm/vega-lite@5.18.1/build/vega-lite.min.js,' +
      'npm/vega-embed@6.26.0/build/vega-embed.min.js',
    aiHint:
      'Use ```vega-lite code blocks for declarative statistical visualisations. ' +
      'Content must be a valid Vega-Lite JSON spec with $schema, mark, and encoding fields. ' +
      'Always use inline data: {"values": [...]} instead of {"url": "..."} since external URLs cannot be fetched.',
    async render(container, source, mod) {
      // vega-embed UMD sets window.vegaEmbed = { default: fn, vega, vegaLite, ... }
      // Fall back: .default → .embed → mod itself
      const raw = mod as Record<string, unknown>;
      const embedFn = (raw.default ?? raw.embed ?? mod) as (
        el: HTMLElement,
        spec: unknown,
        opts?: Record<string, unknown>
      ) => Promise<unknown>;
      container.innerHTML = '';
      const spec = JSON.parse(source);
      // Pre-fetch any external data URLs via Tauri HTTP (bypasses WebView CSP).
      const resolved = await resolveVegaDataUrls(spec);
      await embedFn(container, resolved, { renderer: 'svg', actions: false });
    },
  },

  // ── ABCjs ─────────────────────────────────────────────────────────────────
  {
    id: 'abcjs',
    name: 'ABCjs',
    description: 'Renders music sheet notation from ABC notation text in the browser.',
    stars: 1500,
    npmPackage: 'abcjs',
    exportName: 'ABCJS',
    sizeKb: 320,
    languages: ['abc', 'abcjs'],
    homepage: 'https://paulrosen.github.io/abcjs',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/abcjs@{version}/dist/abcjs-basic-min.js',
    aiHint:
      'Use ```abc code blocks to render music sheet notation. ' +
      'Content uses ABC notation format (X:1, T:title, M:4/4, L:1/8, K:C, then notes).',
    render(container, source, mod) {
      const ABCJS = mod as {
        renderAbc: (el: HTMLElement, source: string, opts?: object) => unknown;
      };
      ABCJS.renderAbc(container, source, { responsive: 'resize' });
    },
  },

  // ── jsMind ────────────────────────────────────────────────────────────────
  {
    id: 'jsmind',
    name: 'jsMind',
    description: 'Pure-JavaScript mind map visualizer — render interactive mind maps from JSON.',
    stars: 3600,
    npmPackage: 'jsmind',
    exportName: 'jsMind',
    sizeKb: 50,
    languages: ['jsmind', 'mindmap'],
    homepage: 'https://hizzgdev.github.io/jsmind',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/jsmind@{version}/es6/jsmind.js',
    aiHint:
      'Use ```jsmind code blocks to render interactive mind maps. ' +
      'Content must be a JSON object with "meta", "format": "node_tree", and "data" fields. ' +
      'Example: {"meta":{"name":"map"},"format":"node_tree","data":{"id":"root","topic":"Center","children":[{"id":"1","topic":"Branch","direction":"right"}]}}.',
    render(container, source, mod) {
      const jsMind = mod as {
        show: (options: object, mind: object) => void;
      };
      if (!container.style.height) container.style.height = '400px';
      const id = `jm-${Math.random().toString(36).slice(2)}`;
      container.id = id;
      jsMind.show({ container: id, editable: false, theme: 'default' }, JSON.parse(source));
    },
  },

  // ── Pintora ───────────────────────────────────────────────────────────────
  {
    id: 'pintora',
    name: 'Pintora',
    description: 'Text-to-diagram tool supporting sequence, activity, component, mindmap and Gantt.',
    stars: 900,
    npmPackage: '@pintora/standalone',
    exportName: 'pintora',
    sizeKb: 380,
    languages: ['pintora'],
    homepage: 'https://pintorajs.vercel.app',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/@pintora/standalone@{version}/lib/pintora-standalone.umd.min.js',
    aiHint:
      'Use ```pintora code blocks for text-based diagrams (sequence, activity, component, mindmap, gantt). ' +
      'Example: sequenceDiagram\n  A->B: Hello.',
    async render(container, source, mod) {
      const pintora = mod as {
        renderTo: (el: HTMLElement, opts: object) => Promise<void>;
      };
      await pintora.renderTo(container, { code: source, backgroundColor: 'transparent' });
    },
  },

  // ── Chart.js ──────────────────────────────────────────────────────────────
  {
    id: 'chartjs',
    name: 'Chart.js',
    description: 'Simple yet flexible JavaScript charting — bar, line, pie, radar, doughnut and more.',
    stars: 65000,
    npmPackage: 'chart.js',
    exportName: 'Chart',
    sizeKb: 200,
    languages: ['chartjs', 'chart'],
    homepage: 'https://www.chartjs.org',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/chart.js@{version}/dist/chart.umd.min.js',
    aiHint:
      'Use ```chartjs code blocks to render bar, line, pie, radar, and other Chart.js charts. ' +
      'Content must be a valid Chart.js config JSON with type, data, and optional options.',
    render(container, source, mod) {
      const Chart = mod as new (canvas: HTMLCanvasElement, config: unknown) => unknown;
      const canvas = document.createElement('canvas');
      container.appendChild(canvas);
      new Chart(canvas, JSON.parse(source));
    },
  },

  // ── Cytoscape.js ──────────────────────────────────────────────────────────
  {
    id: 'cytoscape',
    name: 'Cytoscape.js',
    description: 'Graph theory and network analysis library with rich interactive visualization.',
    stars: 10000,
    npmPackage: 'cytoscape',
    exportName: 'cytoscape',
    sizeKb: 290,
    languages: ['cytoscape'],
    homepage: 'https://js.cytoscape.org',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/cytoscape@{version}/dist/cytoscape.min.js',
    aiHint:
      'Use ```cytoscape code blocks to render interactive graph and network visualisations. ' +
      'Content must be a Cytoscape.js config JSON with elements (nodes and edges arrays).',
    render(container, source, mod) {
      const cytoscape = mod as (opts: object) => unknown;
      if (!container.style.height) container.style.height = '400px';
      cytoscape({ container, ...JSON.parse(source) });
    },
  },

  // ── Viz.js (Graphviz) ─────────────────────────────────────────────────────
  {
    id: 'viz',
    name: 'Viz.js (Graphviz)',
    description: 'Graphviz compiled to WebAssembly — renders DOT language directed and undirected graphs.',
    stars: 3100,
    npmPackage: '@viz-js/viz',
    exportName: 'Viz',
    sizeKb: 1500,
    languages: ['dot', 'graphviz'],
    homepage: 'https://github.com/mdaines/viz-js',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/@viz-js/viz@{version}/lib/viz-standalone.js',
    aiHint:
      'Use ```dot code blocks to render Graphviz DOT language graphs (directed/undirected). ' +
      'Example: digraph G { A -> B -> C; }.',
    async render(container, source, mod) {
      // viz-standalone.js is UMD; loaded via <script> tag, window.Viz = { instance }
      const vizMod = mod as { instance: () => Promise<{ renderSVGElement: (src: string) => SVGElement }> };
      const viz = await vizMod.instance();
      container.innerHTML = '';
      container.appendChild(viz.renderSVGElement(source));
    },
  },
];

/** Quick lookup by plugin id */
export function getRendererPlugin(id: string): RendererPlugin | undefined {
  return RENDERER_PLUGINS.find((p) => p.id === id);
}

/** All language identifiers that have a registered renderer */
export const RENDERER_LANGUAGES = new Set<string>(
  RENDERER_PLUGINS.flatMap((p) => p.languages)
);
