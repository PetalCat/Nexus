<script lang="ts">
	import {
		Chart as ChartJS,
		DoughnutController,
		ArcElement,
		Tooltip,
		Legend
	} from 'chart.js';
	import type { ComputedStats } from '$lib/server/stats-engine';

	ChartJS.register(DoughnutController, ArcElement, Tooltip, Legend);

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

	const chartInfo = $derived.by(() => {
		const typeMap = new Map<string, number>();
		for (const item of stats.topItems) {
			typeMap.set(item.mediaType, (typeMap.get(item.mediaType) ?? 0) + item.playTimeMs);
		}
		const entries = [...typeMap.entries()].sort((a, b) => b[1] - a[1]);
		if (entries.length === 0) {
			return {
				labels: ['No data'],
				data: [1],
				colors: ['rgba(240,235,227,0.05)']
			};
		}
		return {
			labels: entries.map(([t]) => t.charAt(0).toUpperCase() + t.slice(1)),
			data: entries.map(([, ms]) => Math.round(ms / 60_000)),
			colors: entries.map(([t]) => TYPE_COLORS[t] ?? '#605850')
		};
	});

	const totalHours = $derived(Math.round(stats.totalPlayTimeMs / 3_600_000));

	let canvas: HTMLCanvasElement;
	let chart: ChartJS | undefined;

	function buildChart() {
		if (!canvas) return;
		chart?.destroy();

		chart = new ChartJS(canvas, {
			type: 'doughnut',
			data: {
				labels: chartInfo.labels,
				datasets: [{
					data: chartInfo.data,
					backgroundColor: chartInfo.colors,
					borderWidth: 0
				}]
			},
			options: {
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
			}
		});
	}

	$effect(() => {
		stats; // track reactivity
		buildChart();
		return () => chart?.destroy();
	});
</script>

<div class="flex items-center gap-4">
	<div class="relative h-32 w-32 flex-shrink-0">
		<canvas bind:this={canvas}></canvas>
		<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
			<div class="text-center">
				<p class="font-display text-lg font-bold text-cream">{totalHours}h</p>
				<p class="text-[9px] text-faint">total</p>
			</div>
		</div>
	</div>
	<div class="flex flex-col gap-1.5 text-xs">
		{#each chartInfo.labels as label, i (label)}
			<div class="flex items-center gap-2">
				<span class="h-2.5 w-2.5 rounded-full" style="background: {chartInfo.colors[i]}"></span>
				<span class="text-muted">{label}</span>
			</div>
		{/each}
	</div>
</div>
