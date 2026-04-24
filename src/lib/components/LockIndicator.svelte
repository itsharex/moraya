<script lang="ts">
	import { t } from '$lib/i18n';
	import type { Lock } from '$lib/services/review/types';

	let {
		lock,
		selfName,
		onForceUnlock,
		onViewReadonly,
	}: {
		/** The current lock on the open file, or null if not locked. */
		lock: Lock | null;
		/** Current user's git name — to distinguish "own lock" vs "other's lock". */
		selfName: string;
		onForceUnlock?: () => void;
		onViewReadonly?: () => void;
	} = $props();

	const isOwnLock = $derived(lock?.lockedBy === selfName);

	function minutesLeft(lock: Lock): number {
		const ms = new Date(lock.expiresAt).getTime() - Date.now();
		return Math.max(0, Math.ceil(ms / 60_000));
	}
</script>

{#if lock}
	<div class="lock-indicator" class:own={isOwnLock} class:other={!isOwnLock}>
		<span class="lock-icon">🔒</span>
		{#if isOwnLock}
			<span class="lock-text">{$t('review.lockSelf')}</span>
		{:else}
			<span class="lock-text">
				{lock.lockedBy}
				{$t('review.lockOther')}
				({minutesLeft(lock)} {$t('review.lockExpiry')})
			</span>
			<div class="lock-actions">
				{#if onViewReadonly}
					<button class="lock-btn" onclick={onViewReadonly}>{$t('review.viewReadonly')}</button>
				{/if}
				{#if onForceUnlock}
					<button class="lock-btn danger" onclick={onForceUnlock}>{$t('review.forceUnlock')}</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.lock-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		font-size: var(--font-size-xs);
		border-bottom: 1px solid var(--color-border);
		flex-wrap: wrap;
	}
	.lock-indicator.own {
		background: rgba(34, 197, 94, 0.08);
		color: #16a34a;
	}
	.lock-indicator.other {
		background: rgba(251, 146, 60, 0.1);
		color: #ea580c;
	}
	.lock-icon {
		flex-shrink: 0;
	}
	.lock-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lock-actions {
		display: flex;
		gap: 4px;
	}
	.lock-btn {
		padding: 1px 7px;
		font-size: 10px;
		border-radius: 3px;
		border: 1px solid currentColor;
		background: transparent;
		cursor: pointer;
		color: inherit;
	}
	.lock-btn:hover { opacity: 0.75; }
	.lock-btn.danger { color: #dc2626; border-color: #dc2626; }
</style>
