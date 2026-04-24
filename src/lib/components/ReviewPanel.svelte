<script lang="ts">
	import { t } from '$lib/i18n';
	import { onDestroy } from 'svelte';
	import { reviewStore } from '$lib/services/review/review-store';
	import { createReview } from '$lib/services/review/review-service';
	import { gitHeadCommit, gitGetUserInfo } from '$lib/services/git';
	import type { ResolvedReview, ReviewAnchor } from '$lib/services/review/types';
	import type { KnowledgeBase } from '$lib/stores/files-store';
	import ReviewComment from './ReviewComment.svelte';

	let {
		kb,
		editorMode = 'visual',
		onJumpToReview,
		onOpenGitBind,
	}: {
		kb: KnowledgeBase | null;
		editorMode?: string;
		onJumpToReview?: (reviewId: string) => void;
		onOpenGitBind?: () => void;
	} = $props();

	// ── Store state ───────────────────────────────────────────────

	let reviews = $state<ResolvedReview[]>([]);
	let loading = $state(false);
	let activeReviewId = $state<string | null>(null);

	const unsub = reviewStore.subscribe((s) => {
		reviews = s.reviews;
		loading = s.loading;
		activeReviewId = s.activeReviewId;
	});
	onDestroy(() => unsub());

	// ── Derived groups ────────────────────────────────────────────

	const openReviews = $derived(
		reviews.filter((r) => r.status === 'open' && r.anchorState !== 'unanchored')
	);
	const relocatedReviews = $derived(
		reviews.filter((r) => r.status === 'open' && r.anchorState === 'relocated')
	);
	const unanchoredReviews = $derived(
		reviews.filter((r) => r.status === 'unanchored')
	);
	const closedReviews = $derived(
		reviews.filter((r) => r.status === 'resolved' || r.status === 'wontfix')
	);

	const openCount = $derived(openReviews.length + relocatedReviews.length + unanchoredReviews.length);

	let showClosed = $state(false);

	// ── User info ─────────────────────────────────────────────────

	let currentUser = $state('');
	let currentUserEmail = $state('');
	let headCommit = $state('');

	$effect(() => {
		if (kb?.path) {
			gitGetUserInfo(kb.path).then((info) => {
				currentUser = info.name || 'Unknown';
				currentUserEmail = info.email || '';
			}).catch(() => {});
			if (kb.git) {
				gitHeadCommit(kb.path).then((h) => { headCommit = h; }).catch(() => {});
			}
		}
	});

	// ── Reanchor mode ─────────────────────────────────────────────

	let reanchoringId = $state<string | null>(null);

	function handleReanchor(reviewId: string) {
		reanchoringId = reviewId;
	}

	/** Called from Editor when user confirms a text selection in reanchor mode. */
	export function confirmReanchor(anchor: ReviewAnchor) {
		if (!reanchoringId) return;
		const id = reanchoringId;
		reanchoringId = null;
		import('$lib/services/review/review-service').then(({ reanchorReview }) => {
			const review = reviews.find((r) => r.id === id);
			if (!review) return;
			const updated = reanchorReview(review, anchor);
			reviewStore.updateReview(id, updated);
		});
	}

	/** True when the panel is in "waiting for text selection" reanchor mode. */
	export function getIsReanchoring(): boolean { return reanchoringId !== null; }
</script>

