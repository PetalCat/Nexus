<script lang="ts">
	import type { ReaderSettings } from './reader-settings';

	interface Props {
		settings: ReaderSettings;
		variant?: 'epub' | 'pdf';
	}

	let { settings = $bindable(), variant = 'epub' }: Props = $props();

	const flowOptions: Array<{ value: ReaderSettings['flow']; label: string }> = [
		{ value: 'paginated', label: 'Paginated' },
		{ value: 'scrolled', label: 'Scrolled' }
	];
	const spreadOptions: Array<{ value: ReaderSettings['spread']; label: string }> = [
		{ value: 'auto', label: 'Auto' },
		{ value: 'single', label: 'Single' },
		{ value: 'dual', label: 'Dual' }
	];
	const animOptions: Array<{ value: ReaderSettings['pageAnimation']; label: string }> = [
		{ value: 'slide', label: 'Slide' },
		{ value: 'fade', label: 'Fade' },
		{ value: 'none', label: 'None' }
	];
	const dirOptions: Array<{ value: ReaderSettings['direction']; label: string }> = [
		{ value: 'ltr', label: 'Left → Right' },
		{ value: 'rtl', label: 'Right → Left' }
	];
</script>

<div class="reader-settings space-y-5">
	<section>
		<h3 class="settings-heading">Page flow</h3>
		<div class="settings-row">
			{#each flowOptions as opt}
				<button
					type="button"
					class="settings-pill"
					class:settings-pill--active={settings.flow === opt.value}
					onclick={() => { settings.flow = opt.value; }}
				>{opt.label}</button>
			{/each}
		</div>
	</section>

	<section>
		<h3 class="settings-heading">Spread</h3>
		<div class="settings-row">
			{#each spreadOptions as opt}
				<button
					type="button"
					class="settings-pill"
					class:settings-pill--active={settings.spread === opt.value}
					onclick={() => { settings.spread = opt.value; }}
				>{opt.label}</button>
			{/each}
		</div>
		<p class="settings-hint">Auto picks dual on tablets/desktop, single on phones.</p>
	</section>

	<section>
		<h3 class="settings-heading">Page animation</h3>
		<div class="settings-row">
			{#each animOptions as opt}
				<button
					type="button"
					class="settings-pill"
					class:settings-pill--active={settings.pageAnimation === opt.value}
					onclick={() => { settings.pageAnimation = opt.value; }}
				>{opt.label}</button>
			{/each}
		</div>
	</section>

	<section>
		<h3 class="settings-heading">Inputs</h3>
		<label class="settings-toggle">
			<input type="checkbox" bind:checked={settings.inputs.tapZones} />
			<span>Tap zones (left/middle/right)</span>
		</label>
		<label class="settings-toggle">
			<input type="checkbox" bind:checked={settings.inputs.swipe} />
			<span>Swipe</span>
		</label>
		<label class="settings-toggle">
			<input type="checkbox" bind:checked={settings.inputs.keyboard} />
			<span>Keyboard (← → PgUp PgDn Space)</span>
		</label>
	</section>

	<section>
		<h3 class="settings-heading">Direction</h3>
		<div class="settings-row">
			{#each dirOptions as opt}
				<button
					type="button"
					class="settings-pill"
					class:settings-pill--active={settings.direction === opt.value}
					onclick={() => { settings.direction = opt.value; }}
				>{opt.label}</button>
			{/each}
		</div>
	</section>

	{#if variant === 'epub'}
		<section>
			<h3 class="settings-heading">Font size</h3>
			<input
				type="range" min="12" max="32" step="1"
				bind:value={settings.fontSize}
				class="w-full"
			/>
			<p class="settings-hint">{settings.fontSize}px</p>
		</section>
	{/if}
</div>

<style>
	.settings-heading {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgb(255 247 230 / 0.45);
		margin-bottom: 0.5rem;
	}
	.settings-row {
		display: flex;
		gap: 0.4rem;
	}
	.settings-pill {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 0.6rem;
		border: 1px solid rgb(255 247 230 / 0.08);
		font-size: 0.75rem;
		color: rgb(255 247 230 / 0.5);
		background: transparent;
		transition: all 120ms ease;
	}
	.settings-pill:hover {
		color: rgb(255 247 230 / 0.7);
		border-color: rgb(255 247 230 / 0.2);
	}
	.settings-pill--active {
		background: var(--color-accent, #d4b483);
		color: #1a1410;
		border-color: var(--color-accent, #d4b483);
	}
	.settings-toggle {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
		color: rgb(255 247 230 / 0.7);
		padding: 0.35rem 0;
	}
	.settings-hint {
		font-size: 0.7rem;
		color: rgb(255 247 230 / 0.4);
		margin-top: 0.4rem;
	}
</style>
