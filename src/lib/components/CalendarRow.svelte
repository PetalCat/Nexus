<script lang="ts">
	import type { CalendarItem } from '$lib/adapters/types';

	interface Props {
		items: CalendarItem[];
		title?: string;
		subtitle?: string;
	}

	let { items, title = 'Up Next on Your Calendar', subtitle = 'This week' }: Props = $props();

	function dayName(dateStr: string): string {
		const d = new Date(dateStr.split('T')[0] + 'T00:00:00');
		return d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
	}

	function dayNumber(dateStr: string): string {
		const d = new Date(dateStr.split('T')[0] + 'T00:00:00');
		return String(d.getDate());
	}

	function itemSubtitle(item: CalendarItem): string {
		const mt = item.mediaType;
		const pretty =
			mt === 'show' ? 'TV'
			: mt === 'movie' ? 'Film'
			: mt === 'music' || mt === 'album' ? 'Album'
			: mt === 'book' ? 'Book'
			: mt === 'game' ? 'Game'
			: mt.toUpperCase();
		if (item.status === 'downloading') return `${pretty} · Downloading`;
		if (item.overview) return item.overview;
		return pretty;
	}
</script>

<section class="flex flex-col gap-3">
	<div class="flex items-baseline gap-3 px-4 sm:px-6">
		<h2 class="row-title">{title}</h2>
		{#if subtitle}
			<span class="row-sub">{subtitle}</span>
		{/if}
		<a href="/calendar" class="row-all">Full calendar →</a>
	</div>

	<div class="cal px-4 sm:px-6">
		{#each items as item (item.id)}
			<a
				href="/media/{item.mediaType}/{item.sourceId}?service={item.serviceId}"
				class="cal-item"
				aria-label="{item.title} — {dayName(item.releaseDate)} {dayNumber(item.releaseDate)}"
			>
				<div class="cal-date">
					<span class="dy">{dayName(item.releaseDate)}</span>
					<span class="num">{dayNumber(item.releaseDate)}</span>
				</div>
				<div class="cal-body">
					<div class="t">{item.title}</div>
					<div class="s">{itemSubtitle(item)}</div>
				</div>
			</a>
		{/each}
	</div>
</section>

<style>
	.row-title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: clamp(17px, 1.2vw, 22px);
		line-height: 1.1;
		letter-spacing: -0.015em;
		color: var(--color-cream);
	}
	.row-sub {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.18em;
		color: var(--color-faint);
		text-transform: uppercase;
	}
	.row-all {
		margin-left: auto;
		font-size: 12px;
		color: var(--color-muted);
		text-decoration: none;
		transition: color 0.15s ease;
	}
	.row-all:hover {
		color: var(--color-accent);
	}

	.cal {
		display: flex;
		gap: 10px;
		overflow-x: auto;
		scrollbar-width: none;
		padding: 6px 0;
	}
	.cal::-webkit-scrollbar {
		display: none;
	}

	.cal-item {
		flex: 0 0 auto;
		width: 230px;
		padding: 14px 16px;
		border-radius: 12px;
		background: color-mix(in oklch, var(--color-raised) 80%, transparent);
		border: 1px solid rgba(240, 235, 227, 0.06);
		display: flex;
		gap: 12px;
		align-items: center;
		transition: border-color 0.2s ease, transform 0.2s ease, background 0.2s ease;
		text-decoration: none;
		color: inherit;
	}
	.cal-item:hover {
		border-color: color-mix(in oklch, var(--color-accent) 30%, transparent);
		transform: translateY(-2px);
		background: color-mix(in oklch, var(--color-raised) 92%, transparent);
	}

	.cal-date {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 8px 12px 8px 0;
		min-width: 46px;
		border-right: 1px solid rgba(240, 235, 227, 0.08);
	}
	.cal-date .dy {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--color-faint);
		line-height: 1;
		margin-bottom: 4px;
	}
	.cal-date .num {
		font-family: var(--font-display);
		font-size: 26px;
		font-weight: 700;
		color: var(--color-accent);
		line-height: 1;
	}

	.cal-body {
		min-width: 0;
		flex: 1;
	}
	.cal-body .t {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-cream);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 2px;
	}
	.cal-body .s {
		font-family: var(--font-mono);
		font-size: 10.5px;
		letter-spacing: 0.04em;
		color: var(--color-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
