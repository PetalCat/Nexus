<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props { stats: ComputedStats }
	let { stats }: Props = $props();

	const streakStats = [
		{ label: 'Current', value: stats.streaks.current },
		{ label: 'Longest', value: stats.streaks.longest },
		{ label: 'Sessions', value: stats.totalSessions }
	];

	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const weekdayReordered = $derived([1, 2, 3, 4, 5, 6, 0].map(i => stats.weekdayDistribution[i]));
	const maxDay = $derived(Math.max(...weekdayReordered, 1));
</script>

<div>
	<!-- Streak stats -->
	<div class="mb-4 flex gap-4">
		{#each streakStats as stat (stat.label)}
			<div class="text-center">
				<p class="font-display text-xl font-bold text-accent">{stat.value}</p>
				<p class="text-[10px] text-faint">{stat.label}</p>
			</div>
		{/each}
	</div>

	<!-- Weekday activity bars -->
	<div class="flex flex-col gap-1.5">
		{#each DAYS as day, i}
			<div class="flex items-center gap-2">
				<span class="w-8 text-[9px] text-faint">{day}</span>
				<div class="h-3 flex-1 rounded-sm" style="background: rgba(212, 162, 83, {Math.max(0.06, (weekdayReordered[i] / maxDay) * 0.8)});"></div>
			</div>
		{/each}
	</div>
</div>
