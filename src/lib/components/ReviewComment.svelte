<script lang="ts">
	import { t } from '$lib/i18n';
	import { reviewStore } from '$lib/services/review/review-store';
	import { addComment, resolveReview, wontfixReview } from '$lib/services/review/review-service';
	import type { ResolvedReview } from '$lib/services/review/types';

	let {
		review,
		currentUser,
		currentUserEmail,
		headCommit = '',
		onJump,
		onReanchor,
	}: {
		review: ResolvedReview;
		currentUser: string;
		currentUserEmail: string;
		headCommit?: string;
		onJump?: (reviewId: string) => void;
		onReanchor?: (reviewId: string) => void;
	} = $props();

	let showReplyInput = $state(false);
	let replyText = $state('');
	let submittingReply = $state(false);

	const isActive = $derived(
		(function () {
			let active: string | null = null;
			reviewStore.subscribe((s) => { active = s.activeReviewId; });
			return active === review.id;
		})()
	);

	function formatDate(iso: string): string {
		try {
			return new Date(iso).toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			});
		} catch {
			return iso;
		}
	}

	async function handleResolve() {
		const updated = resolveReview(review, currentUser);
		await reviewStore.updateReview(review.id, updated);
	}

	async function handleWontfix() {
		const updated = wontfixReview(review, currentUser);
		await reviewStore.updateReview(review.id, updated);
	}

	async function handleReply() {
		if (!replyText.trim() || submittingReply) return;
		submittingReply = true;
		try {
			const comment = addComment(review, currentUser, currentUserEmail, replyText.trim());
			await reviewStore.updateReview(review.id, {
				comments: [...review.comments, comment],
			});
			replyText = '';
			showReplyInput = false;
		} finally {
			submittingReply = false;
		}
	}

	async function handleMarkVerified() {
		if (headCommit) {
			await reviewStore.markVerified(review.id, headCommit);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			handleReply();
		}
	}

	/** True when the document was modified after the reviewer last verified. */
	const showVerifiedPrompt = $derived(
		review.anchorState === 'exact' && headCommit && headCommit !== review.lastVerifiedCommit
	);

	const anchorClass = $derived(
		review.anchorState === 'relocated' ? 'anchor-relocated' : ''
	);
</script>

<div
	class="review-comment"
	class:active={isActive}
	class:resolved={review.status === 'resolved' || review.status === 'wontfix'}
	onclick={() => {
		reviewStore.setActive(review.id);
		onJump?.(review.id);
	}}
	role="button"
	tabindex="0"
	onkeydown={(e) => e.key === 'Enter' && onJump?.(review.id)}
