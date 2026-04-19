<script lang="ts">
	interface OutlineItem {
		title: string;
		dest: any;
		items?: OutlineItem[];
	}

	interface Props {
		visible: boolean;
		totalPages: number;
		currentPage: number;
		outline?: OutlineItem[];
		highlights?: Array<{ cfi: string; text: string; color: string; chapter?: string }>;
		bookmarks?: Array<{ cfi: string; label?: string }>;
		onPageClick: (page: number) => void;
	}

	let {
		visible,
		totalPages,
		currentPage,
		outline,
		highlights = [],
		bookmarks = [],
		onPageClick
	}: Props = $props();

	type Tab = 'pages' | 'outline' | 'notes';
	let activeTab = $state<Tab>('pages');

	// Virtual window for the pages tab: only render ~50 entries at a time
	const PAGE_WINDOW = 50;
	let pageScrollOffset = $state(0);
	let lastCenteredPage = $state(0);

	let pageWindowStart = $derived.by(() => {
		// Re-center if currentPage drifts far from where we last centered
		const center = currentPage + pageScrollOffset;
		const tentativeStart = Math.max(1, center - Math.floor(PAGE_WINDOW / 2));
		return tentativeStart;
	});
	let pageWindowEnd = $derived(Math.min(totalPages, pageWindowStart + PAGE_WINDOW - 1));
	let visiblePages = $derived(
		Array.from({ length: Math.max(0, pageWindowEnd - pageWindowStart + 1) }, (_, i) => pageWindowStart + i)
	);
	let hasPagesBefore = $derived(pageWindowStart > 1);
	let hasPagesAfter = $derived(pageWindowEnd < totalPages);

	// When current page goes outside visible window, reset offset
	let needsRecenter = $derived(currentPage < pageWindowStart || currentPage > pageWindowEnd);

	$effect(() => {
		if (needsRecenter) {
			pageScrollOffset = 0;
			lastCenteredPage = currentPage;
		}
	});

	function shiftPagesUp() {
		pageScrollOffset -= PAGE_WINDOW;
	}

	function shiftPagesDown() {
		pageScrollOffset += PAGE_WINDOW;
	}
</script>

<aside
	class="sidebar"
	class:sidebar-hidden={!visible}
	aria-label="PDF sidebar"
