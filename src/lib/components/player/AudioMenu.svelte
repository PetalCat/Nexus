<script lang="ts">
	import type { TrackInfo } from '$lib/adapters/playback';

	interface Props {
		tracks: TrackInfo[];
		currentTrack: number;
		onselect: (id: number) => void;
	}

	let { tracks, currentTrack, onselect }: Props = $props();
</script>

<div class="panel">
	<div class="panel__head">Audio</div>

	{#each tracks as t (t.id)}
		<button
			class="panel__item"
			class:panel__item--on={currentTrack === t.id}
			onclick={() => onselect(t.id)}
		>
			{t.name}{t.lang ? ` (${t.lang})` : ''}
			{#if currentTrack === t.id}<span class="panel__ck">&#10003;</span>{/if}
		</button>
	{/each}
</div>
