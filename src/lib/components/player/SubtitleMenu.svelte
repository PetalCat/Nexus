<script lang="ts">
	import type { TrackInfo } from '$lib/adapters/playback';

	interface Props {
		tracks: TrackInfo[];
		burnableTracks: TrackInfo[];
		currentTrack: number;
		isBurnIn: boolean;
		onselect: (id: number) => void;
		onburnin: (id: number) => void;
	}

	let { tracks, burnableTracks, currentTrack, isBurnIn, onselect, onburnin }: Props = $props();

	let burnInExpanded = $state(false);
</script>

<div class="panel">
	<div class="panel__head">Subtitles</div>

	<button
		class="panel__item"
		class:panel__item--on={currentTrack === -1 && !isBurnIn}
		onclick={() => onselect(-1)}
	>
		Off
		{#if currentTrack === -1 && !isBurnIn}<span class="panel__ck">&#10003;</span>{/if}
	</button>

	{#each tracks as t (t.id)}
		<button
			class="panel__item"
			class:panel__item--on={currentTrack === t.id && !isBurnIn}
			onclick={() => onselect(t.id)}
		>
			{t.name}{t.lang ? ` (${t.lang})` : ''}
			{#if currentTrack === t.id && !isBurnIn}<span class="panel__ck">&#10003;</span>{/if}
		</button>
	{/each}

	{#if burnableTracks.length > 0}
		<button class="panel__item panel__item--section" onclick={() => (burnInExpanded = !burnInExpanded)}>
			<span>Image subs (burn-in)</span>
			<span class="panel__chevron" class:panel__chevron--open={burnInExpanded}>&#8250;</span>
		</button>

		{#if burnInExpanded}
			{#each burnableTracks as t (t.id)}
				<button
					class="panel__item panel__item--indent"
					class:panel__item--on={isBurnIn && currentTrack === t.id}
					onclick={() => onburnin(t.id)}
				>
					{t.name}{t.lang ? ` (${t.lang})` : ''}
					<span class="panel__tag">BURN-IN</span>
					{#if isBurnIn && currentTrack === t.id}<span class="panel__ck">&#10003;</span>{/if}
				</button>
			{/each}
		{/if}
	{/if}
</div>

<style>
	.panel {
		position: absolute;
		bottom: 100%;
		right: 0;
		margin-bottom: 0.5rem;
		min-width: 14rem;
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
	.panel__item--section {
		display: flex;
		justify-content: space-between;
		align-items: center;
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-top: 0.25rem;
	}

	.panel__chevron {
		display: inline-block;
		transform: rotate(0deg);
		transition: transform 0.15s ease;
		font-size: 1rem;
		line-height: 1;
	}

	.panel__chevron--open {
		transform: rotate(90deg);
	}

	.panel__item--indent {
		padding-left: 1.25rem;
	}

	.panel__tag {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		background: rgba(251, 146, 60, 0.15);
		color: #fb923c;
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
		margin-left: 0.25rem;
	}
</style>
