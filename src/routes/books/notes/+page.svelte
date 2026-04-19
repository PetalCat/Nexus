<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import BookCover from '$lib/components/books/system/BookCover.svelte';
	import RightRailBlock from '$lib/components/books/system/RightRailBlock.svelte';
	import Ornament from '$lib/components/books/system/Ornament.svelte';
	import ProseStat from '$lib/components/books/system/ProseStat.svelte';

	let { data }: { data: PageData } = $props();

	// Filter state — All / Highlights / Notes
	let typeFilter = $state<'all' | 'highlights' | 'notes'>('all');
	let searchText = $state(''); // TODO: filter wiring — input accepts value but is unused in v1

	// TODO: filter wiring — segment groups for By book / Chronological / Random are visual-only in v1
	let sortMode = $state<'book' | 'chron' | 'random'>('book');

	const visibleGroups = $derived.by(() => {
		return data.groups.filter(g => {
			if (typeFilter === 'highlights') return g.highlights.length > 0;
			if (typeFilter === 'notes') return g.notes.length > 0;
			return true;
		});
	});

	const totalVisible = $derived(
		visibleGroups.reduce((acc, g) => {
			if (typeFilter === 'highlights') return acc + g.highlights.length;
			if (typeFilter === 'notes') return acc + g.notes.length;
			return acc + g.highlights.length + g.notes.length;
		}, 0)
	);

	/** Build a minimal UnifiedMedia-shaped object for BookCover */
	function bookToMedia(book: { id: string; title: string; author?: string; poster?: string | null }): UnifiedMedia {
		return {
			id: book.id,
			sourceId: book.id,
			serviceId: '',
			serviceType: 'calibre',
			type: 'book',
			title: book.title,
			poster: book.poster ?? undefined
		};
	}

	/** Format a Unix-ms timestamp as "Apr 7, 3:42pm" */
	function formatDate(ts: number): string {
		const d = new Date(ts);
		const mon = d.toLocaleString('en-US', { month: 'short' });
		const day = d.getDate();
		let hr = d.getHours();
		const min = String(d.getMinutes()).padStart(2, '0');
		const ampm = hr >= 12 ? 'pm' : 'am';
		hr = hr % 12 || 12;
		return `${mon} ${day}, ${hr}:${min}${ampm}`;
	}

	/** Accent the last word of a title with the accent color */
	function accentLastWord(title: string): string {
		const parts = title.trim().split(/\s+/);
		if (parts.length <= 1) return `<em>${title}</em>`;
		const last = parts.pop()!;
		return `${parts.join(' ')} <em>${last}</em>`;
	}
</script>

<svelte:head>
	<title>Marginalia — Nexus</title>
</svelte:head>

