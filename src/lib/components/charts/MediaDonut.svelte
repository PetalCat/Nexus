<script lang="ts">
	import { Doughnut } from 'svelte-chartjs';
	import {
		Chart as ChartJS,
		ArcElement,
		Tooltip,
		Legend
	} from 'chart.js';
	import type { ComputedStats } from '$lib/server/stats-engine';

	ChartJS.register(ArcElement, Tooltip, Legend);

	interface Props {
		stats: ComputedStats;
	}

	let { stats }: Props = $props();

	const TYPE_COLORS: Record<string, string> = {
		movie: '#d4a253',
		show: '#3d8f84',
		episode: '#3d8f84',
		book: '#c45c5c',
		game: '#56a99d',
		music: '#e8bc6a',
		video: '#8a7565',
		live: '#605850'
	};

	const chartData = $derived.by(() => {
		const typeMap = new Map<string, number>();
		for (const item of stats.topItems) {
			typeMap.set(item.mediaType, (typeMap.get(item.mediaType) ?? 0) + item.playTimeMs);
		}
		const entries = [...typeMap.entries()].sort((a, b) => b[1] - a[1]);
		if (entries.length === 0) {
			return { labels: ['No data'], datasets: [{ data: [1], backgroundColor: ['rgba(240,235,227,0.05)'], borderWidth: 0 }] };
		}

		return {
			labels: entries.map(([t]) => t.charAt(0).toUpperCase() + t.slice(1)),
			datasets: [{
				data: entries.map(([, ms]) => Math.round(ms / 60_000)),
				backgroundColor: entries.map(([t]) => TYPE_COLORS[t] ?? '#605850'),
				borderWidth: 0
			}]
		};
	});

	const totalHours = $derived(Math.round(stats.totalPlayTimeMs / 3_600_000));

	const chartOptions = {
		responsive: true,
		maintainAspectRatio: false,
		cutout: '65%',
		plugins: {
			legend: { display: false },
			tooltip: {
				callbacks: {
					label: (ctx: any) => {
						const mins = ctx.raw;
						if (mins < 60) return ` ${mins}m`;
						return ` ${Math.floor(mins / 60)}h ${mins % 60}m`;
					}
				}
			}
		}
	};
</script>

<div class="flex items-center gap-4">
	<div class="relative h-32 w-32 flex-shrink-0">
		<Doughnut data={chartData} options={chartOptions} />
		<div class="absolute inset-0 flex items-center justify-center">
			<div class="text-center">
				<p class="font-display text-lg font-bold text-cream">{totalHours}h</p>
				<p class="text-[9px] text-faint">total</p>
			</div>
		</div>
	</div>
	<div class="flex flex-col gap-1.5 text-xs">
		{#each chartData.labels as label, i (label)}
			<div class="flex items-center gap-2">
				<span class="h-2.5 w-2.5 rounded-full" style="background: {chartData.datasets[0].backgroundColor[i]}"></span>
				<span class="text-muted">{label}</span>
			</div>
		{/each}
	</div>
</div>
