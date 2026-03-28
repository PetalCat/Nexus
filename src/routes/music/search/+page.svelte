<script lang="ts">
	import type { PageData } from './$types';
	import type { Track } from '$lib/stores/musicStore.svelte';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { setQueue, musicPlayer } from '$lib/stores/musicStore.svelte';
	import AlbumCard from '$lib/components/music/AlbumCard.svelte';
	import ArtistCard from '$lib/components/music/ArtistCard.svelte';
	import TrackRow from '$lib/components/music/TrackRow.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let { data }: { data: PageData } = $props();

	let searchInput = $state('');
	let searchTimeout: ReturnType<typeof setTimeout>;

	$effect(() => {
		searchInput = data.query ?? '';
	});

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

	const tracks = $derived(data.songs.map(toTrack));

	const hasResults = $derived(
		data.songs.length > 0 ||
			data.albums.length > 0 ||
			data.artists.length > 0 ||
			data.playlists.length > 0
	);

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
		}, 300);
	}

	function playSong(index: number) {
		setQueue(tracks, index);
	}
</script>

<svelte:head>
	<title>Search Music — Nexus</title>
</svelte:head>

<div class="search-page">
	<!-- Search input -->
	<div class="search-bar">
		<svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="11" cy="11" r="8" />
			<line x1="21" y1="21" x2="16.65" y2="16.65" />
		</svg>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			type="text"
			class="search-input"
			placeholder="Search your music library"
			bind:value={searchInput}
			oninput={handleSearch}
			autofocus
		/>
	</div>

	{#if data.query && hasResults}
		<!-- Songs -->
		{#if data.songs.length > 0}
			<section class="result-section">
				<div class="section-header">
					<h2 class="section-title">Songs</h2>
					<span class="section-count">{data.songs.length} track{data.songs.length !== 1 ? 's' : ''}</span>
					{#if data.songs.length >= 4}
						<a href="/music/songs?q={encodeURIComponent(data.query)}" class="see-all">See all</a>
					{/if}
				</div>

				<!-- Table header -->
				<div class="table-header">
					<span class="col-num">#</span>
					<span class="col-title">Title</span>
					<span class="col-album">Album</span>
					<span class="col-duration">Duration</span>
				</div>

				<div class="track-list">
					{#each data.songs.slice(0, 4) as song, i (song.id)}
						{@const track = tracks[i]}
						{@const isCurrentTrack = musicPlayer.currentTrack?.id === track.id}
						<TrackRow
							{track}
							index={i}
							isPlaying={isCurrentTrack && musicPlayer.playing}
							isCurrent={isCurrentTrack}
							showAlbumArt={true}
							showArtist={true}
							showAlbum={true}
							onplay={() => playSong(i)}
						/>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Albums -->
		{#if data.albums.length > 0}
			<section class="result-section">
				<div class="section-header">
					<h2 class="section-title">Albums</h2>
					{#if data.albums.length >= 4}
						<a href="/music/albums?q={encodeURIComponent(data.query)}" class="see-all">See all</a>
					{/if}
				</div>
				<div class="card-row">
					{#each data.albums.slice(0, 4) as album (album.id)}
						<div class="card-item">
							<AlbumCard {album} />
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Artists -->
		{#if data.artists.length > 0}
			<section class="result-section">
				<div class="section-header">
					<h2 class="section-title">Artists</h2>
					{#if data.artists.length >= 4}
						<a href="/music/artists?q={encodeURIComponent(data.query)}" class="see-all">See all</a>
					{/if}
				</div>
				<div class="card-row">
					{#each data.artists.slice(0, 4) as artist (artist.id)}
						<div class="card-item-artist">
							<ArtistCard {artist} />
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Playlists -->
		{#if data.playlists.length > 0}
			<section class="result-section">
				<div class="section-header">
					<h2 class="section-title">Playlists</h2>
				</div>
				<div class="playlist-list">
					{#each data.playlists as playlist (playlist.id)}
						<a href="/music/playlists/{playlist.id}" class="playlist-item">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 15V6" /><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
								<path d="M12 12H3" /><path d="M16 6H3" /><path d="M12 18H3" />
							</svg>
							<span class="playlist-name">{playlist.name}</span>
							{#if playlist.trackCount != null}
								<span class="playlist-count">{playlist.trackCount} tracks</span>
							{/if}
						</a>
					{/each}
				</div>
			</section>
		{/if}
	{:else if data.query && !hasResults}
		<div class="empty-state">
			<p>No results for "{data.query}"</p>
		</div>
	{:else}
		<div class="empty-state">
			<div class="empty-icon">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8" />
					<line x1="21" y1="21" x2="16.65" y2="16.65" />
				</svg>
			</div>
			<p>Search your music library</p>
		</div>
	{/if}
</div>

<style>
	.search-page {
		padding: 0 16px 120px;
	}

	.search-bar {
		position: relative;
		padding: 12px 0 20px;
	}

	.search-icon {
		position: absolute;
		left: 14px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-muted);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 14px 16px 14px 44px;
		border-radius: 12px;
		font-size: 16px;
		font-family: var(--font-body);
		color: var(--color-cream);
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.06);
		outline: none;
		transition: border-color 0.15s ease;
	}

	.search-input::placeholder {
		color: var(--color-muted);
	}

	.search-input:focus {
		border-color: rgba(212, 162, 83, 0.3);
	}

	.result-section {
		margin-bottom: 28px;
	}

	.section-header {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin-bottom: 14px;
	}

	.section-title {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 600;
		color: var(--color-cream);
		margin: 0;
	}

	.section-count {
		font-size: 12px;
		color: var(--color-muted);
	}

	.see-all {
		margin-left: auto;
		font-size: 12px;
		font-weight: 600;
		color: var(--color-accent);
		text-decoration: none;
		transition: opacity 0.15s ease;
	}

	.see-all:hover {
		opacity: 0.8;
	}

	/* Songs table header */
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
		padding-left: 48px;
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

	/* Album / artist card rows */
	.card-row {
		display: flex;
		gap: 14px;
		overflow-x: auto;
		padding-bottom: 8px;
		scrollbar-width: none;
	}

	.card-row::-webkit-scrollbar {
		display: none;
	}

	.card-item {
		width: 140px;
		flex-shrink: 0;
	}

	.card-item-artist {
		width: 120px;
		flex-shrink: 0;
	}

	/* Playlists */
	.playlist-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.playlist-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 8px;
		text-decoration: none;
		color: var(--color-cream);
		transition: background 0.15s ease;
	}

	.playlist-item:hover {
		background: rgba(240, 235, 227, 0.04);
	}

	.playlist-item svg {
		color: var(--color-muted);
		flex-shrink: 0;
	}

	.playlist-name {
		font-size: 14px;
		font-weight: 500;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.playlist-count {
		font-size: 12px;
		color: var(--color-muted);
		flex-shrink: 0;
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 80px 20px;
		color: var(--color-muted);
		font-size: 14px;
		text-align: center;
	}

	.empty-icon {
		margin-bottom: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		border-radius: 16px;
		background: var(--color-surface);
	}
</style>
