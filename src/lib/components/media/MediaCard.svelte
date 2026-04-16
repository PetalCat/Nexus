<script lang="ts">
	import { Heart } from 'lucide-svelte';
	import type { UnifiedMedia } from '$lib/types/media-ui';
	import { MEDIA_TYPE_CONFIG } from '$lib/types/media-ui';
	import { setActiveTransition } from '$lib/transition';
	import { lowResImageUrl } from '$lib/image-hint';
	import MediaBadge from './MediaBadge.svelte';
	import ProgressBar from './ProgressBar.svelte';

	interface Props {
		media: UnifiedMedia;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		fill?: boolean;
		showProgress?: boolean;
		showBadge?: boolean;
		forceAspect?: 'portrait' | 'square' | 'video' | null;
		isFavorite?: boolean;
		onfavoritetoggle?: () => void;
		onclick?: () => void;
	}

	let { media, size = 'md', fill = false, showProgress = false, showBadge = true, forceAspect = null, isFavorite, onfavoritetoggle, onclick }: Props = $props();

	const metaLine = $derived(
		media.metadata?.year ? String(media.metadata.year) :
		media.metadata?.artist ? String(media.metadata.artist) :
		media.metadata?.author ? String(media.metadata.author) :
		media.metadata?.platform ? String(media.metadata.platform) :
		''
	);

	let hovered = $state(false);
	let imageError = $state(false);
	let imageLoaded = $state(false);
	let cardEl: HTMLButtonElement | undefined = $state();
	let tiltX = $state(0);
	let tiltY = $state(0);

	// Low-res placeholder derived from the full-res URL. On fast links this is
	// pre-empted by the full-res image and never paints; on slow links it
	// gives the user a recognizable blur until the full-res arrives.
	const lowResSrc = $derived(lowResImageUrl(media.image));

	const sizeClasses: Record<string, string> = {
		sm: 'w-[130px] md:w-[145px]',
		md: 'w-[155px] md:w-[185px]',
		lg: 'w-[185px] md:w-[220px]',
		xl: 'w-[200px] md:w-[230px]'
	};

	const naturalAspect = $derived(
		media.type === 'music' ? 'aspect-square' :
		media.type === 'video' ? 'aspect-video' :
		(media.type === 'movie' || media.type === 'show' || media.type === 'book' || media.type === 'game') ? 'aspect-[2/3]' :
		'aspect-video'
	);
	const aspect = $derived(
		forceAspect === 'portrait' ? 'aspect-[2/3]' :
		forceAspect === 'square' ? 'aspect-square' :
		forceAspect === 'video' ? 'aspect-video' :
		naturalAspect
	);
	const typeConfig = $derived(MEDIA_TYPE_CONFIG[media.type]);
	const hasProgress = $derived(showProgress && media.progress != null && media.progress > 0);

	const glowColors: Record<string, string> = {
		movie: 'rgba(212, 162, 83, 0.25)',
		show: 'rgba(61, 143, 132, 0.25)',
		music: 'rgba(184, 134, 46, 0.25)',
		book: 'rgba(86, 169, 157, 0.25)',
		game: 'rgba(196, 92, 92, 0.25)',
		live: 'rgba(196, 92, 92, 0.25)',
		video: 'rgba(229, 69, 69, 0.25)'
	};

	let tiltFrame = 0;
	function handleMouseMove(e: MouseEvent) {
		if (!cardEl || !hovered) return;
		cancelAnimationFrame(tiltFrame);
		tiltFrame = requestAnimationFrame(() => {
			if (!cardEl) return;
			const rect = cardEl.getBoundingClientRect();
			const x = (e.clientX - rect.left) / rect.width;
			const y = (e.clientY - rect.top) / rect.height;
			tiltX = (y - 0.5) * -8;
			tiltY = (x - 0.5) * 8;
		});
	}

	function handleMouseLeave() {
		hovered = false;
		tiltX = 0;
		tiltY = 0;
	}

	function handleClick() {
		setActiveTransition(media.id);
		const img = cardEl?.querySelector('img');
		if (img) img.style.viewTransitionName = `media-${media.id}`;
		onclick?.();
	}
</script>

<button
	bind:this={cardEl}
	class="nexus-perspective tv-card-scale group relative cursor-pointer text-left outline-none {fill ? 'w-full' : `flex-shrink-0 ${sizeClasses[size]}`}"
	onmouseenter={() => (hovered = true)}
	onmouseleave={handleMouseLeave}
	onmousemove={handleMouseMove}
	onfocus={() => (hovered = true)}
	onblur={() => { hovered = false; tiltX = 0; tiltY = 0; }}
	onclick={handleClick}
	aria-label="View {media.title}"
