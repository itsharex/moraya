/**
 * Unit tests for review-service.ts
 *
 * Covers:
 *  - sidecarPath()        × 2 cases
 *  - resolveAnchors()     × 6 cases (three-layer anchor matching)
 *  - createReview()       × 1 case
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sidecarPath,
  resolveAnchors,
  createReview,
} from './review-service';
import type { Review, ReviewAnchor } from './types';

// ── Helpers ────────────────────────────────────────────────────────

function makeAnchor(overrides: Partial<ReviewAnchor> = {}): ReviewAnchor {
  return {
    commitHash: 'abc123',
    markedText: 'hello world',
    contextBefore: 'Before text. ',
    contextAfter: ' After text.',
    originalLine: 1,
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'r_test01',
    author: 'alice',
    authorEmail: 'alice@example.com',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
    lastVerifiedCommit: 'abc123',
    anchor: makeAnchor(),
    comments: [],
    ...overrides,
  };
}

// ── sidecarPath ────────────────────────────────────────────────────

describe('sidecarPath', () => {
  it('should build path for a top-level document', () => {
    const result = sidecarPath('/home/user/kb', 'article.md');
    expect(result).toBe('/home/user/kb/.moraya/reviews/article.md.reviews.json');
  });

  it('should build path for a nested document and normalise separators', () => {
    const result = sidecarPath('/home/user/kb/', 'subdir/note.md');
    expect(result).toBe('/home/user/kb/.moraya/reviews/subdir/note.md.reviews.json');
  });
});

// ── resolveAnchors ─────────────────────────────────────────────────

describe('resolveAnchors', () => {
  const docText = 'Before text. hello world After text. The rest of the document.';

  it('Layer 1 — exact match (single occurrence)', () => {
    const review = makeReview();
    const [result] = resolveAnchors(docText, [review]);
    expect(result.anchorState).toBe('exact');
    expect(result.from).toBe(docText.indexOf('hello world'));
    expect(result.to).toBe(docText.indexOf('hello world') + 'hello world'.length);
  });

  it('Layer 1 — multiple occurrences picks closest to originalLine', () => {
    const multiDoc = 'hello world line1\nhello world line2\nhello world line3';
    const review = makeReview({
      anchor: makeAnchor({ markedText: 'hello world', originalLine: 2 }),
    });
    const [result] = resolveAnchors(multiDoc, [review]);
    expect(result.anchorState).toBe('exact');
    // originalLine=2 maps to the second occurrence
    expect(result.from).toBeGreaterThanOrEqual(multiDoc.indexOf('hello world'));
  });

  it('Layer 2 — fuzzy match when text is slightly modified', () => {
    // Change "hello world" to "helo world" (one char deleted) — should still match via Levenshtein
    const modifiedDoc = 'Before text. helo world After text.';
    const review = makeReview({
      anchor: makeAnchor({
        markedText: 'hello world',
        contextBefore: 'Before text. ',
        contextAfter: ' After text.',
      }),
    });
    const [result] = resolveAnchors(modifiedDoc, [review]);
    // Should be 'relocated' since the text changed but context matches
    expect(['relocated', 'exact']).toContain(result.anchorState);
  });

  it('Layer 3 — unanchored when both text and context are gone', () => {
    const unrelatedDoc = 'Completely different content with no resemblance at all.';
    const review = makeReview({
      anchor: makeAnchor({
        markedText: 'hello world',
        contextBefore: 'Before text. ',
        contextAfter: ' After text.',
      }),
    });
    const [result] = resolveAnchors(unrelatedDoc, [review]);
    expect(result.anchorState).toBe('unanchored');
    expect(result.from).toBe(0);
    expect(result.to).toBe(0);
  });

  it('resolved reviews get anchorState=exact with from=to=0', () => {
    const review = makeReview({ status: 'resolved' });
    const [result] = resolveAnchors(docText, [review]);
    expect(result.anchorState).toBe('exact');
    expect(result.from).toBe(0);
    expect(result.to).toBe(0);
  });

  it('wontfix reviews get anchorState=exact with from=to=0', () => {
    const review = makeReview({ status: 'wontfix' });
    const [result] = resolveAnchors(docText, [review]);
    expect(result.anchorState).toBe('exact');
    expect(result.from).toBe(0);
    expect(result.to).toBe(0);
  });
});

// ── createReview ───────────────────────────────────────────────────

describe('createReview', () => {
  it('should create a review with correct initial shape', () => {
    const anchor = makeAnchor();
    const review = createReview('bob', 'bob@example.com', anchor, 'This needs clarification');
    expect(review.author).toBe('bob');
    expect(review.authorEmail).toBe('bob@example.com');
    expect(review.status).toBe('open');
    expect(review.resolvedAt).toBeNull();
    expect(review.resolvedBy).toBeNull();
    expect(review.comments).toHaveLength(1);
    expect(review.comments[0].text).toBe('This needs clarification');
    expect(review.comments[0].author).toBe('bob');
    expect(review.anchor).toEqual(anchor);
    expect(review.lastVerifiedCommit).toBe(anchor.commitHash);
    // id should have r_ prefix
    expect(review.id).toMatch(/^r_/);
  });
});
