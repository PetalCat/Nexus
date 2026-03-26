<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props { stats: ComputedStats }
	let { stats }: Props = $props();

	const COLORS = ['#d4a253', '#3d8f84', '#c45c5c', '#56a99d', '#e8bc6a', '#8a7565'];

	function makeSegments(items: { name: string; playTimeMs: number }[]) {
		const total = items.reduce((sum, d) => sum + d.playTimeMs, 0);
		if (total === 0) return [];
		return items.map((item, i) => ({
			name: item.name,
			pct: Math.round((item.playTimeMs / total) * 100),
			color: COLORS[i % COLORS.length]
		}));
	}

	const devices = $derived(makeSegments(stats.topDevices));
	const clients = $derived(makeSegments(stats.topClients));
</script>

{#snippet segmentBar(segments: { name: string; pct: number; color: string }[], label: string)}
	<div class="mb-3">
		<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</p>
		{#if segments.length === 0}
			<p class="text-[10px] text-faint">No data</p>
		{:else}
			<div class="flex h-6 overflow-hidden rounded-md">
				{#each segments as seg (seg.name)}
					<div
						style="width: {Math.max(seg.pct, 3)}%; background: {seg.color};"
						class="flex items-center justify-center text-[9px] font-medium text-cream/80"
						title="{seg.name}: {seg.pct}%"
					>
						{#if seg.pct >= 15}{seg.name}{/if}
					</div>
				{/each}
			</div>
			<div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
				{#each segments as seg (seg.name)}
					<div class="flex items-center gap-1 text-[10px] text-muted">
						<span class="h-2 w-2 rounded-full" style="background: {seg.color}"></span>
						{seg.name} · {seg.pct}%
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{@render segmentBar(devices, 'Devices')}
{@render segmentBar(clients, 'Clients')}