>
	<!-- Tabs -->
	<div class="tabs">
		<button
			class="tab"
			class:tab-active={activeTab === 'pages'}
			onclick={() => (activeTab = 'pages')}
		>Pages</button>
		<button
			class="tab"
			class:tab-active={activeTab === 'outline'}
			onclick={() => (activeTab = 'outline')}
		>Outline</button>
		<button
			class="tab"
			class:tab-active={activeTab === 'notes'}
			onclick={() => (activeTab = 'notes')}
		>Notes</button>
	</div>

	<!-- Tab content -->
	<div class="tab-content">
		{#if activeTab === 'pages'}
			<div class="pages-list">
				{#if hasPagesBefore}
					<button class="pages-ellipsis" onclick={shiftPagesUp}>
						... pages 1-{pageWindowStart - 1}
					</button>
				{/if}

				{#each visiblePages as pageNum (pageNum)}
					<button
						class="page-entry"
						class:page-active={pageNum === currentPage}
						onclick={() => onPageClick(pageNum)}
					>
						<div class="page-thumb">
							<span class="page-thumb-num">{pageNum}</span>
						</div>
						<span class="page-label">{pageNum}</span>
					</button>
				{/each}

				{#if hasPagesAfter}
					<button class="pages-ellipsis" onclick={shiftPagesDown}>
						... pages {pageWindowEnd + 1}-{totalPages}
					</button>
				{/if}
			</div>

		{:else if activeTab === 'outline'}
			<div class="outline-list">
				{#if outline && outline.length > 0}
					{#each outline as item (item.title)}
						{@render outlineNode(item, 0)}
					{/each}
				{:else}
					<div class="empty-message">No outline available</div>
				{/if}
			</div>

		{:else if activeTab === 'notes'}
			<div class="notes-list">
				{#if highlights.length > 0 || bookmarks.length > 0}
					{#each bookmarks as bm (bm.cfi)}
						<button class="note-item" onclick={() => onPageClick(parseInt(bm.cfi) || 1)}>
							<span class="note-dot" style="background: var(--color-accent);"></span>
							<span class="note-text">{bm.label || 'Bookmark'}</span>
						</button>
					{/each}
					{#each highlights as hl (hl.cfi)}
						<button class="note-item" onclick={() => onPageClick(parseInt(hl.cfi) || 1)}>
							<span class="note-dot" style="background: {hl.color};"></span>
							<span class="note-text">{hl.text}</span>
						</button>
					{/each}
				{:else}
					<div class="empty-message">No notes yet</div>
				{/if}
			</div>
		{/if}
	</div>
</aside>

{#snippet outlineNode(item: OutlineItem, depth: number)}
	<button
		class="outline-item"
		style="padding-left: {12 + depth * 14}px;"
		onclick={() => {
			if (typeof item.dest === 'number') onPageClick(item.dest);
		}}
	>
		{item.title}
	</button>
	{#if item.items}
		{#each item.items as child (child.title)}
			{@render outlineNode(child, depth + 1)}
		{/each}
	{/if}
{/snippet}

<style>
	.sidebar {
		position: fixed;
		top: 0;
		bottom: 0;
		left: 0;
		width: min(320px, 88vw);
		background: #181514;
		border-right: 1px solid rgba(240, 235, 227, 0.06);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-family: var(--font-body);
		z-index: 71;
		box-shadow: 8px 0 28px rgba(0, 0, 0, 0.45);
		animation: toc-drawer-in 220ms ease-out;
	}

	.sidebar-hidden {
		display: none;
	}

	@keyframes toc-drawer-in {
		from { transform: translateX(-100%); }
		to { transform: translateX(0); }
	}

	/* ── Tabs ────────────────────────────────────────── */
	.tabs {
		display: flex;
		border-bottom: 1px solid rgba(240, 235, 227, 0.04);
		flex-shrink: 0;
	}

	.tab {
		flex: 1;
		padding: 10px 0;
		border: none;
		background: none;
		color: var(--color-faint);
		font-size: 10px;
		font-family: var(--font-body);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		cursor: pointer;
		position: relative;
		transition: color 0.15s;
	}

	.tab:hover {
		color: var(--color-muted);
	}

	.tab-active {
		color: var(--color-cream);
	}

	.tab-active::after {
		content: '';
		position: absolute;
		bottom: 0;
		left: 20%;
		right: 20%;
		height: 2px;
		background: var(--color-accent);
		border-radius: 1px;
	}

	/* ── Tab content ─────────────────────────────────── */
	.tab-content {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
	}

	/* ── Pages tab ───────────────────────────────────── */
	.pages-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px;
	}

	.page-entry {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 6px;
		border: none;
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
		transition: background 0.15s;
	}

	.page-entry:hover {
		background: var(--color-surface);
	}

	.page-active {
		background: rgba(212, 162, 83, 0.06);
	}

	.page-thumb {
		width: 100%;
		aspect-ratio: 0.707;
		background: rgba(240, 235, 227, 0.06);
		border-radius: 3px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid transparent;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.page-active .page-thumb {
		border-color: var(--color-accent);
		box-shadow: 0 0 12px rgba(212, 162, 83, 0.15);
	}

	.page-thumb-num {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-faint);
		user-select: none;
	}

	.page-label {
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--color-faint);
	}

	.page-active .page-label {
		color: var(--color-accent);
	}

	.pages-ellipsis {
		padding: 6px;
		border: none;
		background: none;
		color: var(--color-faint);
		font-family: var(--font-mono);
		font-size: 10px;
		cursor: pointer;
		text-align: center;
		border-radius: 4px;
		transition: background 0.15s;
	}

	.pages-ellipsis:hover {
		background: var(--color-surface);
		color: var(--color-muted);
	}

	/* ── Outline tab ─────────────────────────────────── */
	.outline-list {
		padding: 4px 0;
	}

	.outline-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 6px 12px;
		border: none;
		background: none;
		color: var(--color-muted);
		font-size: 12px;
		font-family: var(--font-body);
		cursor: pointer;
		line-height: 1.4;
		transition: background 0.15s, color 0.15s;
	}

	.outline-item:hover {
		background: var(--color-surface);
		color: var(--color-cream);
	}

	/* ── Notes tab ───────────────────────────────────── */
	.notes-list {
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.note-item {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px;
		border: none;
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
		text-align: left;
		transition: background 0.15s;
	}

	.note-item:hover {
		background: var(--color-surface);
	}

	.note-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		margin-top: 3px;
	}

	.note-text {
		font-size: 11px;
		color: var(--color-muted);
		line-height: 1.4;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
	}

	/* ── Empty message ───────────────────────────────── */
	.empty-message {
		padding: 24px 16px;
		text-align: center;
		font-size: 12px;
		color: var(--color-faint);
	}
</style>
