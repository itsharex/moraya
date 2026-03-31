<script lang="ts">
  import { t } from '$lib/i18n';

  export interface OutlineHeading {
    id: string;
    level: number;
    text: string;
    html?: string;
  }

  const OUTLINE_MIN_WIDTH = 120;
  const OUTLINE_MAX_WIDTH = 400;

  let {
    headings = [],
    activeId = null,
    width = 200,
    onSelect,
    onWidthChange,
  }: {
    headings?: OutlineHeading[];
    activeId?: string | null;
    width?: number;
    onSelect?: (heading: OutlineHeading) => void;
    onWidthChange?: (width: number) => void;
  } = $props();

  let dragging = $state(false);

  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    dragging = true;
    const startX = e.clientX;
    const startW = width;
    const isRtl = document.documentElement.dir === 'rtl';
    // Prevent text selection in editor during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    function onPointerMove(ev: PointerEvent) {
      const delta = ev.clientX - startX;
      const newW = Math.round(
        Math.min(OUTLINE_MAX_WIDTH, Math.max(OUTLINE_MIN_WIDTH, startW + (isRtl ? -delta : delta))),
      );
      onWidthChange?.(newW);
    }

    function onPointerUp() {
      dragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="outline-wrapper" class:dragging style="width: {width}px">
  <nav class="outline-scroll">
    {#if headings.length === 0}
      <span class="outline-empty">{$t('outline.empty')}</span>
    {:else}
      {#each headings as h}
        <button
          class="outline-item"
          class:active={h.id === activeId}
          style="padding-inline-start: {(h.level - 1) * 12}px"
          onclick={() => onSelect?.(h)}
          title={h.text}
        >
          {#if h.html}
            {@html h.html}
          {:else}
            {h.text}
          {/if}
        </button>
      {/each}
    {/if}
  </nav>
  <div class="resize-handle" onpointerdown={onPointerDown}></div>
</div>

<style>
  /* Outer wrapper: sticky positioning + holds resize handle */
  .outline-wrapper {
    position: sticky;
    top: 0;
    flex-shrink: 0;
    align-self: flex-start;
    height: calc(100vh - var(--titlebar-height) - var(--statusbar-height) - 4rem);
  }

  /* Inner scrollable area */
  .outline-scroll {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 8px;
    scrollbar-width: none;
  }

  .outline-scroll::-webkit-scrollbar {
    display: none;
  }

  .outline-empty {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  .outline-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    padding: 2px 4px;
    font-size: var(--font-size-xs);
    line-height: 1.6;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.15s;
  }

  .outline-item :global(.katex) {
    font-size: inherit;
  }

  .outline-item:hover {
    color: var(--text-primary);
  }

  .outline-item.active {
    color: var(--text-primary);
    border-left-color: var(--accent-color);
  }

  /* Resize handle — right edge, full height, outside scroll */
  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    height: 100%;
    cursor: col-resize;
    z-index: 1;
  }

  .resize-handle:hover,
  .dragging .resize-handle {
    background: var(--accent-color);
    opacity: 0.4;
  }

  .outline-wrapper.dragging {
    user-select: none;
  }

  /* RTL overrides */
  :global([dir="rtl"]) .outline-scroll {
    padding-right: 0;
    padding-left: 8px;
  }

  :global([dir="rtl"]) .resize-handle {
    right: auto;
    left: 0;
  }

  :global([dir="rtl"]) .outline-item {
    text-align: right;
    border-left: none;
    border-right: 2px solid transparent;
  }

  :global([dir="rtl"]) .outline-item.active {
    border-left-color: transparent;
    border-right-color: var(--accent-color);
  }
</style>
