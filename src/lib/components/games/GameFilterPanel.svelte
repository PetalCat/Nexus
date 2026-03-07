<script lang="ts">
	import type { UnifiedMedia } from '$lib/adapters/types';

	interface Filters {
		genres: string[];
		statuses: string[];
		ratingMin: number | null;
		ratingMax: number | null;
		regions: string[];
		tags: string[];
	}

	interface Props {
		items: UnifiedMedia[];
		filters: Filters;
		onfilterchange: (filters: Filters) => void;
	}

	let { items, filters, onfilterchange }: Props = $props();

	const allGenres = $derived(
		[...new Set(items.flatMap((i) => i.genres ?? []))].filter(Boolean).sort()
	);
	const allStatuses = $derived(
		[...new Set(items.map((i) => (i.metadata?.userStatus as string) ?? '').filter(Boolean))].sort()
	);
	const allRegions = $derived(
		[...new Set(items.flatMap((i) => {
			const r = i.metadata?.regions;
			return Array.isArray(r) ? r : typeof r === 'string' && r ? [r] : [];
		}))].sort()
	);
	const allTags = $derived(
		[...new Set(items.flatMap((i) => {
			const t = i.metadata?.tags;
			return Array.isArray(t) ? t : typeof t === 'string' && t ? [t] : [];
		}))].sort()
	);

	const activeCount = $derived(
		filters.genres.length +
		filters.statuses.length +
		filters.regions.length +
		filters.tags.length +
		(filters.ratingMin != null ? 1 : 0) +
		(filters.ratingMax != null ? 1 : 0)
	);

	function toggleInArray(arr: string[], value: string): string[] {
		return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
	}

	function toggleGenre(g: string) {
		onfilterchange({ ...filters, genres: toggleInArray(filters.genres, g) });
	}
	function toggleStatus(s: string) {
		onfilterchange({ ...filters, statuses: toggleInArray(filters.statuses, s) });
	}
	function toggleRegion(r: string) {
		onfilterchange({ ...filters, regions: toggleInArray(filters.regions, r) });
	}
	function toggleTag(t: string) {
		onfilterchange({ ...filters, tags: toggleInArray(filters.tags, t) });
	}
	function setRatingMin(v: string) {
		onfilterchange({ ...filters, ratingMin: v ? Number(v) : null });
	}
	function setRatingMax(v: string) {
		onfilterchange({ ...filters, ratingMax: v ? Number(v) : null });
	}
	function clearAll() {
		onfilterchange({ genres: [], statuses: [], ratingMin: null, ratingMax: null, regions: [], tags: [] });
	}

	const statusLabels: Record<string, string> = {
		playing: 'Playing',
		finished: 'Finished',
		completed: 'Completed',
		retired: 'Retired',
		wishlist: 'Wishlist',
		backlog: 'Backlog'
	};

	const statusColors: Record<string, string> = {
		playing: 'var(--color-accent)',
		finished: '#4dd9c0',
		completed: '#6bbd45',
		retired: '#f59e0b',
		wishlist: '#60a5fa',
		backlog: 'var(--color-muted)'
	};
</script>

