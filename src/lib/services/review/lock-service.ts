/**
 * Soft-lock service — manages `.moraya/locks.json` for collaborative editing.
 *
 * Lock lifecycle:
 *  1. acquireLock()  → called when the user opens a file for editing
 *  2. releaseLock()  → called on file close, tab switch, or app exit
 *
 * If the KB has git enabled, both acquire and release will asynchronously
 * commit+push the updated locks.json (failures are silently ignored so as
 * not to block the user's editing flow).
 *
 * Known limitation: No automatic pull before checking locks — the user must
 * manually sync to see the latest lock state from other team members.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Lock, LocksFile } from './types';
import type { GitUserInfo } from '$lib/services/git/types';
import type { KnowledgeBase } from '$lib/stores/files-store';

const LOCKS_FILE_NAME = '.moraya/locks.json';
const LOCK_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Internal helpers ──────────────────────────────────────────────

function locksPath(kbRoot: string): string {
  return `${kbRoot.replace(/\\/g, '/').replace(/\/$/, '')}/${LOCKS_FILE_NAME}`;
}

async function readLocksRaw(kbRoot: string): Promise<LocksFile> {
  const path = locksPath(kbRoot);
  try {
    const raw = await invoke<string>('read_file', { path });
    return JSON.parse(raw) as LocksFile;
  } catch {
    return { version: 1, locks: {} };
  }
}

async function writeLocksRaw(kbRoot: string, data: LocksFile): Promise<void> {
  // Ensure .moraya/ directory exists
  const dir = `${kbRoot.replace(/\\/g, '/').replace(/\/$/, '')}/.moraya`;
  await invoke('create_dir', { path: dir });
  await invoke('write_file', { path: locksPath(kbRoot), content: JSON.stringify(data, null, 2) });
}

/**
 * Push locks.json changes to the remote (non-blocking).
 * Called after acquire/release if the KB has git enabled.
 */
function pushLocksAsync(kbRoot: string, kb: KnowledgeBase): void {
  if (!kb.git) return;
  const relPath = LOCKS_FILE_NAME;
  const configId = kb.git.configId;
  void invoke('git_add_commit', {
    path: kbRoot,
    files: [relPath],
    message: 'lock: update locks.json',
    configId,
  })
    .then(() => invoke('git_push', { path: kbRoot, configId }))
    .catch(() => { /* Silently ignore — lock push failures must not block editing */ });
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Read the current locks file.
 */
export async function readLocks(kbRoot: string): Promise<LocksFile> {
  return readLocksRaw(kbRoot);
}

/**
 * Return true if the given lock has expired.
 */
export function isExpired(lock: Lock): boolean {
  return new Date(lock.expiresAt).getTime() < Date.now();
}

/**
 * Try to acquire the lock for a file.
 *
 * @returns `{ success: true }` if acquired,
 *          `{ success: false, lockedBy, minutesLeft }` if blocked.
 */
export async function acquireLock(
  kbRoot: string,
  docRelPath: string,
  userInfo: GitUserInfo,
  kb: KnowledgeBase,
): Promise<{ success: true } | { success: false; lockedBy: string; minutesLeft: number }> {
  const data = await readLocksRaw(kbRoot);
  const existing = data.locks[docRelPath];

  if (existing && !isExpired(existing)) {
    // Locked by someone else (or ourselves in another session)
    const selfName = userInfo.name || 'Unknown';
    if (existing.lockedBy !== selfName) {
      const msLeft = new Date(existing.expiresAt).getTime() - Date.now();
      const minutesLeft = Math.ceil(msLeft / 60_000);
      return { success: false, lockedBy: existing.lockedBy, minutesLeft };
    }
    // Same user → refresh the expiry
  }

  const now = new Date();
  const lock: Lock = {
    lockedBy: userInfo.name || 'Unknown',
    lockedByEmail: userInfo.email || '',
    lockedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LOCK_DURATION_MS).toISOString(),
  };

  data.locks[docRelPath] = lock;
  await writeLocksRaw(kbRoot, data);
  pushLocksAsync(kbRoot, kb);

  return { success: true };
}

/**
 * Release the lock held by the current user on a file.
 * No-op if the file is not locked or locked by someone else.
 */
export async function releaseLock(
  kbRoot: string,
  docRelPath: string,
  kb: KnowledgeBase,
): Promise<void> {
  let data: LocksFile;
  try {
    data = await readLocksRaw(kbRoot);
  } catch {
    return; // Nothing to release
  }

  if (!data.locks[docRelPath]) return; // Already released

  delete data.locks[docRelPath];
  try {
    await writeLocksRaw(kbRoot, data);
    pushLocksAsync(kbRoot, kb);
  } catch {
    // Best-effort; don't throw on release failure
  }
}

/**
 * Force-release any lock on a file (used when the user chooses "force unlock").
 */
export async function forceUnlock(
  kbRoot: string,
  docRelPath: string,
  kb: KnowledgeBase,
): Promise<void> {
  return releaseLock(kbRoot, docRelPath, kb);
}
