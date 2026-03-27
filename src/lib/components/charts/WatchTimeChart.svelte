<script lang="ts">
	import { browser } from '$app/environment';
	import type { Chart as ChartJS } from 'chart.js';

	interface Props {
		dailyTimeline: { day: string; totalMs: number; sessions: number }[];
	}

	let { dailyTimeline }: Props = $props();

	let canvas = $state<HTMLCanvasElement>();
	let chart: ChartJS | undefined;
	let chartReady = $state(false);

	async function ensureChartJs() {
		if (chartReady || !browser) return;

		const {
			Chart,
			CategoryScale,
			LinearScale,
			BarController,
			BarElement,
			Tooltip
		} = await import('chart.js');

		Chart.register(CategoryScale, LinearScale, BarController, BarElement, Tooltip);
		chartReady = true;
		return Chart;
	}

	async function buildChart() {
		if (!canvas) return;
		const Chart = await ensureChartJs();
		if (!Chart || !canvas) return;
		chart?.destroy();

		const labels = dailyTimeline.map((d) => {
			const date = new Date(d.day + 'T12:00:00');
			return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		});

		chart = new Chart(canvas, {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: 'Minutes',
						data: dailyTimeline.map((d) => Math.round(d.totalMs / 60_000)),
						backgroundColor: 'rgba(212, 162, 83, 0.6)',
						borderRadius: 4,
						borderSkipped: false
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					tooltip: {
						callbacks: {
							label: (ctx: any) => {
								const mins = ctx.raw;
								if (mins < 60) return `${mins}m`;
								return `${Math.floor(mins / 60)}h ${mins % 60}m`;
							}
						}
					}
				},
				scales: {
					x: {
						grid: { display: false },
						ticks: {
							color: 'rgba(240, 235, 227, 0.3)',
							font: { size: 10 },
							maxRotation: 45,
							autoSkip: true,
							maxTicksLimit: 14
						}
					},
					y: {
						grid: { color: 'rgba(240, 235, 227, 0.04)' },
						ticks: {
							color: 'rgba(240, 235, 227, 0.3)',
							font: { size: 10 },
							callback: (v: any) => v < 60 ? `${v}m` : `${Math.floor(v / 60)}h`
						}
					}
				}
			}
		});
	}

	$effect(() => {
		if (!browser) return;
		dailyTimeline; // track reactivity
		void buildChart();
		return () => chart?.destroy();
	});
</script>

<div class="h-48">
	{#if dailyTimeline.length === 0}
		<div class="flex h-full items-center justify-center text-xs text-faint">No activity in this period</div>
	{:else}
		<canvas bind:this={canvas}></canvas>
	{/if}
</div>
