<script lang="ts">
	import type { PlaybackMode } from '$lib/adapters/playback';

	let { mode, isBurnIn = false }: { mode: PlaybackMode; isBurnIn?: boolean } = $props();

	const colors: Record<PlaybackMode, string> = {
		'direct-play': '#34d399',
		'remux': '#60a5fa',
		'direct-stream': '#2dd4bf',
		'transcode': '#fb923c',
	};

	const labels: Record<PlaybackMode, string> = {
		'direct-play': 'DIRECT',
		'remux': 'REMUX',
		'direct-stream': 'AUDIO-TX',
		'transcode': 'TRANSCODE',
	};

	const label = $derived(isBurnIn ? `${labels[mode]} · burn-in` : labels[mode]);
	const color = $derived(colors[mode]);
</script>

<span
	class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
	style="background: {color}20; color: {color}"
>
	{label}
</span>
