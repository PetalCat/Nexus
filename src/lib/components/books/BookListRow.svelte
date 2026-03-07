<script lang="ts">
	import type { UnifiedMedia } from '$lib/adapters/types';

	interface Props {
		item: UnifiedMedia;
	}

	let { item }: Props = $props();

	const detailUrl = $derived(`/media/${item.type}/${item.sourceId}?service=${item.serviceId}`);
	const authorName = $derived((item.metadata?.author as string) ?? '');
	const seriesInfo = $derived(
		item.metadata?.seriesName
			? `${item.metadata.seriesName}${item.metadata.seriesIndex ? ` #${item.metadata.seriesIndex}` : ''}`
			: ''
	);
	const isRead = $derived(item.metadata?.readStatus === true);

	let imgError = $state(false);
</script>

<a
	href={detailUrl}
	class="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--color-hover)] sm:gap-4 sm:px-4"
>
	<!-- Thumbnail -->
	<div class="h-[60px] w-[40px] shrink-0 overflow-hidden rounded bg-[var(--color-raised)]">
		{#if item.poster && !imgError}
			<img
				src={item.poster}
				alt={item.title}
				class="h-full w-full object-cover"
				onerror={() => (imgError = true)}
				loading="lazy"
			/>
		{:else}
			<div class="flex h-full w-full items-center justify-center">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-[var(--color-faint)]">
					<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/>
				</svg>
			</div>
		{/if}
	</div>

	<!-- Info -->
	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-2">
			<p class="truncate text-sm font-medium text-[var(--color-cream)]">{item.title}</p>
			{#if isRead}
				<span class="shrink-0 rounded-full bg-[var(--color-steel)]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-steel)]">Read</span>
			{/if}
		</div>
		<div class="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
			{#if authorName}
				<span class="truncate">{authorName}</span>
			{/if}
			{#if seriesInfo}
				<span class="opacity-40">·</span>
				<span class="truncate text-[var(--color-faint)]">{seriesInfo}</span>
			{/if}
		</div>
	</div>

	<!-- Genres -->
	<div class="hidden items-center gap-1.5 md:flex">
		{#each (item.genres ?? []).slice(0, 2) as genre}
			<span class="rounded-full border border-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]">{genre}</span>
		{/each}
	</div>

	<!-- Rating -->
	<div class="hidden w-14 shrink-0 items-center justify-end gap-0.5 sm:flex">
		{#if item.rating}
			<span class="text-xs text-[var(--color-accent)]">
				<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9 3 10.5l.5-3.5L1 4.5 4.5 4z"/></svg>
			</span>
			<span class="text-xs text-[var(--color-muted)]">{item.rating.toFixed(1)}</span>
		{/if}
	</div>

	<!-- Progress -->
	{#if item.progress != null && item.progress > 0 && item.progress < 1}
		<div class="hidden w-20 shrink-0 items-center gap-2 lg:flex">
			<div class="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface)]">
				<div class="h-full rounded-full bg-[var(--color-accent)]" style="width: {item.progress * 100}%"></div>
			</div>
			<span class="text-[10px] text-[var(--color-faint)]">{Math.round(item.progress * 100)}%</span>
		</div>
	{/if}
</a>
