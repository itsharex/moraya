import { writable } from 'svelte/store';

/**
 * v0.60.x — File-load progress, shown in the bottom StatusBar.
 *
 * For very large markdown files (10MB+) the user-visible delay is dominated
 * by markdown-it parsing + ProseMirror Doc construction + initial DOM
 * render. The whole pipeline can take 10s+ during which the editor area is
 * blank. Without a status indicator the user can't tell the app from a
 * frozen one.
 *
 * The store only emits `loading` when a non-trivial file is being applied
 * (size threshold matches the async-parse threshold in Editor.svelte).
 * Tiny files complete fast enough that an indicator would just flash.
 */

export type LoadingPhase = 'idle' | 'parsing' | 'rendering';

export interface EditorLoadingState {
  phase: LoadingPhase;
  /** Approx file size in KB (rounded). Useful for the status pill text. */
  sizeKB?: number;
}

const initial: EditorLoadingState = { phase: 'idle' };

const internal = writable<EditorLoadingState>(initial);

/** Files smaller than this don't get an indicator (parse is sub-50ms). */
const SIZE_THRESHOLD_BYTES = 50_000;

export const editorLoadingStore = {
  subscribe: internal.subscribe,
  /**
   * Mark a file load as starting. Returns true if the indicator was shown
   * (caller should call `finish()` later); false if the file is small
   * enough that no indicator is needed.
   */
  startIfLarge(byteLength: number): boolean {
    if (byteLength < SIZE_THRESHOLD_BYTES) return false;
    internal.set({ phase: 'parsing', sizeKB: Math.round(byteLength / 1024) });
    return true;
  },
  setPhase(phase: LoadingPhase): void {
    internal.update((s) => ({ ...s, phase }));
  },
  finish(): void {
    internal.set(initial);
  },
};
