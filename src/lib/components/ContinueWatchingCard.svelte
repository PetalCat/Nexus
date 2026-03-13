<script lang="ts">
	import type { HomepageItem } from '$lib/types/homepage';
	import { goto } from '$app/navigation';

	interface Props {
		item: HomepageItem;
	}

	let { item }: Props = $props();

	const detailUrl = $derived(`/media/${item.mediaType}/${item.sourceId}?service=${item.serviceId}`);
	const playUrl = $derived(`${detailUrl}&play=1`);
	const isPlayable = $derived(!!item.streamUrl);
	const href = $derived(isPlayable ? playUrl : detailUrl);
	const thumbSrc = $derived(item.backdrop ?? item.poster);

	let imgError = $state(false);

	function handlePlayClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		goto(playUrl);
	}
</script>

<a
	{href}
	class="group relative flex w-40 shrink-0 flex-col gap-1.5 sm:w-48 md:w-56"
>
	<!-- Thumbnail -->
	<div
		class="relative aspect-video w-full overflow-hidden rounded-[10px] bg-[var(--color-raised)] transition-all duration-250 group-hover:scale-[1.03] group-hover:shadow-[0_8px_40px_rgba(0,0,0,0.7),0_0_0_1px_rgba(124,108,248,0.25)]"
	>
		{#if thumbSrc && !imgError}
			<img
				src={thumbSrc}
				alt={item.title}
				class="h-full w-full object-cover transition-opacity duration-300"
				onerror={() => (imgError = true)}
				loading="lazy"
			/>
		{:else}
			<div class="flex h-full w-full items-center justify-center p-4">
				<span class="text-center text-xs text-[var(--color-muted)] leading-tight line-clamp-2">{item.title}</span>
			</div>
		{/if}

		<!-- Progress bar -->
		{#if item.progress != null && item.progress > 0 && item.progress < 1}
			<div class="progress-bar absolute bottom-0 left-0 right-0">
				<div class="progress-fill" style="width: {item.progress * 100}%"></div>
			</div>
		{/if}

		<!-- Play overlay on hover -->
		{#if isPlayable}
			<div
				class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100"
			>
				<button
					class="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-accent)] shadow-[0_0_24px_rgba(212,162,83,0.12)] transition-transform hover:scale-110"
					onclick={handlePlayClick}
					aria-label="Play {item.title}"
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="white">
						<path d="M8 5.14v14l11-7-11-7z" />
					</svg>
				</button>
			</div>
		{/if}
	</div>

	<!-- Info -->
	<div class="min-w-0 px-0.5">
		<p class="truncate text-sm font-medium text-[var(--color-cream)]">{item.title}</p>
		<p class="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
			{#if item.episodeInfo}
				<span class="font-semibold text-[var(--color-accent)]">{item.episodeInfo}</span>
			{/if}
			{#if item.episodeInfo && item.timeRemaining}
				<span class="opacity-40">·</span>
			{/if}
			{#if item.timeRemaining}
				<span>{item.timeRemaining}</span>
			{/if}
		</p>
	</div>
</a>
