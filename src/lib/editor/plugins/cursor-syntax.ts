import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { MarkType } from 'prosemirror-model';

const pluginKey = new PluginKey('cursor-syntax');

const HEADING_PREFIX: Record<number, string> = {
  1: '# ',
  2: '## ',
  3: '### ',
  4: '#### ',
  5: '##### ',
  6: '###### ',
};

const MARK_DELIMITERS: Record<string, { open: string; close: string }> = {
  strong: { open: '**', close: '**' },
  em: { open: '*', close: '*' },
  code: { open: '`', close: '`' },
  strike_through: { open: '~~', close: '~~' },
};

function makeWidget(text: string, className: string): () => HTMLSpanElement {
  return () => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  };
}

/**
 * Find the contiguous range of `markType` in the current textblock that contains `pos`.
 * Returns absolute document positions {from, to}, or null if cursor is not inside that mark.
 */
function getMarkRange(
  state: EditorState,
  pos: number,
  markType: MarkType
): { from: number; to: number } | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;

  const base = $pos.start(); // absolute position of parent content start
  const runs: Array<{ from: number; to: number }> = [];
  let runFrom = -1;
  let nodePos = base;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childEnd = nodePos + child.nodeSize;

    if (markType.isInSet(child.marks)) {
      if (runFrom === -1) runFrom = nodePos;
    } else {
      if (runFrom !== -1) {
        runs.push({ from: runFrom, to: nodePos });
        runFrom = -1;
      }
    }
    nodePos = childEnd;
  }
  if (runFrom !== -1) runs.push({ from: runFrom, to: nodePos });

  return runs.find(r => pos >= r.from && pos <= r.to) ?? null;
}

function buildDecorations(state: EditorState): DecorationSet {
  const { selection } = state;
  // Only show decorations when cursor is a single collapsed point (no selection)
  if (!selection.empty) return DecorationSet.empty;

  const $from = selection.$from;
  const decorations: Decoration[] = [];
  const pos = $from.pos;
  const depth = $from.depth;
  const parent = $from.parent;

  // 1. Block-level: heading prefix
  if (parent.type === state.schema.nodes.heading) {
    const level = parent.attrs.level as number;
    const prefix = HEADING_PREFIX[level] ?? '# ';
    const contentStart = $from.start(depth);
    decorations.push(
      Decoration.widget(contentStart, makeWidget(prefix, 'syntax-md-prefix'), {
        side: -1,
        key: 'heading-prefix',
      })
    );
  }

  // 2. Block-level: blockquote prefix at start of current paragraph
  for (let d = depth - 1; d >= 1; d--) {
    if ($from.node(d).type === state.schema.nodes.blockquote) {
      const contentStart = $from.start(depth);
      decorations.push(
        Decoration.widget(contentStart, makeWidget('> ', 'syntax-md-prefix'), {
          side: -1,
          key: 'bq-prefix',
        })
      );
      break;
    }
  }

  // 3. Inline marks: strong, em, code, strike_through
  for (const [markName, delim] of Object.entries(MARK_DELIMITERS)) {
    const markType = state.schema.marks[markName];
    if (!markType) continue;

    const range = getMarkRange(state, pos, markType);
    if (!range) continue;

    decorations.push(
      Decoration.widget(range.from, makeWidget(delim.open, 'syntax-md-mark'), {
        side: -1,
        key: `${markName}-open`,
      }),
      Decoration.widget(range.to, makeWidget(delim.close, 'syntax-md-mark'), {
        side: 1,
        key: `${markName}-close`,
      })
    );
  }

  // 4. Link mark: show '[' at start and '](href)' at end
  const linkType = state.schema.marks.link;
  if (linkType) {
    const range = getMarkRange(state, pos, linkType);
    if (range) {
      // Read href from the first link-marked inline child within the range
      let href = '';
      const base = $from.start();
      $from.parent.forEach((child, offset) => {
        if (href) return;
        const childStart = base + offset;
        if (childStart >= range.from && childStart < range.to) {
          const lm = child.marks.find(m => m.type === linkType);
          if (lm) href = (lm.attrs.href as string) ?? '';
        }
      });

      decorations.push(
        Decoration.widget(range.from, makeWidget('[', 'syntax-md-mark'), {
          side: -1,
          key: 'link-open',
        }),
        Decoration.widget(range.to, makeWidget(`](${href})`, 'syntax-md-mark'), {
          side: 1,
          key: 'link-close',
        })
      );
    }
  }

  return DecorationSet.create(state.doc, decorations);
}

export function createCursorSyntaxPlugin(): Plugin {
  return new Plugin({
    key: pluginKey,
    state: {
      init(_, state) {
        return buildDecorations(state);
      },
      apply(tr, old, _, newState) {
        // Only recompute when selection or document changes
        if (!tr.selectionSet && !tr.docChanged) return old;
        return buildDecorations(newState);
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
