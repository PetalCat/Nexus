<script lang="ts">
	import type { PageData } from './$types';
	import SetupHint from '$lib/components/onboarding/SetupHint.svelte';
	import { goto } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	const activeDays = $derived(data.days);
	const dayOptions = [7, 14, 30];
	const sortedDates = $derived(Object.keys(data.byDate).sort());

	const mediaTypeColors: Record<string, string> = {
		movie: '#4a9eff',
		show: '#34d399',
		music: '#a78bfa',
		album: '#a78bfa',
		book: '#f59e0b',
		game: '#f472b6'
	};

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr + 'T00:00:00');
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const tomorrow = new Date(today.getTime() + 86_400_000);
		const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

		if (dateOnly.getTime() === today.getTime()) return 'Today';
		if (dateOnly.getTime() === tomorrow.getTime()) return 'Tomorrow';

		return date.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatChipDate(dateStr: string): string {
		const date = new Date(dateStr + 'T00:00:00');
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function isToday(dateStr: string): boolean {
		const now = new Date();
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		return dateStr === today;
	}

	function isPast(dateStr: string): boolean {
		const now = new Date();
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		return dateStr < today;
	}

	function selectDays(d: number) {
		goto(`/calendar?days=${d}`, { replaceState: true });
	}
</script>

<svelte:head>
	<title>Calendar — Nexus</title>
</svelte:head>

{#if data.missingCategories?.length}
	<SetupHint missing={data.missingCategories} />
{/if}

<div class="calendar-page">
	<!-- Header -->
	<div class="calendar-header">
		<div class="header-left">
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<rect x="3" y="4" width="18" height="18" rx="2" />
				<line x1="16" y1="2" x2="16" y2="6" />
				<line x1="8" y1="2" x2="8" y2="6" />
				<line x1="3" y1="10" x2="21" y2="10" />
			</svg>
			<h1>Calendar</h1>
		</div>
		<div class="days-selector">
			{#each dayOptions as d (d)}
				<button
					class="days-btn"
					class:active={activeDays === d}
					onclick={() => selectDays(d)}
				>
					{d}d
				</button>
			{/each}
		</div>
	</div>

	<!-- Content -->
	{#if data.items.length === 0}
		<div class="empty-state">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="empty-icon">
				<rect x="3" y="4" width="18" height="18" rx="2" />
				<line x1="16" y1="2" x2="16" y2="6" />
				<line x1="8" y1="2" x2="8" y2="6" />
				<line x1="3" y1="10" x2="21" y2="10" />
			</svg>
			<p class="empty-title">Nothing on the horizon</p>
			<p class="empty-sub">No upcoming releases found in the next {activeDays} days. Connect Sonarr or Radarr to track releases.</p>
		</div>
	{:else}
		<div class="date-groups">
			{#each sortedDates as date (date)}
				{@const items = data.byDate[date]}
				<div class="date-group" class:is-today={isToday(date)} class:is-past={isPast(date)}>
					<div class="date-label">
						<span class="date-text">{formatDate(date)}</span>
						{#if isToday(date)}
							<span class="today-dot"></span>
						{/if}
						<span class="date-count">{items.length}</span>
					</div>
					<div class="poster-grid">
						{#each items as item (item.id)}
							<a
								href="/media/{item.mediaType}/{item.sourceId}?service={item.serviceId}"
								class="calendar-card group"
							>
								<div class="card-poster">
									<!-- Media type dot -->
									<span
										class="type-dot"
										style="background: {mediaTypeColors[item.mediaType] ?? '#888'}"
										title={item.mediaType}
									></span>

									{#if item.poster}
										<img
											src={item.poster}
											alt={item.title}
											class="poster-img"
											loading="lazy"
											decoding="async"
										/>
									{:else}
										<div class="poster-placeholder">
											<span class="placeholder-text">{item.title}</span>
										</div>
									{/if}

									<!-- Date chip -->
									<span class="date-chip">{formatChipDate(date)}</span>

									<!-- Status badge -->
									{#if item.status === 'downloading'}
										<span class="status-badge downloading">Downloading</span>
									{:else if item.status === 'released'}
										<span class="status-badge released">Released</span>
									{/if}
								</div>
								<div class="card-info">
									<p class="card-title">{item.title}</p>
									{#if item.overview}
										<p class="card-overview">{item.overview}</p>
									{/if}
								</div>
							</a>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.calendar-page {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.calendar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 2rem;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--color-cream);
	}

	.header-left h1 {
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.days-selector {
		display: flex;
		gap: 0.25rem;
		background: var(--color-surface);
		border-radius: 8px;
		padding: 0.2rem;
		border: 1px solid rgba(240, 235, 227, 0.06);
	}

	.days-btn {
		padding: 0.35rem 0.75rem;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--color-muted);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.days-btn:hover {
		color: var(--color-cream);
		background: rgba(240, 235, 227, 0.04);
	}

	.days-btn.active {
		background: var(--color-accent);
		color: #0a0a0f;
		font-weight: 600;
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 6rem 1rem;
		text-align: center;
	}

	.empty-icon {
		color: var(--color-muted);
		opacity: 0.3;
		margin-bottom: 1.25rem;
	}

	.empty-title {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-cream);
		margin-bottom: 0.5rem;
	}

	.empty-sub {
		font-size: 0.85rem;
		color: var(--color-muted);
		max-width: 28rem;
	}

	/* Date groups */
	.date-groups {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.date-group.is-past {
		opacity: 0.5;
	}

	.date-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid rgba(240, 235, 227, 0.06);
	}

	.date-text {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-cream);
		letter-spacing: -0.01em;
	}

	.is-today .date-text {
		color: var(--color-accent);
	}

	.today-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-accent);
		box-shadow: 0 0 8px rgba(212, 162, 83, 0.4);
	}

	.date-count {
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--color-muted);
		background: var(--color-surface);
		padding: 0.1rem 0.45rem;
		border-radius: 4px;
	}

	/* Poster grid */
	.poster-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
		gap: 1.25rem;
	}

	@media (min-width: 640px) {
		.poster-grid {
			grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		}
	}

	@media (min-width: 1024px) {
		.poster-grid {
			grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		}
	}

	/* Calendar card */
	.calendar-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		text-decoration: none;
	}

	.card-poster {
		position: relative;
		aspect-ratio: 2/3;
		border-radius: 10px;
		overflow: hidden;
		background: var(--color-raised);
		transition: all 0.25s ease;
	}

	.calendar-card:hover .card-poster {
		transform: scale(1.03);
		box-shadow: 0 8px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(124, 108, 248, 0.25);
	}

	.poster-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.poster-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 1rem;
	}

	.placeholder-text {
		text-align: center;
		font-size: 0.75rem;
		color: var(--color-muted);
		line-clamp: 3;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* Type dot */
	.type-dot {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		z-index: 5;
		box-shadow: 0 0 6px rgba(0, 0, 0, 0.5);
		border: 1.5px solid rgba(0, 0, 0, 0.3);
	}

	/* Date chip */
	.date-chip {
		position: absolute;
		bottom: 0.4rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.75);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--color-cream);
		white-space: nowrap;
		z-index: 5;
	}

	/* Status badge */
	.status-badge {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		z-index: 5;
	}

	.status-badge.downloading {
		background: rgba(74, 158, 255, 0.2);
		color: #4a9eff;
		border: 1px solid rgba(74, 158, 255, 0.3);
	}

	.status-badge.released {
		background: rgba(52, 211, 153, 0.2);
		color: #34d399;
		border: 1px solid rgba(52, 211, 153, 0.3);
	}

	/* Card info */
	.card-info {
		padding: 0 0.25rem;
	}

	.card-title {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-cream);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-overview {
		font-size: 0.72rem;
		color: var(--color-muted);
		margin-top: 0.15rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.4;
	}
</style>
