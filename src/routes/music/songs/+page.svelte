<script lang="ts">
	import type { PageData } from './$types';
	import type { Track } from '$lib/stores/musicStore.svelte';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { setQueue, musicPlayer, toggleLikeTrack } from '$lib/stores/musicStore.svelte';
	import TrackRow from '$lib/components/music/TrackRow.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let { data }: { data: PageData } = $props();

	let filter = $state<'all' | 'liked'>('all');
	let searchInput = $state('');
	let searchTimeout: ReturnType<typeof setTimeout>;

	$effect(() => {
		searchInput = data.search ?? '';
	});

	const likedSet = $derived(new Set(data.likedIds));

	function toTrack(item: UnifiedMedia): Track {
		return {
			id: item.id,
			sourceId: item.sourceId,
			serviceId: item.serviceId,
			title: item.title,
			artist: (item.metadata?.artist as string) ?? 'Unknown',
			album: (item.metadata?.album as string) ?? '',
			albumId: (item.metadata?.albumId as string) ?? '',
			duration: item.duration ?? 0,
			image: item.poster ?? ''
		};
	}

	const filteredSongs = $derived.by(() => {
		if (filter === 'liked') {
			return data.songs.filter((s: UnifiedMedia) => likedSet.has(`${s.sourceId}::${s.serviceId}`));
		}
		return data.songs;
	});

	const tracks = $derived(filteredSongs.map(toTrack));

	function playSong(index: number) {
		setQueue(tracks, index);
	}

	async function handleLikeToggle(song: UnifiedMedia) {
		await toggleLikeTrack(song.sourceId, song.serviceId);
		// Toggle locally for instant feedback
		const key = `${song.sourceId}::${song.serviceId}`;
		if (likedSet.has(key)) {
			data.likedIds = data.likedIds.filter((id: string) => id !== key);
		} else {
			data.likedIds = [...data.likedIds, key];
		}
	}

	function handleSearch() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			const params = new URLSearchParams($page.url.searchParams);
			if (searchInput) {
				params.set('q', searchInput);
			} else {
				params.delete('q');
			}
			goto(`?${params.toString()}`, { replaceState: true, keepFocus: true });
		}, 400);
	}

	function setSort(sort: string) {
		const params = new URLSearchParams($page.url.searchParams);
		params.set('sort', sort);
		goto(`?${params.toString()}`, { replaceState: true });
	}

	const sortOptions = [
		{ value: 'SortName', label: 'Name' },
		{ value: 'Album', label: 'Album' },
		{ value: 'Artist', label: 'Artist' },
		{ value: 'DateCreated', label: 'Recently Added' },
		{ value: 'Random', label: 'Random' }
	];
</script>

<svelte:head>
	<title>Songs — Nexus</title>
</svelte:head>

<div class="songs-page">
	<!-- Filter bar -->
	<div class="filter-bar">
		<div class="filter-chips">
			<button
				class="chip"
				class:active={filter === 'all'}
				onclick={() => (filter = 'all')}
			>
				All
			</button>
			<button
				class="chip"
				class:active={filter === 'liked'}
				onclick={() => (filter = 'liked')}
			>
				Liked &hearts;
			</button>
		</div>

		<div class="filter-right">
			<select
				class="sort-select"
				value={data.currentSort}
				onchange={(e) => setSort(e.currentTarget.value)}
			>
				{#each sortOptions as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>

			<input
				type="text"
				class="search-input"
				placeholder="Search songs..."
				bind:value={searchInput}
				oninput={handleSearch}
			/>
		</div>
	</div>

	<!-- Table header -->
	<div class="table-header">
		<span class="col-num">#</span>
		<span class="col-title">Title</span>
		<span class="col-album">Album</span>
		<span class="col-duration">Duration</span>
	</div>

	<!-- Track list -->
	{#if filteredSongs.length === 0}
		<div class="empty-state">
			{#if filter === 'liked'}
				<p>No liked songs yet. Tap the heart on any track to save it here.</p>
			{:else if data.search}
				<p>No songs matching "{data.search}".</p>
			{:else}
				<p>No songs found in your library.</p>
			{/if}
		</div>
	{:else}
		<div class="track-list">
			{#each filteredSongs as song, i (song.id)}
				{@const track = tracks[i]}
				{@const isCurrentTrack = musicPlayer.currentTrack?.id === track.id}
				<TrackRow
					{track}
					index={i}
					isPlaying={isCurrentTrack && musicPlayer.playing}
					isCurrent={isCurrentTrack}
					isLiked={likedSet.has(`${song.sourceId}::${song.serviceId}`)}
					showAlbumArt={true}
					showArtist={true}
					showAlbum={true}
					onplay={() => playSong(i)}
					onliketoggle={() => handleLikeToggle(song)}
				/>
			{/each}
		</div>
	{/if}
</div>

<style>
	.songs-page {
		padding: 0 16px 120px;
	}

	.filter-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 0 16px;
		flex-wrap: wrap;
	}

	.filter-chips {
		display: flex;
		gap: 6px;
	}

	.chip {
		padding: 5px 14px;
		border-radius: 9999px;
		font-size: 12px;
		font-weight: 600;
		font-family: var(--font-body);
		color: var(--color-muted);
		background: transparent;
		border: 1px solid rgba(240, 235, 227, 0.08);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.chip:hover {
		color: var(--color-cream);
		border-color: rgba(240, 235, 227, 0.15);
	}

	.chip.active {
		background: rgba(212, 162, 83, 0.12);
		color: var(--color-accent);
		border-color: rgba(212, 162, 83, 0.25);
	}

	.filter-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.sort-select {
		padding: 5px 10px;
		border-radius: 6px;
		font-size: 12px;
		font-family: var(--font-body);
		color: var(--color-cream);
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.06);
		cursor: pointer;
		outline: none;
	}

	.sort-select:focus {
		border-color: rgba(212, 162, 83, 0.3);
	}

	.search-input {
		padding: 5px 12px;
		border-radius: 6px;
		font-size: 12px;
		font-family: var(--font-body);
		color: var(--color-cream);
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.06);
		outline: none;
		width: 180px;
		transition: border-color 0.15s ease;
	}

	.search-input::placeholder {
		color: var(--color-muted);
	}

	.search-input:focus {
		border-color: rgba(212, 162, 83, 0.3);
	}

	.table-header {
		display: flex;
		align-items: center;
		padding: 0 6px 8px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted);
		border-bottom: 1px solid rgba(240, 235, 227, 0.06);
		margin-bottom: 4px;
	}

	.col-num {
		width: 36px;
		flex-shrink: 0;
		text-align: center;
	}

	.col-title {
		flex: 1;
		min-width: 0;
		padding-left: 48px; /* account for album art */
	}

	.col-album {
		display: none;
		width: 160px;
		flex-shrink: 0;
		padding: 0 12px;
	}

	@media (min-width: 768px) {
		.col-album {
			display: block;
		}
	}

	.col-duration {
		width: 80px;
		flex-shrink: 0;
		text-align: right;
		padding-right: 8px;
	}

	.track-list {
		display: flex;
		flex-direction: column;
	}

	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 80px 20px;
		color: var(--color-muted);
		font-size: 14px;
		text-align: center;
	}
</style>
