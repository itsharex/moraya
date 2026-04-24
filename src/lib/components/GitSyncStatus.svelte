<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '$lib/i18n';
  import { gitStore } from '$lib/services/git';
  import type { GitSyncPhase } from '$lib/services/git';

  let { onSync }: { onSync: () => void } = $props();

  let syncPhase = $state<GitSyncPhase>('idle');
  let ahead = $state(0);
  let behind = $state(0);

  const unsub = gitStore.subscribe((s) => {
    syncPhase = s.syncPhase;
    ahead = s.ahead;
    behind = s.behind;
  });
  onDestroy(() => { unsub(); });
</script>

{#if syncPhase !== 'idle'}
  <span class="git-sync" class:git-error={syncPhase === 'error'} class:git-syncing={syncPhase === 'syncing' || syncPhase === 'committing'}>
    {#if syncPhase === 'synced'}
      <span class="git-icon">&#10003;</span> {$t('git.synced')}
    {:else if syncPhase === 'ahead'}
      <span class="git-icon">&uarr;</span>{ahead} {$t('git.ahead')}
    {:else if syncPhase === 'behind'}
      <span class="git-icon">&darr;</span>{behind} {$t('git.behind')}
    {:else if syncPhase === 'diverged'}
      <span class="git-icon">&uarr;</span>{ahead} <span class="git-icon">&darr;</span>{behind}
    {:else if syncPhase === 'syncing'}
      <span class="git-spinner-sm"></span> {$t('git.syncing')}
    {:else if syncPhase === 'committing'}
      <span class="git-spinner-sm"></span> {$t('git.committing')}
    {:else if syncPhase === 'error'}
      <span class="git-icon">&#9888;</span> {$t('git.syncError')}
    {:else if syncPhase === 'no-git'}
      ({$t('git.notInstalled')})
    {/if}

    {#if syncPhase !== 'syncing' && syncPhase !== 'committing' && syncPhase !== 'no-git'}
      <button class="git-sync-btn" onclick={onSync} title={$t('git.syncNow')}>
        &#x21BB;
      </button>
    {/if}
  </span>
{/if}

<style>
  .git-sync {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    padding: 0 0.4rem;
  }

  .git-error {
    color: var(--color-danger, #ef4444);
  }

  .git-syncing {
    color: var(--accent-color, #0969da);
  }

  .git-icon {
    font-size: 0.7rem;
  }

  .git-sync-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0 0.15rem;
    line-height: 1;
  }

  .git-sync-btn:hover {
    color: var(--text-primary);
  }

  .git-spinner-sm {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--border-color);
    border-top-color: var(--accent-color, #0969da);
    border-radius: 50%;
    animation: git-spin-sm 0.6s linear infinite;
  }

  @keyframes git-spin-sm {
    to { transform: rotate(360deg); }
  }
</style>
