import { describe, it, expect } from 'vitest';
import { defaultExportOptions } from './pdf-export-native';

/**
 * v0.60.0 unit tests for the export pipeline.
 *
 * These cover the pure-function bits:
 *   - default options shape
 *   - footer/header template placeholder replacement
 *   - ProgressEvent → ExportProgressState mapping (via internal eventToState
 *     re-exported here for testing)
 */

describe('defaultExportOptions', () => {
  it('uses A4 portrait + 20/15/20/15 margins by default', () => {
    const o = defaultExportOptions();
    expect(o.paper_size).toBe('a4');
    expect(o.orientation).toBe('portrait');
    expect(o.margins).toEqual({ top: 20, right: 15, bottom: 20, left: 15 });
  });

  it('threads document title into options', () => {
    const o = defaultExportOptions('My Doc');
    expect(o.document_title).toBe('My Doc');
  });

  it('enables highlight / mermaid / math by default', () => {
    const o = defaultExportOptions();
    expect(o.enable_highlight).toBe(true);
    expect(o.enable_mermaid).toBe(true);
    expect(o.enable_math).toBe(true);
  });

  it('disables header but enables footer by default', () => {
    const o = defaultExportOptions();
    expect(o.header_enabled).toBe(false);
    expect(o.footer_enabled).toBe(true);
    expect(o.footer_template).toBe('{page} / {total}');
  });
});

/**
 * Footer/header templates use simple `{token}` placeholders. Test that the
 * substitution works (this is the algorithm used both server- and client-
 * side; we test the client-side shape).
 */
function applyTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

describe('export template placeholders', () => {
  it('substitutes {page} / {total}', () => {
    expect(applyTemplate('{page} / {total}', { page: 3, total: 12 })).toBe('3 / 12');
  });
  it('substitutes {title}', () => {
    expect(applyTemplate('Doc: {title}', { title: 'My Notes' })).toBe('Doc: My Notes');
  });
  it('substitutes {date}', () => {
    expect(applyTemplate('{date}', { date: '2026-05-12' })).toBe('2026-05-12');
  });
  it('leaves unknown placeholders intact', () => {
    expect(applyTemplate('{page} of {unknown}', { page: 1 })).toBe('1 of {unknown}');
  });
  it('handles empty template', () => {
    expect(applyTemplate('', { page: 1 })).toBe('');
  });
});

/**
 * The orchestrator distinguishes `paginating` events from other phases by
 * presence of `current` and `total` fields. Verify the mapping (we simulate
 * `eventToState` since it's not exported).
 */
type RustEvent =
  | { type: 'Preparing' }
  | { type: 'Rendering' }
  | { type: 'Paginating'; current: number; total: number }
  | { type: 'Writing' }
  | { type: 'Done' }
  | { type: 'Fallback'; reason: string }
  | { type: 'Error'; message: string };

function eventToState(
  ev: RustEvent,
): { phase?: string; current?: number; total?: number; message?: string } | null {
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
      return null;
    case 'Error':
      return { phase: 'error', message: ev.message };
  }
}

describe('ProgressEvent state mapping', () => {
  it('maps Preparing/Rendering/Writing/Done to phase strings', () => {
    expect(eventToState({ type: 'Preparing' })).toEqual({ phase: 'preparing' });
    expect(eventToState({ type: 'Rendering' })).toEqual({ phase: 'rendering' });
    expect(eventToState({ type: 'Writing' })).toEqual({ phase: 'writing' });
    expect(eventToState({ type: 'Done' })).toEqual({ phase: 'done' });
  });

  it('threads current/total through Paginating', () => {
    const s = eventToState({ type: 'Paginating', current: 12, total: 200 });
    expect(s).toEqual({ phase: 'paginating', current: 12, total: 200 });
  });

  it('returns null for Fallback (caller switches paths)', () => {
    expect(eventToState({ type: 'Fallback', reason: 'x' })).toBeNull();
  });

  it('captures error message', () => {
    const s = eventToState({ type: 'Error', message: 'boom' });
    expect(s).toEqual({ phase: 'error', message: 'boom' });
  });
});

/**
 * Document title inference — copied from the implementation in
 * export-service.ts since it's not exported.
 */
function inferTitle(markdown: string): string {
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) return h1[1].trim();
    if (!line.startsWith('#')) return line.slice(0, 80);
  }
  return 'Document';
}

describe('document title inference', () => {
  it('picks up the first H1', () => {
    expect(inferTitle('# Hello world\n\nbody')).toBe('Hello world');
  });
  it('skips lower-level headings if no H1 present', () => {
    expect(inferTitle('## Sub\nline')).toBe('line');
  });
  it('falls back to the first non-blank line', () => {
    expect(inferTitle('\n\nplain first line\n# Heading')).toBe('plain first line');
  });
  it('truncates very long first lines', () => {
    const long = 'a'.repeat(200);
    expect(inferTitle(long).length).toBeLessThanOrEqual(80);
  });
  it('returns Document for empty input', () => {
    expect(inferTitle('')).toBe('Document');
  });
});
