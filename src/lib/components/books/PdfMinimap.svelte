<script lang="ts">
	interface Props {
		numPages: number;
		currentPage: number;
		highlightedPages: number[];
		bookmarkedPages: number[];
		onNavigate: (page: number) => void;
	}

	let { numPages, currentPage, highlightedPages, bookmarkedPages, onNavigate }: Props = $props();

	let highlightSet = $derived(new Set(highlightedPages));
	let bookmarkSet = $derived(new Set(bookmarkedPages));
</script>

<div class="minimap">
	<div class="minimap-inner">
		{#each Array(numPages) as _, i (i)}
			{@const page = i + 1}
			<button
				class="page-rect"
				class:current={page === currentPage}
				onclick={() => onNavigate(page)}
				aria-label="Go to page {page}"
			>
				{#if highlightSet.has(page)}
					<span class="dot-highlight"></span>
				{/if}
				{#if bookmarkSet.has(page)}
					<span class="ribbon"></span>
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.minimap {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 32px;
		z-index: 40;
		background: var(--color-deep);
		border-left: 1px solid rgba(240, 235, 227, 0.04);
		opacity: 0;
		transition: opacity 300ms ease;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: rgba(240, 235, 227, 0.08) transparent;
	}

	.minimap:hover,
	.minimap:focus-within {
		opacity: 1;
	}

	/* Show minimap when hovering near right edge — handled by parent hover zone */
	:global(.viewport:hover) ~ .minimap,
	.minimap:hover {
		opacity: 1;
	}

	.minimap-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 8px 4px;
	}

	.page-rect {
		position: relative;
		width: 20px;
		height: 14px;
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 1px;
		background: rgba(240, 235, 227, 0.03);
		cursor: pointer;
		padding: 0;
		transition: background 0.15s, box-shadow 0.15s, border-color 0.15s;
		flex-shrink: 0;
	}

	.page-rect:hover {
		border-color: rgba(212, 162, 83, 0.3);
		background: rgba(212, 162, 83, 0.08);
	}

	.page-rect.current {
		background: rgba(212, 162, 83, 0.25);
		border-color: rgba(212, 162, 83, 0.3);
		box-shadow: 0 0 6px rgba(212, 162, 83, 0.15);
	}

	.dot-highlight {
		position: absolute;
		bottom: 1px;
		left: 50%;
		transform: translateX(-50%);
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: rgba(250, 204, 21, 0.85);
		pointer-events: none;
	}

	.ribbon {
		position: absolute;
		top: -1px;
		right: 1px;
		width: 5px;
		height: 7px;
		background: var(--color-warm);
		clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 75%, 0 100%);
		pointer-events: none;
	}
</style>
