<script lang="ts">
	import type { CalendarItem } from '$lib/adapters/types';

	interface Props {
		items: CalendarItem[];
		title?: string;
		subtitle?: string;
	}

	let { items, title = 'Coming This Week', subtitle = 'Upcoming releases from your libraries' }: Props = $props();

	let scrollEl: HTMLDivElement | undefined = $state();
	let canScrollLeft = $state(false);
	let canScrollRight = $state(true);

	const mediaTypeColors: Record<string, string> = {
		movie: '#4a9eff',
		show: '#34d399',
		music: '#a78bfa',
		album: '#a78bfa',
		book: '#f59e0b',
		game: '#f472b6'
	};

	function formatChipDate(dateStr: string): string {
		const date = new Date(dateStr.split('T')[0] + 'T00:00:00');
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const tomorrow = new Date(today.getTime() + 86_400_000);
		const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

		if (dateOnly.getTime() === today.getTime()) return 'Today';
		if (dateOnly.getTime() === tomorrow.getTime()) return 'Tomorrow';

		return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
	}

	function scroll(dir: -1 | 1) {
		if (!scrollEl) return;
		const scrollAmount = scrollEl.clientWidth * 0.75;
		scrollEl.scrollBy({ left: dir * scrollAmount, behavior: 'smooth' });
	}

	function updateScrollState() {
		if (!scrollEl) return;
		canScrollLeft = scrollEl.scrollLeft > 2;
		canScrollRight = scrollEl.scrollLeft < scrollEl.scrollWidth - scrollEl.clientWidth - 2;
	}
</script>

<section class="flex flex-col gap-3">
	<div class="flex items-start justify-between px-4 sm:px-6">
		<div class="flex flex-col gap-0.5">
			<div class="flex items-center gap-2">
				<h2 class="text-display text-base font-semibold tracking-tight">{title}</h2>
				<a href="/calendar" class="see-all-link">See All</a>
			</div>
			{#if subtitle}
				<p class="text-xs text-[var(--color-muted)]">{subtitle}</p>
			{/if}
		</div>
		<div class="flex gap-0.5">
			<button
				class="btn-icon rounded-md p-1.5 transition-opacity {canScrollLeft ? 'opacity-60 hover:opacity-100' : 'opacity-20 pointer-events-none'}"
				onclick={() => scroll(-1)}
				aria-label="Scroll left"
				disabled={!canScrollLeft}
			>
				<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M10 12L6 8l4-4" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
			<button
				class="btn-icon rounded-md p-1.5 transition-opacity {canScrollRight ? 'opacity-60 hover:opacity-100' : 'opacity-20 pointer-events-none'}"
				onclick={() => scroll(1)}
				aria-label="Scroll right"
				disabled={!canScrollRight}
			>
				<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
		</div>
	</div>

	<div
		class="media-row px-4 sm:px-6"
		bind:this={scrollEl}
		onscroll={updateScrollState}
	>
		{#each items as item (item.id)}
			<div class="w-[8.5rem] sm:w-[10rem] md:w-[11rem]">
				<a
					href="/media/{item.mediaType}/{item.sourceId}?service={item.serviceId}"
					class="group relative flex w-full flex-col gap-2"
				>
					<div
						class="relative overflow-hidden rounded-[10px] aspect-[2/3] w-full bg-[var(--color-raised)] transition-all duration-250 group-hover:scale-[1.03] group-hover:shadow-[0_8px_40px_rgba(0,0,0,0.7),0_0_0_1px_rgba(124,108,248,0.25)]"
					>
						<!-- Media type dot -->
						<span
							class="type-dot"
							style="background: {mediaTypeColors[item.mediaType] ?? '#888'}"
						></span>

						{#if item.poster}
							<img
								src={item.poster}
								alt={item.title}
								class="h-full w-full object-cover"
								loading="lazy"
								decoding="async"
								fetchpriority="low"
							/>
						{:else}
							<div class="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
								<span class="text-center text-xs text-[var(--color-muted)] leading-tight line-clamp-3">{item.title}</span>
							</div>
						{/if}

						<!-- Date chip -->
						<span class="date-chip">{formatChipDate(item.releaseDate)}</span>

						<!-- Status badge -->
						{#if item.status === 'downloading'}
							<span class="status-badge downloading">DL</span>
						{/if}
					</div>

					<!-- Info -->
					<div class="min-w-0 px-0.5">
						<p class="truncate text-sm font-medium text-[var(--color-cream)]">{item.title}</p>
						{#if item.overview}
							<p class="text-xs text-[var(--color-muted)] line-clamp-1">{item.overview}</p>
						{/if}
					</div>
				</a>
			</div>
		{/each}
	</div>
</section>

<style>
	.see-all-link {
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--color-accent);
		text-decoration: none;
		opacity: 0.7;
		transition: opacity 0.15s ease;
	}

	.see-all-link:hover {
		opacity: 1;
	}

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

	.status-badge {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		font-size: 0.55rem;
		font-weight: 600;
		text-transform: uppercase;
		z-index: 5;
	}

	.status-badge.downloading {
		background: rgba(74, 158, 255, 0.2);
		color: #4a9eff;
		border: 1px solid rgba(74, 158, 255, 0.3);
	}
</style>
