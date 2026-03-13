<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props { stats: ComputedStats }
	let { stats }: Props = $props();

	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	const grid = $derived.by(() => {
		const hourly = stats.hourlyDistribution;
		const weekday = stats.weekdayDistribution;
		const maxHour = Math.max(...hourly, 1);
		const maxDay = Math.max(...weekday, 1);

		// Reorder weekday: Mon(1)..Sun(0)
		const reordered = [1, 2, 3, 4, 5, 6, 0];

		const cells: { day: number; hour: number; intensity: number }[] = [];
		let maxVal = 0;
		for (let d = 0; d < 7; d++) {
			for (let h = 0; h < 24; h++) {
				const val = (hourly[h] / maxHour) * (weekday[reordered[d]] / maxDay);
				if (val > maxVal) maxVal = val;
				cells.push({ day: d, hour: h, intensity: val });
			}
		}
		if (maxVal > 0) {
			for (const cell of cells) cell.intensity /= maxVal;
		}
		return cells;
	});
</script>

<div class="overflow-x-auto">
	<div class="inline-grid gap-[2px]" style="grid-template-columns: 28px repeat(24, 1fr); min-width: 320px;">
		<!-- Header row -->
		<div></div>
		{#each Array(24) as _, h}
			{#if h % 6 === 0}
				<div class="text-center text-[8px] text-faint">
					{h === 0 ? '12a' : h === 6 ? '6a' : h === 12 ? '12p' : '6p'}
				</div>
			{:else}
				<div></div>
			{/if}
		{/each}

		<!-- Grid rows -->
		{#each DAYS as day, d}
			<div class="flex items-center text-[9px] text-faint">{day}</div>
			{#each Array(24) as _, h}
				{@const cell = grid[d * 24 + h]}
				<div
					class="aspect-square rounded-[2px]"
					style="background: rgba(212, 162, 83, {Math.max(0.04, cell.intensity * 0.9)});"
					title="{day} {h}:00 — {Math.round(cell.intensity * 100)}%"
				></div>
			{/each}
		{/each}
	</div>
</div>
