<script lang="ts">
	import type { UnifiedMedia, SubtitleStatus, FriendProfile, SocialSession } from '$lib/types/media-ui';
	import { MEDIA_TYPE_CONFIG } from '$lib/types/media-ui';
	import ActionButton from './ActionButton.svelte';
	import Breadcrumb from './Breadcrumb.svelte';
	import MediaBadge from './MediaBadge.svelte';
	import ProgressBar from './ProgressBar.svelte';
	import { Star, ChevronDown } from 'lucide-svelte';

	interface Props {
		media: UnifiedMedia;
		parentLabel?: string;
		parentHref?: string;
		subtitleStatus?: SubtitleStatus | null;
		friendsWatched?: FriendProfile[];
		activeSession?: SocialSession | null;
	}

	let { media, parentLabel, parentHref, subtitleStatus = null, friendsWatched = [], activeSession = null }: Props = $props();
	let subtitlesOpen = $state(false);

	const typeConfig = $derived(MEDIA_TYPE_CONFIG[media.type]);
	const metaEntries = $derived(
		Object.entries(media.metadata).filter(([k]) => !['year', 'rating'].includes(k))
	);
</script>

<article class="mx-auto max-w-5xl px-6 py-12 lg:px-10">
	{#if parentLabel && parentHref}
		<div class="mb-6">
			<Breadcrumb crumbs={[{ label: parentLabel, href: parentHref }, { label: media.title }]} />
		</div>
	{/if}
	<div class="flex flex-col gap-10 md:flex-row md:gap-14">
		<!-- Poster -->
		<div class="w-full flex-shrink-0 md:w-72 lg:w-80">
			<div class="relative aspect-[2/3] overflow-hidden rounded-2xl" style="box-shadow: 0 8px 40px rgba(13,11,10,0.6), 0 0 80px rgba(212,162,83,0.05);">
				{#if media.image}
					<img
						src={media.image}
						alt="{media.title} poster"
						class="h-full w-full object-cover"
						data-media-id={media.id}
						style="view-transition-name: media-{media.id}"
					/>
				{:else}
					<div class="flex h-full w-full items-end bg-gradient-to-br p-6 {typeConfig.gradient}">
						<span class="font-display text-2xl font-bold leading-tight text-cream/80">
							{media.title}
						</span>
					</div>
				{/if}
				{#if media.progress && media.progress > 0}
					<div class="absolute inset-x-0 bottom-0">
						<ProgressBar value={media.progress} height="normal" glow />
					</div>
				{/if}
			</div>
		</div>

		<!-- Info -->
		<div class="flex flex-1 flex-col gap-5">
			<div class="flex items-center gap-3 animate-fade-in-up" style="animation-delay: 0.15s; opacity: 0">
				<MediaBadge type={media.type} size="md" />
				{#if media.metadata.rating}
					<span class="flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 ring-1 ring-accent/20">
						<Star size={12} class="fill-accent text-accent" />
						<span class="text-xs font-semibold text-accent">{media.metadata.rating}</span>
					</span>
				{/if}
			</div>

			<h1 class="font-display text-4xl font-black leading-tight tracking-tight text-cream lg:text-5xl animate-fade-in-up" style="animation-delay: 0.2s; opacity: 0">
				{media.title}
			</h1>

			{#if media.metadata.year}
				<p class="text-sm text-muted animate-fade-in-up" style="animation-delay: 0.25s; opacity: 0">{media.metadata.year}</p>
			{/if}

			<p class="max-w-lg font-body text-[15px] leading-relaxed text-muted/80 animate-fade-in-up" style="animation-delay: 0.3s; opacity: 0">
				{media.description}
			</p>

			<!-- Metadata grid -->
			{#if metaEntries.length > 0}
				<div class="mt-3 grid grid-cols-2 gap-x-10 gap-y-3 sm:grid-cols-3 animate-fade-in-up" style="animation-delay: 0.35s; opacity: 0">
					{#each metaEntries as [key, val]}
						<div>
							<span class="font-body text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
								{key}
							</span>
							<p class="mt-0.5 text-sm text-cream/90">{val}</p>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Subtitles collapsible -->
			{#if subtitleStatus}
				<div class="animate-fade-in-up" style="animation-delay: 0.38s; opacity: 0">
					<button
						class="group/subs flex w-full items-center gap-3 rounded-xl bg-cream/[0.03] px-4 py-3 transition-colors hover:bg-cream/[0.05]"
						onclick={() => (subtitlesOpen = !subtitlesOpen)}
					>
						<div class="h-5 w-1 rounded-full {subtitleStatus.searchNeeded ? 'bg-accent' : 'bg-steel'}"></div>
						<span class="text-sm font-semibold text-cream/80">Subtitles</span>
						<div class="flex-1 text-left">
							<span class="text-xs text-faint">
								{subtitleStatus.available.length} available, {subtitleStatus.missing.length} missing
							</span>
						</div>
						<ChevronDown
							size={16}
							class="text-faint transition-transform duration-300 {subtitlesOpen ? 'rotate-180' : ''}"
						/>
					</button>
					{#if subtitlesOpen}
						<div class="animate-fade-in mt-2 rounded-xl border border-cream/[0.06] bg-cream/[0.02] px-4 py-4" style="opacity: 0">
							<div class="flex flex-col gap-2">
								{#each subtitleStatus.available as track}
									<div class="flex items-center gap-2 text-xs text-cream/70">
										<span class="rounded bg-steel/20 px-1.5 py-0.5 text-[10px] font-medium text-steel-light">{track.language}</span>
										<span class="text-faint">{track.format}</span>
										{#if track.hearingImpaired}
											<span class="text-faint">(CC)</span>
										{/if}
									</div>
								{/each}
								{#each subtitleStatus.missing as lang}
									<div class="flex items-center gap-2 text-xs text-accent/70">
										<span class="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{lang}</span>
										<span class="text-faint">missing</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Action -->
			<div class="mt-6 flex items-center gap-4 animate-fade-in-up" style="animation-delay: 0.44s; opacity: 0">
				{#if media.action}
					<ActionButton action={media.action} size="lg" />
				{/if}
				{#if media.progress && media.progress > 0}
					<div class="flex items-center gap-2">
						<div class="h-1 w-20 overflow-hidden rounded-full bg-cream/10">
							<div class="h-full rounded-full bg-accent/70" style="width: {media.progress * 100}%"></div>
						</div>
						<span class="text-xs text-faint">{Math.round(media.progress * 100)}% complete</span>
					</div>
				{/if}
			</div>
		</div>
	</div>
</article>
