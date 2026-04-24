/**
 * Review service — sidecar JSON CRUD, anchor resolution (3-layer), and
 * pure-function helpers for creating/updating reviews.
 *
 * All file I/O goes through Tauri IPC (read_file / write_file / create_dir).
 * The resolveAnchors() function is pure TypeScript (no Tauri calls) and can
 * be tested without a Tauri runtime.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  Review,
  ReviewFile,
  ReviewAnchor,
  ReviewComment,
  ResolvedReview,
  AnchorState,
} from './types';

// ── Path helpers ──────────────────────────────────────────────────

/**
 * Compute the sidecar JSON path for a document.
 *
 * @param kbRoot    Absolute path to the knowledge base root directory
 * @param relPath   Document path relative to kbRoot (e.g. "article.md" or "subdir/note.md")
 * @returns Absolute path to the sidecar file
 */
export function sidecarPath(kbRoot: string, relPath: string): string {
  // Normalise separators (Windows paths may use backslash)
  const root = kbRoot.replace(/\\/g, '/').replace(/\/$/, '');
  const rel = relPath.replace(/\\/g, '/').replace(/^\//, '');
  return `${root}/.moraya/reviews/${rel}.reviews.json`;
}

/**
 * Compute the parent directory of the sidecar JSON file.
 * Used to call create_dir before the first write.
 */
function sidecarDir(kbRoot: string, relPath: string): string {
  const full = sidecarPath(kbRoot, relPath);
  const lastSlash = full.lastIndexOf('/');
  return full.substring(0, lastSlash);
}

// ── I/O ───────────────────────────────────────────────────────────

/**
 * Load the sidecar review file for a document.
 * Returns null if the file does not exist yet.
 */
export async function loadReviews(
  kbRoot: string,
  relPath: string,
): Promise<ReviewFile | null> {
  const path = sidecarPath(kbRoot, relPath);
  try {
    const raw = await invoke<string>('read_file', { path });
    return JSON.parse(raw) as ReviewFile;
  } catch {
    // File not found or parse error → treat as no reviews yet
    return null;
  }
}

/**
 * Persist the review file to disk.
 * Ensures the `.moraya/reviews/` directory hierarchy exists before writing.
 */
export async function saveReviews(
  kbRoot: string,
  relPath: string,
  data: ReviewFile,
): Promise<void> {
  const dir = sidecarDir(kbRoot, relPath);
  // create_dir is idempotent; safe to call every time
  await invoke('create_dir', { path: dir });
  const path = sidecarPath(kbRoot, relPath);
  await invoke('write_file', { path, content: JSON.stringify(data, null, 2) });
}

// ── Pure CRUD helpers ─────────────────────────────────────────────

/** Generate an id with the given prefix using the first 8 hex chars of a UUID. */
function genId(prefix: 'r' | 'c'): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * Create a new Review object (does NOT save to disk).
 * The caller is responsible for calling saveReviews() afterwards.
 */
export function createReview(
  author: string,
  authorEmail: string,
  anchor: ReviewAnchor,
  commentText: string,
): Review {
  const now = new Date().toISOString();
  const comment: ReviewComment = {
    id: genId('c'),
    author,
    authorEmail,
    text: commentText,
    createdAt: now,
  };
  return {
    id: genId('r'),
    author,
    authorEmail,
    createdAt: now,
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
    lastVerifiedCommit: anchor.commitHash,
    anchor,
    comments: [comment],
  };
}

/**
 * Create a new reply comment (does NOT save to disk).
 */
export function addComment(
  review: Review,
  author: string,
  authorEmail: string,
  text: string,
): ReviewComment {
  return {
    id: genId('c'),
    author,
    authorEmail,
    text,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Return a new Review with status = 'resolved'.
 * Does NOT mutate the original.
 */
export function resolveReview(review: Review, resolvedBy: string): Review {
  return {
    ...review,
    status: 'resolved',
    resolvedAt: new Date().toISOString(),
    resolvedBy,
  };
}

/**
 * Return a new Review with status = 'wontfix'.
 * Does NOT mutate the original.
 */
export function wontfixReview(review: Review, resolvedBy: string): Review {
  return {
    ...review,
    status: 'wontfix',
    resolvedAt: new Date().toISOString(),
    resolvedBy,
  };
}

/**
 * Return a new Review with updated anchor and status = 'open'.
 * Used after the user manually re-anchors a displaced review.
 */
export function reanchorReview(review: Review, newAnchor: ReviewAnchor): Review {
  return {
    ...review,
    status: 'open',
    anchor: newAnchor,
    lastVerifiedCommit: newAnchor.commitHash,
  };
}

// ── Levenshtein distance ──────────────────────────────────────────

/** Classic Levenshtein edit distance (O(m*n)). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Two-row rolling array for O(min(m,n)) space
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
    // reuse tmp as next curr
    void tmp;
  }
  return prev[n];
}

/** Similarity in [0, 1]: 1 - distance / maxLen. */
function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}

// ── Three-layer anchor resolution ────────────────────────────────

const LAYER2_SIMILARITY_THRESHOLD = 0.7;
const LAYER2_WINDOW = 200;   // chars on each side of contextBefore match
const LAYER2_LEN_TOLERANCE = 10; // ±chars in substring length

/**
 * Resolve the ProseMirror positions (from, to) for a `markedText` match in
 * the plain-text document. Returns { from, to } in plain-text character
 * offsets (NOT ProseMirror positions — caller must map via `mapTextOffset`).
 *
 * Returns null if no match is found at the given offset.
 */
function findInDoc(
  docText: string,
  needle: string,
  startOffset = 0,
): { from: number; to: number } | null {
  const idx = docText.indexOf(needle, startOffset);
  if (idx === -1) return null;
  return { from: idx, to: idx + needle.length };
}

/**
 * Among all occurrences of `needle` in `docText`, return the one whose
 * start position is closest to `targetOffset`.
 */
function findClosest(
  docText: string,
  needle: string,
  targetOffset: number,
): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null;
  let bestDist = Infinity;
  let pos = 0;
  while (true) {
    const idx = docText.indexOf(needle, pos);
    if (idx === -1) break;
    const dist = Math.abs(idx - targetOffset);
    if (dist < bestDist) {
      bestDist = dist;
      best = { from: idx, to: idx + needle.length };
    }
    pos = idx + 1;
  }
  return best;
}

/**
 * Count how many occurrences of `needle` exist in `haystack`.
 */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    count++;
    pos = idx + 1;
  }
  return count;
}

