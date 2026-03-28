<script lang="ts">
	import type { PageData } from './$types';
	import ArtistCard from '$lib/components/music/ArtistCard.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { data }: { data: PageData } = $props();

	let searchInput = $derived(data.search);

	const sorts = [
		{ value: 'SortName', label: 'Alphabetical' },
		{ value: 'MostPlayed', label: 'Most Played' }
	] as const;

	function updateParams(params: Record<string, string>) {
		const url = new URL(page.url);
		for (const [key, val] of Object.entries(params)) {
			if (val) {
				url.searchParams.set(key, val);
			} else {
				url.searchParams.delete(key);
			}
		}
		goto(url.toString(), { replaceState: true, keepFocus: true });
	}

	function onSearch(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		searchInput = value;
		updateParams({ q: value });
	}

	function setSort(sort: string) {
		updateParams({ sort });
	}
</script>

<svelte:head>
	<title>Artists — Nexus</title>
</svelte:head>

<div class="page">
	<div class="toolbar">
		<div class="search-wrap">
			<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="11" cy="11" r="8" />
				<line x1="21" y1="21" x2="16.65" y2="16.65" />
			</svg>
			<input
				type="text"
				class="search-input"
				placeholder="Search artists..."
				value={searchInput}
				oninput={onSearch}
			/>
		</div>

		<div class="sort-pills">
			{#each sorts as s (s.value)}
				<button
					class="pill"
					class:active={data.currentSort === s.value}
					onclick={() => setSort(s.value)}
				>
					{s.label}
				</button>
			{/each}
		</div>
	</div>

	{#if data.artists.length === 0}
		<div class="empty">
			<div class="empty-icon">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
					<circle cx="12" cy="7" r="4" />
				</svg>
			</div>
			<p class="empty-text">No artists found</p>
		</div>
	{:else}
		<div class="grid">
			{#each data.artists as artist (artist.id)}
				<ArtistCard {artist} />
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		padding: 20px 24px 40px;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 24px;
		flex-wrap: wrap;
	}

	.search-wrap {
		position: relative;
		flex: 1;
		min-width: 180px;
		max-width: 360px;
	}

	.search-icon {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-muted, #8a8078);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 8px 12px 8px 36px;
		background: var(--color-raised, #1a1a2e);
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 8px;
		color: var(--color-cream, #f0e6d3);
		font-family: var(--font-body);
		font-size: 13px;
		outline: none;
		transition: border-color 0.15s ease;
	}

	.search-input::placeholder {
		color: var(--color-muted, #8a8078);
	}

	.search-input:focus {
		border-color: rgba(212, 162, 83, 0.4);
	}

	.sort-pills {
		display: flex;
		gap: 4px;
	}

	.pill {
		padding: 6px 14px;
		border-radius: 9999px;
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 600;
		color: var(--color-muted, #8a8078);
		background: transparent;
		border: none;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}

	.pill:hover {
		color: var(--color-cream, #f0e6d3);
	}

	.pill.active {
		background: rgba(212, 162, 83, 0.12);
		color: #d4a253;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: 24px;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 96px 0;
		text-align: center;
	}

	.empty-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		border-radius: 16px;
		background: var(--color-surface, #1a1a2e);
		color: var(--color-muted, #8a8078);
		margin-bottom: 20px;
	}

	.empty-text {
		font-size: 14px;
		font-weight: 500;
		color: var(--color-cream, #f0e6d3);
		margin: 0;
	}
</style>