>
	<!-- Header -->
	<div class="comment-header">
		<span class="author">@{review.author}</span>
		{#if review.anchorState === 'relocated'}
			<span class="status-badge relocated" title={$t('review.relocated')}>⚠</span>
		{/if}
		{#if review.status === 'resolved'}
			<span class="status-badge resolved">{$t('review.resolved')}</span>
		{:else if review.status === 'wontfix'}
			<span class="status-badge wontfix">{$t('review.wontfixLabel')}</span>
		{:else if review.status === 'unanchored'}
			<span class="status-badge unanchored">{$t('review.unanchored')}</span>
		{/if}
		<span class="date">{formatDate(review.createdAt)}</span>
	</div>

	<!-- Anchor context -->
	<div class="anchor-text {anchorClass}">
		"{review.anchor.markedText}"
	</div>

	<!-- Comments thread -->
	{#each review.comments as comment (comment.id)}
		<div class="thread-comment" class:root={comment === review.comments[0]}>
			{#if comment !== review.comments[0]}
				<span class="reply-author">@{comment.author}</span>
			{/if}
			<p class="comment-text">{comment.text}</p>
			<span class="comment-date">{formatDate(comment.createdAt)}</span>
		</div>
	{/each}

	<!-- Verified prompt -->
	{#if showVerifiedPrompt}
		<div class="verified-prompt">
			{$t('review.verifiedPrompt')}
			<button class="link-btn" onclick={handleMarkVerified}>{$t('review.markVerified')}</button>
		</div>
	{/if}

	<!-- Actions (only for open/unanchored) -->
	{#if review.status === 'open' || review.status === 'unanchored'}
		<div class="actions">
			{#if review.status === 'open'}
				<button class="action-btn" onclick={(e) => { e.stopPropagation(); showReplyInput = !showReplyInput; }}>
					{$t('review.reply')}
				</button>
				<button class="action-btn" onclick={(e) => { e.stopPropagation(); handleResolve(); }}>
					{$t('review.resolve')}
				</button>
				<button class="action-btn muted" onclick={(e) => { e.stopPropagation(); handleWontfix(); }}>
					{$t('review.wontfix')}
				</button>
			{:else}
				<!-- unanchored -->
				<button class="action-btn" onclick={(e) => { e.stopPropagation(); onReanchor?.(review.id); }}>
					{$t('review.reanchor')}
				</button>
				<button class="action-btn" onclick={(e) => { e.stopPropagation(); handleResolve(); }}>
					{$t('review.markResolved')}
				</button>
			{/if}
		</div>
	{/if}

	<!-- Reply input -->
	{#if showReplyInput}
		<div class="reply-box" onclick={(e) => e.stopPropagation()} role="presentation">
			<textarea
				bind:value={replyText}
				placeholder={$t('review.reply')}
				rows={2}
				onkeydown={handleKeydown}
			></textarea>
			<div class="reply-actions">
				<button class="action-btn muted" onclick={() => { showReplyInput = false; replyText = ''; }}>
					{$t('common.cancel')}
				</button>
				<button
					class="action-btn primary"
					disabled={!replyText.trim() || submittingReply}
					onclick={handleReply}
				>
					{$t('common.add')}
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.review-comment {
		padding: 10px 12px;
		border-left: 3px solid transparent;
		border-bottom: 1px solid var(--color-border);
		cursor: pointer;
		transition: background 0.15s;
	}
	.review-comment:hover,
	.review-comment.active {
		background: var(--color-hover);
		border-left-color: var(--color-accent);
	}
	.review-comment.resolved {
		opacity: 0.6;
	}
	.comment-header {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		margin-bottom: 4px;
	}
	.author {
		font-weight: 600;
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}
	.date {
		margin-left: auto;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.status-badge {
		font-size: var(--font-size-xs);
		padding: 1px 5px;
		border-radius: 3px;
	}
	.status-badge.resolved { background: rgba(34, 197, 94, 0.15); color: #16a34a; }
	.status-badge.wontfix  { background: rgba(148, 163, 184, 0.15); color: var(--color-text-muted); }
	.status-badge.unanchored { background: rgba(239, 68, 68, 0.12); color: #dc2626; }
	.status-badge.relocated { background: rgba(251, 146, 60, 0.15); color: #ea580c; cursor: help; }

	.anchor-text {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
		margin-bottom: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.anchor-text.anchor-relocated {
		color: #ea580c;
	}

	.thread-comment {
		margin: 4px 0;
		font-size: var(--font-size-sm);
	}
	.thread-comment.root .comment-text {
		font-weight: 500;
	}
	.reply-author {
		font-weight: 600;
		margin-right: 4px;
		color: var(--color-accent);
		font-size: var(--font-size-xs);
	}
	.comment-text {
		display: inline;
		margin: 0;
		color: var(--color-text);
	}
	.comment-date {
		font-size: 10px;
		color: var(--color-text-muted);
		display: block;
		margin-top: 2px;
	}

	.verified-prompt {
		font-size: var(--font-size-xs);
		color: #d97706;
		background: rgba(251, 191, 36, 0.1);
		padding: 4px 6px;
		border-radius: 4px;
		margin: 4px 0;
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

	.actions {
		display: flex;
		gap: 6px;
		margin-top: 6px;
		flex-wrap: wrap;
	}
	.action-btn {
		font-size: var(--font-size-xs);
		padding: 2px 8px;
		border-radius: 4px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
	}
	.action-btn:hover { background: var(--color-hover); }
	.action-btn.primary { background: var(--color-accent); color: #fff; border-color: var(--color-accent); }
	.action-btn.muted  { color: var(--color-text-muted); }
	.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.reply-box {
		margin-top: 8px;
	}
	.reply-box textarea {
		width: 100%;
		resize: vertical;
		font-size: var(--font-size-sm);
		padding: 6px;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-surface);
		color: var(--color-text);
		box-sizing: border-box;
	}
	.reply-actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		margin-top: 4px;
	}
</style>
