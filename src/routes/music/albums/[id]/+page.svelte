<script lang="ts">
	import type { PageData } from './$types';
	import { setQueue, musicPlayer } from '$lib/stores/musicStore.svelte';
	import type { Track } from '$lib/stores/musicStore.svelte';
	import AlbumCard from '$lib/components/music/AlbumCard.svelte';
	import { Play, Shuffle, Heart, MoreHorizontal } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	let imageError = $state(false);
	let liked = $state(false);

	const album = $derived(data.album);
	const tracks = $derived(data.tracks);
	const artistName = $derived(album?.metadata?.artist ? String(album.metadata.artist) : 'Unknown Artist');
	const artistId = $derived(album?.metadata?.artistId ? String(album.metadata.artistId) : '');
	const trackCount = $derived(tracks.length);
	const totalDuration = $derived(tracks.reduce((sum: number, t: any) => sum + (t.duration ?? 0), 0));
	const totalMinutes = $derived(Math.round(totalDuration / 60));

	function toTrack(item: any, serviceId: string): Track {
		return {
			id: item.id ?? item.sourceId,
			sourceId: item.sourceId ?? item.id,
			serviceId: serviceId,
			title: item.title ?? 'Unknown',
			artist: (item.metadata?.artist as string) ?? 'Unknown',
			album: (item.metadata?.album as string) ?? album?.title ?? '',
			albumId: (item.metadata?.albumId as string) ?? album?.sourceId ?? '',
			duration: item.duration ?? 0,
			image: item.poster ?? album?.poster ?? ''
		};
	}

	function playFromTrack(index: number) {
		const mapped = tracks.map((t: any) => toTrack(t, data.serviceId));
		setQueue(mapped, index);
	}

	function playAll() {
		playFromTrack(0);
	}

	function shufflePlay() {
		const mapped = tracks.map((t: any) => toTrack(t, data.serviceId));
		const randomIndex = Math.floor(Math.random() * mapped.length);
		setQueue(mapped, randomIndex);
	}

	function toggleLike() {
		liked = !liked;
	}

	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function isCurrentTrack(track: any): boolean {
		const current = musicPlayer.currentTrack;
		if (!current) return false;
		return current.sourceId === (track.sourceId ?? track.id);
	}

	function isPlaying(track: any): boolean {
		return isCurrentTrack(track) && musicPlayer.playing;
	}
</script>

<svelte:head>
	<title>{album?.title ?? 'Album'} — Nexus</title>
</svelte:head>

