<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import WatchTimeChart from '$lib/components/charts/WatchTimeChart.svelte';
	import MediaDonut from '$lib/components/charts/MediaDonut.svelte';
	import GenreBars from '$lib/components/charts/GenreBars.svelte';
	import ViewingHeatmap from '$lib/components/charts/ViewingHeatmap.svelte';
	import TopItems from '$lib/components/charts/TopItems.svelte';
	import ActivityCalendar from '$lib/components/charts/ActivityCalendar.svelte';
	import DeviceBreakdown from '$lib/components/charts/DeviceBreakdown.svelte';
	import QualityStats from '$lib/components/charts/QualityStats.svelte';

	let { data }: { data: PageData } = $props();

	// Period presets
	const presets = [
		{ label: 'Today', days: 1 },
		{ label: '7 Days', days: 7 },
		{ label: '30 Days', days: 30 },
		{ label: 'Year', days: 365 },
		{ label: 'All Time', days: 0 }
	];

	function applyPreset(days: number) {
		const now = Date.now();
		const to = now;
		const from = days === 0 ? 0 : now - days * 24 * 60 * 60 * 1000;
		goto(`/activity/insights?from=${from}&to=${to}`, { replaceState: true });
	}

	function applyDateRange(fromDate: string, toDate: string) {
		const from = new Date(fromDate).getTime();
		const to = new Date(toDate).getTime() + 86400000;
		if (!isNaN(from) && !isNaN(to) && to > from) {
			goto(`/activity/insights?from=${from}&to=${to}`, { replaceState: true });
		}
	}

	const fromDate = $derived(new Date(data.from).toISOString().slice(0, 10));
	const toDate = $derived(new Date(data.to).toISOString().slice(0, 10));

	const activePreset = $derived.by(() => {
		const now = Date.now();
		const duration = data.to - data.from;
		if (data.from === 0) return 'All Time';
		const days = Math.round(duration / (24 * 60 * 60 * 1000));
		if (Math.abs(data.to - now) > 3600000) return null;
		if (days === 1) return 'Today';
		if (days === 7) return '7 Days';
		if (days === 30) return '30 Days';
		if (days >= 364 && days <= 366) return 'Year';
		return null;
	});

	function formatDuration(ms: number) {
		if (ms <= 0) return '0m';
		const totalMin = Math.round(ms / 60_000);
		if (totalMin < 60) return `${totalMin}m`;
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	function pctChange(current: number, previous: number): string | null {
		if (previous === 0 && current === 0) return null;
		if (previous === 0) return '+100%';
		const pct = Math.round(((current - previous) / previous) * 100);
		return pct >= 0 ? `+${pct}%` : `${pct}%`;
	}

	function pctColor(s: string | null): string {
		if (!s) return 'text-faint';
		return s.startsWith('+') ? 'text-emerald-400' : 'text-red-400';
	}

	const statCards = $derived([
		{
			label: 'Watch Time',
			value: formatDuration(data.stats.totalPlayTimeMs),
			sub: `across ${data.stats.totalSessions} sessions`,
			change: pctChange(data.stats.totalPlayTimeMs, data.prevStats.totalPlayTimeMs)
		},
		{
			label: 'Items Consumed',
			value: String(data.stats.totalItems),
			sub: (() => {
				const types = new Map<string, number>();
				for (const item of data.stats.topItems) {
					types.set(item.mediaType, (types.get(item.mediaType) ?? 0) + 1);
				}
				return [...types.entries()].map(([t, c]) => `${c} ${t}${c > 1 ? 's' : ''}`).join(', ') || 'no items';
			})(),
			change: pctChange(data.stats.totalItems, data.prevStats.totalItems)
		},
		{
			label: 'Current Streak',
			value: `${data.stats.streaks.current}d`,
			sub: `longest: ${data.stats.streaks.longest}d`,
			change: null
		},
		{
			label: 'Completion Rate',
			value: `${Math.round(data.stats.avgCompletionRate * 100)}%`,
			sub: `${data.stats.completions} of ${data.stats.totalItems} finished`,
			change: pctChange(data.stats.avgCompletionRate, data.prevStats.avgCompletionRate)
		}
	]);

	let customFrom = $state('');
	let customTo = $state('');

	$effect(() => {
		customFrom = fromDate;
		customTo = toDate;
	});
</script>

<div class="px-3 sm:px-4 lg:px-6">
	<!-- Period Controls -->
	<div class="mb-6 flex flex-wrap items-center gap-3">
		<div class="flex gap-1.5">
			{#each presets as preset (preset.label)}
				<button
					onclick={() => applyPreset(preset.days)}
					class="rounded-lg px-3 py-1.5 text-xs font-medium transition-all
						{activePreset === preset.label
						? 'bg-accent/15 text-accent'
						: 'bg-cream/[0.04] text-muted hover:text-cream hover:bg-cream/[0.08]'}"
				>
					{preset.label}
				</button>
			{/each}
		</div>

		<div class="flex items-center gap-2">
			<input
				type="date"
				bind:value={customFrom}
				onchange={() => applyDateRange(customFrom, customTo)}
				class="rounded-lg border border-cream/[0.06] bg-raised px-2.5 py-1.5 text-xs text-cream"
			/>
			<span class="text-xs text-faint">to</span>
			<input
				type="date"
				bind:value={customTo}
				onchange={() => applyDateRange(customFrom, customTo)}
				class="rounded-lg border border-cream/[0.06] bg-raised px-2.5 py-1.5 text-xs text-cream"
			/>
		</div>
	</div>

	<!-- Stat Cards -->
	<div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
		{#each statCards as card (card.label)}
			<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
				<p class="text-[11px] uppercase tracking-wide text-muted">{card.label}</p>
				<p class="mt-1 font-display text-2xl font-bold text-cream">{card.value}</p>
				<p class="mt-0.5 text-[11px] text-faint">{card.sub}</p>
				{#if card.change}
					<p class="mt-1 text-[11px] font-medium {pctColor(card.change)}">{card.change} vs prev period</p>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Chart Row 1: Watch Time (2/3) + Media Donut (1/3) -->
	<div class="mb-4 grid gap-4 lg:grid-cols-3">
		<div class="lg:col-span-2">
			<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
				<h3 class="mb-3 text-sm font-semibold text-cream">Watch Time</h3>
				<WatchTimeChart dailyTimeline={data.dailyTimeline} />
			</div>
		</div>
		<div>
			<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
				<h3 class="mb-3 text-sm font-semibold text-cream">Media Types</h3>
				<MediaDonut stats={data.stats} />
			</div>
		</div>
	</div>

	<!-- Chart Row 2: Genre Bars + Viewing Heatmap + Top Items -->
	<div class="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
			<h3 class="mb-3 text-sm font-semibold text-cream">Top Genres</h3>
			<GenreBars stats={data.stats} />
		</div>
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
			<h3 class="mb-3 text-sm font-semibold text-cream">Viewing Heatmap</h3>
			<ViewingHeatmap stats={data.stats} />
		</div>
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4 sm:col-span-2 lg:col-span-1">
			<h3 class="mb-3 text-sm font-semibold text-cream">Top Items</h3>
			<TopItems stats={data.stats} from={data.from} />
		</div>
	</div>

	<!-- Chart Row 3: Activity Calendar + Playback Details -->
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
			<h3 class="mb-3 text-sm font-semibold text-cream">Activity & Streaks</h3>
			<ActivityCalendar stats={data.stats} calendarData={data.calendarData} />
		</div>
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
			<h3 class="mb-3 text-sm font-semibold text-cream">Playback Details</h3>
			<DeviceBreakdown stats={data.stats} />
			<div class="mt-4 border-t border-cream/[0.06] pt-4">
				<QualityStats stats={data.stats} />
			</div>
		</div>
	</div>
</div>
