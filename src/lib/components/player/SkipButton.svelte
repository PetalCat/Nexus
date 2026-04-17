<script lang="ts">
	import type { SkipMarker } from './types';

	interface Props {
		marker: SkipMarker;
		onclick: (marker: SkipMarker) => void;
	}

	let { marker, onclick }: Props = $props();

	const defaultLabel = $derived(
		marker.kind === 'intro' ? 'Skip Intro'
		: marker.kind === 'credits' ? 'Skip Credits'
		: 'Skip Recap'
	);
	const label = $derived(marker.label ?? defaultLabel);
</script>

<button class="skip-btn" onclick={() => onclick(marker)} type="button">
	{label}
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<polyline points="9 18 15 12 9 6" />
	</svg>
</button>

<style>
	.skip-btn {
		position: absolute;
		right: 1.5rem;
		bottom: 6rem;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: #fff;
		background: rgba(15, 15, 20, 0.85);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: 999px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
		cursor: pointer;
		z-index: 30;
		animation: skip-fade-in 180ms ease-out;
		transition: background 0.15s, transform 0.1s;
	}
	.skip-btn:hover {
		background: rgba(40, 40, 48, 0.92);
	}
	.skip-btn:active {
		transform: translateY(1px);
	}

	@keyframes skip-fade-in {
		from { opacity: 0; transform: translateY(6px); }
		to   { opacity: 1; transform: translateY(0); }
	}
</style>
