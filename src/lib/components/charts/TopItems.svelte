<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props {
		stats: ComputedStats;
		from: number;
	}

	let { stats, from }: Props = $props();

	const TYPE_COLORS: Record<string, string> = {
		movie: '#d4a253',
		show: '#3d8f84',
		episode: '#3d8f84',
		book: '#c45c5c',
		game: '#56a99d',
		music: '#e8bc6a'
	};

	const items = $derived(stats.topItems.slice(0, 5));

	function formatTime(ms: number): string {
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${mins}m`;
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}
</script>

<div class="flex flex-col gap-2">
	{#if items.length === 0}
		<p class="py-8 text-center text-xs text-faint">No activity in this period.</p>
	{:else}
		{#each items as item, i (item.mediaId)}
			<div class="flex items-center gap-3">
				<span
					class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-xs font-bold"
					style="color: {i === 0 ? '#d4a253' : 'rgba(240,235,227,0.4)'};"
				>
					{i + 1}
				</span>
				<div class="min-w-0 flex-1">
					<p class="truncate text-xs font-medium text-cream">{item.title}</p>
					<p class="text-[10px] text-faint">
						<span style="color: {TYPE_COLORS[item.mediaType] ?? '#605850'}">{item.mediaType}</span>
						· {item.sessions} session{item.sessions !== 1 ? 's' : ''}
					</p>
				</div>
				<span class="flex-shrink-0 text-[11px] text-muted">{formatTime(item.playTimeMs)}</span>
			</div>
		{/each}
	{/if}
</div>
