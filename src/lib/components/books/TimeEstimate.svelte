<script lang="ts">
	interface Props {
		remainingPages: number;
		averageSecondsPerPage?: number;
	}

	let { remainingPages, averageSecondsPerPage = 120 }: Props = $props();

	let totalSeconds = $derived(remainingPages * averageSecondsPerPage);
	let hours = $derived(Math.floor(totalSeconds / 3600));
	let minutes = $derived(Math.ceil((totalSeconds % 3600) / 60));

	let timeText = $derived(hours >= 1 ? `~${hours}h ${minutes}m left` : `~${minutes}m left`);
</script>

<div class="time-estimate">
	<svg class="clock-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<circle cx="12" cy="12" r="10" />
		<polyline points="12 6 12 12 16 14" />
	</svg>
	<span class="time">{timeText}</span>
</div>

<style>
	.time-estimate {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.04);
		border-radius: 6px;
		padding: 3px 10px;
	}

	.clock-icon {
		color: var(--color-steel);
		flex-shrink: 0;
	}

	.time {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-steel-light);
		font-weight: 600;
	}
</style>
