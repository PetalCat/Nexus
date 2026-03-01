<script lang="ts">
	import type { UnifiedMedia } from '$lib/adapters/types';

	interface Props {
		item: UnifiedMedia;
		size?: 'sm' | 'md' | 'lg';
	}

	let { item, size = 'md' }: Props = $props();

	const widths = { sm: 'w-32', md: 'w-44', lg: 'w-56' };
	const heights = { sm: 'h-48', md: 'h-64', lg: 'h-80' };

	const typeIcon: Record<string, string> = {
		movie: '🎬',
		show: '📺',
		episode: '📺',
		book: '📚',
		game: '🎮',
		music: '🎵',
		album: '💿',
		live: '📡'
	};

	const statusClass: Record<string, string> = {
		available: 'badge-available',
		requested: 'badge-requested',
		downloading: 'badge-downloading',
		missing: 'badge-missing'
	};

	let imgError = $state(false);
</script>

<a
	href="/media/{item.type}/{item.sourceId}?service={item.serviceId}"
	class="group relative flex flex-col gap-2 {widths[size]}"
>
	<!-- Poster -->
	<div
		class="relative overflow-hidden rounded-[10px] {heights[size]} bg-[var(--color-raised)] transition-transform duration-200 group-hover:scale-[1.03] group-hover:shadow-[var(--shadow-float)]"
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
			<div class="flex h-full w-full flex-col items-center justify-center gap-2 p-4">
				<span class="text-3xl opacity-40">{typeIcon[item.type] ?? '🎬'}</span>
				<span class="text-center text-xs text-[var(--color-muted)] leading-tight line-clamp-3"
					>{item.title}</span
				>
			</div>
		{/if}

		<!-- Progress bar -->
		{#if item.progress != null && item.progress > 0 && item.progress < 1}
			<div class="progress-bar absolute bottom-0 left-0 right-0">
				<div class="progress-fill" style="width: {item.progress * 100}%"></div>
			</div>
		{/if}

		<!-- Hover overlay -->
		<div
			class="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100"
		>
			<div
				class="btn btn-primary flex h-10 w-10 items-center justify-center rounded-full p-0 text-sm"
			>
				{#if item.type === 'book'}
					📖
				{:else if item.type === 'game'}
					🎮
				{:else if item.type === 'music' || item.type === 'album'}
					▶
				{:else}
					▶
				{/if}
			</div>
		</div>

		<!-- Status badge -->
		{#if item.status && item.status !== 'available'}
			<div class="absolute top-2 right-2">
				<span class="badge {statusClass[item.status] ?? ''} text-[10px]">{item.status}</span>
			</div>
		{/if}
	</div>

	<!-- Info -->
	<div class="min-w-0 px-0.5">
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
