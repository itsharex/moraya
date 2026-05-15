import { writable, derived } from 'svelte/store';

/**
 * v0.60.0 — PDF export progress, visible in the bottom StatusBar.
 *
 * The store is updated by `pdf-export-native.ts` while the native path runs
 * and by `export-service.ts` while the canvas fallback runs. StatusBar
 * subscribes to render a small progress pill that auto-clears 2s after a
 * Done event.
 */

export type ExportPhase =
  | 'idle'
  | 'preparing'
  | 'rendering'
  | 'paginating'
  | 'writing'
  | 'done'
  | 'error';

export interface ExportProgressState {
  /** Current phase. `idle` hides the StatusBar pill. */
  phase: ExportPhase;
  /** Current page during paginating (canvas fallback only). */
  current?: number;
  /** Total pages during paginating. */
  total?: number;
  /** True when the canvas fallback path is engaged. */
  fallback: boolean;
  /** Error message for `phase === 'error'`. */
  message?: string;
}

const initial: ExportProgressState = {
  phase: 'idle',
  fallback: false,
};

const internal = writable<ExportProgressState>(initial);

let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoHide(): void {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
}

function scheduleAutoHide(): void {
  clearAutoHide();
  autoHideTimer = setTimeout(() => {
    internal.set(initial);
    autoHideTimer = null;
  }, 2000);
}

export const exportProgressStore = {
  subscribe: internal.subscribe,
  reset(): void {
    clearAutoHide();
    internal.set(initial);
  },
  start(): void {
    clearAutoHide();
    internal.set({ phase: 'preparing', fallback: false });
  },
  setPhase(phase: ExportPhase): void {
    internal.update((s) => ({ ...s, phase }));
  },
  setPaginating(current: number, total: number): void {
    internal.update((s) => ({ ...s, phase: 'paginating', current, total }));
  },
  fallback(): void {
    internal.update((s) => ({ ...s, fallback: true }));
  },
  done(): void {
    internal.update((s) => ({ ...s, phase: 'done' }));
    scheduleAutoHide();
  },
  error(message: string): void {
    internal.set({ phase: 'error', fallback: false, message });
    scheduleAutoHide();
  },
};

/** True iff a non-idle phase is active. Useful for `{#if active}` blocks. */
export const isExportActive = derived(
  internal,
  ($s) => $s.phase !== 'idle',
);
