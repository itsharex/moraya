<script lang="ts">
  import { onDestroy } from 'svelte';
  import { filesStore, type KnowledgeBase } from '../stores/files-store';
  import { open, ask } from '@tauri-apps/plugin-dialog';
  import { t } from '$lib/i18n';
  import { checkGitInstalled, deleteGitToken } from '$lib/services/git';
  import GitBindDialog from './GitBindDialog.svelte';
  import KbPicoraBindDialog from './KbPicoraBindDialog.svelte';
  import { kbSyncStore } from '$lib/services/kb-sync/sync-service';
  import type { KbSyncState } from '$lib/services/kb-sync/types';

  let { onClose }: { onClose: () => void } = $props();

  let knowledgeBases = $state<KnowledgeBase[]>([]);
  let editingId = $state<string | null>(null);
  let editingName = $state('');
  let editInputEl = $state<HTMLInputElement | null>(null);
  let gitAvailable = $state<boolean | null>(null);
  let bindingKb = $state<KnowledgeBase | null>(null);
  let picoraBindingKb = $state<KnowledgeBase | null>(null);
  let syncStates = $state<Map<string, KbSyncState>>(new Map());

  const unsubSync = kbSyncStore.subscribe(map => { syncStates = map; });
  onDestroy(() => { unsubSync(); });

  // Top-level store subscription — do NOT wrap in $effect().
  // Svelte 5 $effect tracks reads in subscribe callbacks, causing infinite loops.
  const unsubFiles = filesStore.subscribe(state => {
    knowledgeBases = state.knowledgeBases;
  });
  onDestroy(() => { unsubFiles(); });

  async function addKnowledgeBase() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: $t('knowledgeBase.add'),
    });

    if (selected && typeof selected === 'string') {
      // Check if already exists
      if (filesStore.findKnowledgeBaseByPath(selected)) return;

      const name = selected.split('/').pop() || selected;
      const kb: KnowledgeBase = {
        id: crypto.randomUUID(),
        name,
        path: selected,
        lastAccessedAt: Date.now(),
      };
      filesStore.addKnowledgeBase(kb);
    }
  }

  async function removeKnowledgeBase(kb: KnowledgeBase) {
    const confirmed = await ask(
      $t('knowledgeBase.deleteConfirm').replace('{name}', kb.name),
      { title: $t('knowledgeBase.remove'), kind: 'warning' }
    );
    if (confirmed) {
      filesStore.removeKnowledgeBase(kb.id);
    }
  }

  function startRename(kb: KnowledgeBase) {
    editingId = kb.id;
    editingName = kb.name;
    setTimeout(() => editInputEl?.focus(), 50);
  }

  function confirmRename() {
    if (editingId && editingName.trim()) {
      filesStore.renameKnowledgeBase(editingId, editingName.trim());
    }
    editingId = null;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      confirmRename();
    } else if (e.key === 'Escape') {
      editingId = null;
    }
  }

  function formatDate(ts: number): string {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString();
  }

  // Check git availability on mount
  $effect(() => {
    checkGitInstalled().then(ok => { gitAvailable = ok; }).catch(() => { gitAvailable = false; });
  });

  async function unbindGit(kb: KnowledgeBase) {
    if (!kb.git) return;
    const confirmed = await ask(
      $t('git.unbindConfirm').replace('{name}', kb.name),
      { title: $t('git.unbindTitle'), kind: 'warning' }
    );
    if (confirmed) {
      await deleteGitToken(kb.git.configId).catch(() => {});
      filesStore.updateKnowledgeBase(kb.id, { git: undefined });
    }
  }

  function shortenUrl(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\.git$/, '');
  }


  function picoraButtonClass(kb: KnowledgeBase): string {
    if (!kb.picoraBinding) return '';
    const state = syncStates.get(kb.id);
    if (!state) return 'picora-ok';
    if (state.status === 'conflict') return 'picora-warn';
    if (state.status === 'error') return 'picora-err';
    if (state.status === 'syncing') return 'picora-sync';
    return 'picora-ok';
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="kb-overlay" onkeydown={(e) => e.key === 'Escape' && onClose()} onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="kb-dialog" onclick={(e) => e.stopPropagation()}>
    <div class="kb-dialog-header">
      <h3>{$t('knowledgeBase.title')}</h3>
      <button class="kb-dialog-close" onclick={onClose}>&times;</button>
    </div>

    <div class="kb-dialog-body">
      {#if knowledgeBases.length === 0}
        <div class="kb-empty">
          <p>{$t('knowledgeBase.empty')}</p>
          <p class="kb-empty-hint">{$t('knowledgeBase.emptyHint')}</p>
        </div>
      {:else}
        <div class="kb-list">
          {#each knowledgeBases as kb}
            <div class="kb-list-item">
              <div class="kb-list-info">
                {#if editingId === kb.id}
                  <input
                    bind:this={editInputEl}
                    class="kb-rename-input"
                    bind:value={editingName}
                    onkeydown={handleRenameKeydown}
                    onblur={confirmRename}
                  />
                {:else}
                  <span class="kb-list-name" role="button" tabindex="0"
                    onclick={async () => {
                      const result = await filesStore.setActiveKnowledgeBase(kb.id);
                      if (result.success) { onClose(); }
                    }}
                    onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.click(); }}
                  >{kb.name}</span>
                {/if}
                <span class="kb-list-path" title={kb.path}>{kb.path}</span>
                {#if kb.git}
                  <span class="kb-git-info" title={kb.git.remoteUrl}>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                    {shortenUrl(kb.git.remoteUrl)}
                  </span>
                {/if}
              </div>
              <div class="kb-list-actions">
                <button
                  class="kb-action-btn kb-picora-btn {picoraButtonClass(kb)}"
                  onclick={() => { picoraBindingKb = kb; }}
                  title={kb.picoraBinding ? $t('kbSync.card.settings') : $t('kbSync.card.bind')}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-1px;display:inline-block" aria-hidden="true"><path fill-rule="evenodd" d="M8 8m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0zM8 8m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0zM8 8m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z"/></svg>{#if kb.picoraBinding}{@const _s = syncStates.get(kb.id)}{#if _s?.status === 'conflict'} ⚠{_s.conflictCount}{:else if _s?.status === 'error'} ✗{:else if _s?.status === 'syncing'} ⟳{:else} {kb.picoraBinding.picoraKbName.slice(0, 12)}{/if}{/if}
                </button>
                {#if kb.git}
                  <button class="kb-action-btn" onclick={() => unbindGit(kb)} title={$t('git.unbind')}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z"/></svg>
                  </button>
                {:else if gitAvailable}
                  <button class="kb-action-btn" onclick={() => { bindingKb = kb; }} title={$t('git.bind')}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25V5.372a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm3-8.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0z"/></svg>
                  </button>
                {/if}
                <button class="kb-action-btn" onclick={() => startRename(kb)} title={$t('knowledgeBase.rename')}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zM11.189 3.5L3 11.689v.001l-.59 2.058 2.058-.59L12.657 4.97 11.19 3.5z"/></svg>
                </button>
                <button class="kb-action-btn kb-action-danger" onclick={() => removeKnowledgeBase(kb)} title={$t('knowledgeBase.remove')}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675a.75.75 0 10-1.492.15l.66 6.6A1.75 1.75 0 005.405 15h5.19a1.75 1.75 0 001.741-1.575l.66-6.6a.75.75 0 00-1.492-.15l-.66 6.6a.25.25 0 01-.249.225h-5.19a.25.25 0 01-.249-.225l-.66-6.6z"/></svg>
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="kb-dialog-footer">
      <button class="kb-add-btn" onclick={addKnowledgeBase}>
        + {$t('knowledgeBase.add')}
      </button>
    </div>
  </div>
</div>

{#if bindingKb}
  <GitBindDialog kb={bindingKb} onClose={() => { bindingKb = null; }} />
{/if}

{#if picoraBindingKb}
  <KbPicoraBindDialog
    kb={picoraBindingKb}
    onClose={() => { picoraBindingKb = null; }}
    onBound={() => { picoraBindingKb = null; }}
  />
{/if}

<style>
  .kb-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .kb-dialog {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    width: 460px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }

  .kb-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border-light);
  }

  .kb-dialog-header h3 {
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .kb-dialog-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
  }

  .kb-dialog-close:hover {
    color: var(--text-primary);
  }

  .kb-dialog-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .kb-empty {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .kb-empty-hint {
    margin-top: 0.5rem;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  .kb-list-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    gap: 0.5rem;
  }

  .kb-list-item:hover {
    background: var(--bg-hover);
  }

  .kb-list-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;
  }

  .kb-list-name {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .kb-list-name:hover {
    color: var(--accent-color, #0969da);
  }

  .kb-list-path {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kb-rename-input {
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--accent-color);
    border-radius: 3px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: 600;
    outline: none;
    width: 100%;
  }

  .kb-list-actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .kb-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 3px;
  }

  .kb-action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .kb-action-danger:hover {
    color: var(--color-danger, #ef4444);
  }

  .kb-dialog-footer {
    padding: 0.5rem 1rem;
    border-top: 1px solid var(--border-light);
  }

  .kb-add-btn {
    width: 100%;
    padding: 0.4rem;
    border: 1px dashed var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    border-radius: 5px;
    cursor: pointer;
    font-size: var(--font-size-sm);
  }

  .kb-add-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
    background: var(--bg-hover);
  }

  .kb-git-info {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kb-git-info svg {
    flex-shrink: 0;
  }

  .kb-picora-btn {
    font-size: var(--font-size-xs);
    padding: 0 0.4rem;
    border-radius: 3px;
    border: 1px solid var(--border-color) !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Override the fixed 1.5rem width inherited from .kb-action-btn so the bound-state
       label (kbName suffix) is not truncated. Unbound state shows lens icon only. */
    width: auto;
    min-width: 1.5rem;
    max-width: 140px;
  }

  .kb-picora-btn.picora-ok { color: var(--color-success, #38a169); border-color: var(--color-success, #38a169) !important; }
  .kb-picora-btn.picora-warn { color: var(--warning-color, #e8a838); border-color: var(--warning-color, #e8a838) !important; }
  .kb-picora-btn.picora-err { color: var(--color-error, #e53e3e); border-color: var(--color-error, #e53e3e) !important; }
  .kb-picora-btn.picora-sync { color: var(--accent-color); border-color: var(--accent-color) !important; }
</style>
