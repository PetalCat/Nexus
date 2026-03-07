<script lang="ts">
	import Breadcrumb from './Breadcrumb.svelte';
	import { Star, Tv, Layers, Search } from 'lucide-svelte';
	import type { UnifiedMedia, Season, EpisodeSubtitleMap, FriendProfile, SocialSession } from '$lib/types/media-ui';
	import { MEDIA_TYPE_CONFIG } from '$lib/types/media-ui';
	import ActionButton from './ActionButton.svelte';
	import EpisodeRow from './EpisodeRow.svelte';
	import SubtitlePanel from '../ui/SubtitlePanel.svelte';

	interface Props {
		show: UnifiedMedia;
		seasons: Season[];
		episodeSubtitles?: EpisodeSubtitleMap;
		friendsWatched?: FriendProfile[];
		activeSession?: SocialSession | null;
	}

	let { show, seasons, episodeSubtitles = {}, friendsWatched = [], activeSession = null }: Props = $props();

	type TabId = 'episodes' | 'subtitles' | 'overview';
	let activeTab = $state<TabId>('episodes');
	let selectedSeason = $state(1);
	let subtitleSeason = $state(1);

	const missingCount = $derived(
		Object.values(episodeSubtitles).reduce((sum, s) => sum + s.missing.length, 0)
	);

	const tabs: { id: TabId; label: string }[] = [
		{ id: 'episodes', label: 'Episodes' },
		{ id: 'subtitles', label: 'Subtitles' },
		{ id: 'overview', label: 'Overview' }
	];

	const typeConfig = $derived(MEDIA_TYPE_CONFIG[show.type]);
	const progressPercent = $derived(Math.round((show.progress ?? 0) * 100));
	const totalEpisodes = $derived(seasons.reduce((sum, s) => sum + s.episodes.length, 0));
	const currentSeason = $derived(seasons.find((s) => s.number === selectedSeason) ?? seasons[0]);
	const subtitleCurrentSeason = $derived(seasons.find((s) => s.number === subtitleSeason) ?? seasons[0]);

	// Sliding tab indicator
	let tabButtons = $state<HTMLButtonElement[]>([]);
	let tabIndicatorStyle = $derived.by(() => {
		const idx = tabs.findIndex((t) => t.id === activeTab);
		const btn = tabButtons[idx];
		if (!btn) return 'opacity: 0';
		return `left: ${btn.offsetLeft}px; width: ${btn.offsetWidth}px; opacity: 1`;
	});
</script>

