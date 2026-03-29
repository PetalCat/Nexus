<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';

	let { data }: { data: PageData } = $props();

	let searchValue = $state('');

	$effect(() => {
		searchValue = data.name ?? '';
	});

	const franchise = $derived(data.franchise);

	const sections = $derived.by(() => {
		if (!franchise) return [];
		const defs: { key: string; label: string; items: UnifiedMedia[] }[] = [
			{ key: 'movies', label: 'Movies', items: franchise.movies },
			{ key: 'shows', label: 'TV Shows', items: franchise.shows },
			{ key: 'books', label: 'Books', items: franchise.books },
			{ key: 'games', label: 'Games', items: franchise.games },
			{ key: 'music', label: 'Music', items: franchise.music },
			{ key: 'videos', label: 'Videos', items: franchise.videos }
		];
		return defs.filter((s) => s.items.length > 0);
	});

	const totalCount = $derived(sections.reduce((sum, s) => sum + s.items.length, 0));

	function cardUrl(item: UnifiedMedia): string {
		return `/media/${item.type}/${item.sourceId}?service=${item.serviceId}`;
	}
</script>

<svelte:head>
	<title>{franchise ? `${franchise.name} — Nexus` : 'Franchise — Nexus'}</title>
</svelte:head>

<div class="franchise-page">
	<!-- Search bar -->
	<form method="get" action="/franchise" class="search-bar" role="search" aria-label="Franchise search">
		<svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="11" cy="11" r="8" />
			<path d="M21 21l-4.35-4.35" />
		</svg>
		<input
			type="text"
			name="name"
			bind:value={searchValue}
			placeholder="Search a franchise (e.g. Star Wars, Dune, Batman)"
			class="search-input"
			aria-label="Franchise name"
		/>
		<button type="submit" class="search-submit" aria-label="Search">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M5 12h14" />
				<path d="M12 5l7 7-7 7" />
			</svg>
		</button>
	</form>

	{#if !data.name}
		<!-- Empty state: no search -->
		<div class="empty-state">
			<div class="empty-icon">
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M4 7h16M4 12h10M4 17h6" />
				</svg>
			</div>
			<h2 class="empty-title">Explore a franchise</h2>
			<p class="empty-desc">Search for a franchise name to find all related movies, shows, books, games, and more across your library.</p>
		</div>
	{:else if !franchise || totalCount === 0}
		<!-- Empty state: no results -->
		<div class="empty-state">
			<div class="empty-icon">
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<circle cx="11" cy="11" r="8" />
					<path d="M21 21l-4.35-4.35" />
				</svg>
			</div>
			<h2 class="empty-title">No results for "{data.name}"</h2>
			<p class="empty-desc">Try a different franchise name or check your connected services.</p>
		</div>
	{:else}
		<!-- Title -->
		<header class="franchise-header">
			<h1 class="franchise-title">Explore: {franchise.name}</h1>
			<span class="franchise-count">{totalCount} item{totalCount !== 1 ? 's' : ''} found</span>
		</header>

		<!-- Sections -->
		<div class="sections">
			{#each sections as section (section.key)}
				<section class="media-section" aria-label="{section.label} in {franchise.name}">
					<h2 class="section-title">{section.label}</h2>
					<div class="scroll-row">
						{#each section.items as item (item.sourceId + ':' + item.serviceId)}
							<a
								href={cardUrl(item)}
								class="poster-card"
								aria-label="{item.title}{item.year ? ` (${item.year})` : ''}"
							>
								<div class="poster-img">
									{#if item.poster}
										<img
											src={item.poster}
											alt=""
											loading="lazy"
											decoding="async"
										/>
									{:else}
										<div class="poster-placeholder" aria-hidden="true">
											<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
												<rect x="3" y="3" width="18" height="18" rx="2" />
												<circle cx="9" cy="10" r="2" />
												<path d="M3 21l7-7 4 4 3-3 4 4" />
											</svg>
										</div>
									{/if}
								</div>
								<div class="poster-info">
									<span class="poster-title">{item.title}</span>
									{#if item.year}
										<span class="poster-year">{item.year}</span>
									{/if}
								</div>
							</a>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</div>

<style>
	.franchise-page {
		padding: 1rem 0.75rem 2rem;
		max-width: 1400px;
		margin: 0 auto;
	}

	@media (min-width: 640px) {
		.franchise-page {
			padding: 1.5rem 1rem 3rem;
		}
	}

	@media (min-width: 1024px) {
		.franchise-page {
			padding: 2rem 1.5rem 4rem;
		}
	}

	/* Search bar */
	.search-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: #14141f;
		border: 1px solid transparent;
		border-radius: 0.75rem;
		padding: 0.5rem 0.75rem;
		margin-bottom: 1.5rem;
		transition: border-color 0.2s;
	}

	.search-bar:focus-within {
		border-color: #d4a253;
	}

	.search-icon {
		color: #8a8a9a;
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #f0e6d3;
		font-size: 0.9375rem;
		min-width: 0;
		min-height: 44px;
	}

	.search-input::placeholder {
		color: #8a8a9a;
	}

	.search-submit {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		flex-shrink: 0;
		background: transparent;
		border: none;
		color: #d4a253;
		cursor: pointer;
		border-radius: 0.5rem;
		transition: background 0.15s;
	}

	.search-submit:hover {
		background: rgba(212, 162, 83, 0.1);
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 6rem 1rem;
	}

	.empty-icon {
		width: 4rem;
		height: 4rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 1rem;
		background: #14141f;
		color: #8a8a9a;
		margin-bottom: 1.25rem;
	}

	.empty-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: #f0e6d3;
		margin: 0 0 0.5rem;
	}

	.empty-desc {
		font-size: 0.875rem;
		color: #8a8a9a;
		max-width: 28rem;
		line-height: 1.5;
		margin: 0;
	}

	/* Header */
	.franchise-header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.franchise-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #f0e6d3;
		margin: 0;
	}

	@media (min-width: 640px) {
		.franchise-title {
			font-size: 1.75rem;
		}
	}

	.franchise-count {
		font-size: 0.8125rem;
		color: #8a8a9a;
	}

	/* Sections */
	.sections {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.section-title {
		font-size: 1.125rem;
		font-weight: 600;
		color: #f0e6d3;
		margin: 0 0 0.75rem;
	}

	/* Horizontal scroll row */
	.scroll-row {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.scroll-row::-webkit-scrollbar {
		display: none;
	}

	/* Poster card */
	.poster-card {
		display: flex;
		flex-direction: column;
		width: 120px;
		flex-shrink: 0;
		text-decoration: none;
		color: inherit;
		border-radius: 0.5rem;
		transition: transform 0.15s, opacity 0.15s;
		min-height: 44px;
	}

	.poster-card:hover {
		transform: translateY(-2px);
	}

	.poster-card:focus-visible {
		outline: 2px solid #d4a253;
		outline-offset: 2px;
	}

	.poster-img {
		width: 120px;
		aspect-ratio: 2 / 3;
		border-radius: 0.5rem;
		overflow: hidden;
		background: #14141f;
	}

	.poster-img img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.poster-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #8a8a9a;
	}

	.poster-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding-top: 0.375rem;
	}

	.poster-title {
		font-size: 0.8125rem;
		font-weight: 500;
		color: #f0e6d3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.3;
	}

	.poster-year {
		font-size: 0.75rem;
		color: #8a8a9a;
	}
</style>
