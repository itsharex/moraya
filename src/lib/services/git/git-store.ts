import { writable } from 'svelte/store';
import type { GitSyncPhase } from './types';

interface GitState {
	installed: boolean | null;
	syncPhase: GitSyncPhase;
	ahead: number;
	behind: number;
	branch: string;
	lastError: string | null;
	lastSyncAt: number | null;
}

const initialState: GitState = {
	installed: null,
	syncPhase: 'idle',
	ahead: 0,
	behind: 0,
	branch: '',
	lastError: null,
	lastSyncAt: null,
};

const { subscribe, update } = writable<GitState>(initialState);

export const gitStore = {
	subscribe,

	setInstalled(installed: boolean) {
		update((s) => ({
			...s,
			installed,
			syncPhase: installed ? s.syncPhase : 'no-git',
		}));
	},

	setSyncing() {
		update((s) => ({ ...s, syncPhase: 'syncing', lastError: null }));
	},

	setCommitting() {
		update((s) => ({ ...s, syncPhase: 'committing', lastError: null }));
	},

	setSyncResult(ahead: number, behind: number, branch: string) {
		let phase: GitSyncPhase;
		if (ahead > 0 && behind > 0) {
			phase = 'diverged';
		} else if (ahead > 0) {
			phase = 'ahead';
		} else if (behind > 0) {
			phase = 'behind';
		} else {
			phase = 'synced';
		}

		update((s) => ({
			...s,
			syncPhase: phase,
			ahead,
			behind,
			branch,
			lastError: null,
			lastSyncAt: Date.now(),
		}));
	},

	setError(error: string) {
		update((s) => ({ ...s, syncPhase: 'error', lastError: error }));
	},

	setIdle() {
		update((s) => ({
			...s,
			syncPhase: 'idle',
			ahead: 0,
			behind: 0,
			branch: '',
			lastError: null,
			lastSyncAt: null,
		}));
	},

	reset() {
		update(() => initialState);
	},
};
