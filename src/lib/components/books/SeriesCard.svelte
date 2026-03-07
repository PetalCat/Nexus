<script lang="ts">
	import type { UnifiedMedia } from '$lib/adapters/types';

	interface Props {
		series: { name: string; books: UnifiedMedia[] };
	}

	let { series }: Props = $props();

	const covers = $derived(series.books.filter(b => b.poster).slice(0, 3));
	const readCount = $derived(series.books.filter(b => b.metadata?.readStatus === true).length);
</script>

<a
	href="/books?series={encodeURIComponent(series.name)}&tab=all"
	class="group flex flex-col overflow-hidden rounded-xl bg-[var(--color-raised)] transition-all hover:bg-[var(--color-hover)] hover:shadow-[var(--shadow-card)]"
>
	<!-- Stacked covers -->
	<div class="relative flex h-[180px] items-center justify-center overflow-hidden bg-[var(--color-surface)] sm:h-[200px]">
		{#if covers.length >= 3}
			<img src={covers[2].poster} alt="" class="absolute h-[110px] w-auto rounded-sm object-cover opacity-40 shadow-md sm:h-[130px]" style="transform: rotate(-8deg) translateX(-20px)" loading="lazy" />
			<img src={covers[1].poster} alt="" class="absolute h-[120px] w-auto rounded-sm object-cover opacity-60 shadow-md sm:h-[140px]" style="transform: rotate(4deg) translateX(16px)" loading="lazy" />
			<img src={covers[0].poster} alt="" class="relative h-[130px] w-auto rounded-sm object-cover shadow-lg transition-transform duration-300 group-hover:scale-105 sm:h-[150px]" loading="lazy" />
		{:else if covers.length >= 1}
			<img src={covers[0].poster} alt="" class="relative h-[130px] w-auto rounded-sm object-cover shadow-lg transition-transform duration-300 group-hover:scale-105 sm:h-[150px]" loading="lazy" />
		{:else}
			<div class="flex h-full w-full items-center justify-center text-[var(--color-faint)]">
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
					<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/>
				</svg>
			</div>
		{/if}
	</div>

	<!-- Info -->
	<div class="flex flex-col gap-1 p-3">
		<p class="truncate text-sm font-semibold text-[var(--color-cream)]">{series.name}</p>
		<div class="flex items-center justify-between">
			<span class="text-xs text-[var(--color-muted)]">{series.books.length} book{series.books.length === 1 ? '' : 's'}</span>
			{#if readCount > 0}
				<span class="text-[10px] text-[var(--color-steel)]">Read {readCount} of {series.books.length}</span>
			{/if}
		</div>
	</div>
</a>
