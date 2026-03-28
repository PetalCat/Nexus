<script lang="ts">
	import type { PageData } from './$types';
	import type { Track } from '$lib/stores/musicStore.svelte';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { musicPlayer, setQueue } from '$lib/stores/musicStore.svelte';
	import AlbumCard from '$lib/components/music/AlbumCard.svelte';
	import TrackRow from '$lib/components/music/TrackRow.svelte';
	import { Play, Shuffle } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	function mediaToTrack(item: UnifiedMedia): Track {
		return {
			id: item.id,
			sourceId: item.sourceId,
			serviceId: item.serviceId,
			title: item.title,
			artist: (item.metadata?.artist as string) ?? '',
			album: (item.metadata?.albumName as string) ?? '',
			albumId: (item.metadata?.albumId as string) ?? '',
			duration: item.duration ?? 0,
			image: item.poster ?? ''
		};
	}

	const topTracks = $derived(data.topSongs.map(mediaToTrack));
	const albumCount = $derived(data.albums.length);
	const trackCount = $derived((data.artist as any)?.trackCount ?? 0);

	const heroBackdrop = $derived(
		data.artist.backdrop ?? data.artist.imageUrl ?? data.albums[0]?.backdrop ?? data.albums[0]?.poster ?? ''
	);

	function playAllTopSongs(startIndex = 0) {
		if (topTracks.length === 0) return;
		setQueue(topTracks, startIndex);
	}

	function shuffleAll() {
		if (topTracks.length === 0) return;
		const shuffled = [...topTracks].sort(() => Math.random() - 0.5);
		setQueue(shuffled, 0);
	}

</script>

<svelte:head>
	<title>{data.artist.name} — Nexus</title>
</svelte:head>

<div class="artist-page">
	<!-- Hero Banner -->
	<div class="hero" style:--bg-image="url('{heroBackdrop}')">
		<div class="hero-overlay"></div>
		<div class="hero-content">
			<h1 class="artist-name">{data.artist.name}</h1>
			<p class="artist-stats">
				{albumCount} {albumCount === 1 ? 'album' : 'albums'}{#if trackCount > 0}&nbsp;&middot;&nbsp;{trackCount} tracks{/if}
			</p>
			<div class="hero-actions">
				<button class="play-btn-hero" onclick={() => playAllTopSongs(0)} aria-label="Play">
					<Play size={22} fill="currentColor" strokeWidth={0} />
				</button>
				<button class="pill-btn" onclick={shuffleAll}>
					<Shuffle size={14} />
					Shuffle All
				</button>
			</div>
		</div>
	</div>

	<div class="content">
		<!-- Top Songs -->
		{#if topTracks.length > 0}
			<section class="section">
				<h2 class="section-title">Top Songs</h2>
				<div class="track-list">
					{#each topTracks as track, i (track.id)}
						<TrackRow
							{track}
							index={i}
							isCurrent={musicPlayer.currentTrack?.id === track.id}
							isPlaying={musicPlayer.currentTrack?.id === track.id && musicPlayer.playing}
							showAlbum={true}
							showArtist={false}
							onplay={() => playAllTopSongs(i)}
						/>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Discography -->
		{#if data.albums.length > 0}
			<section class="section">
				<h2 class="section-title">Discography</h2>
				<div class="scroll-row">
					{#each data.albums as album (album.id)}
						<div class="card-slot">
							<AlbumCard {album} />
						</div>
					{/each}
				</div>
			</section>
		{/if}
	</div>
</div>

<style>
	.artist-page {
		min-height: 100vh;
	}

	/* ── Hero ── */
	.hero {
		position: relative;
		height: 280px;
		margin: -20px -24px 0;
		overflow: hidden;
		display: flex;
		align-items: flex-end;
	}

	.hero::before {
		content: '';
		position: absolute;
		inset: 0;
		background-image: var(--bg-image);
		background-size: cover;
		background-position: center 30%;
		filter: brightness(0.5) saturate(1.2);
	}

	.hero-overlay {
		position: absolute;
		inset: 0;
		background: linear-gradient(transparent 30%, var(--color-void, #0d0b0a) 100%);
	}

	.hero-content {
		position: relative;
		z-index: 1;
		padding: 0 32px 28px;
		width: 100%;
	}

	.artist-name {
		font-family: var(--font-display);
		font-size: 36px;
		font-weight: 700;
		color: var(--color-cream, #f0e6d3);
		margin: 0 0 4px;
		text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
		line-height: 1.1;
	}

	.artist-stats {
		font-size: 12px;
		color: var(--color-muted, #8a8078);
		margin: 0 0 16px;
	}

	.hero-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.play-btn-hero {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: none;
		background: #d4a253;
		color: #0d0b0a;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		box-shadow: 0 4px 20px rgba(212, 162, 83, 0.4);
		transition: background 0.15s ease, transform 0.15s ease;
	}

	.play-btn-hero:hover {
		background: #e0b36a;
		transform: scale(1.05);
	}

	.pill-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 18px;
		border-radius: 9999px;
		border: 1px solid rgba(240, 230, 211, 0.15);
		background: rgba(240, 230, 211, 0.06);
		color: var(--color-cream, #f0e6d3);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.pill-btn:hover {
		background: rgba(240, 230, 211, 0.1);
		border-color: rgba(240, 230, 211, 0.25);
	}

	/* ── Content ── */
	.content {
		padding: 32px 24px 80px;
	}

	.section {
		margin-bottom: 40px;
	}

	.section-title {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 600;
		color: var(--color-cream, #f0e6d3);
		margin: 0 0 16px;
	}

	.track-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	/* ── Horizontal Scroll Row ── */
	.scroll-row {
		display: flex;
		gap: 16px;
		overflow-x: auto;
		padding-bottom: 8px;
		scroll-snap-type: x proximity;
		-webkit-overflow-scrolling: touch;
	}

	.scroll-row::-webkit-scrollbar {
		height: 4px;
	}

	.scroll-row::-webkit-scrollbar-track {
		background: transparent;
	}

	.scroll-row::-webkit-scrollbar-thumb {
		background: rgba(240, 230, 211, 0.08);
		border-radius: 4px;
	}

	.card-slot {
		flex: 0 0 160px;
		scroll-snap-align: start;
	}
</style>
