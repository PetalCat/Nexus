<script lang="ts">
	import type { Level } from '$lib/components/player/PlayerEngine';

	interface Props {
		levels: Level[];
		activeLevelIndex: number;
		autoQuality: boolean;
		qualityLabel: string;
		onselect: (index: number) => void;
	}

	let { levels, activeLevelIndex, autoQuality, qualityLabel, onselect }: Props = $props();

	function fmtBitrate(bps: number): string {
		if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
		if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbps`;
		return `${bps} bps`;
	}
</script>

<div class="panel">
	<div class="panel__head">Quality</div>

	<button
		class="panel__item"
		class:panel__item--on={autoQuality}
		onclick={() => onselect(-1)}
	>
		Auto
		{#if autoQuality && activeLevelIndex !== -1}
			<span class="panel__meta">({levels[activeLevelIndex]?.height ?? '?'}p)</span>
		{/if}
		{#if autoQuality}<span class="panel__ck">&#10003;</span>{/if}
	</button>

	{#each levels as level (level.index)}
		<button
			class="panel__item"
			class:panel__item--on={!autoQuality && activeLevelIndex === level.index}
			onclick={() => onselect(level.index)}
		>
			{level.height}p
			<span class="panel__meta">{fmtBitrate(level.bitrate)}</span>
			{#if !autoQuality && activeLevelIndex === level.index}
				<span class="panel__ck">&#10003;</span>
			{/if}
		</button>
	{/each}
</div>
