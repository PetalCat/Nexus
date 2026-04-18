<script lang="ts">
	import type { PageData } from './$types';
	import AlbumCard from '$lib/components/music/AlbumCard.svelte';
	import ArtistCard from '$lib/components/music/ArtistCard.svelte';
	import { lowResImageUrl } from '$lib/image-hint';

	let { data }: { data: PageData } = $props();

	let loadedChips = $state<Record<string, boolean>>({});

	const greeting = $derived.by(() => {
		const h = new Date().getHours();
		return h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening';
	});

	const hasData = $derived(
		data.recentlyPlayed.length > 0 || data.newAlbums.length > 0 || data.artists.length > 0
	);
</script>

<svelte:head>
	<title>Music — Nexus</title>
</svelte:head>

<div class="px-4 py-6 sm:px-6">
	<h1 class="greeting">{greeting}</h1>

	{#if !hasData}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="9" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M12 18V8l9-2v2"/>
				</svg>
			</div>
			<p class="font-medium text-[var(--color-cream)]">Connect a music service to start listening.</p>
			<a href="/settings/accounts" class="btn btn-primary mt-4 text-sm">Connect a Service</a>
		</div>
	{:else}
		<!-- Recently Played chips -->
		{#if data.recentlyPlayed.length > 0}
			<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-8">
				{#each data.recentlyPlayed.slice(0, 6) as item (item.mediaId ?? item.serviceId + item.timestamp)}
					{@const chipArt = item.poster ?? null}
					{@const chipLowRes = lowResImageUrl(chipArt)}
					{@const chipKey = item.mediaId ?? item.serviceId + item.timestamp}
					<a href="/music/albums/{item.mediaId}?service={item.serviceId}" class="recent-chip">
						{#if chipArt}
							<div class="chip-art-wrap">
								{#if chipLowRes && !loadedChips[chipKey]}
									<img
										src={chipLowRes}
										alt=""
										aria-hidden="true"
										class="chip-lqip"
										loading="lazy"
										decoding="async"
									/>
								{/if}
								<img
									src={chipArt}
									alt=""
									class="chip-art"
									loading="lazy"
									decoding="async"
									onload={() => (loadedChips = { ...loadedChips, [chipKey]: true })}
								/>
							</div>
						{:else}
							<div class="chip-art chip-art-placeholder">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
									<circle cx="9" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M12 18V8l9-2v2"/>
								</svg>
							</div>
						{/if}
						<span class="chip-title">{item.mediaTitle ?? 'Unknown'}</span>
					</a>
				{/each}
			</div>
		{/if}

		<!-- New in Your Library -->
		{#if data.newAlbums.length > 0}
			<section class="mb-8">
				<h2 class="section-title">New in Your Library</h2>
				<div class="h-scroll">
					{#each data.newAlbums as album (album.id)}
						<div class="w-[140px] shrink-0">
							<AlbumCard {album} />
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Your Artists -->
		{#if data.artists.length > 0}
			<section>
				<h2 class="section-title">Your Artists</h2>
				<div class="h-scroll">
					{#each data.artists as artist (artist.id)}
						<div class="w-[120px] shrink-0">
							<ArtistCard {artist} />
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	.greeting {
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 700;
		color: var(--color-cream);
		margin-bottom: 20px;
	}

	.section-title {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 600;
		color: var(--color-cream);
		margin-bottom: 14px;
	}

	.h-scroll {
		display: flex;
		gap: 14px;
		overflow-x: auto;
		padding-bottom: 8px;
		scrollbar-width: none;
	}

	.h-scroll::-webkit-scrollbar {
		display: none;
	}

	.recent-chip {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 12px 4px 4px;
		background: var(--color-raised);
		border-radius: 6px;
		text-decoration: none;
		color: var(--color-cream);
		transition: background 0.15s ease;
		overflow: hidden;
	}

	.recent-chip:hover {
		background: var(--color-surface);
	}

	.chip-art-wrap {
		position: relative;
		width: 44px;
		height: 44px;
		border-radius: 4px;
		overflow: hidden;
		flex-shrink: 0;
	}

	.chip-art {
		position: relative;
		width: 44px;
		height: 44px;
		border-radius: 4px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.chip-lqip {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: blur(10px);
		transform: scale(1.15);
	}

	.chip-art-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface);
		color: var(--color-muted);
	}

	.chip-title {
		font-size: 13px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
</style>
