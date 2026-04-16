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
			<span>{t.name}{t.lang ? ` (${t.lang})` : ''}</span>
			{#if currentTrack === t.id}<span class="panel__ck">&#10003;</span>{/if}
		</button>
	{/each}
</div>

<style>
	.panel {
		position: absolute;
		bottom: 100%;
		right: 0;
		margin-bottom: 0.5rem;
		min-width: 12rem;
		max-height: calc(100vh - 8rem);
		overflow-y: auto;
		background: rgba(15, 15, 20, 0.95);
		backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 0.5rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		padding: 0.25rem;
		z-index: 20;
	}
	.panel__head {
		padding: 0.5rem 0.75rem 0.25rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(255, 255, 255, 0.5);
	}
	.panel__item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: none;
		border-radius: 0.375rem;
		color: rgba(255, 255, 255, 0.9);
		font-size: 0.85rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s;
	}
	.panel__item:hover { background: rgba(255, 255, 255, 0.06); }
	.panel__item--on { background: rgba(255, 255, 255, 0.04); font-weight: 500; }
	.panel__ck {
		color: var(--color-accent, #fbbf24);
		font-size: 0.85rem;
	}
</style>