<div class="flex flex-col">
	<!-- Hero backdrop -->
	<div class="relative overflow-hidden">
		<!-- Blurred cover as backdrop -->
		<div class="absolute inset-0 scale-110">
			<img
				src={show.image}
				alt=""
				class="h-full w-full object-cover blur-2xl opacity-30 animate-ken-burns"
				aria-hidden="true"
			/>
			<div
				class="absolute inset-0"
				style="background: linear-gradient(to bottom, rgba(13,11,10,0.4) 0%, rgba(13,11,10,0.85) 60%, rgba(13,11,10,1) 100%);"
			></div>
		</div>

		<!-- Hero content -->
		<div class="relative px-4 pb-8 pt-6 sm:px-6 lg:px-10">
			<div class="mb-6">
				<Breadcrumb crumbs={[{ label: 'TV Shows', href: '/shows' }, { label: show.title }]} />
			</div>

			<!-- Main hero row -->
			<div class="flex flex-col gap-6 sm:flex-row sm:gap-8 lg:gap-10">
				<!-- Cover image -->
				<div class="w-full flex-shrink-0 sm:w-52 lg:w-64">
					<div
						class="relative aspect-[2/3] overflow-hidden rounded-xl"
						style="box-shadow: 0 8px 40px rgba(13,11,10,0.6), 0 0 60px rgba(138,160,180,0.08), 0 0 80px rgba(61,143,132,0.06);"
					>
						{#if show.image}
							<img
								src={show.image}
								alt="{show.title} cover"
								class="h-full w-full object-cover"
								data-media-id={show.id}
								style="view-transition-name: media-{show.id}"
							/>
						{:else}
							<div class="flex h-full w-full items-end bg-gradient-to-br p-4 {typeConfig.gradient}">
								<span class="font-display text-xl font-bold leading-tight text-cream/80">
									{show.title}
								</span>
							</div>
						{/if}
					</div>
				</div>

				<!-- Metadata -->
				<div class="flex flex-1 flex-col gap-3">
					<h1
						class="animate-fade-in-up nexus-title-glow font-display text-3xl font-black leading-tight tracking-tight text-cream lg:text-4xl"
						style="opacity: 0; animation-delay: 0.1s"
					>
						{show.title}
					</h1>

					<!-- Badges row -->
					<div
						class="animate-fade-in-up flex flex-wrap items-center gap-2"
						style="opacity: 0; animation-delay: 0.18s"
					>
						{#if show.metadata.year}
							<span class="rounded bg-cream/[0.06] px-2 py-0.5 text-xs font-medium text-muted">
								{show.metadata.year}
							</span>
						{/if}
						{#if show.metadata.genre}
							<span class="text-xs text-faint">·</span>
							<span class="text-xs text-muted">{show.metadata.genre}</span>
						{/if}
					</div>

					<!-- Rating -->
					{#if show.metadata.rating}
						<div
							class="animate-fade-in-up flex items-center gap-1.5"
							style="opacity: 0; animation-delay: 0.24s"
						>
							<Star size={14} class="fill-steel-light text-steel-light" />
							<span class="text-sm font-semibold text-steel-light">{show.metadata.rating}</span>
						</div>
					{/if}

					<!-- Description -->
					<p
						class="animate-fade-in-up nexus-text-glow max-w-xl text-sm leading-relaxed text-muted/80"
						style="opacity: 0; animation-delay: 0.3s"
					>
						{show.description}
					</p>

					<!-- Action row -->
					<div
						class="animate-fade-in-up mt-2 flex flex-wrap items-center gap-4"
						style="opacity: 0; animation-delay: 0.38s"
					>
						{#if show.action}
							<ActionButton action={show.action} size="lg" />
						{/if}
						{#if progressPercent > 0}
							<div class="flex items-center gap-2">
								<div class="h-1.5 w-24 overflow-hidden rounded-full bg-cream/10">
									<div
										class="h-full rounded-full bg-gradient-to-r from-steel to-steel-light animate-progress-fill-fast origin-left"
										style="animation-delay: 0.5s; transform: scaleX(0)"
									></div>
								</div>
								<span class="text-xs font-medium text-steel-light">{progressPercent}% complete</span>
							</div>
						{/if}
					</div>

					<!-- Stats row -->
					<div
						class="animate-fade-in-up mt-3 flex flex-wrap items-center gap-4 text-xs text-faint sm:gap-5"
						style="opacity: 0; animation-delay: 0.44s"
					>
						<div class="flex items-center gap-1.5">
							<Tv size={12} strokeWidth={1.5} class="text-steel/60" />
							<span>{totalEpisodes} episode{totalEpisodes !== 1 ? 's' : ''}</span>
						</div>
						<div class="flex items-center gap-1.5">
							<Layers size={12} strokeWidth={1.5} class="text-steel/60" />
							<span>{seasons.length} season{seasons.length !== 1 ? 's' : ''}</span>
						</div>
						{#if show.metadata.genre}
							<span>{show.metadata.genre}</span>
						{/if}
					</div>
				</div>
			</div>
		</div>

		<!-- Bottom glow line -->
		<div
			class="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-px animate-glow-pulse"
			style="background: linear-gradient(to right, transparent, rgba(61,143,132,0.3) 30%, rgba(61,143,132,0.3) 70%, transparent)"
			aria-hidden="true"
		></div>
	</div>

	<!-- Tabs bar -->
	<div class="border-b border-cream/[0.06] px-4 sm:px-6 lg:px-10">
		<nav class="relative flex gap-1" aria-label="Show detail tabs">
			{#each tabs as tab, i}
				<button
					bind:this={tabButtons[i]}
					onclick={() => (activeTab = tab.id)}
					class="relative px-4 py-3 text-sm font-medium transition-colors {activeTab === tab.id
						? 'text-cream'
						: 'text-muted hover:text-cream/70'}"
				>
					{tab.label}
					{#if tab.id === 'episodes'}
						<span class="ml-1.5 rounded-full bg-cream/[0.08] px-1.5 py-0.5 text-[10px] text-faint">
							{totalEpisodes}
						</span>
					{/if}
					{#if tab.id === 'subtitles' && missingCount > 0}
						<span class="ml-1.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
							{missingCount}
						</span>
					{/if}
				</button>
			{/each}
			<!-- Sliding indicator -->
			<div
				class="absolute -bottom-px h-0.5 rounded-full bg-steel transition-all duration-300"
				style={tabIndicatorStyle}
			></div>
		</nav>
	</div>

	<!-- Tab content -->
	<div class="px-4 py-8 sm:px-6 lg:px-10">
		{#key activeTab}
			<div class="animate-fade-in" style="opacity: 0">
				{#if activeTab === 'episodes'}
					<div class="flex flex-col gap-6">
						<!-- Season selector pills -->
						{#if seasons.length > 1}
							<div class="flex flex-wrap gap-2">
								{#each seasons as season}
									<button
										onclick={() => (selectedSeason = season.number)}
										class="rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-300 ease-out-back
											{selectedSeason === season.number
											? 'scale-105 bg-steel/20 text-steel-light ring-1 ring-steel/20'
											: 'bg-cream/[0.04] text-muted hover:scale-[1.02] hover:bg-cream/[0.08] hover:text-cream/80'}"
									>
										{season.title ?? `Season ${season.number}`}
									</button>
								{/each}
							</div>
						{/if}

						<!-- Episode grid -->
						{#if currentSeason}
							{#key selectedSeason}
								<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
									{#each currentSeason.episodes as episode, i (episode.id)}
										<div class="nexus-stagger-item" style="animation-delay: {Math.min(i * 40, 600)}ms">
											<EpisodeRow
												{episode}
												index={i}
												subtitleStatus={episodeSubtitles[episode.id] ?? null}
												onplay={() => console.log('Play', episode.title)}
											/>
										</div>
									{/each}
								</div>
							{/key}
						{/if}
					</div>
				{:else if activeTab === 'subtitles'}
					<div class="flex flex-col gap-6">
						<!-- Header -->
						<div class="flex flex-wrap items-center justify-between gap-3">
							<h2 class="text-lg font-semibold text-cream/90">Subtitle Management</h2>
							{#if missingCount > 0}
								<button
									class="inline-flex items-center gap-1.5 rounded-lg bg-accent/10 px-4 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
									onclick={() => console.log('Search all missing')}
								>
									<Search size={13} strokeWidth={2} />
									Search All Missing ({missingCount})
								</button>
							{/if}
						</div>

						<!-- Season selector pills -->
						{#if seasons.length > 1}
							<div class="flex flex-wrap gap-2">
								{#each seasons as season}
									<button
										onclick={() => (subtitleSeason = season.number)}
										class="rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-300 ease-out-back
											{subtitleSeason === season.number
											? 'scale-105 bg-steel/20 text-steel-light ring-1 ring-steel/20'
											: 'bg-cream/[0.04] text-muted hover:scale-[1.02] hover:bg-cream/[0.08] hover:text-cream/80'}"
									>
										{season.title ?? `Season ${season.number}`}
									</button>
								{/each}
							</div>
						{/if}

						<!-- Per-episode subtitle rows -->
						{#if subtitleCurrentSeason}
							{#key subtitleSeason}
								<div class="rounded-xl border border-cream/[0.06] bg-cream/[0.02] divide-y divide-cream/[0.06]">
									{#each subtitleCurrentSeason.episodes as episode, i (episode.id)}
										{@const epSubs = episodeSubtitles[episode.id]}
										<div
											class="nexus-stagger-item flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-6"
											style="animation-delay: {Math.min(i * 50, 400)}ms"
										>
											<div class="flex items-center gap-3 sm:w-48 sm:flex-shrink-0">
												<span class="text-xs font-semibold tabular-nums text-faint">
													E{episode.episodeNumber}
												</span>
												<span class="truncate text-sm font-medium text-cream/80">
													{episode.title}
												</span>
											</div>
											{#if epSubs}
												<div class="flex-1">
													<SubtitlePanel status={epSubs} mode="full" />
												</div>
											{:else}
												<span class="text-xs text-faint italic">No subtitle data</span>
											{/if}
										</div>
									{/each}
								</div>
							{/key}
						{/if}
					</div>
				{:else if activeTab === 'overview'}
					<div class="flex flex-col gap-10">
						<!-- Metadata grid -->
						<div class="grid grid-cols-2 gap-6 sm:grid-cols-4">
							{#each [
								{ label: 'Genre', value: show.metadata.genre ?? '-' },
								{ label: 'Year', value: show.metadata.year ?? '-' },
								{ label: 'Rating', value: null },
								{ label: 'Source', value: show.source }
							] as cell, i}
								<div class="animate-fade-in-up" style="opacity: 0; animation-delay: {0.05 + i * 0.06}s">
									<span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{cell.label}</span>
									{#if cell.label === 'Rating'}
										<p class="mt-1 flex items-center gap-1 text-sm text-cream/90">
											{#if show.metadata.rating}
												<Star size={12} class="fill-steel-light text-steel-light" />
												{show.metadata.rating}
											{:else}
												-
											{/if}
										</p>
									{:else if cell.label === 'Source'}
										<p class="mt-1 text-sm capitalize text-cream/90">{cell.value}</p>
									{:else}
										<p class="mt-1 text-sm text-cream/90">{cell.value}</p>
									{/if}
								</div>
							{/each}
						</div>

						<!-- Full description -->
						<div class="animate-fade-in-up" style="opacity: 0; animation-delay: 0.35s">
							<span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Description</span>
							<p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted/80">
								{show.description}
							</p>
						</div>
					</div>
				{/if}
			</div>
		{/key}
	</div>

	<div class="h-8" aria-hidden="true"></div>
</div>
