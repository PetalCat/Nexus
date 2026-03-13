<script lang="ts">
	import { Bar } from 'svelte-chartjs';
	import {
		Chart as ChartJS,
		CategoryScale,
		LinearScale,
		BarElement,
		Tooltip
	} from 'chart.js';
	import type { ComputedStats } from '$lib/server/stats-engine';

	ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

	interface Props {
		stats: ComputedStats;
		from: number;
		to: number;
	}

	let { stats, from, to }: Props = $props();

	const chartData = $derived.by(() => {
		const hours = stats.hourlyDistribution;
		const labels = hours.map((_, i) => {
			if (i === 0) return '12am';
			if (i === 12) return '12pm';
			if (i < 12) return `${i}am`;
			return `${i - 12}pm`;
		});

		return {
			labels,
			datasets: [
				{
					label: 'Minutes',
					data: hours.map((ms) => Math.round(ms / 60_000)),
					backgroundColor: 'rgba(212, 162, 83, 0.6)',
					borderRadius: 4,
					borderSkipped: false as const
				}
			]
		};
	});

	const chartOptions = {
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
				ticks: { color: 'rgba(240, 235, 227, 0.3)', font: { size: 10 } }
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
	};
</script>

<div class="h-48">
	<Bar data={chartData} options={chartOptions} />
</div>