<div class="review-panel">
	<!-- Source mode notice -->
	{#if editorMode !== 'visual'}
		<div class="notice source-mode-notice">
			{$t('review.sourceModeLimitHint')}
		</div>
	{/if}

	<!-- Not git-bound -->
	{#if !kb?.git}
		<div class="empty-state">
			<p>{$t('review.notGitBound')}</p>
			<p class="hint">{$t('review.notGitBoundHint')}</p>
			{#if onOpenGitBind}
				<button class="bind-btn" onclick={onOpenGitBind}>{$t('review.bindGitBtn')}</button>
			{/if}
		</div>

	<!-- Loading -->
	{:else if loading}
		<div class="loading">...</div>

	<!-- No reviews -->
	{:else if reviews.length === 0}
		<div class="empty-state">
			<p>{$t('review.noReviews')}</p>
			<p class="hint">{$t('review.noReviewsHint')}</p>
		</div>

	<!-- Review list -->
	{:else}
		<div class="review-list">
			<!-- Reanchor mode banner -->
			{#if reanchoringId}
				<div class="notice reanchor-notice">
					{$t('review.reanchor')} — select text in editor
					<button class="link-btn" onclick={() => { reanchoringId = null; }}>
						{$t('common.cancel')}
					</button>
				</div>
			{/if}

			<!-- Open reviews -->
			{#each openReviews as review (review.id)}
				<ReviewComment
					{review}
					{currentUser}
					{currentUserEmail}
					{headCommit}
					onJump={onJumpToReview}
					onReanchor={handleReanchor}
				/>
			{/each}

			<!-- Relocated reviews (mixed into open list with badge) -->

			<!-- Unanchored group -->
			{#if unanchoredReviews.length > 0}
				<div class="group-header unanchored-header">{$t('review.unanchored')}</div>
				{#each unanchoredReviews as review (review.id)}
					<ReviewComment
						{review}
						{currentUser}
						{currentUserEmail}
						{headCommit}
						onJump={onJumpToReview}
						onReanchor={handleReanchor}
					/>
				{/each}
			{/if}

			<!-- Closed (resolved / wontfix) collapsible -->
			{#if closedReviews.length > 0}
				<button
					class="group-toggle"
					onclick={() => { showClosed = !showClosed; }}
				>
					{showClosed ? '▼' : '▶'}
					{$t('review.resolvedCount')} ({closedReviews.length})
				</button>
				{#if showClosed}
					{#each closedReviews as review (review.id)}
						<ReviewComment
							{review}
							{currentUser}
							{currentUserEmail}
							{headCommit}
							onJump={onJumpToReview}
							onReanchor={handleReanchor}
						/>
					{/each}
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.review-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		font-size: var(--font-size-sm);
	}

	.review-list {
		flex: 1;
		overflow-y: auto;
	}

	.empty-state {
		padding: 24px 16px;
		text-align: center;
		color: var(--color-text-muted);
	}
	.empty-state p {
		margin: 0 0 6px;
	}
	.empty-state .hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		opacity: 0.8;
	}

	.bind-btn {
		margin-top: 10px;
		padding: 6px 14px;
		border-radius: 6px;
		border: 1px solid var(--color-accent);
		background: transparent;
		color: var(--color-accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}
	.bind-btn:hover { background: rgba(var(--color-accent-rgb), 0.08); }

	.loading {
		padding: 24px;
		text-align: center;
		color: var(--color-text-muted);
	}

	.notice {
		padding: 8px 12px;
		font-size: var(--font-size-xs);
		border-bottom: 1px solid var(--color-border);
	}
	.source-mode-notice {
		background: rgba(148, 163, 184, 0.1);
		color: var(--color-text-muted);
	}
	.reanchor-notice {
		background: rgba(59, 130, 246, 0.08);
		color: var(--color-accent);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.link-btn {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-accent);
		cursor: pointer;
		font-size: inherit;
		text-decoration: underline;
	}

	.group-header {
		padding: 6px 12px;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text-muted);
		background: var(--color-surface-alt, var(--color-hover));
		border-bottom: 1px solid var(--color-border);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.unanchored-header {
		color: #dc2626;
	}

	.group-toggle {
		width: 100%;
		text-align: left;
		padding: 8px 12px;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text-muted);
		background: var(--color-surface-alt, var(--color-hover));
		border: none;
		border-top: 1px solid var(--color-border);
		cursor: pointer;
	}
	.group-toggle:hover { background: var(--color-hover); }
</style>
