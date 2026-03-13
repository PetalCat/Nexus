<script lang="ts">
	import type { ComputedStats } from '$lib/server/stats-engine';

	interface Props { stats: ComputedStats }
	let { stats }: Props = $props();

	const resEntries = $derived(Object.entries(stats.resolutionBreakdown));
	const totalRes = $derived(resEntries.reduce((sum, [, v]) => sum + v, 0));

	const fourKPct = $derived.by(() => {
		const fourK = (stats.resolutionBreakdown['2160'] ?? 0) + (stats.resolutionBreakdown['4K'] ?? 0);
		return totalRes > 0 ? Math.round((fourK / totalRes) * 100) : 0;
	});

	const hdrEntries = $derived(Object.entries(stats.hdrBreakdown));
	const hdrTotal = $derived(hdrEntries.reduce((sum, [, v]) => sum + v, 0));
	const hdrPct = $derived.by(() => {
		const hdr = hdrEntries.filter(([k]) => k !== 'SDR' && k !== 'none').reduce((sum, [, v]) => sum + v, 0);
		return hdrTotal > 0 ? Math.round((hdr / hdrTotal) * 100) : 0;
	});

	const transcodePct = $derived(Math.round(stats.transcodeRate * 100));
	const subtitlePct = $derived(Math.round(stats.subtitleUsage * 100));

	const metrics = $derived([
		{ label: '4K', value: `${fourKPct}%`, color: '#d4a253' },
		{ label: 'HDR', value: `${hdrPct}%`, color: '#3d8f84' },
		{ label: 'Transcoded', value: `${transcodePct}%`, color: '#c45c5c' },
		{ label: 'Subtitles', value: `${subtitlePct}%`, color: 'rgba(240,235,227,0.5)' }
	]);
</script>

<div class="flex justify-between gap-3">
	{#each metrics as m (m.label)}
		<div class="text-center">
			<p class="font-display text-lg font-bold" style="color: {m.color}">{m.value}</p>
			<p class="text-[10px] text-faint">{m.label}</p>
		</div>
	{/each}
</div>
