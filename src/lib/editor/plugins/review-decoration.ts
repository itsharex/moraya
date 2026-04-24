/**
 * Review anchor highlight decoration plugin.
 *
 * Data flow:
 *   reviewStore (Svelte writable)
 *       ↓  subscribe → dispatch meta transaction
 *   plugin state (PluginKey)
 *       ↓
 *   DecorationSet  (inline decorations)
 *       ↓
 *   ProseMirror rendering
 *
 * The plugin subscribes to reviewStore in its `view()` lifecycle method.
 * When the store changes it dispatches a `review-update` meta transaction
 * so the plugin state can be updated synchronously inside ProseMirror.
 *
 * anchor positions (from/to) in ResolvedReview are **plain-text character
 * offsets** produced by resolveAnchors(). This plugin maps them to ProseMirror
 * positions by walking doc.textContent and collecting block node offsets.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { DecorationSet, Decoration } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PmNode } from 'prosemirror-model';
import { reviewStore } from '$lib/services/review/review-store';
import type { ResolvedReview } from '$lib/services/review/types';

// ── Plugin key ────────────────────────────────────────────────────

export const reviewDecorationKey = new PluginKey<DecorationSet>('review-decoration');

// ── Text-offset → ProseMirror position mapping ────────────────────

/**
 * Build a mapping from plain-text character offsets to ProseMirror positions.
 *
 * We walk all leaf text nodes, tracking how many text chars have been seen.
 * Returns an array of { textStart, pmStart } pairs (one per text run).
 *
 * The mapping is linear in doc size — computed once per decoration rebuild.
 */
function buildTextOffsetMap(doc: PmNode): Array<{ textStart: number; pmStart: number }> {
  const map: Array<{ textStart: number; pmStart: number }> = [];
  let textPos = 0;

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      map.push({ textStart: textPos, pmStart: pos });
      textPos += node.text.length;
    } else if (node.isBlock && !node.isLeaf && map.length > 0) {
      // Block boundary adds a newline to textContent
      textPos += 1;
    }
    return true; // recurse
  });

  return map;
}

/**
 * Convert a plain-text offset to the nearest ProseMirror position using
 * the pre-built offset map.  Returns -1 if the offset is out of range.
 */
function textOffsetToPmPos(
  map: Array<{ textStart: number; pmStart: number }>,
  offset: number,
  docSize: number,
): number {
  if (offset <= 0) return 1;
  if (offset >= docSize) return docSize;

  // Find the text run that contains `offset`
  for (let i = map.length - 1; i >= 0; i--) {
    if (map[i].textStart <= offset) {
      return map[i].pmStart + (offset - map[i].textStart);
    }
  }
  return 1;
}

// ── Decoration builder ────────────────────────────────────────────

const DECORATION_CLASSES: Record<string, string> = {
  exact: 'review-highlight-open',
  relocated: 'review-highlight-relocated',
};

function buildDecorations(
  state: EditorState,
  reviews: ResolvedReview[],
): DecorationSet {
  const decos: Decoration[] = [];
  const map = buildTextOffsetMap(state.doc);
  const docSize = state.doc.content.size;

  for (const review of reviews) {
    if (review.status === 'resolved' || review.status === 'wontfix') continue;
    if (review.anchorState === 'unanchored') continue;

    const cls = DECORATION_CLASSES[review.anchorState];
    if (!cls) continue;

    const from = textOffsetToPmPos(map, review.from, docSize);
    const to = textOffsetToPmPos(map, review.to, docSize);

    if (from >= to || from < 0) continue;

    decos.push(
      Decoration.inline(from, Math.min(to, docSize), {
        class: cls,
        'data-review-id': review.id,
        title: `@${review.author}: ${review.comments[0]?.text ?? ''}`,
      }),
    );

    // Add a small ⚠ widget after relocated anchors
    if (review.anchorState === 'relocated') {
      decos.push(
        Decoration.widget(to, () => {
          const span = document.createElement('span');
          span.className = 'review-relocated-badge';
          span.textContent = '⚠';
          span.title = 'Anchor position has shifted';
          return span;
        }, { side: 1 }),
      );
    }
  }

  return decos.length > 0
    ? DecorationSet.create(state.doc, decos)
    : DecorationSet.empty;
}

// ── Plugin factory ────────────────────────────────────────────────

export function createReviewDecorationPlugin(): Plugin {
  return new Plugin<DecorationSet>({
    key: reviewDecorationKey,

    state: {
      init(_config, state): DecorationSet {
        return DecorationSet.empty;
      },

      apply(tr: Transaction, old: DecorationSet, _oldState: EditorState, newState: EditorState): DecorationSet {
        // File switch → clear decorations
        if (tr.getMeta('file-switch')) {
          return DecorationSet.empty;
        }

        // Review store update → rebuild decorations
        const reviews = tr.getMeta('review-update') as ResolvedReview[] | undefined;
        if (reviews !== undefined) {
          return buildDecorations(newState, reviews);
        }

        // Doc change → remap existing decorations
        if (tr.docChanged) {
          return old.map(tr.mapping, newState.doc);
        }

        return old;
      },
    },

    props: {
      decorations(state): DecorationSet {
        return reviewDecorationKey.getState(state) ?? DecorationSet.empty;
      },

      handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
        // If the user clicks on a review highlight, notify the store
        const target = event.target as HTMLElement;
        const reviewId = target.dataset?.reviewId
          ?? target.closest('[data-review-id]')?.getAttribute('data-review-id');
        if (reviewId) {
          reviewStore.setActive(reviewId);
          return false; // Don't consume the click
        }
        return false;
      },
    },

    view(editorView: EditorView) {
      // Subscribe to reviewStore and push updates via meta transaction
      const unsub = reviewStore.subscribe((storeState) => {
        const tr = editorView.state.tr.setMeta('review-update', storeState.reviews);
        editorView.dispatch(tr);
      });

      return {
        destroy() {
          unsub();
        },
      };
    },
  });
}