/**
 * Approximate the character offset of a line number (1-based) in plain text.
 */
function lineToOffset(docText: string, line: number): number {
  let lineNum = 1;
  for (let i = 0; i < docText.length; i++) {
    if (lineNum === line) return i;
    if (docText[i] === '\n') lineNum++;
  }
  return docText.length;
}

/**
 * Map a plain-text character offset to a ProseMirror document position.
 *
 * ProseMirror interleaves structural tokens between text characters.
 * We walk the document and track how many text chars we've seen.
 * When we reach the target, we return the current ProseMirror pos.
 *
 * Returns -1 if the offset exceeds the document text length.
 */
export function mapTextOffsetToPMPos(docText: string, offset: number, pmDocSize: number): number {
  // Simple approximation: PM positions and text chars don't align perfectly,
  // but for typical Markdown documents the ratio is close to 1:1 plus structure
  // tokens (~1 per block). We use a direct string-search on textContent.
  // The decoration plugin will use view.state.doc.textContent directly.
  // This function provides a best-effort mapping.
  if (offset < 0) return 1;
  if (offset >= docText.length) return pmDocSize;
  // Map text-offset → PM pos via simple char counting through textContent
  // (sufficient for single-block documents). Multi-block docs are handled
  // in review-decoration.ts via full doc traversal.
  return offset + 1; // +1 because PM positions start at 1
}

/**
 * Three-layer anchor resolution for a set of reviews against current doc text.
 *
 * Returns ResolvedReview[] with in-memory anchorState + estimated from/to.
 * Reviews with status 'resolved' or 'wontfix' get anchorState='exact' and
 * from=to=0 (they are not highlighted).
 *
 * ⚠ The from/to values are plain-text character offsets (NOT ProseMirror
 * positions). The Decoration plugin must translate them using the actual PM
 * document structure.
 */
export function resolveAnchors(docText: string, reviews: Review[]): ResolvedReview[] {
  return reviews.map((review) => {
    // Already-closed reviews need no anchor resolution
    if (review.status === 'resolved' || review.status === 'wontfix') {
      return { ...review, anchorState: 'exact' as AnchorState, from: 0, to: 0 };
    }

    const { markedText, contextBefore, originalLine } = review.anchor;
    const approxOffset = lineToOffset(docText, originalLine);

    // ── Layer 1: Exact match ───────────────────────────────────────
    const occurrences = countOccurrences(docText, markedText);
    if (occurrences === 1) {
      const match = findInDoc(docText, markedText);
      if (match) {
        return { ...review, anchorState: 'exact' as AnchorState, from: match.from, to: match.to };
      }
    } else if (occurrences > 1) {
      // Multiple hits → pick the one closest to originalLine
      const match = findClosest(docText, markedText, approxOffset);
      if (match) {
        return { ...review, anchorState: 'exact' as AnchorState, from: match.from, to: match.to };
      }
    }

    // ── Layer 2: Context fuzzy match ──────────────────────────────
    const ctxIdx = contextBefore ? docText.indexOf(contextBefore) : -1;
    if (ctxIdx !== -1) {
      const windowStart = Math.max(0, ctxIdx - LAYER2_WINDOW);
      const windowEnd = Math.min(docText.length, ctxIdx + contextBefore.length + LAYER2_WINDOW);
      const window = docText.slice(windowStart, windowEnd);

      const targetLen = markedText.length;
      let bestSim = 0;
      let bestFrom = -1;
      let bestTo = -1;

      for (let i = 0; i <= window.length; i++) {
        for (let len = Math.max(1, targetLen - LAYER2_LEN_TOLERANCE);
          len <= targetLen + LAYER2_LEN_TOLERANCE && i + len <= window.length;
          len++) {
          const candidate = window.slice(i, i + len);
          const sim = similarity(candidate, markedText);
          if (sim > bestSim) {
            bestSim = sim;
            bestFrom = windowStart + i;
            bestTo = windowStart + i + len;
          }
        }
      }

      if (bestSim > LAYER2_SIMILARITY_THRESHOLD) {
        return {
          ...review,
          anchorState: 'relocated' as AnchorState,
          from: bestFrom,
          to: bestTo,
        };
      }
    }

    // ── Layer 3: Unanchored ───────────────────────────────────────
    return { ...review, anchorState: 'unanchored' as AnchorState, from: 0, to: 0 };
  });
}
