// ─────────────────────────── Git types ───────────────────────────

/** Mirrors Rust GitStatus struct */
export interface GitFileStatus {
	modified: string[];
	added: string[];
	deleted: string[];
	untracked: string[];
	has_changes: boolean;
}

/** Mirrors Rust GitLogEntry struct */
export interface GitLogEntry {
	hash: string;
	short_hash: string;
	author: string;
	email: string;
	date: string;
	message: string;
}

/** Mirrors Rust GitSyncStatus struct */
export interface GitSyncStatus {
	ahead: number;
	behind: number;
	branch: string;
	remote_branch: string;
}

/** Mirrors Rust GitUserInfo struct */
export interface GitUserInfo {
	name: string;
	email: string;
}

/** Git binding config stored on KnowledgeBase */
export interface GitConfig {
	remoteUrl: string;
	configId: string;
	branch: string;
	autoCommit: boolean;
	autoSync: boolean;
	syncIntervalMin: number;
	lastSyncAt: number;
}

/** Sync phase for UI display */
export type GitSyncPhase =
	| 'idle'
	| 'synced'
	| 'ahead'
	| 'behind'
	| 'diverged'
	| 'syncing'
	| 'committing'
	| 'error'
	| 'no-git';

/** Keychain prefix for git tokens */
export const KEYCHAIN_GIT_PREFIX = 'git-token:';
