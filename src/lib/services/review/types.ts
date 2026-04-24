/**
 * Review system types — Sidecar JSON data model + in-memory state types.
 *
 * Sidecar files are stored at:
 *   {kbRoot}/.moraya/reviews/{relDocPath}.reviews.json
 *
 * The `AnchorState` and `ResolvedReview` types are in-memory only
 * and are never written to disk.
 */

// ── Core Enums ────────────────────────────────────────────────────

export type ReviewStatus =
  | 'open'        // Pending (anchor valid)
  | 'resolved'    // Author manually marked resolved
  | 'wontfix'     // Author marked won't fix
  | 'unanchored'; // Anchor lost (all 3 layers failed — written back to JSON)

/**
 * In-memory only: result of three-layer anchor matching.
 * - 'exact'      → Layer 1 hit, yellow highlight
 * - 'relocated'  → Layer 2 fuzzy hit, orange highlight (JSON status stays 'open')
 * - 'unanchored' → All layers failed, written back to JSON
 */
export type AnchorState = 'exact' | 'relocated' | 'unanchored';

// ── Stored types (persisted to sidecar JSON) ──────────────────────

export interface ReviewAnchor {
  commitHash: string;      // HEAD commit when review was created
  markedText: string;      // The selected text fragment
  contextBefore: string;   // Up to 50 chars before the anchor
  contextAfter: string;    // Up to 50 chars after the anchor
  originalLine: number;    // Approximate line number at creation time
}

export interface ReviewComment {
  id: string;
  author: string;
  authorEmail: string;
  text: string;
  createdAt: string; // ISO 8601
}

export interface Review {
  id: string;              // Prefix: 'r_' + 8-char UUID fragment
  author: string;
  authorEmail: string;
  createdAt: string;       // ISO 8601
  status: ReviewStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  lastVerifiedCommit: string; // HEAD at the time the reviewer last confirmed
  anchor: ReviewAnchor;
  comments: ReviewComment[]; // [0] = root comment (original opinion), [1+] = replies
}

export interface ReviewFile {
  version: 1;
  documentPath: string; // Relative path within the knowledge base
  reviews: Review[];
}

// ── Lock types ────────────────────────────────────────────────────

export interface Lock {
  lockedBy: string;
  lockedByEmail: string;
  lockedAt: string;    // ISO 8601
  expiresAt: string;   // ISO 8601 (lockedAt + 2 hours)
}

export interface LocksFile {
  version: 1;
  locks: Record<string, Lock>; // key: document relative path (e.g. "article.md")
}

// ── In-memory types (never persisted) ────────────────────────────

/**
 * A review enriched with anchor resolution result.
 * Produced by `resolveAnchors()` and stored in reviewStore.
 */
export interface ResolvedReview extends Review {
  anchorState: AnchorState;
  from: number; // ProseMirror document position (start of anchor)
  to: number;   // ProseMirror document position (end of anchor)
}
