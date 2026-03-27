<script lang="ts">
	interface Props {
		highlights: Array<{ page: number; text: string; color: string; createdAt?: number }>;
		notes: Array<{ page: number; content: string; createdAt?: number }>;
		currentPage: number;
	}

	let { highlights, notes, currentPage }: Props = $props();

	let pageHighlights = $derived(highlights.filter((h) => h.page === currentPage));
	let pageNotes = $derived(notes.filter((n) => n.page === currentPage));

	function formatTime(ts?: number): string {
		if (!ts) return '';
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}
</script>

{#if pageHighlights.length > 0 || pageNotes.length > 0}
	<div class="margin-notes">
		{#each pageHighlights as hl, i (i)}
			<div class="note-card">
				<div class="connector"></div>
				<div class="card-label" style="color: {hl.color};">
					Highlight &middot; p.{hl.page}
				</div>
				<div class="card-content">{hl.text}</div>
				{#if hl.createdAt}
					<div class="card-time">{formatTime(hl.createdAt)}</div>
				{/if}
			</div>
		{/each}

		{#each pageNotes as note, i (i)}
			<div class="note-card">
				<div class="connector"></div>
				<div class="card-label">Note &middot; p.{note.page}</div>
				<div class="card-content">{note.content}</div>
				{#if note.createdAt}
					<div class="card-time">{formatTime(note.createdAt)}</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.margin-notes {
		width: 180px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 80px 12px 40px 0;
		align-self: flex-start;
	}

	/* Hide below 1200px */
	@media (max-width: 1199px) {
		.margin-notes {
			display: none;
		}
	}

	.note-card {
		position: relative;
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 8px;
		padding: 10px 10px 8px;
		transition: border-color 0.2s ease;
	}

	.note-card:hover {
		border-color: rgba(212, 162, 83, 0.2);
	}

	.connector {
		position: absolute;
		left: -12px;
		top: 14px;
		width: 12px;
		height: 1px;
		background: rgba(240, 235, 227, 0.1);
	}

	.card-label {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 600;
		color: var(--color-accent);
		margin-bottom: 4px;
		font-family: var(--font-body);
	}

	.card-content {
		font-size: 11px;
		line-height: 1.5;
		color: var(--color-muted);
		font-family: var(--font-body);
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		-webkit-box-orient: vertical;
	}

	.card-time {
		font-size: 9px;
		color: var(--color-faint);
		margin-top: 4px;
		font-family: var(--font-body);
	}
</style>
