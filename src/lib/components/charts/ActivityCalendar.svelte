<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props {
		stats: ComputedStats;
		calendarData: Record<string, number>;
	}
	let { stats, calendarData }: Props = $props();

	const streakStats = $derived([
		{ label: 'Current', value: stats.streaks.current },
		{ label: 'Longest', value: stats.streaks.longest },
		{ label: 'Sessions', value: stats.totalSessions }
	]);

	const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

	// Build 52-week × 7-day grid (GitHub-style contribution calendar)
	const weeks = $derived.by(() => {
		const today = new Date();
		const result: { date: string; ms: number }[][] = [];

		// Find the start: go back ~52 weeks to the nearest Sunday
		const startDate = new Date(today);
		startDate.setDate(startDate.getDate() - 364 - startDate.getDay());

		let currentWeek: { date: string; ms: number }[] = [];
		const d = new Date(startDate);

		while (d <= today) {
			const dateStr = d.toISOString().slice(0, 10);
			currentWeek.push({ date: dateStr, ms: calendarData[dateStr] ?? 0 });

			if (currentWeek.length === 7) {
				result.push(currentWeek);
				currentWeek = [];
			}
			d.setDate(d.getDate() + 1);
		}
		if (currentWeek.length > 0) {
			result.push(currentWeek);
		}
		return result;
	});

	const maxMs = $derived(Math.max(...Object.values(calendarData), 1));

	function cellOpacity(ms: number): number {
		if (ms === 0) return 0;
		return Math.max(0.15, Math.min((ms / maxMs) * 0.9, 0.9));
	}

	function formatTooltip(date: string, ms: number): string {
		const d = new Date(date + 'T12:00:00');
		const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		if (ms === 0) return `${label}: No activity`;
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${label}: ${mins}m`;
		return `${label}: ${Math.floor(mins / 60)}h ${mins % 60}m`;
	}
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

	<!-- GitHub-style contribution grid -->
	<div class="overflow-x-auto">
		<div class="flex gap-[2px]">
			<!-- Day labels column -->
			<div class="flex flex-col gap-[2px] pr-1">
				{#each DAY_LABELS as label}
					<div class="flex h-[11px] w-5 items-center">
						<span class="text-[8px] text-faint">{label}</span>
					</div>
				{/each}
			</div>

			<!-- Week columns -->
			{#each weeks as week, wi (wi)}
				<div class="flex flex-col gap-[2px]">
					{#each week as cell (cell.date)}
						<div
							class="h-[11px] w-[11px] rounded-[2px]"
							style="background: {cell.ms > 0 ? `rgba(212, 162, 83, ${cellOpacity(cell.ms)})` : 'rgba(255,255,255,0.03)'};"
							title={formatTooltip(cell.date, cell.ms)}
						></div>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</div>
