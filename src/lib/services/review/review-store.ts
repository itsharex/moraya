/**
 * Review store — manages the review state for the currently open document.
 *
 * Data flow:
 *  1. loadForFile()  → read sidecar JSON → resolveAnchors() → update store
 *  2. refresh()      → re-run resolveAnchors() with fresh doc text → update store
 *  3. addReview()    → add to store + persist unanchored items back to JSON
 *  4. updateReview() → patch in store + persist
 *
 * The store's `reviews` array contains ResolvedReview objects (with anchorState,
 * from, to) that are used directly by the Decoration plugin.
 */

import { writable, get } from 'svelte/store';
import type { Review, ResolvedReview } from './types';
import { loadReviews, saveReviews, resolveAnchors } from './review-service';

// ── State shape ───────────────────────────────────────────────────

interface ReviewStoreState {
  reviews: ResolvedReview[];
  activeReviewId: string | null;
  loading: boolean;
  /** Current KB root — needed for save operations. */
  kbRoot: string | null;
  /** Current document relative path — needed for save operations. */
  relPath: string | null;
  /** Current document plain text — needed for anchor re-resolution. */
  docText: string;
}

const initialState: ReviewStoreState = {
  reviews: [],
  activeReviewId: null,
  loading: false,
  kbRoot: null,
  relPath: null,
  docText: '',
};

// ── Internal helpers ──────────────────────────────────────────────

const { subscribe, set, update } = writable<ReviewStoreState>(initialState);

/** Throttle timer for writing unanchored reviews back to disk (500ms). */
let unanchoredWriteTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persist reviews that just became 'unanchored' back to the sidecar JSON.
 * Throttled to avoid excessive IO on every keystroke.
 */
function scheduleUnanchoredWrite(kbRoot: string, relPath: string, reviews: ResolvedReview[]): void {
  if (unanchoredWriteTimer) clearTimeout(unanchoredWriteTimer);
  unanchoredWriteTimer = setTimeout(async () => {
    unanchoredWriteTimer = null;
    // Only update status for reviews that the resolveAnchors() demoted to unanchored
    const current = get({ subscribe });
    if (!current.kbRoot || !current.relPath) return;

    const existingFile = await loadReviews(kbRoot, relPath);
    if (!existingFile) return;

    let changed = false;
    const updatedReviews = existingFile.reviews.map(r => {
      const resolved = reviews.find(rr => rr.id === r.id);
      if (resolved && resolved.anchorState === 'unanchored' && r.status === 'open') {
        changed = true;
        return { ...r, status: 'unanchored' as const };
      }
      return r;
    });

    if (changed) {
      await saveReviews(kbRoot, relPath, { ...existingFile, reviews: updatedReviews });
    }
  }, 500);
}

// ── Exported store ────────────────────────────────────────────────

export const reviewStore = {
  subscribe,

  /**
   * Load reviews for the given file and run anchor resolution.
   * @param docText Plain text content of the current document
   */
  async loadForFile(kbRoot: string, relPath: string, docText: string): Promise<void> {
    update(s => ({ ...s, loading: true, kbRoot, relPath, docText }));

    try {
      const file = await loadReviews(kbRoot, relPath);
      const rawReviews: Review[] = file?.reviews ?? [];
      const resolved = resolveAnchors(docText, rawReviews);

      update(s => ({ ...s, reviews: resolved, loading: false }));

      // Persist any newly-unanchored reviews back to disk
      const nowUnanchored = resolved.filter(r => r.anchorState === 'unanchored' && r.status === 'open');
      if (nowUnanchored.length > 0) {
        scheduleUnanchoredWrite(kbRoot, relPath, resolved);
      }
    } catch {
      update(s => ({ ...s, loading: false }));
    }
  },

  /**
   * Clear the store (called on file switch).
   */
  unload(): void {
    if (unanchoredWriteTimer) {
      clearTimeout(unanchoredWriteTimer);
      unanchoredWriteTimer = null;
    }
    set(initialState);
  },

  /**
   * Set the active (focused) review in the panel.
   */
  setActive(id: string | null): void {
    update(s => ({ ...s, activeReviewId: id }));
  },

  /**
   * Add a newly created review and persist to disk.
   */
  async addReview(review: Review): Promise<void> {
    const state = get({ subscribe });
    if (!state.kbRoot || !state.relPath) return;

    const resolved = resolveAnchors(state.docText, [review]);
    const resolvedReview = resolved[0];

    update(s => ({ ...s, reviews: [...s.reviews, resolvedReview] }));

    // Persist
    const existing = await loadReviews(state.kbRoot, state.relPath);
    const file = existing ?? { version: 1 as const, documentPath: state.relPath, reviews: [] };
    await saveReviews(state.kbRoot, state.relPath, {
      ...file,
      reviews: [...file.reviews, review],
    });
  },

  /**
   * Update a review by id (e.g. after resolving, adding a comment).
   * Patches both in-store and persists to disk.
   */
  async updateReview(id: string, patch: Partial<Review>): Promise<void> {
    const state = get({ subscribe });
    if (!state.kbRoot || !state.relPath) return;

    // Update in store
    update(s => ({
      ...s,
      reviews: s.reviews.map(r =>
        r.id === id ? { ...r, ...patch } : r
      ),
    }));

    // Persist
    const existing = await loadReviews(state.kbRoot, state.relPath);
    if (!existing) return;
    const updatedReviews = existing.reviews.map(r =>
      r.id === id ? { ...r, ...patch } : r
    );
    await saveReviews(state.kbRoot, state.relPath, { ...existing, reviews: updatedReviews });
  },

  /**
   * Re-run anchor resolution after the document text changes.
   * Called by the editor on document change (debounced 300ms in the caller).
   */
  refresh(docText: string): void {
    update(s => {
      if (s.reviews.length === 0) return { ...s, docText };

      // Re-resolve against fresh doc text
      const rawReviews: Review[] = s.reviews.map(r => {
        // Strip in-memory fields to get back to the stored shape
        const { anchorState: _a, from: _f, to: _t, ...raw } = r as ResolvedReview & { anchorState: unknown; from: unknown; to: unknown };
        void _a; void _f; void _t;
        return raw as Review;
      });
      const resolved = resolveAnchors(docText, rawReviews);

      // Schedule write-back for any newly-unanchored reviews
      const nowUnanchored = resolved.filter(r => r.anchorState === 'unanchored' && r.status === 'open');
      if (nowUnanchored.length > 0 && s.kbRoot && s.relPath) {
        scheduleUnanchoredWrite(s.kbRoot, s.relPath, resolved);
      }

      return { ...s, reviews: resolved, docText };
    });
  },

  /**
   * Mark a review's lastVerifiedCommit = HEAD (user confirmed "already reviewed").
   */
  async markVerified(id: string, headCommit: string): Promise<void> {
    return reviewStore.updateReview(id, { lastVerifiedCommit: headCommit });
  },
};
