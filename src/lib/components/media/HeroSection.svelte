<script lang="ts">
	import type { UnifiedMedia } from '$lib/types/media-ui';
	import { MEDIA_TYPE_CONFIG } from '$lib/types/media-ui';
	import ActionButton from './ActionButton.svelte';
	import MediaBadge from './MediaBadge.svelte';
	import { Star } from 'lucide-svelte';

	interface Props {
		media: UnifiedMedia;
	}

	let { media }: Props = $props();

	const typeConfig = $derived(MEDIA_TYPE_CONFIG[media.type]);
</script>

<section
	class="nexus-grain relative flex items-end overflow-hidden"
	style="min-height: clamp(380px, 55vh, 640px);"
	aria-label="Featured: {media.title}"
>
	<!-- Background layer -->
	{#if media.image}
		<img
			src={media.image}
			alt=""
			class="absolute inset-0 h-full w-full object-cover animate-ken-burns"
			aria-hidden="true"
		/>
	{:else}
		<div
			class="absolute inset-0 bg-gradient-to-br {typeConfig.gradient}"
			aria-hidden="true"
		></div>
	{/if}

	<!-- Cinematic overlays -->
	<div class="absolute inset-0 bg-gradient-to-t from-nexus-void via-nexus-void/50 to-nexus-void/5" aria-hidden="true"></div>
	<div class="absolute inset-0 bg-gradient-to-r from-nexus-void/90 via-nexus-void/30 to-transparent" aria-hidden="true"></div>
	<div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_40%,rgba(13,11,10,0.6)_100%)]" aria-hidden="true"></div>

	<!-- Content -->
	<div class="relative z-10 flex max-w-2xl flex-col gap-5 px-8 pb-12 lg:px-12 lg:pb-16">
		<div class="animate-fade-in-up" style="animation-delay: 0.1s; opacity: 0">
			<MediaBadge type={media.type} size="md" />
		</div>

		<h1
			class="animate-fade-in-up nexus-title-glow font-display text-4xl font-black leading-[1.05] tracking-tight text-cream sm:text-5xl lg:text-[3.5rem]"
			style="animation-delay: 0.2s; opacity: 0"
		>
			{media.title}
		</h1>

		{#if media.metadata?.year || media.metadata?.runtime || media.metadata?.genre}
			<div
				class="animate-fade-in-up nexus-text-glow flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm"
				style="animation-delay: 0.3s; opacity: 0"
			>
				{#if media.metadata.rating}
					<span class="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5">
						<Star size={12} class="fill-accent text-accent" />
						<span class="font-semibold text-accent">{media.metadata.rating}</span>
					</span>
				{/if}
				{#if media.metadata.year}
					<span class="text-cream/60">{media.metadata.year}</span>
				{/if}
				{#if media.metadata.runtime}
					<span class="text-cream/20" aria-hidden="true">&bull;</span>
					<span class="text-cream/60">{media.metadata.runtime}</span>
				{/if}
				{#if media.metadata.genre}
					<span class="text-cream/20" aria-hidden="true">&bull;</span>
					<span class="text-cream/60">{media.metadata.genre}</span>
				{/if}
			</div>
		{/if}

		<p
			class="animate-fade-in-up nexus-text-glow line-clamp-2 max-w-lg font-body text-sm leading-relaxed text-cream/50 lg:text-[15px]"
			style="animation-delay: 0.35s; opacity: 0"
		>
			{media.description}
		</p>

		<div
			class="animate-fade-in-up flex items-center gap-4 pt-2"
			style="animation-delay: 0.45s; opacity: 0"
		>
			{#if media.action}
				<ActionButton action={media.action} size="lg" />
			{/if}
			{#if media.progress && media.progress > 0}
				<div class="flex items-center gap-2">
					<div class="h-1 w-16 overflow-hidden rounded-full bg-cream/10">
						<div class="h-full rounded-full bg-accent/70" style="width: {media.progress * 100}%"></div>
					</div>
					<span class="text-xs text-cream/40">{Math.round(media.progress * 100)}%</span>
				</div>
			{/if}
		</div>
	</div>
</section>
