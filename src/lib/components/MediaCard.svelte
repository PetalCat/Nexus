<script lang="ts">
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { goto } from '$app/navigation';

	interface Props {
		item: UnifiedMedia;
		size?: 'sm' | 'md' | 'lg';
	}

	let { item, size = 'md' }: Props = $props();

	const heights = { sm: 'aspect-[2/3]', md: 'aspect-[2/3]', lg: 'aspect-[2/3]' };

	const statusClass: Record<string, string> = {
		available: 'badge-available',
		requested: 'badge-requested',
		downloading: 'badge-downloading',
		missing: 'badge-missing'
	};

	const detailUrl = $derived(`/media/${item.type}/${item.sourceId}?service=${item.serviceId}`);
	const playUrl = $derived(`${detailUrl}&play=1`);
	const isPlayable = $derived(!!item.streamUrl);

	let imgError = $state(false);

	function handlePlayClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		goto(playUrl);
	}
</script>

<a
	href={detailUrl}
	class="group relative flex w-full flex-col gap-2"
>
	<!-- Poster -->
	<div
		class="relative overflow-hidden rounded-[10px] {heights[size]} w-full bg-[var(--color-raised)] transition-all duration-250 group-hover:scale-[1.03] group-hover:shadow-[0_8px_40px_rgba(0,0,0,0.7),0_0_0_1px_rgba(124,108,248,0.25)]"
	>
		{#if item.poster && !imgError}
			<img
				src={item.poster}
				alt={item.title}
				class="h-full w-full object-cover transition-opacity duration-300"
				onerror={() => (imgError = true)}
				loading="lazy"
			/>
		{:else}
			<div class="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
				<!-- Type icon as SVG -->
				<span class="opacity-25 text-[var(--color-text)]">
					{#if item.type === 'movie'}
						<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="2" y="4" width="20" height="16" rx="2"/>
							<path d="M2 8h20M7 4v4M12 4v4M17 4v4M7 12v4M12 12v4M17 12v4"/>
						</svg>
					{:else if item.type === 'show' || item.type === 'episode'}
						<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="2" y="4" width="20" height="14" rx="2"/>
							<path d="M8 20h8M12 18v2"/>
						</svg>
					{:else if item.type === 'book'}
						<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/>
							<path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/>
							<path d="M4 20h10"/>
						</svg>
					{:else if item.type === 'game'}
						<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="2" y="7" width="20" height="12" rx="3"/>
							<path d="M8 11v4M6 13h4M15 12h2M15 14h2"/>
						</svg>
					{:else if item.type === 'music' || item.type === 'album'}
						<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="9" cy="18" r="3"/>
							<circle cx="18" cy="16" r="3"/>
							<path d="M12 18V8l9-2v2"/>
						</svg>
					{:else if item.type === 'live'}
						<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0"/>
							<circle cx="12" cy="20" r="1" fill="currentColor"/>
						</svg>
					{:else}
						<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
							<rect x="2" y="4" width="20" height="16" rx="2"/>
							<path d="M2 8h20M7 4v4M12 4v4M17 4v4"/>
						</svg>
					{/if}
				</span>
				<span class="text-center text-xs text-[var(--color-muted)] leading-tight line-clamp-3">{item.title}</span>
			</div>
		{/if}

		<!-- Progress bar -->
		{#if item.progress != null && item.progress > 0 && item.progress < 1}
			<div class="progress-bar absolute bottom-0 left-0 right-0">
				<div class="progress-fill" style="width: {item.progress * 100}%"></div>
			</div>
		{/if}

		<!-- Hover overlay (play button only for playable items) -->
		{#if isPlayable}
			<div
				class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100"
			>
				<button
					class="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-nebula)] shadow-[0_0_24px_var(--color-nebula-dim)] transition-transform hover:scale-110"
					onclick={handlePlayClick}
					aria-label="Play {item.title}"
				>
					{#if item.type === 'book'}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
							<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
						</svg>
					{:else if item.type === 'game'}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M6 12h4M8 10v4M15 12h2M15 10h2"/>
							<rect x="2" y="7" width="20" height="12" rx="3"/>
						</svg>
					{:else}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="white">
							<path d="M8 5.14v14l11-7-11-7z"/>
						</svg>
					{/if}
				</button>
			</div>
		{/if}

		<!-- Status badge -->
		{#if item.status && item.status !== 'available'}
			<div class="absolute top-2 right-2">
				<span class="badge {statusClass[item.status] ?? ''} text-[10px]">{item.status}</span>
			</div>
		{/if}
	</div>

	<!-- Info -->
	<div class="min-w-0 px-0.5">
		{#if item.type === 'episode' && item.metadata?.seriesName}
			<p class="truncate text-[10px] font-bold text-[var(--color-nebula)] uppercase tracking-wider mb-[-2px]">
				{item.metadata.seriesName}
				{#if item.metadata.seasonNumber != null && item.metadata.episodeNumber != null}
					<span class="opacity-70 ml-0.5">S{String(item.metadata.seasonNumber).padStart(2, '0')}E{String(item.metadata.episodeNumber).padStart(2, '0')}</span>
				{/if}
			</p>
		{/if}
		<p class="truncate text-sm font-medium text-[var(--color-text)]">{item.title}</p>
		<p class="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
			{#if item.year}
				<span>{item.year}</span>
			{/if}
			{#if item.year && item.rating}
				<span class="opacity-40">·</span>
			{/if}
			{#if item.rating}
				<span class="text-[var(--color-star)]">★</span>
				<span>{item.rating.toFixed(1)}</span>
			{/if}
		</p>
	</div>
</a>
