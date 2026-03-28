<script lang="ts">
	interface Props {
		artist: {
			id: string;
			name: string;
			imageUrl?: string;
			albumCount?: number;
			serviceId?: string;
		};
	}

	let { artist }: Props = $props();

	let imageError = $state(false);

	const href = $derived(`/music/artists/${artist.id}${artist.serviceId ? `?service=${artist.serviceId}` : ''}`);
</script>

<a {href} class="group/artist flex flex-col items-center text-center">
	<div class="avatar">
		{#if artist.imageUrl && !imageError}
			<img
				src={artist.imageUrl}
				alt={artist.name}
				class="image"
				loading="lazy"
				onerror={() => (imageError = true)}
			/>
		{:else}
			<div class="placeholder"></div>
		{/if}
	</div>

	<div class="info">
		<p class="artist-name">{artist.name}</p>
		{#if artist.albumCount != null}
			<p class="album-count">
				{artist.albumCount} {artist.albumCount === 1 ? 'album' : 'albums'}
			</p>
		{/if}
	</div>
</a>

<style>
	.group\/artist {
		text-decoration: none;
		cursor: pointer;
	}

	.avatar {
		position: relative;
		aspect-ratio: 1;
		width: 100%;
		overflow: hidden;
		border-radius: 50%;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		transition:
			box-shadow 0.3s ease,
			transform 0.3s ease;
	}

	.group\/artist:hover .avatar {
		transform: scale(1.05);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}

	.image {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.placeholder {
		width: 100%;
		height: 100%;
		background: linear-gradient(135deg, var(--color-surface, #1a1a2e) 0%, var(--color-deep, #0d0b0a) 100%);
	}

	.info {
		margin-top: 8px;
		padding: 0 2px;
	}

	.artist-name {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-cream, #f0e6d3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
		margin: 0;
	}

	.album-count {
		font-size: 11px;
		color: var(--color-muted, #8a8078);
		margin: 0;
	}
</style>
