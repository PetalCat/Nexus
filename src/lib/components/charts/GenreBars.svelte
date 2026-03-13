<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props { stats: ComputedStats }
	let { stats }: Props = $props();

	const COLORS = ['#d4a253', '#3d8f84', '#c45c5c', '#e8bc6a', '#56a99d', '#8a7565'];

	const genres = $derived(stats.topGenres.slice(0, 6));
	const maxMs = $derived(genres.length > 0 ? genres[0].playTimeMs : 1);

	function formatTime(ms: number): string {
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${mins}m`;
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}
</script>

<div class="flex flex-col gap-2.5">
	{#if genres.length === 0}
		<p class="py-8 text-center text-xs text-faint">No genre data in this period.</p>
	{:else}
		{#each genres as genre, i (genre.genre)}
			<div class="flex items-center gap-2">
				<span class="w-16 flex-shrink-0 truncate text-[11px] text-muted">{genre.genre}</span>
				<div class="relative h-5 flex-1 overflow-hidden rounded">
					<div
						class="h-full rounded"
						style="width: {Math.max(4, (genre.playTimeMs / maxMs) * 100)}%;
							background: linear-gradient(90deg, {COLORS[i % COLORS.length]}99, {COLORS[i % COLORS.length]}33);"
					></div>
					<span class="absolute inset-y-0 left-2 flex items-center text-[10px] font-medium text-cream/80">
						{formatTime(genre.playTimeMs)}
					</span>
				</div>
			</div>
		{/each}
	{/if}
</div>