<div class="album-page">
	<!-- Hero -->
	<div class="hero">
		<div class="cover">
			{#if album?.poster && !imageError}
				<img
					src={album.poster}
					alt={album.title}
					class="cover-img"
					onerror={() => (imageError = true)}
				/>
			{:else}
				<div class="cover-placeholder"></div>
			{/if}
		</div>

		<div class="hero-info">
			<span class="label">Album</span>
			<h1 class="title">{album?.title ?? 'Unknown Album'}</h1>
			{#if artistId}
				<a href="/music/artists/{artistId}?service={data.serviceId}" class="artist-link">
					{artistName}
				</a>
			{:else}
				<span class="artist-text">{artistName}</span>
			{/if}
			<span class="stats">
				{#if album?.year}{album.year} &middot; {/if}{trackCount} song{trackCount !== 1 ? 's' : ''}, {totalMinutes} min
			</span>

			<div class="actions">
				<button class="play-btn" onclick={playAll} aria-label="Play all">
					<Play size={20} fill="currentColor" />
				</button>
				<button class="shuffle-btn" onclick={shufflePlay}>
					<Shuffle size={14} />
					Shuffle
				</button>
				<button class="icon-btn" class:liked onclick={toggleLike} aria-label="Like album">
					<Heart size={16} fill={liked ? 'currentColor' : 'none'} />
				</button>
				<button class="icon-btn" aria-label="More options">
					<MoreHorizontal size={16} />
				</button>
			</div>
		</div>
	</div>

	<!-- Tracklist -->
	<div class="tracklist">
		<div class="track-header">
			<span class="col-num">#</span>
			<span class="col-title">Title</span>
			<span class="col-artist">Artist</span>
			<span class="col-duration">Duration</span>
		</div>

		{#each tracks as track, i (track.sourceId ?? track.id)}
			{@const playing = isPlaying(track)}
			{@const current = isCurrentTrack(track)}
			<button
				class="track-row"
				class:current
				onclick={() => playFromTrack(i)}
			>
				<span class="col-num">
					{#if playing}
						<span class="equalizer">
							<span class="bar"></span>
							<span class="bar"></span>
							<span class="bar"></span>
						</span>
					{:else}
						<span class="track-number">{(track.metadata?.indexNumber ?? i + 1)}</span>
						<span class="track-play-icon">
							<Play size={12} fill="currentColor" />
						</span>
					{/if}
				</span>
				<span class="col-title" class:playing-title={current}>
					{track.title}
				</span>
				<span class="col-artist">
					{track.metadata?.artist ? String(track.metadata.artist) : artistName}
				</span>
				<span class="col-duration">
					{track.duration ? formatDuration(track.duration) : '--:--'}
				</span>
			</button>
		{/each}
	</div>

	<!-- More by Artist -->
	{#if data.moreByArtist.length > 0}
		<div class="more-section">
			<h2 class="more-title">More by {artistName}</h2>
			<div class="more-scroll">
				{#each data.moreByArtist as moreAlbum (moreAlbum.sourceId)}
					<AlbumCard album={moreAlbum} />
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.album-page {
		padding: 24px;
		max-width: 900px;
		margin: 0 auto;
	}

	/* ── Hero ── */
	.hero {
		display: flex;
		gap: 28px;
		align-items: flex-end;
		margin-bottom: 32px;
	}

	.cover {
		width: 220px;
		height: 220px;
		border-radius: 12px;
		overflow: hidden;
		flex-shrink: 0;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
	}

	.cover-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.cover-placeholder {
		width: 100%;
		height: 100%;
		background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-deep) 100%);
	}

	.hero-info {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-muted);
	}

	.title {
		font-family: var(--font-display);
		font-size: 28px;
		font-weight: 700;
		color: var(--color-cream);
		margin: 0;
		line-height: 1.15;
	}

	.artist-link {
		font-size: 13px;
		color: var(--color-muted);
		text-decoration: none;
		transition: color 0.15s ease;
	}

	.artist-link:hover {
		color: var(--color-accent);
	}

	.artist-text {
		font-size: 13px;
		color: var(--color-muted);
	}

	.stats {
		font-size: 13px;
		color: var(--color-muted);
		margin-bottom: 8px;
	}

	.actions {
		display: flex;
		gap: 10px;
		align-items: center;
		margin-top: 8px;
	}

	.play-btn {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: none;
		background: var(--color-accent);
		color: #0d0b0a;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		box-shadow: 0 4px 20px rgba(212, 162, 83, 0.35);
		transition: transform 0.15s ease;
	}

	.play-btn:hover {
		transform: scale(1.06);
	}

	.shuffle-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		border-radius: 20px;
		border: 1px solid color-mix(in srgb, var(--color-muted) 40%, transparent);
		background: transparent;
		color: var(--color-cream);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background 0.15s ease;
	}

	.shuffle-btn:hover {
		border-color: var(--color-cream);
		background: color-mix(in srgb, var(--color-cream) 6%, transparent);
	}

	.icon-btn {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1px solid color-mix(in srgb, var(--color-muted) 30%, transparent);
		background: transparent;
		color: var(--color-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.icon-btn:hover {
		color: var(--color-cream);
		border-color: var(--color-cream);
	}

	.icon-btn.liked {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}

	/* ── Tracklist ── */
	.tracklist {
		margin-bottom: 48px;
	}

	.track-header {
		display: grid;
		grid-template-columns: 40px 1fr 1fr 80px;
		gap: 8px;
		padding: 0 12px 8px;
		border-bottom: 1px solid color-mix(in srgb, var(--color-muted) 15%, transparent);
		margin-bottom: 4px;
	}

	.track-header span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-faint, var(--color-muted));
		font-weight: 600;
	}

	.col-duration {
		text-align: right;
	}

	.track-row {
		display: grid;
		grid-template-columns: 40px 1fr 1fr 80px;
		gap: 8px;
		align-items: center;
		padding: 8px 12px;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--color-cream);
		cursor: pointer;
		width: 100%;
		text-align: left;
		transition: background 0.12s ease;
	}

	.track-row:hover {
		background: var(--color-raised, color-mix(in srgb, var(--color-surface) 60%, transparent));
	}

	.track-row .col-num {
		font-size: 13px;
		font-family: var(--font-mono, monospace);
		color: var(--color-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
	}

	.track-number {
		display: block;
	}

	.track-play-icon {
		display: none;
		color: var(--color-accent);
	}

	.track-row:hover .track-number {
		display: none;
	}

	.track-row:hover .track-play-icon {
		display: block;
	}

	.track-row .col-title {
		font-size: 13px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.playing-title {
		color: var(--color-accent);
	}

	.track-row .col-artist {
		font-size: 12px;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.track-row .col-duration {
		font-size: 12px;
		font-family: var(--font-mono, monospace);
		color: var(--color-muted);
		text-align: right;
	}

	.track-row.current .col-num {
		color: var(--color-accent);
	}

	/* Equalizer bars */
	.equalizer {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 14px;
	}

	.bar {
		width: 3px;
		background: var(--color-accent);
		border-radius: 1px;
		animation: eq-bounce 0.6s ease-in-out infinite alternate;
	}

	.bar:nth-child(1) {
		height: 6px;
		animation-delay: 0s;
	}

	.bar:nth-child(2) {
		height: 10px;
		animation-delay: 0.2s;
	}

	.bar:nth-child(3) {
		height: 4px;
		animation-delay: 0.4s;
	}

	@keyframes eq-bounce {
		0% {
			height: 4px;
		}
		100% {
			height: 14px;
		}
	}

	/* ── More by Artist ── */
	.more-section {
		margin-top: 16px;
	}

	.more-title {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 700;
		color: var(--color-cream);
		margin: 0 0 16px;
	}

	.more-scroll {
		display: flex;
		gap: 16px;
		overflow-x: auto;
		padding-bottom: 8px;
	}

	.more-scroll > :global(*) {
		min-width: 150px;
		max-width: 150px;
	}

	/* ── Responsive ── */
	@media (max-width: 640px) {
		.hero {
			flex-direction: column;
			align-items: center;
			text-align: center;
		}

		.cover {
			width: 180px;
			height: 180px;
		}

		.hero-info {
			align-items: center;
		}

		.title {
			font-size: 22px;
		}

		.track-header,
		.track-row {
			grid-template-columns: 32px 1fr 60px;
		}

		.col-artist {
			display: none;
		}
	}
</style>
