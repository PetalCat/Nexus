<script lang="ts">
	let stats = $state<{ booksRead: number; currentStreak: number; pagesRead: number } | null>(null);
	let loading = $state(true);

	$effect(() => {
		fetch('/api/books/stats')
			.then(r => r.ok ? r.json() : null)
			.then(data => {
				if (data) stats = data;
			})
			.catch(() => {})
			.finally(() => { loading = false; });
	});
</script>

{#if !loading && stats}
	<div class="flex items-center gap-4 rounded-xl bg-[var(--color-raised)] px-4 py-3 sm:gap-6">
		<div class="flex items-center gap-2">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-[var(--color-accent)]">
				<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/>
			</svg>
			<div>
				<p class="text-sm font-semibold text-[var(--color-cream)]">{stats.booksRead}</p>
				<p class="text-[10px] text-[var(--color-muted)]">Books this year</p>
			</div>
		</div>

		<div class="h-6 w-px bg-[var(--color-surface)]"></div>

		<div class="flex items-center gap-2">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-[var(--color-steel)]">
				<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
			</svg>
			<div>
				<p class="text-sm font-semibold text-[var(--color-cream)]">{stats.currentStreak}</p>
				<p class="text-[10px] text-[var(--color-muted)]">Day streak</p>
			</div>
		</div>

		<div class="h-6 w-px bg-[var(--color-surface)]"></div>

		<div class="flex items-center gap-2">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-[var(--color-warm)]">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
			</svg>
			<div>
				<p class="text-sm font-semibold text-[var(--color-cream)]">{(stats.pagesRead ?? 0).toLocaleString()}</p>
				<p class="text-[10px] text-[var(--color-muted)]">Pages read</p>
			</div>
		</div>
	</div>
{/if}
