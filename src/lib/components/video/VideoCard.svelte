<script lang="ts">
	import { Play } from 'lucide-svelte';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { setActiveTransition } from '$lib/transition';
	import { lowResImageUrl } from '$lib/image-hint';
	import { formatDuration, formatViews } from '$lib/utils/video-format';

	interface Props {
		video: UnifiedMedia;
		onclick?: () => void;
		onchannelclick?: () => void;
		showChannel?: boolean;
		layout?: 'grid' | 'list';
	}

	let { video, onclick, onchannelclick, showChannel = true, layout = 'grid' }: Props = $props();

	let hovered = $state(false);
	let imageError = $state(false);
	let imgLoaded = $state(false);
	let cardEl: HTMLButtonElement | undefined = $state();
	let tiltX = $state(0);
	let tiltY = $state(0);

	const lowResSrc = $derived(lowResImageUrl(video.poster));

	const duration = $derived(formatDuration(video.duration));
	const channel = $derived((video.metadata?.author as string) ?? '');
	const views = $derived(formatViews(video.metadata?.viewCount as number | undefined));
	const uploadDate = $derived.by(() => {
		const pub = video.metadata?.published as number | undefined;
		if (!pub || typeof pub !== 'number') return '';
		const d = new Date(pub * 1000);
		return isNaN(d.getTime()) ? '' : d.toISOString();
	});

	const timeAgo = $derived.by(() => {
		if (!uploadDate) return '';
		const date = new Date(uploadDate);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return '1 day ago';
		if (diffDays < 7) return `${diffDays} days ago`;
		if (diffDays < 30) {
			const w = Math.floor(diffDays / 7);
			return `${w} week${w > 1 ? 's' : ''} ago`;
		}
		if (diffDays < 365) {
			const m = Math.floor(diffDays / 30);
			return `${m} month${m > 1 ? 's' : ''} ago`;
		}
		return `${Math.floor(diffDays / 365)} years ago`;
	});

	let tiltFrame = 0;
	function handleMouseMove(e: MouseEvent) {
		if (!cardEl || !hovered) return;
		cancelAnimationFrame(tiltFrame);
		tiltFrame = requestAnimationFrame(() => {
			if (!cardEl) return;
			const rect = cardEl.getBoundingClientRect();
			const x = (e.clientX - rect.left) / rect.width;
			const y = (e.clientY - rect.top) / rect.height;
			tiltX = (y - 0.5) * -6;
			tiltY = (x - 0.5) * 6;
		});
	}

	function handleMouseLeave() {
		hovered = false;
		tiltX = 0;
		tiltY = 0;
	}

	function handleClick() {
		setActiveTransition(video.id);
		const el = cardEl?.querySelector('img') ?? document.querySelector(`[data-media-id="${video.id}"]`);
		if (el) (el as HTMLElement).style.viewTransitionName = `media-${video.id}`;
		onclick?.();
	}
</script>

