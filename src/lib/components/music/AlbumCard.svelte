<script lang="ts">
	import { Play } from 'lucide-svelte';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { lowResImageUrl } from '$lib/image-hint';

	interface Props {
		album: UnifiedMedia;
		onplay?: () => void;
	}

	let { album, onplay }: Props = $props();

	let imageError = $state(false);
	let imgLoaded = $state(false);

	const artist = $derived(album.metadata?.artist ? String(album.metadata.artist) : '');
	const href = $derived(`/music/albums/${album.sourceId}?service=${album.serviceId}`);
	const lowResSrc = $derived(lowResImageUrl(album.poster));

	function handlePlay(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		onplay?.();
	}
</script>

<a {href} class="group/album flex flex-col text-left">
	<div class="cover">
		{#if album.poster && !imageError}
			{#if lowResSrc && !imgLoaded}
				<img
					src={lowResSrc}
					alt=""
					aria-hidden="true"
					class="lqip"
					loading="lazy"
					decoding="async"
				/>
			{/if}
			<img
				src={album.poster}
				alt={album.title}
				class="image"
				loading="lazy"
				decoding="async"
				onload={() => (imgLoaded = true)}
				onerror={() => (imageError = true)}
			/>
		{:else}
			<div class="placeholder"></div>
		{/if}

		{#if onplay}
			<button class="play-btn" onclick={handlePlay} aria-label="Play {album.title}">
				<Play size={16} fill="currentColor" />
			</button>
		{/if}
	</div>

	<div class="info">
		<p class="album-name">{album.title}</p>
		{#if artist}
			<p class="artist-name">{artist}</p>
		{/if}
	</div>
</a>

<style>
	.group\/album {
		text-decoration: none;
		cursor: pointer;
	}

	.cover {
		position: relative;
		aspect-ratio: 1;
		overflow: hidden;
		border-radius: 10px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		transition: box-shadow 0.3s ease;
	}

	.group\/album:hover .cover {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}

	.image {
		position: relative;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.3s ease;
	}

	.lqip {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: blur(16px);
		transform: scale(1.1);
	}

	.group\/album:hover .image {
		transform: scale(1.03);
	}

	.placeholder {
		width: 100%;
		height: 100%;
		background: linear-gradient(135deg, var(--color-surface, #1a1a2e) 0%, var(--color-deep, #0d0b0a) 100%);
	}

	.play-btn {
		position: absolute;
		bottom: 8px;
		right: 8px;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: none;
		background: #d4a253;
		color: #0d0b0a;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		opacity: 0;
		transform: translateY(6px);
		transition:
			opacity 0.25s ease,
			transform 0.25s ease;
		box-shadow: 0 4px 16px rgba(212, 162, 83, 0.4);
	}

	.group\/album:hover .play-btn {
		opacity: 1;
		transform: translateY(0);
	}

	.play-btn:hover {
		background: #e0b36a;
	}

	.info {
		margin-top: 6px;
		padding: 0 2px;
	}

	.album-name {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-cream, #f0e6d3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin: 0;
	}

	.artist-name {
		font-size: 11px;
		color: var(--color-muted, #8a8078);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin: 0;
	}
</style>