>
	<div
		class="relative overflow-hidden rounded-xl transition-[transform,box-shadow] duration-300 ease-out {aspect}"
		style="transform: rotateX({tiltX}deg) rotateY({tiltY}deg) scale({hovered ? 1.03 : 1});
			box-shadow: {hovered
			? `0 8px 32px ${glowColors[media.type]}, 0 16px 48px rgba(13, 11, 10, 0.7)`
			: '0 2px 8px rgba(13, 11, 10, 0.3)'};"
	>
		{#if media.image && !imageError}
			{#if !imageLoaded}
				<div class="absolute inset-0 skeleton-bone"></div>
			{/if}
			{#if lowResSrc && !imageLoaded}
				<!-- Blurred LQIP behind the main image. Paints in ~100 ms on slow
				     links. On fast LAN the full-res below loads first and the
				     main <img> above covers this before it's visible. -->
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
				src={media.image}
				alt={media.title}
				class="relative h-full w-full object-cover transition-transform duration-300 ease-out"
				class:scale-[1.08]={hovered}
				class:opacity-0={!imageLoaded}
				data-media-id={media.id}
				loading="lazy"
				decoding="async"
				onload={() => (imageLoaded = true)}
				onerror={() => (imageError = true)}
			/>
		{:else}
			<div
				class="flex h-full w-full items-end bg-gradient-to-br p-3 {typeConfig.gradient}"
			>
				<span class="font-display text-base font-bold leading-tight text-cream/70">{media.title}</span>
			</div>
		{/if}

		<!-- Hover overlay -->
		<div
			class="pointer-events-none absolute inset-0 transition-opacity duration-200"
			class:opacity-0={!hovered}
			class:opacity-100={hovered}
			style="background: linear-gradient(to top, rgba(13,11,10,0.85) 0%, rgba(13,11,10,0.2) 50%, transparent 100%);"
		></div>

		<!-- Badge -->
		{#if showBadge}
			<div
				class="absolute left-2 top-2 z-10 transition-opacity duration-200"
				class:opacity-70={!hovered}
				class:opacity-100={hovered}
			>
				<MediaBadge type={media.type} />
			</div>
		{/if}

		<!-- Favorite heart -->
		{#if onfavoritetoggle}
			<div
				onclick={(e) => { e.stopPropagation(); onfavoritetoggle?.(); }}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onfavoritetoggle?.(); } }}
				role="button"
				tabindex="0"
				class="absolute right-2 top-2 z-20 rounded-full p-1 transition-all duration-300
					{isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
					hover:bg-nexus-void/40"
				aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
			>
				<Heart
					size={14}
					strokeWidth={1.5}
					class={isFavorite ? 'fill-warm text-warm' : 'text-cream/70'}
				/>
			</div>
		{/if}

		<!-- Music equalizer bars -->
		{#if media.type === 'music'}
			<div
				class="absolute right-2.5 top-2.5 z-10 flex h-4 items-end gap-[2px] transition-opacity duration-300"
				class:opacity-0={!hovered}
				class:opacity-100={hovered}
				aria-hidden="true"
			>
				<span class="w-[3px] rounded-full bg-accent/90 animate-equalizer-1"></span>
				<span class="w-[3px] rounded-full bg-accent/90 animate-equalizer-2" style="animation-delay: 0.15s"></span>
				<span class="w-[3px] rounded-full bg-accent/90 animate-equalizer-3" style="animation-delay: 0.3s"></span>
			</div>
		{/if}

		<!-- Metadata on hover -->
		<div
			class="absolute inset-x-0 bottom-0 z-10 p-3 transition-[transform,opacity] duration-200 ease-out"
			style="transform: translateY({hovered ? '0' : '8px'}); opacity: {hovered ? 1 : 0};"
		>
			{#if media.image && !imageError}
				<h3 class="line-clamp-2 font-display text-sm font-bold leading-tight text-cream">
					{media.title}
				</h3>
			{/if}
			{#if media.metadata?.year}
				<p class="mt-0.5 text-[11px] text-cream/50">{media.metadata.year}</p>
			{:else if media.metadata?.artist}
				<p class="mt-0.5 text-[11px] text-cream/50">{media.metadata.artist}</p>
			{:else if media.metadata?.author}
				<p class="mt-0.5 text-[11px] text-cream/50">{media.metadata.author}</p>
			{/if}
		</div>

		<!-- Progress bar -->
		{#if hasProgress}
			<div class="absolute inset-x-0 bottom-0 z-20">
				<ProgressBar value={media.progress!} glow />
			</div>
		{/if}

		<!-- Shine effect on hover -->
		{#if hovered}
			<div
				class="pointer-events-none absolute inset-0 z-10 opacity-[0.07]"
				style="background: linear-gradient(135deg, rgba(255,255,255,0.4) 0%, transparent 40%, transparent 60%, rgba(255,255,255,0.1) 100%);"
				aria-hidden="true"
			></div>
		{/if}
	</div>

	<!-- Persistent metadata below card -->
	<div class="mt-1.5 px-0.5">
		<p class="truncate text-xs font-medium text-cream/80">{media.title}</p>
		{#if metaLine}
			<p class="truncate text-[11px] text-muted/60">{metaLine}</p>
		{/if}
	</div>
</button>
