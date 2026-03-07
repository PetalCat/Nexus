<script lang="ts">
	interface Props {
		hltb: { main?: number; extra?: number; completionist?: number };
	}

	let { hltb }: Props = $props();

	function formatTime(minutes?: number): string {
		if (!minutes) return '';
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}` : `${m}m`;
	}

	const entries = $derived(
		[
			{ label: 'Main Story', value: hltb.main, color: 'var(--color-steel)' },
			{ label: 'Main + Extra', value: hltb.extra, color: '#8b5cf6' },
			{ label: 'Completionist', value: hltb.completionist, color: 'var(--color-accent)' }
		].filter((e) => e.value && e.value > 0)
	);

	const maxValue = $derived(Math.max(...entries.map((e) => e.value!)));
</script>

<div class="hltb-bars">
	{#each entries as entry}
		{@const pct = (entry.value! / maxValue) * 100}
		<div class="hltb-row">
			<span class="hltb-row__label">{entry.label}</span>
			<div class="hltb-row__track">
				<div
					class="hltb-row__fill"
					style="width: {pct}%; background: {entry.color};"
				></div>
			</div>
			<span class="hltb-row__time">{formatTime(entry.value)}</span>
		</div>
	{/each}
</div>

<style>
	.hltb-bars {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.hltb-row {
		display: grid;
		grid-template-columns: 7.5rem 1fr auto;
		align-items: center;
		gap: 0.75rem;
	}

	.hltb-row__label {
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--color-muted);
		text-align: right;
	}

	.hltb-row__track {
		height: 1.25rem;
		background: var(--color-raised);
		border-radius: 6px;
		overflow: hidden;
		position: relative;
	}

	.hltb-row__fill {
		height: 100%;
		border-radius: 6px;
		transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
		min-width: 1.5rem;
	}

	.hltb-row__time {
		font-family: var(--font-display);
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-cream);
		min-width: 3.5rem;
		text-align: left;
	}

	@media (max-width: 480px) {
		.hltb-row {
			grid-template-columns: 5.5rem 1fr auto;
			gap: 0.5rem;
		}
		.hltb-row__label {
			font-size: 0.7rem;
		}
	}
</style>
