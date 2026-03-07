<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let filterColor = $state('all');
	let sortBy = $state<'date' | 'book'>('date');
	let searchText = $state('');

	const colorOptions = ['all', 'yellow', 'green', 'blue', 'pink'] as const;

	const colorMap: Record<string, string> = {
		yellow: '#d4a253',
		green: '#3d8f84',
		blue: '#5b8dca',
		pink: '#c45c5c'
	};

	const filteredHighlights = $derived.by(() => {
		let h = data.highlights;
		if (filterColor !== 'all') h = h.filter(x => x.color === filterColor);
		if (searchText) {
			const q = searchText.toLowerCase();
			h = h.filter(x => x.text.toLowerCase().includes(q) || (x.note?.toLowerCase().includes(q)));
		}
		if (sortBy === 'book') {
			h = [...h].sort((a, b) => a.bookId.localeCompare(b.bookId));
		}
		return h;
	});

	const notesByBook = $derived.by(() => {
		const map = new Map<string, typeof data.notes>();
		for (const n of data.notes) {
			const key = n.bookId;
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(n);
		}
		return map;
	});

	function relativeTime(ts: number) {
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		return `${months}mo ago`;
	}

	function exportMarkdown() {
		let md = '# Reading Notes & Highlights\n\n';
		const byBook = new Map<string, typeof filteredHighlights>();
		for (const h of filteredHighlights) {
			const key = h.bookId;
			if (!byBook.has(key)) byBook.set(key, []);
			byBook.get(key)!.push(h);
		}
		for (const [bookId, items] of byBook) {
			md += `## ${bookId}\n\n`;
			for (const h of items) {
				md += `> ${h.text}\n\n`;
				if (h.note) md += `*${h.note}*\n\n`;
				if (h.chapter) md += `Chapter: ${h.chapter}\n\n`;
				md += `---\n\n`;
			}
		}
		const blob = new Blob([md], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'reading-notes.md';
		a.click();
		URL.revokeObjectURL(url);
	}

	function copyToClipboard() {
		let text = '';
		for (const h of filteredHighlights) {
			text += `"${h.text}"`;
			if (h.note) text += `\n  Note: ${h.note}`;
			text += '\n\n';
		}
		navigator.clipboard.writeText(text);
	}
</script>

<svelte:head>
	<title>Notes & Highlights - Nexus</title>
</svelte:head>

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">
	<!-- Header -->
	<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="font-[var(--font-display)] text-2xl font-bold text-[var(--color-cream)]">Notes & Highlights</h1>
			<p class="mt-1 text-sm text-[var(--color-muted)]">
				{data.highlights.length} highlight{data.highlights.length !== 1 ? 's' : ''}
				· {data.notes.length} note{data.notes.length !== 1 ? 's' : ''}
			</p>
		</div>
		<div class="flex gap-2">
			<button onclick={exportMarkdown} class="rounded-lg bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-cream)]">
				Export Markdown
			</button>
			<button onclick={copyToClipboard} class="rounded-lg bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-cream)]">
				Copy to Clipboard
			</button>
		</div>
	</div>

	<!-- Filter bar -->
	<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
		<!-- Color filter -->
		<div class="flex items-center gap-2">
			<span class="text-xs text-[var(--color-muted)]">Color</span>
			<div class="flex gap-1 rounded-lg bg-[var(--color-surface)] p-1">
				{#each colorOptions as c}
					<button
						onclick={() => filterColor = c}
						class="rounded-md px-2.5 py-1 text-xs font-medium transition-all {filterColor === c
							? 'bg-[var(--color-raised)] text-[var(--color-cream)]'
							: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
					>
						{#if c !== 'all'}
							<span class="mr-1 inline-block h-2 w-2 rounded-full" style="background: {colorMap[c]}"></span>
						{/if}
						{c[0].toUpperCase() + c.slice(1)}
					</button>
				{/each}
			</div>
		</div>

		<!-- Sort -->
		<div class="flex items-center gap-2">
			<span class="text-xs text-[var(--color-muted)]">Sort</span>
			<div class="flex gap-1 rounded-lg bg-[var(--color-surface)] p-1">
				<button
					onclick={() => sortBy = 'date'}
					class="rounded-md px-2.5 py-1 text-xs font-medium transition-all {sortBy === 'date'
						? 'bg-[var(--color-raised)] text-[var(--color-cream)]'
						: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
				>Date</button>
				<button
					onclick={() => sortBy = 'book'}
					class="rounded-md px-2.5 py-1 text-xs font-medium transition-all {sortBy === 'book'
						? 'bg-[var(--color-raised)] text-[var(--color-cream)]'
						: 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
				>Book</button>
			</div>
		</div>

		<!-- Search -->
		<input
			bind:value={searchText}
			class="input w-full text-sm sm:ml-auto sm:w-52"
			placeholder="Search highlights..."
		/>
	</div>

	<!-- Highlights grid -->
	{#if filteredHighlights.length === 0 && data.notes.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
				</svg>
			</div>
			<p class="font-medium">No notes or highlights yet</p>
			<p class="mt-1 text-sm text-[var(--color-muted)]">Highlight text while reading to build your collection.</p>
			<a href="/books" class="btn btn-primary mt-4 text-sm">Browse Books</a>
		</div>
	{:else}
		{#if filteredHighlights.length > 0}
			<section class="mb-10">
				<h2 class="mb-4 text-base font-semibold text-[var(--color-cream)]">Highlights</h2>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each filteredHighlights as h (h.id)}
						{@const borderColor = colorMap[h.color ?? 'yellow'] ?? colorMap.yellow}
						<a
							href="/books/read/{h.bookId}?service={h.serviceId}&cfi={encodeURIComponent(h.cfi)}"
							class="group block rounded-xl bg-[var(--color-raised)] p-4 transition-all hover:bg-[var(--color-surface)] hover:shadow-[var(--shadow-card)]"
						>
							<!-- Quoted text -->
							<div
								class="mb-3 border-l-[3px] pl-3 text-sm italic leading-relaxed text-[var(--color-cream)]"
								style="border-color: {borderColor}"
							>
								<p class="line-clamp-4">{h.text}</p>
							</div>

							<!-- Note -->
							{#if h.note}
								<p class="mb-3 text-xs text-[var(--color-muted)] leading-relaxed">{h.note}</p>
							{/if}

							<!-- Meta -->
							<div class="flex items-center justify-between text-[10px] text-[var(--color-faint)]">
								<div class="flex items-center gap-2">
									{#if h.chapter}
										<span class="rounded bg-[var(--color-surface)] px-1.5 py-0.5">{h.chapter}</span>
									{/if}
									<span>Book {h.bookId}</span>
								</div>
								<span>{relativeTime(h.createdAt)}</span>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Notes section grouped by book -->
		{#if notesByBook.size > 0}
			<section>
				<h2 class="mb-4 text-base font-semibold text-[var(--color-cream)]">Notes</h2>
				{#each [...notesByBook] as [bookId, bookNotes] (bookId)}
					<div class="mb-6">
						<h3 class="mb-3 text-sm font-medium text-[var(--color-accent)]">Book {bookId}</h3>
						<div class="space-y-2">
							{#each bookNotes as note (note.id)}
								<div class="rounded-xl bg-[var(--color-raised)] p-4">
									<p class="text-sm text-[var(--color-cream)] whitespace-pre-wrap">{note.content}</p>
									<p class="mt-2 text-[10px] text-[var(--color-faint)]">{relativeTime(note.updatedAt)}</p>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</section>
		{/if}
	{/if}
</div>