<div class="notes-page">

	<!-- ─── Page head ─────────────────────────────────────────────────── -->
	<header class="page-head">
		<span class="mono-tag">◇ FROM THE PAGES YOU'VE FOLDED</span>
		<h1>The <em>marginalia</em>.</h1>
		<p class="subtitle">
			Every line you've underlined, every note you've scribbled, brought together.
			{data.totalHighlights} highlight{data.totalHighlights !== 1 ? 's' : ''} and
			{data.totalNotes} note{data.totalNotes !== 1 ? 's' : ''} across
			{data.totalBooks} book{data.totalBooks !== 1 ? 's' : ''}.
			Searchable, filterable, yours.
		</p>
	</header>

	<!-- ─── Toolbar ───────────────────────────────────────────────────── -->
	<div class="toolbar">
		<!-- Type filter -->
		<div class="seg-group">
			<button
				class="seg"
				class:seg-active={typeFilter === 'all'}
				onclick={() => typeFilter = 'all'}
			>All</button>
			<button
				class="seg"
				class:seg-active={typeFilter === 'highlights'}
				onclick={() => typeFilter = 'highlights'}
			>Highlights</button>
			<button
				class="seg"
				class:seg-active={typeFilter === 'notes'}
				onclick={() => typeFilter = 'notes'}
			>Notes</button>
		</div>

		<!-- Sort mode — visual only in v1 -->
		<!-- TODO: filter wiring — chron/random sort not implemented -->
		<div class="seg-group">
			<button
				class="seg"
				class:seg-active={sortMode === 'book'}
				onclick={() => sortMode = 'book'}
			>By book</button>
			<button
				class="seg"
				class:seg-active={sortMode === 'chron'}
				onclick={() => sortMode = 'chron'}
			>Chronological</button>
			<button
				class="seg"
				class:seg-active={sortMode === 'random'}
				onclick={() => sortMode = 'random'}
			>Random</button>
		</div>

		<!-- Search (value bound, wiring deferred to v2) -->
		<!-- TODO: filter wiring — search input not yet applied -->
		<input
			class="search-input"
			bind:value={searchText}
			placeholder="Search marginalia…"
		/>

		<span class="entry-count">{totalVisible} entr{totalVisible !== 1 ? 'ies' : 'y'}</span>
	</div>

	<!-- ─── Main + rail ───────────────────────────────────────────────── -->
	<div class="content-grid">

		<!-- Main column -->
		<main class="main-col">
			{#if visibleGroups.length === 0}
				<div class="empty-state">
					<Ornament />
					<p class="empty-text">No marginalia yet. Highlight in the reader to start.</p>
				</div>
			{:else}
				{#each visibleGroups as group (group.bookId)}
					{@const cards = [
						...(typeFilter !== 'notes' ? group.highlights.map(h => ({ kind: 'hl' as const, h })) : []),
						...(typeFilter !== 'highlights' ? group.notes.map(n => ({ kind: 'nt' as const, n })) : [])
					]}
					<section class="book-group">
						<!-- Book head row -->
						<div class="book-head">
							<a href="/books/{group.book.id}" class="cover-link" aria-label="Open {group.book.title}">
								<BookCover book={bookToMedia(group.book)} size="sm" />
							</a>
							<div class="book-meta">
								<h2 class="book-title">{@html accentLastWord(group.book.title)}</h2>
								{#if group.book.author}
									<p class="book-author">{group.book.author}</p>
								{/if}
							</div>
							<div class="book-right">
								<span class="book-count">{group.total}</span>
								<a class="book-link" href="/books/{group.book.id}">Open book →</a>
							</div>
						</div>

						<!-- Cards grid -->
						{#if cards.length > 0}
							<div class="cards-grid">
								{#each cards as card (card.kind === 'hl' ? `hl-${card.h.id}` : `nt-${card.n.id}`)}
									{#if card.kind === 'hl'}
										{@const h = card.h}
										<article class="qcard highlight">
											<span class="glyph">"</span>
											<p class="qtext">{h.text}</p>
											{#if h.note}
												<p class="qnote">⟶ {h.note}</p>
											{/if}
											<footer class="qmeta">
												CH {h.chapter ?? '—'} · {formatDate(h.createdAt)}
											</footer>
										</article>
									{:else}
										{@const n = card.n}
										<article class="qcard note">
											<span class="glyph">§</span>
											<p class="qtext">{n.content}</p>
											<footer class="qmeta">
												CH {n.chapter ?? '—'} · {formatDate(n.createdAt)}
											</footer>
										</article>
									{/if}
								{/each}
							</div>
						{/if}
					</section>
				{/each}
			{/if}
		</main>

		<!-- Right rail -->
		<aside class="right-rail">
			<RightRailBlock label="This year">
				<div class="rail-stat">
					<span class="rail-big">{data.thisYear}</span>
					<span class="rail-unit">entries</span>
				</div>
				<p class="rail-sub">{data.totalHighlights} HIGHLIGHTS · {data.totalNotes} NOTES</p>
			</RightRailBlock>

			<RightRailBlock label="Tags">
				<div class="tag-cloud">
					{#each data.tagCloud as { tag, count } (tag)}
						<span class="tag-chip">
							{tag}
							<span class="tag-badge">{count}</span>
						</span>
					{/each}
					{#if data.tagCloud.length === 0}
						<span class="rail-empty">No tags yet</span>
					{/if}
				</div>
			</RightRailBlock>

			<RightRailBlock label="Books">
				<ul class="rail-book-list">
					{#each data.groups as g (g.bookId)}
						<li>
							<a class="rail-book-link" href="/books/{g.book.id}">{g.book.title}</a>
						</li>
					{/each}
					{#if data.groups.length === 0}
						<li class="rail-empty">None yet</li>
					{/if}
				</ul>
			</RightRailBlock>

			<RightRailBlock label="Export">
				<div class="export-labels">
					<span class="export-label">MARKDOWN</span>
					<span class="export-label">JSON</span>
					<span class="export-label">CSV</span>
				</div>
			</RightRailBlock>
		</aside>
	</div>

	<!-- ─── Footer ────────────────────────────────────────────────────── -->
	<footer class="page-footer">
		<Ornament />
		<ProseStat>
			<em>"We read to know we're not alone." — C.S. Lewis</em>
		</ProseStat>
	</footer>

</div>

<style>
	/* ── Layout ─────────────────────────────────────────────────────────── */
	.notes-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 48px 24px 80px;
	}

	.content-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 280px;
		gap: 48px;
		align-items: start;
	}

	@media (max-width: 1023px) {
		.content-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.right-rail {
			order: -1;
		}
	}

	/* ── Page head ──────────────────────────────────────────────────────── */
	.page-head {
		margin-bottom: 40px;
	}

	.mono-tag {
		font: 9px/1 var(--font-mono);
		letter-spacing: .28em;
		color: var(--accent);
		text-transform: uppercase;
		display: block;
		margin-bottom: 12px;
	}

	.page-head h1 {
		font-family: var(--font-display);
		font-size: clamp(42px, 7vw, 72px);
		font-weight: 400;
		line-height: .95;
		letter-spacing: -.02em;
		color: var(--cream);
		margin: 0 0 18px;
	}

	.page-head h1 em {
		font-style: italic;
		color: var(--accent);
	}

	.subtitle {
		font-family: var(--font-display);
		font-style: italic;
		font-size: 15px;
		color: var(--muted);
		line-height: 1.6;
		max-width: 640px;
		margin: 0;
	}

	/* ── Toolbar ────────────────────────────────────────────────────────── */
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-bottom: 36px;
	}

	.seg-group {
		display: flex;
		background: var(--raised);
		border: 1px solid rgba(240, 235, 227, .07);
		border-radius: 6px;
		padding: 2px;
		gap: 2px;
	}

	.seg {
		font: 10px/1 var(--font-mono);
		letter-spacing: .14em;
		text-transform: uppercase;
		padding: 6px 12px;
		border-radius: 4px;
		border: none;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		transition: background 120ms, color 120ms;
	}

	.seg:hover {
		color: var(--cream);
	}

	.seg-active {
		background: var(--surface);
		color: var(--cream);
	}

	.search-input {
		font: 12px/1 var(--font-body);
		padding: 7px 12px;
		background: var(--raised);
		border: 1px solid rgba(240, 235, 227, .08);
		border-radius: 6px;
		color: var(--cream);
		outline: none;
		width: 180px;
		transition: border-color 120ms;
	}

	.search-input:focus {
		border-color: var(--accent-dim);
	}

	.search-input::placeholder {
		color: var(--faint);
	}

	.entry-count {
		margin-left: auto;
		font: 10px/1 var(--font-mono);
		letter-spacing: .18em;
		color: var(--faint);
		text-transform: uppercase;
	}

	/* ── Empty state ────────────────────────────────────────────────────── */
	.empty-state {
		padding: 80px 0;
		text-align: center;
	}

	.empty-text {
		font-family: var(--font-display);
		font-style: italic;
		color: var(--muted);
		margin-top: 20px;
	}

	/* ── Book group ─────────────────────────────────────────────────────── */
	.book-group {
		margin-bottom: 48px;
		padding-bottom: 48px;
		border-bottom: 1px solid rgba(240, 235, 227, .05);
	}

	.book-group:last-child {
		border-bottom: none;
	}

	.book-head {
		display: grid;
		grid-template-columns: 60px 1fr auto;
		gap: 16px;
		align-items: start;
		margin-bottom: 20px;
	}

	.cover-link {
		display: block;
		text-decoration: none;
	}

	.book-meta {
		min-width: 0;
	}

	.book-title {
		font-family: var(--font-display);
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -.01em;
		color: var(--cream);
		margin: 0 0 4px;
		line-height: 1.15;
	}

	:global(.book-title em) {
		color: var(--accent);
		font-style: italic;
	}

	.book-author {
		font-family: var(--font-display);
		font-style: italic;
		font-size: 13px;
		color: var(--muted);
		margin: 0;
	}

	.book-right {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		padding-top: 2px;
		flex-shrink: 0;
	}

	.book-count {
		font: 22px/1 var(--font-display);
		font-weight: 700;
		color: var(--accent);
	}

	.book-link {
		font: 9px/1 var(--font-mono);
		letter-spacing: .2em;
		color: var(--accent-dim);
		text-decoration: none;
		text-transform: uppercase;
		transition: color 120ms;
	}

	.book-link:hover {
		color: var(--accent);
	}

	/* ── Cards grid ─────────────────────────────────────────────────────── */
	.cards-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}

	@media (max-width: 640px) {
		.cards-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	/* ── Quote cards ────────────────────────────────────────────────────── */
	.qcard {
		position: relative;
		border-radius: 6px;
		padding: 18px 18px 14px;
		overflow: hidden;
	}

	.qcard.highlight {
		background: rgba(212, 162, 83, .07);
		border: 1px solid rgba(212, 162, 83, .15);
	}

	.qcard.note {
		background: var(--raised);
		border: 1px solid rgba(240, 235, 227, .06);
		border-left: 3px solid var(--steel);
	}

	.glyph {
		position: absolute;
		top: 6px;
		right: 12px;
		font-family: var(--font-display);
		font-size: 52px;
		line-height: 1;
		color: rgba(212, 162, 83, .12);
		pointer-events: none;
		user-select: none;
	}

	.qcard.note .glyph {
		color: rgba(61, 143, 132, .12);
		font-size: 36px;
		top: 8px;
		right: 10px;
	}

	.qtext {
		font-family: var(--font-display);
		font-size: 14px;
		line-height: 1.6;
		color: var(--cream);
		margin: 0 0 10px;
		position: relative;
	}

	.qcard.highlight .qtext {
		font-style: italic;
	}

	.qcard.note .qtext {
		font-style: normal;
		font-size: 13px;
	}

	.qnote {
		font-family: var(--font-display);
		font-style: italic;
		font-size: 12px;
		color: var(--accent-lt);
		margin: 0 0 10px;
		opacity: .85;
	}

	.qmeta {
		font: 10px/1 var(--font-mono);
		letter-spacing: .12em;
		color: var(--faint);
		text-transform: uppercase;
	}

	/* ── Right rail ─────────────────────────────────────────────────────── */
	.right-rail {
		position: sticky;
		top: 24px;
	}

	.rail-stat {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 4px;
	}

	.rail-big {
		font-family: var(--font-display);
		font-size: 40px;
		font-weight: 700;
		color: var(--accent);
		line-height: 1;
	}

	.rail-unit {
		font: 10px/1 var(--font-mono);
		letter-spacing: .2em;
		color: var(--muted);
		text-transform: uppercase;
	}

	.rail-sub {
		font: 9px/1 var(--font-mono);
		letter-spacing: .15em;
		color: var(--faint);
		text-transform: uppercase;
		margin: 0;
	}

	.tag-cloud {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font: 10px/1 var(--font-mono);
		letter-spacing: .12em;
		text-transform: uppercase;
		color: var(--muted);
		background: var(--raised);
		border: 1px solid rgba(240, 235, 227, .08);
		border-radius: 3px;
		padding: 4px 8px;
	}

	.tag-badge {
		background: var(--surface);
		color: var(--accent);
		border-radius: 2px;
		padding: 1px 5px;
		font-size: 9px;
	}

	.rail-book-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.rail-book-link {
		font-family: var(--font-display);
		font-style: italic;
		font-size: 13px;
		color: var(--muted);
		text-decoration: none;
		transition: color 120ms;
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rail-book-link:hover {
		color: var(--cream);
	}

	.rail-empty {
		font: 11px/1 var(--font-mono);
		color: var(--faint);
	}

	.export-labels {
		display: flex;
		gap: 10px;
	}

	.export-label {
		font: 9px/1 var(--font-mono);
		letter-spacing: .2em;
		color: var(--faint);
		text-transform: uppercase;
		border: 1px solid rgba(240, 235, 227, .08);
		border-radius: 3px;
		padding: 4px 8px;
		cursor: default;
	}

	/* ── Footer ─────────────────────────────────────────────────────────── */
	.page-footer {
		margin-top: 64px;
		text-align: center;
	}
</style>
