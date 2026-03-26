<script lang="ts">
	import Breadcrumb from '$lib/components/media/Breadcrumb.svelte';
	import {
		Star,
		Clock,
		Save,
		Trophy,
		Calendar,
		Upload,
		ImageIcon,
		Plus,
		FileText,
		History
	} from 'lucide-svelte';
	import type { UnifiedMedia, GameSaveData, RomMetadata, PlaySession } from '$lib/types/media-ui';
	import { MEDIA_TYPE_CONFIG } from '$lib/types/media-ui';
	import ActionButton from '$lib/components/media/ActionButton.svelte';
	import MediaBadge from '$lib/components/media/MediaBadge.svelte';
	import MediaCard from '$lib/components/media/MediaCard.svelte';
	import FriendsWatchedRow from '$lib/components/social/FriendsWatchedRow.svelte';
	import ShareMenu from '$lib/components/social/ShareMenu.svelte';
	import SessionPanel from '$lib/components/social/SessionPanel.svelte';
	import { getFriendsWhoWatched, getSessionByMediaId } from '$lib/stores/socialStore.svelte';
	import SaveSlotCard from './SaveSlotCard.svelte';
	import FavoriteButton from './FavoriteButton.svelte';
	import RomMetadataPanel from './RomMetadataPanel.svelte';
	import PlayHistoryTimeline from './PlayHistoryTimeline.svelte';
	import BulkActionBar from '$lib/components/ui/BulkActionBar.svelte';

	interface Props {
		game: UnifiedMedia;
		saveData: GameSaveData;
		romMetadata?: RomMetadata | null;
		playHistory?: PlaySession[];
		isFavorite?: boolean;
		onfavoritetoggle?: () => void;
		relatedGames?: UnifiedMedia[];
	}

	let { game, saveData, romMetadata = null, playHistory = [], isFavorite = false, onfavoritetoggle, relatedGames = [] }: Props = $props();

	type TabId = 'overview' | 'saves' | 'screenshots' | 'files' | 'history';
	let activeTab = $state<TabId>('overview');

	const tabs: { id: TabId; label: string }[] = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'saves', label: 'Saves' },
		{ id: 'screenshots', label: 'Screenshots' },
		{ id: 'files', label: 'Files' },
		{ id: 'history', label: 'History' }
	];

	const typeConfig = $derived(MEDIA_TYPE_CONFIG[game.type]);
	const progressPercent = $derived(Math.round((game.progress ?? 0) * 100));
	const friendsPlayed = $derived(getFriendsWhoWatched(game.id));
	const activeSession = $derived(getSessionByMediaId(game.id));
	const saveStates = $derived(saveData.saves.filter((s) => s.type === 'state'));
	const sramSaves = $derived(saveData.saves.filter((s) => s.type === 'sram'));

	// Bulk save selection
	let selectMode = $state(false);
	let selectedSaveIds = $state<Set<string>>(new Set());

	function toggleSaveSelection(id: string) {
		const next = new Set(selectedSaveIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedSaveIds = next;
	}

	function deselectAll() {
		selectedSaveIds = new Set();
	}

	function toggleSelectMode() {
		selectMode = !selectMode;
		if (!selectMode) selectedSaveIds = new Set();
	}

	const lastPlayedAgo = $derived(() => {
		if (!saveData.lastPlayed) return 'Never';
		const now = new Date();
		const then = new Date(saveData.lastPlayed);
		const diffMs = now.getTime() - then.getTime();
		const diffDays = Math.floor(diffMs / 86400000);
		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		return `${diffDays} days ago`;
	});

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
				src={game.image}
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
				<Breadcrumb crumbs={[{ label: 'Games', href: '/games' }, { label: game.title }]} />
			</div>

			<!-- Main hero row -->
			<div class="flex flex-col gap-6 sm:flex-row sm:gap-8 lg:gap-10">
				<!-- Cover image -->
				<div class="w-full flex-shrink-0 sm:w-52 lg:w-64">
					<div
						class="relative aspect-[2/3] overflow-hidden rounded-xl"
						style="box-shadow: 0 8px 40px rgba(13,11,10,0.6), 0 0 60px rgba(196,92,92,0.08), 0 0 80px rgba(196,92,92,0.06);"
					>
						{#if game.image}
							<img
								src={game.image}
								alt="{game.title} cover"
								class="h-full w-full object-cover"
								data-media-id={game.id}
								style="view-transition-name: media-{game.id}"
							/>
						{:else}
							<div class="flex h-full w-full items-end bg-gradient-to-br p-4 {typeConfig.gradient}">
								<span class="font-display text-xl font-bold leading-tight text-cream/80">
									{game.title}
								</span>
							</div>
						{/if}
					</div>
				</div>

				<!-- Metadata -->
				<div class="flex flex-1 flex-col gap-3">
					<div
						class="animate-fade-in-up flex items-start gap-3"
						style="opacity: 0; animation-delay: 0.1s"
					>
						<h1 class="flex-1 nexus-title-glow font-display text-3xl font-black leading-tight tracking-tight text-cream lg:text-4xl">
							{game.title}
						</h1>
						{#if onfavoritetoggle}
							<FavoriteButton active={isFavorite} size="md" onclick={() => onfavoritetoggle?.()} />
						{/if}
					</div>

					<!-- Badges row -->
					<div
						class="animate-fade-in-up flex flex-wrap items-center gap-2"
						style="opacity: 0; animation-delay: 0.18s"
					>
						<span class="rounded bg-cream/[0.06] px-2 py-0.5 text-xs font-medium text-muted">
							{game.metadata.platform}
						</span>
						{#if game.metadata.genre}
							<span class="text-xs text-faint">·</span>
							<span class="text-xs text-muted">{game.metadata.genre}</span>
						{/if}
						{#if game.metadata.year}
							<span class="text-xs text-faint">·</span>
							<span class="text-xs text-muted">{game.metadata.year}</span>
						{/if}
					</div>

					<!-- Rating -->
					{#if game.metadata.rating}
						<div
							class="animate-fade-in-up flex items-center gap-1.5"
							style="opacity: 0; animation-delay: 0.24s"
						>
							<Star size={14} class="fill-accent text-accent" />
							<span class="text-sm font-semibold text-accent">{game.metadata.rating}</span>
						</div>
					{/if}

					<!-- Description -->
					<p
						class="animate-fade-in-up nexus-text-glow max-w-xl text-sm leading-relaxed text-muted/80"
						style="opacity: 0; animation-delay: 0.3s"
					>
						{game.description}
					</p>

					<!-- Action row -->
					<div
						class="animate-fade-in-up mt-2 flex flex-wrap items-center gap-4"
						style="opacity: 0; animation-delay: 0.38s"
					>
						{#if game.action}
							<ActionButton action={game.action} size="lg" />
						{/if}
						{#if progressPercent > 0}
							<div class="flex items-center gap-2">
								<div class="h-1.5 w-24 overflow-hidden rounded-full bg-cream/10">
									<div
										class="h-full rounded-full bg-gradient-to-r from-warm to-warm-light animate-progress-fill-fast origin-left"
										style="animation-delay: 0.5s; transform: scaleX(0)"
									></div>
								</div>
								<span class="text-xs font-medium text-warm-light">{progressPercent}% complete</span>
							</div>
						{/if}
						<ShareMenu mediaId={game.id} mediaTitle={game.title} />
					</div>

					<!-- Stats row -->
					<div
						class="animate-fade-in-up mt-3 flex flex-wrap items-center gap-4 text-xs text-faint sm:gap-5"
						style="opacity: 0; animation-delay: 0.44s"
					>
						{#if saveData.totalPlayTime !== '0h 0m'}
							<div class="flex items-center gap-1.5">
								<Clock size={12} strokeWidth={1.5} class="text-warm/60" />
								<span>{saveData.totalPlayTime} played</span>
							</div>
						{/if}
						{#if saveData.saves.length > 0}
							<div class="flex items-center gap-1.5">
								<Save size={12} strokeWidth={1.5} class="text-warm/60" />
								<span>{saveData.saves.length} save{saveData.saves.length !== 1 ? 's' : ''}</span>
							</div>
						{/if}
						{#if saveData.timesCompleted > 0}
							<div class="flex items-center gap-1.5">
								<Trophy size={12} strokeWidth={1.5} class="text-warm/60" />
								<span>Completed {saveData.timesCompleted}x</span>
							</div>
						{/if}
						{#if saveData.lastPlayed}
							<div class="flex items-center gap-1.5">
								<Calendar size={12} strokeWidth={1.5} class="text-warm/60" />
								<span>Last played {lastPlayedAgo()}</span>
							</div>
						{/if}
					</div>

					{#if friendsPlayed.length > 0}
						<div class="animate-fade-in-up" style="opacity: 0; animation-delay: 0.5s">
							<FriendsWatchedRow friends={friendsPlayed} label="Friends who played this" />
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Bottom glow line -->
		<div
			class="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-px animate-glow-pulse"
			style="background: linear-gradient(to right, transparent, rgba(196,92,92,0.3) 30%, rgba(196,92,92,0.3) 70%, transparent)"
			aria-hidden="true"
		></div>
	</div>

	{#if activeSession}
		<div class="px-4 sm:px-6 lg:px-10 pb-4">
			<SessionPanel session={activeSession} />
		</div>
	{/if}

	<!-- Tabs bar -->
	<div class="border-b border-cream/[0.06] px-4 sm:px-6 lg:px-10">
		<nav class="relative flex gap-1" aria-label="Game detail tabs">
			{#each tabs as tab, i}
				<button
					bind:this={tabButtons[i]}
					onclick={() => (activeTab = tab.id)}
					class="relative px-4 py-3 text-sm font-medium transition-colors {activeTab === tab.id
						? 'text-cream'
						: 'text-muted hover:text-cream/70'}"
				>
					{tab.label}
					{#if tab.id === 'saves' && saveData.saves.length > 0}
						<span class="ml-1.5 rounded-full bg-cream/[0.08] px-1.5 py-0.5 text-[10px] text-faint">
							{saveData.saves.length}
						</span>
					{/if}
				</button>
			{/each}
			<!-- Sliding indicator -->
			<div
				class="absolute -bottom-px h-0.5 rounded-full bg-warm transition-all duration-300"
				style={tabIndicatorStyle}
			></div>
		</nav>
	</div>

	<!-- Tab content -->
	<div class="px-4 py-8 sm:px-6 lg:px-10">
		{#key activeTab}
			<div class="animate-fade-in" style="opacity: 0">
				{#if activeTab === 'overview'}
					<div class="flex flex-col gap-10">
						<!-- Metadata grid -->
						<div class="grid grid-cols-2 gap-6 sm:grid-cols-4">
							{#each [
								{ label: 'Platform', value: game.metadata.platform },
								{ label: 'Genre', value: game.metadata.genre ?? '--' },
								{ label: 'Year', value: game.metadata.year ?? '--' },
								{ label: 'Rating', value: null }
							] as cell, i}
								<div class="animate-fade-in-up" style="opacity: 0; animation-delay: {0.05 + i * 0.06}s">
									<span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{cell.label}</span>
									{#if cell.label === 'Rating'}
										<p class="mt-1 flex items-center gap-1 text-sm text-cream/90">
											{#if game.metadata.rating}
												<Star size={12} class="fill-accent text-accent" />
												{game.metadata.rating}
											{:else}
												--
											{/if}
										</p>
									{:else}
										<p class="mt-1 text-sm text-cream/90">{cell.value}</p>
									{/if}
								</div>
							{/each}
						</div>

						<!-- Related games -->
						{#if relatedGames.length > 0}
							<section>
								<div class="mb-4 flex items-center gap-2">
									<div
										class="h-[18px] w-[3px] shrink-0 rounded-full bg-gradient-to-b from-warm to-warm-light"
										aria-hidden="true"
									></div>
									<h2 class="font-display text-lg font-bold tracking-wide text-cream/90">
										More on {game.metadata.platform}
									</h2>
								</div>
								<div
									class="flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
								>
									{#each relatedGames as related, i (related.id)}
										<a href="/games/{related.id}" class="nexus-stagger-item flex-shrink-0" style="animation-delay: {Math.min(i * 40, 600)}ms" data-sveltekit-preload-data>
											<MediaCard media={related} size="md" showProgress forceAspect="portrait" />
										</a>
									{/each}
								</div>
							</section>
						{/if}
					</div>
				{:else if activeTab === 'saves'}
					<div class="flex flex-col gap-8">
						<!-- Select mode toggle -->
						{#if saveData.saves.length > 0}
							<div class="flex items-center justify-end">
								<button
									onclick={toggleSelectMode}
									class="rounded-full px-3 py-1 text-xs font-medium transition-all duration-300
										{selectMode
										? 'bg-warm/20 text-warm-light'
										: 'bg-cream/[0.04] text-muted hover:bg-cream/[0.08] hover:text-cream/80'}"
								>
									{selectMode ? 'Cancel' : 'Select'}
								</button>
							</div>
						{/if}

						<!-- Save States -->
						<section>
							<div class="mb-4 flex items-center gap-2">
								<div
									class="h-[18px] w-[3px] shrink-0 rounded-full bg-gradient-to-b from-warm to-warm-light"
									aria-hidden="true"
								></div>
								<h2 class="font-display text-base font-bold tracking-wide text-cream/90">
									Save States
								</h2>
								{#if saveStates.length > 0}
									<span class="text-xs text-faint">{saveStates.length}</span>
								{/if}
							</div>

							{#if saveStates.length > 0}
								<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
									{#each saveStates as save, i (save.id)}
										<div class="nexus-stagger-item" style="animation-delay: {Math.min(i * 40, 600)}ms">
											<SaveSlotCard
												{save}
												selectable={selectMode}
												selected={selectedSaveIds.has(save.id)}
												ontoggle={toggleSaveSelection}
											/>
										</div>
									{/each}
									{#if !selectMode}
										<!-- Upload placeholder -->
										<button
											onclick={() => console.log('Upload save state')}
											class="flex aspect-auto min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-cream/[0.08] text-faint transition-all duration-300 hover:border-cream/[0.16] hover:bg-cream/[0.02] hover:text-muted"
										>
											<Plus size={24} strokeWidth={1.5} />
											<span class="text-xs font-medium">Upload Save</span>
										</button>
									{/if}
								</div>
							{:else}
								<div class="flex flex-col items-center justify-center rounded-xl border border-cream/[0.06] bg-cream/[0.02] py-12 text-center">
									<Save size={32} strokeWidth={1} class="text-faint/30" />
									<p class="mt-3 text-sm text-muted">No save states</p>
									<p class="mt-1 text-xs text-faint">Play the game to create save states</p>
								</div>
							{/if}
						</section>

						<!-- SRAM / Battery Saves -->
						<section>
							<div class="mb-4 flex items-center gap-2">
								<div
									class="h-[18px] w-[3px] shrink-0 rounded-full bg-gradient-to-b from-accent-dim to-accent"
									aria-hidden="true"
								></div>
								<h2 class="font-display text-base font-bold tracking-wide text-cream/90">
									Battery Saves (SRAM)
								</h2>
								{#if sramSaves.length > 0}
									<span class="text-xs text-faint">{sramSaves.length}</span>
								{/if}
							</div>

							{#if sramSaves.length > 0}
								<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
									{#each sramSaves as save, i (save.id)}
										<div class="nexus-stagger-item" style="animation-delay: {Math.min(i * 40, 600)}ms">
											<SaveSlotCard
												{save}
												selectable={selectMode}
												selected={selectedSaveIds.has(save.id)}
												ontoggle={toggleSaveSelection}
											/>
										</div>
									{/each}
									{#if !selectMode}
										<!-- Upload placeholder -->
										<button
											onclick={() => console.log('Upload SRAM save')}
											class="flex aspect-auto min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-cream/[0.08] text-faint transition-all duration-300 hover:border-cream/[0.16] hover:bg-cream/[0.02] hover:text-muted"
										>
											<Upload size={24} strokeWidth={1.5} />
											<span class="text-xs font-medium">Upload SRAM</span>
										</button>
									{/if}
								</div>
							{:else}
								<div class="flex flex-col items-center justify-center rounded-xl border border-cream/[0.06] bg-cream/[0.02] py-12 text-center">
									<Upload size={32} strokeWidth={1} class="text-faint/30" />
									<p class="mt-3 text-sm text-muted">No battery saves</p>
									<p class="mt-1 text-xs text-faint">SRAM saves are created in-game</p>
								</div>
							{/if}
						</section>
					</div>

					<!-- Bulk action bar -->
					<BulkActionBar
						selectedCount={selectedSaveIds.size}
						ondeselectall={deselectAll}
					/>
				{:else if activeTab === 'screenshots'}
					<div>
						<div class="mb-4 flex items-center gap-2">
							<div
								class="h-[18px] w-[3px] shrink-0 rounded-full bg-gradient-to-b from-warm to-warm-light"
								aria-hidden="true"
							></div>
							<h2 class="font-display text-base font-bold tracking-wide text-cream/90">
								Screenshots
							</h2>
							{#if saveData.screenshots.length > 0}
								<span class="text-xs text-faint">{saveData.screenshots.length}</span>
							{/if}
						</div>

						{#if saveData.screenshots.length > 0}
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
								{#each saveData.screenshots as screenshot, i}
									<div
										class="nexus-stagger-item group/ss relative aspect-video overflow-hidden rounded-xl border border-cream/[0.06] bg-cream/[0.02]"
										style="animation-delay: {Math.min(i * 40, 600)}ms"
									>
										<img
											src={screenshot}
											alt="Screenshot {i + 1}"
											class="h-full w-full object-cover transition-transform duration-500 group-hover/ss:scale-105"
											loading="lazy"
										/>
									</div>
								{/each}
							</div>
						{:else}
							<div class="flex flex-col items-center justify-center rounded-xl border border-cream/[0.06] bg-cream/[0.02] py-12 text-center">
								<ImageIcon size={32} strokeWidth={1} class="text-faint/30" />
								<p class="mt-3 text-sm text-muted">No screenshots</p>
								<p class="mt-1 text-xs text-faint">Take screenshots during gameplay</p>
							</div>
						{/if}
					</div>
				{:else if activeTab === 'files'}
					<div>
						<div class="mb-4 flex items-center gap-2">
							<div
								class="h-[18px] w-[3px] shrink-0 rounded-full bg-gradient-to-b from-warm to-warm-light"
								aria-hidden="true"
							></div>
							<h2 class="font-display text-base font-bold tracking-wide text-cream/90">
								ROM Information
							</h2>
						</div>
						<RomMetadataPanel metadata={romMetadata} />
					</div>
				{:else if activeTab === 'history'}
					<div>
						<div class="mb-4 flex items-center gap-2">
							<div
								class="h-[18px] w-[3px] shrink-0 rounded-full bg-gradient-to-b from-warm to-warm-light"
								aria-hidden="true"
							></div>
							<h2 class="font-display text-base font-bold tracking-wide text-cream/90">
								Play History
							</h2>
							{#if playHistory.length > 0}
								<span class="text-xs text-faint">{playHistory.length} sessions</span>
							{/if}
						</div>
						<PlayHistoryTimeline sessions={playHistory} />
					</div>
				{/if}
			</div>
		{/key}
	</div>

	<div class="h-8" aria-hidden="true"></div>
</div>