<div class="fp">
	<!-- Active filter chips -->
	{#if activeCount > 0}
		<div class="fp__chips">
			{#each filters.genres as g}
				<button class="fp__chip" onclick={() => toggleGenre(g)}>
					{g} <span class="fp__chip-x">&times;</span>
				</button>
			{/each}
			{#each filters.statuses as s}
				<button class="fp__chip" onclick={() => toggleStatus(s)}>
					{statusLabels[s] ?? s} <span class="fp__chip-x">&times;</span>
				</button>
			{/each}
			{#each filters.regions as r}
				<button class="fp__chip" onclick={() => toggleRegion(r)}>
					{r} <span class="fp__chip-x">&times;</span>
				</button>
			{/each}
			{#each filters.tags as t}
				<button class="fp__chip" onclick={() => toggleTag(t)}>
					{t} <span class="fp__chip-x">&times;</span>
				</button>
			{/each}
			{#if filters.ratingMin != null}
				<button class="fp__chip" onclick={() => setRatingMin('')}>
					Min: {filters.ratingMin} <span class="fp__chip-x">&times;</span>
				</button>
			{/if}
			{#if filters.ratingMax != null}
				<button class="fp__chip" onclick={() => setRatingMax('')}>
					Max: {filters.ratingMax} <span class="fp__chip-x">&times;</span>
				</button>
			{/if}
			<button class="fp__clear" onclick={clearAll}>Clear All</button>
		</div>
	{/if}

	<div class="fp__sections">
		<!-- Status -->
		{#if allStatuses.length > 0}
			<div class="fp__group">
				<span class="fp__group-label">Status</span>
				<div class="fp__options">
					{#each allStatuses as s}
						<button
							class="fp__opt"
							class:fp__opt--active={filters.statuses.includes(s)}
							onclick={() => toggleStatus(s)}
						>
							<span class="fp__dot" style="background: {statusColors[s] ?? 'var(--color-muted)'}"></span>
							{statusLabels[s] ?? s}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Genres -->
		{#if allGenres.length > 0}
			<div class="fp__group">
				<span class="fp__group-label">Genre</span>
				<div class="fp__options fp__options--wrap">
					{#each allGenres as g}
						<button
							class="fp__pill"
							class:fp__pill--active={filters.genres.includes(g)}
							onclick={() => toggleGenre(g)}
						>
							{g}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Rating -->
		<div class="fp__group">
			<span class="fp__group-label">Rating</span>
			<div class="fp__rating-row">
				<input
					type="number"
					min="0"
					max="10"
					step="0.1"
					placeholder="Min"
					value={filters.ratingMin ?? ''}
					oninput={(e) => setRatingMin(e.currentTarget.value)}
					class="fp__input"
				/>
				<span class="fp__rating-sep">-</span>
				<input
					type="number"
					min="0"
					max="10"
					step="0.1"
					placeholder="Max"
					value={filters.ratingMax ?? ''}
					oninput={(e) => setRatingMax(e.currentTarget.value)}
					class="fp__input"
				/>
			</div>
		</div>

		<!-- Regions -->
		{#if allRegions.length > 0}
			<div class="fp__group">
				<span class="fp__group-label">Region</span>
				<div class="fp__options fp__options--wrap">
					{#each allRegions as r}
						<button
							class="fp__pill"
							class:fp__pill--active={filters.regions.includes(r)}
							onclick={() => toggleRegion(r)}
						>
							{r}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Tags -->
		{#if allTags.length > 0}
			<div class="fp__group">
				<span class="fp__group-label">Tags</span>
				<div class="fp__options fp__options--wrap">
					{#each allTags as t}
						<button
							class="fp__pill"
							class:fp__pill--active={filters.tags.includes(t)}
							onclick={() => toggleTag(t)}
						>
							{t}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.fp {
		padding: 0.75rem 1rem;
		background: var(--color-surface);
		border-radius: var(--radius-card);
		border: 1px solid rgba(240, 235, 227, 0.06);
	}

	.fp__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid rgba(240, 235, 227, 0.06);
	}

	.fp__chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.5rem;
		border-radius: 100px;
		background: var(--color-raised);
		color: var(--color-cream);
		font-size: 0.68rem;
		font-weight: 500;
		border: 1px solid rgba(240, 235, 227, 0.08);
		cursor: pointer;
		transition: background 0.15s;
	}
	.fp__chip:hover { background: var(--color-hover); }
	.fp__chip-x { opacity: 0.5; font-size: 0.85rem; line-height: 1; }

	.fp__clear {
		font-size: 0.68rem;
		font-weight: 500;
		color: var(--color-warm);
		cursor: pointer;
		padding: 0.2rem 0.4rem;
	}
	.fp__clear:hover { text-decoration: underline; }

	.fp__sections {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.fp__group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.fp__group-label {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.fp__options {
		display: flex;
		gap: 0.3rem;
	}
	.fp__options--wrap { flex-wrap: wrap; }

	.fp__opt {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.6rem;
		border-radius: 6px;
		font-size: 0.72rem;
		font-weight: 500;
		color: var(--color-muted);
		background: transparent;
		cursor: pointer;
		transition: all 0.15s;
	}
	.fp__opt:hover { color: var(--color-cream); background: var(--color-raised); }
	.fp__opt--active { color: var(--color-cream); background: var(--color-raised); }

	.fp__dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.fp__pill {
		padding: 0.2rem 0.55rem;
		border-radius: 100px;
		font-size: 0.68rem;
		font-weight: 500;
		color: var(--color-muted);
		background: var(--color-raised);
		border: 1px solid transparent;
		cursor: pointer;
		transition: all 0.15s;
	}
	.fp__pill:hover { color: var(--color-cream); border-color: var(--color-muted); }
	.fp__pill--active {
		color: var(--color-cream);
		background: color-mix(in oklch, var(--color-accent) 20%, var(--color-raised));
		border-color: var(--color-accent);
	}

	.fp__rating-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.fp__rating-sep {
		font-size: 0.75rem;
		color: var(--color-faint);
	}
	.fp__input {
		width: 5rem;
		padding: 0.3rem 0.5rem;
		border-radius: 6px;
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.06);
		color: var(--color-cream);
		font-size: 0.75rem;
		font-family: var(--font-body);
	}
	.fp__input::placeholder { color: var(--color-faint); }
	.fp__input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
</style>
