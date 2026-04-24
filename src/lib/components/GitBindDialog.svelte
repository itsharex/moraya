<script lang="ts">
  import { t } from '$lib/i18n';
  import { filesStore, type KnowledgeBase } from '$lib/stores/files-store';
  import type { GitAuthMethod } from '$lib/stores/files-store';
  import {
    gitClone,
    gitInitAndPush,
    gitSyncStatus,
    setGitToken,
    setGitCredential,
    setGitSshAuth,
    gitStore,
  } from '$lib/services/git';
  import { invoke } from '@tauri-apps/api/core';

  let { kb, onClose }: { kb: KnowledgeBase; onClose: () => void } = $props();

  let remoteUrl = $state('');
  let branch = $state('main');
  let authMethod = $state<GitAuthMethod>('token');

  // Token auth
  let token = $state('');

  // Username+Password auth
  let username = $state('');
  let password = $state('');

  // SSH Key auth
  let sshKeyPath = $state('');
  let sshPassphrase = $state('');

  let autoCommit = $state(true);
  let autoSync = $state(false);
  let syncIntervalMin = $state(5);
  let loading = $state(false);
  let error = $state('');
  let dirState = $state<'empty' | 'has-content' | 'has-git' | 'checking'>('checking');

  $effect(() => {
    detectDirState();
  });

  async function detectDirState() {
    try {
      const tree = await invoke<Array<{ name: string; is_dir: boolean }>>('read_dir_recursive', {
        path: kb.path,
        depth: 1,
      });
      const hasGit = tree.some(f => f.name === '.git' && f.is_dir);
      if (hasGit) {
        dirState = 'has-git';
      } else if (tree.length === 0) {
        dirState = 'empty';
      } else {
        dirState = 'has-content';
      }
    } catch {
      dirState = 'empty';
    }
  }

  function modeLabel(): string {
    switch (dirState) {
      case 'empty': return $t('git.modeClone');
      case 'has-content': return $t('git.modePush');
      case 'has-git': return $t('git.modeConnect');
      default: return $t('git.detecting');
    }
  }

  async function handleBind() {
    if (!remoteUrl.trim()) {
      error = $t('git.errorUrlRequired');
      return;
    }
    if (authMethod === 'token' && !token.trim()) {
      error = $t('git.errorTokenRequired');
      return;
    }
    if (authMethod === 'password' && !username.trim()) {
      error = $t('git.errorUsernameRequired');
      return;
    }
    if (authMethod === 'password' && !password.trim()) {
      error = $t('git.errorPasswordRequired');
      return;
    }
    if (authMethod === 'ssh' && !sshKeyPath.trim()) {
      error = $t('git.errorSshKeyRequired');
      return;
    }

    loading = true;
    error = '';

    try {
      const configId = crypto.randomUUID();

      // Store credentials in keychain based on auth method
      if (authMethod === 'token') {
        await setGitToken(configId, token.trim());
      } else if (authMethod === 'password') {
        await setGitCredential(configId, username.trim(), password.trim());
      } else if (authMethod === 'ssh') {
        await setGitSshAuth(configId, sshKeyPath.trim(), sshPassphrase.trim());
      }

      if (dirState === 'empty') {
        await gitClone(remoteUrl.trim(), kb.path, configId);
      } else if (dirState === 'has-content') {
        await gitInitAndPush(kb.path, remoteUrl.trim(), configId, branch);
      }
      // For 'has-git': just save the config — no git operation needed

      filesStore.updateKnowledgeBase(kb.id, {
        git: {
          remoteUrl: remoteUrl.trim(),
          configId,
          branch,
          autoCommit,
          autoSync,
          syncIntervalMin,
          lastSyncAt: Date.now(),
          authMethod,
        },
      });

      try {
        const status = await gitSyncStatus(kb.path, configId);
        gitStore.setSyncResult(status.ahead, status.behind, status.branch);
      } catch {
        gitStore.setSyncResult(0, 0, branch);
      }

      onClose();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="git-overlay" onkeydown={(e) => e.key === 'Escape' && onClose()} onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="git-dialog" onclick={(e) => e.stopPropagation()}>
    <div class="git-dialog-header">
      <div class="git-dialog-title">
        <!-- Generic git branch icon -->
        <svg class="git-icon" width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25V5.372a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm3-8.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0z"/>
        </svg>
        <h3>{$t('git.bindTitle')}</h3>
      </div>
      <button class="git-dialog-close" onclick={onClose}>&times;</button>
    </div>

    <div class="git-dialog-body">
      <div class="git-mode-badge">{modeLabel()}</div>

      <label class="git-field">
        <span>{$t('git.repoUrl')}</span>
        <input
          type="text"
          bind:value={remoteUrl}
          placeholder="https://gitlab.com/user/repo.git  or  git@host:user/repo.git"
          disabled={loading}
        />
      </label>

      <label class="git-field">
        <span>{$t('git.branch')}</span>
        <input
          type="text"
          bind:value={branch}
          placeholder="main"
          disabled={loading}
        />
      </label>

      <!-- Auth method selector -->
      <div class="git-field">
        <span>{$t('git.authMethod')}</span>
        <div class="git-auth-tabs">
          <button
            class="git-auth-tab"
            class:active={authMethod === 'token'}
            onclick={() => { authMethod = 'token'; error = ''; }}
            disabled={loading}
            type="button"
          >
            {$t('git.authToken')}
          </button>
          <button
            class="git-auth-tab"
            class:active={authMethod === 'password'}
            onclick={() => { authMethod = 'password'; error = ''; }}
            disabled={loading}
            type="button"
          >
            {$t('git.authPassword')}
          </button>
          <button
            class="git-auth-tab"
            class:active={authMethod === 'ssh'}
            onclick={() => { authMethod = 'ssh'; error = ''; }}
            disabled={loading}
            type="button"
          >
            {$t('git.authSsh')}
          </button>
        </div>
      </div>

      <!-- Token auth fields -->
      {#if authMethod === 'token'}
        <label class="git-field">
          <span>{$t('git.token')}</span>
          <input
            type="password"
            bind:value={token}
            placeholder="ghp_xxx  /  glpat-xxx  /  ..."
            disabled={loading}
          />
          <span class="git-field-hint">{$t('git.tokenHint')}</span>
        </label>
      {/if}

      <!-- Username + Password auth fields -->
      {#if authMethod === 'password'}
        <label class="git-field">
          <span>{$t('git.username')}</span>
          <input
            type="text"
            bind:value={username}
            placeholder="your-username"
            disabled={loading}
            autocomplete="username"
          />
        </label>
        <label class="git-field">
          <span>{$t('git.password')}</span>
          <input
            type="password"
            bind:value={password}
            placeholder="••••••••"
            disabled={loading}
            autocomplete="current-password"
          />
          <span class="git-field-hint">{$t('git.tokenHint')}</span>
        </label>
      {/if}

      <!-- SSH Key auth fields -->
      {#if authMethod === 'ssh'}
        <label class="git-field">
          <span>{$t('git.sshKeyPath')}</span>
          <input
            type="text"
            bind:value={sshKeyPath}
            placeholder="/Users/you/.ssh/id_ed25519"
            disabled={loading}
          />
          <span class="git-field-hint">{$t('git.sshKeyPathHint')}</span>
        </label>
        <label class="git-field">
          <span>{$t('git.sshPassphrase')}</span>
          <input
            type="password"
            bind:value={sshPassphrase}
            placeholder="••••••••"
            disabled={loading}
            autocomplete="current-password"
          />
          <span class="git-field-hint">{$t('git.sshPassphraseHint')}</span>
        </label>
      {/if}

      <div class="git-options">
        <label class="git-checkbox">
          <input type="checkbox" bind:checked={autoCommit} disabled={loading} />
          <span>{$t('git.autoCommit')}</span>
        </label>
        <label class="git-checkbox">
          <input type="checkbox" bind:checked={autoSync} disabled={loading} />
          <span>{$t('git.autoSync')}</span>
        </label>
        {#if autoSync}
          <label class="git-field git-field-inline">
            <span>{$t('git.syncInterval')}</span>
            <input
              type="number"
              bind:value={syncIntervalMin}
              min="1"
              max="60"
              disabled={loading}
              class="git-input-narrow"
            />
            <span class="git-field-unit">{$t('git.minutes')}</span>
          </label>
        {/if}
      </div>

      {#if error}
        <div class="git-error">{error}</div>
      {/if}
    </div>

    <div class="git-dialog-footer">
      <button class="git-btn git-btn-secondary" onclick={onClose} disabled={loading}>
        {$t('common.cancel')}
      </button>
      <button
        class="git-btn git-btn-primary"
        onclick={handleBind}
        disabled={loading || dirState === 'checking'}
      >
        {#if loading}
          <span class="git-spinner"></span>
        {/if}
        {$t('git.confirmBind')}
      </button>
    </div>
  </div>
</div>

<style>
  .git-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .git-dialog {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    width: 500px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }

  .git-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border-light);
  }

  .git-dialog-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .git-icon {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .git-dialog-header h3 {
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .git-dialog-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
  }
  .git-dialog-close:hover { color: var(--text-primary); }

  .git-dialog-body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .git-mode-badge {
    display: inline-block;
    align-self: flex-start;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: var(--font-size-xs);
    background: var(--bg-hover);
    color: var(--text-secondary);
    border: 1px solid var(--border-light);
  }

  .git-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .git-field > span:first-child {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  .git-field input[type="text"],
  .git-field input[type="password"],
  .git-field input[type="number"] {
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 5px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    outline: none;
  }
  .git-field input:focus { border-color: var(--accent-color); }

  .git-field-hint {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  .git-field-inline {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    margin-left: 1.25rem;
  }

  .git-input-narrow { width: 60px; }

  .git-field-unit {
    font-size: var(--font-size-xs) !important;
    font-weight: 400 !important;
    color: var(--text-muted) !important;
  }

  /* Auth method tabs */
  .git-auth-tabs {
    display: flex;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    overflow: hidden;
  }

  .git-auth-tab {
    flex: 1;
    padding: 0.35rem 0.5rem;
    border: none;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    border-right: 1px solid var(--border-color);
  }
  .git-auth-tab:last-child { border-right: none; }
  .git-auth-tab:hover:not(:disabled):not(.active) { background: var(--bg-hover); }
  .git-auth-tab.active {
    background: var(--accent-color, #0969da);
    color: #fff;
    font-weight: 500;
  }
  .git-auth-tab:disabled { opacity: 0.5; cursor: not-allowed; }

  .git-options {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding-top: 0.25rem;
  }

  .git-checkbox {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .git-error {
    padding: 0.4rem 0.6rem;
    border-radius: 5px;
    background: rgba(239, 68, 68, 0.1);
    color: var(--color-danger, #ef4444);
    font-size: var(--font-size-xs);
    word-break: break-all;
  }

  .git-dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border-light);
  }

  .git-btn {
    padding: 0.4rem 1rem;
    border: none;
    border-radius: 5px;
    font-size: var(--font-size-sm);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .git-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .git-btn-secondary {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
  .git-btn-secondary:hover:not(:disabled) { background: var(--border-light); }

  .git-btn-primary {
    background: var(--accent-color, #0969da);
    color: #fff;
  }
  .git-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }

  .git-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: git-spin 0.6s linear infinite;
  }

  @keyframes git-spin {
    to { transform: rotate(360deg); }
  }
</style>
