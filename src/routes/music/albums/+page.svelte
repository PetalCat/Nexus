<script lang="ts">
	import type { PageData } from './$types';
	import AlbumCard from '$lib/components/music/AlbumCard.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { data }: { data: PageData } = $props();

	let searchInput = $derived.by(() => data.search);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	const sortOptions = [
		{ value: 'added', label: 'Recently Added' },
		{ value: 'title', label: 'Title A\u2013Z' },
		{ value: 'artist', label: 'Artist' },
		{ value: 'year', label: 'Year' }
	] as const;

	const visibleGenres = $derived(data.genres.slice(0, 12));

	function navigate(params: Record<string, string>) {
		const url = new URL(page.url);
		for (const [k, v] of Object.entries(params)) {
			if (v) url.searchParams.set(k, v);
			else url.searchParams.delete(k);
		}
		goto(url.toString(), { keepFocus: true, noScroll: true });
	}

	function selectGenre(genre: string) {
		navigate({ genre: genre === data.currentGenre ? '' : genre });
	}

	function selectSort(sort: string) {
		navigate({ sort });
	}

	function handleSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			navigate({ q: searchInput });
		}, 300);
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			clearTimeout(searchTimer);
			navigate({ q: searchInput });
		}
	}
</script>

<svelte:head>
	<title>Albums — Nexus</title>
</svelte:head>

<div class="px-4 py-6 sm:px-6">
	<h1 class="page-title">Albums</h1>

	<!-- Filter bar -->
	<div class="filter-bar">
		<div class="chips">
			<button
				class="chip"
				class:active={!data.currentGenre}
				onclick={() => selectGenre('')}
			>
				All
			</button>
			{#each visibleGenres as genre (genre)}
				<button
					class="chip"
					class:active={data.currentGenre === genre}
					onclick={() => selectGenre(genre)}
				>
					{genre}
				</button>
			{/each}
		</div>

		<input
			type="search"
			class="search-input"
			placeholder="Search albums..."
			bind:value={searchInput}
			oninput={handleSearchInput}
			onkeydown={handleSearchKeydown}
		/>
	</div>

	<!-- Sort pills -->
	<div class="sort-bar">
		{#each sortOptions as opt (opt.value)}
			<button
				class="sort-pill"
				class:active={data.currentSort === opt.value}
				onclick={() => selectSort(opt.value)}
			>
				{opt.label}
			</button>
		{/each}
	</div>

	<!-- Albums grid -->
	{#if data.albums.length > 0}
		<div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
			{#each data.albums as album (album.id)}
				<AlbumCard {album} />
			{/each}
		</div>
	{:else}
		<div class="empty">
			<p>No albums found</p>
		</div>
	{/if}
</div>

<style>
	.page-title {
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 700;
		color: var(--color-cream);
		margin-bottom: 16px;
	}

	.filter-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}

	.chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		flex: 1;
		min-width: 0;
	}

	.chip {
		padding: 5px 14px;
		border-radius: 20px;
		border: 1px solid color-mix(in srgb, var(--color-muted) 30%, transparent);
		background: transparent;
		color: var(--color-muted);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.chip:hover {
		border-color: var(--color-muted);
		color: var(--color-cream);
	}

	.chip.active {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #0d0b0a;
		font-weight: 600;
	}

	.search-input {
		padding: 6px 12px;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-muted) 30%, transparent);
		background: var(--color-surface);
		color: var(--color-cream);
		font-size: 13px;
		width: 200px;
		outline: none;
		transition: border-color 0.15s ease;
	}

	.search-input::placeholder {
		color: var(--color-muted);
	}

	.search-input:focus {
		border-color: var(--color-accent);
	}

	.sort-bar {
		display: flex;
		gap: 6px;
		margin-bottom: 20px;
	}

	.sort-pill {
		padding: 4px 12px;
		border-radius: 14px;
		border: none;
		background: var(--color-surface);
		color: var(--color-muted);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.sort-pill:hover {
		color: var(--color-cream);
	}

	.sort-pill.active {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		color: var(--color-accent);
		font-weight: 600;
	}

	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 64px 0;
		color: var(--color-muted);
		font-size: 14px;
	}
</style>