{#if layout === 'list'}
	<button
		class="group flex w-full gap-4 rounded-xl p-2 text-left transition-colors duration-150 hover:bg-cream/[0.03]"
		onclick={handleClick}
		onmouseenter={() => (hovered = true)}
		onmouseleave={() => (hovered = false)}
	>
		<!-- Thumbnail -->
		<div class="relative w-40 flex-shrink-0 overflow-hidden rounded-lg aspect-video sm:w-44"
			style="box-shadow: {hovered ? '0 4px 20px rgba(196, 92, 92, 0.12)' : 'none'}; transition: box-shadow 0.2s ease;">
			{#if video.poster && !imageError}
				{#if lowResSrc && !imgLoaded}
					<img
						src={lowResSrc}
						alt=""
						aria-hidden="true"
						class="absolute inset-0 h-full w-full object-cover blur-lg scale-110"
						loading="lazy"
						decoding="async"
					/>
				{/if}
				<img
					src={video.poster}
					alt={video.title}
					class="relative h-full w-full object-cover transition-transform duration-200 ease-out"
					class:scale-105={hovered}
					data-media-id={video.id}
					loading="lazy"
					decoding="async"
					onload={() => (imgLoaded = true)}
					onerror={() => (imageError = true)}
				/>
			{:else}
				<div class="flex h-full w-full items-center justify-center bg-gradient-to-br from-nexus-surface to-nexus-base">
					<span class="text-xs text-muted/50">No thumbnail</span>
				</div>
			{/if}

			<!-- Hover play icon -->
			<div
				class="absolute inset-0 flex items-center justify-center transition-opacity duration-150"
				style="opacity: {hovered ? 1 : 0}; background: rgba(13, 11, 10, 0.35);"
			>
				<div class="flex h-8 w-8 items-center justify-center rounded-full bg-cream/90 shadow-lg">
					<Play size={14} class="ml-0.5 text-nexus-void" fill="currentColor" />
				</div>
			</div>

			{#if duration}
				<span class="absolute bottom-1.5 right-1.5 rounded bg-nexus-void/85 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-cream/90"
					style="box-shadow: 0 0 8px rgba(13, 11, 10, 0.5);">
					{duration}
				</span>
			{/if}
		</div>

		<!-- Details -->
		<div class="flex min-w-0 flex-1 flex-col justify-center py-0.5">
			<h3 class="line-clamp-2 text-sm font-medium leading-snug text-cream/85 transition-colors duration-150 group-hover:text-cream">
				{video.title}
			</h3>
			{#if showChannel && channel}
				{#if onchannelclick}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="mt-1.5 block cursor-pointer text-xs text-muted/60 transition-colors hover:text-warm"
						onclick={(e) => { e.stopPropagation(); onchannelclick?.(); }}
						onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onchannelclick?.(); } }}
						role="link"
						tabindex={0}
					>{channel}</span>
				{:else}
					<p class="mt-1.5 text-xs text-muted/60 transition-colors group-hover:text-muted/80">{channel}</p>
				{/if}
			{/if}
			<p class="mt-0.5 text-[11px] text-faint/70">
				{#if views}{views} views{/if}
				{#if views && timeAgo}<span class="mx-1 text-faint/40">·</span>{/if}
				{#if timeAgo}{timeAgo}{/if}
			</p>
		</div>
	</button>
{:else}
	<button
		bind:this={cardEl}
		class="nexus-perspective group w-full cursor-pointer text-left outline-none"
		onmouseenter={() => (hovered = true)}
		onmouseleave={handleMouseLeave}
		onmousemove={handleMouseMove}
		onfocus={() => (hovered = true)}
		onblur={() => { hovered = false; tiltX = 0; tiltY = 0; }}
		onclick={handleClick}
		aria-label="Watch {video.title}"
	>
		<!-- Thumbnail with 3D tilt -->
		<div
			class="relative overflow-hidden rounded-xl aspect-video transition-[transform,box-shadow] duration-300 ease-out"
			style="transform: rotateX({tiltX}deg) rotateY({tiltY}deg) scale({hovered ? 1.02 : 1});
				box-shadow: {hovered
					? '0 8px 32px rgba(196, 92, 92, 0.18), 0 16px 48px rgba(13, 11, 10, 0.7)'
					: '0 2px 8px rgba(13, 11, 10, 0.3)'};"
		>
			{#if video.poster && !imageError}
				{#if lowResSrc && !imgLoaded}
					<img
						src={lowResSrc}
						alt=""
						aria-hidden="true"
						class="absolute inset-0 h-full w-full object-cover blur-lg scale-110"
						loading="lazy"
						decoding="async"
					/>
				{/if}
				<img
					src={video.poster}
					alt={video.title}
					class="relative h-full w-full object-cover transition-transform duration-300 ease-out"
					class:scale-[1.08]={hovered}
					data-media-id={video.id}
					loading="lazy"
					decoding="async"
					onload={() => (imgLoaded = true)}
					onerror={() => (imageError = true)}
				/>
			{:else}
				<div class="flex h-full w-full items-end bg-gradient-to-br from-nexus-surface via-warm/10 to-nexus-base p-3">
					<span class="font-display text-sm font-bold leading-tight text-cream/60">{video.title}</span>
				</div>
			{/if}

			<!-- Cinematic hover overlay -->
			<div
				class="pointer-events-none absolute inset-0 transition-opacity duration-200"
				class:opacity-0={!hovered}
				class:opacity-100={hovered}
				style="background: linear-gradient(to top, rgba(13,11,10,0.8) 0%, rgba(13,11,10,0.15) 40%, transparent 100%);"
			></div>

			<!-- Centered play button on hover -->
			<div
				class="absolute inset-0 flex items-center justify-center transition-[transform,opacity] duration-200 ease-out"
				style="opacity: {hovered ? 1 : 0}; transform: scale({hovered ? 1 : 0.7});"
			>
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-cream/90 shadow-xl"
					style="box-shadow: 0 0 24px rgba(240, 235, 227, 0.25), 0 4px 16px rgba(13, 11, 10, 0.4);">
					<Play size={20} class="ml-0.5 text-nexus-void" fill="currentColor" />
				</div>
			</div>

			<!-- Duration badge -->
			{#if duration}
				<span class="absolute bottom-2 right-2 z-10 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-cream/90"
					style="background: rgba(13, 11, 10, 0.75); box-shadow: 0 0 12px rgba(13, 11, 10, 0.4);">
					{duration}
				</span>
			{/if}

			<!-- Shine sweep on hover -->
			{#if hovered}
				<div
					class="pointer-events-none absolute inset-0 z-10 opacity-[0.06]"
					style="background: linear-gradient(135deg, rgba(255,255,255,0.5) 0%, transparent 35%, transparent 65%, rgba(255,255,255,0.15) 100%);"
					aria-hidden="true"
				></div>
			{/if}
		</div>

		<!-- Info below thumbnail -->
		<div class="mt-2.5 px-0.5">
			<h3 class="line-clamp-2 text-[13px] font-medium leading-snug text-cream/85 transition-colors duration-150 group-hover:text-cream">
				{video.title}
			</h3>
			{#if showChannel && channel}
				{#if onchannelclick}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="mt-1 block cursor-pointer text-xs text-muted/60 transition-colors hover:text-warm"
						onclick={(e) => { e.stopPropagation(); onchannelclick?.(); }}
						onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onchannelclick?.(); } }}
						role="link"
						tabindex={0}
					>{channel}</span>
				{:else}
					<p class="mt-1 text-xs text-muted/60">{channel}</p>
				{/if}
			{/if}
			<p class="mt-0.5 text-[11px] text-faint/70">
				{#if views}{views} views{/if}
				{#if views && timeAgo}<span class="mx-1 text-faint/40">·</span>{/if}
				{#if timeAgo}{timeAgo}{/if}
			</p>
		</div>
	</button>
{/if}
