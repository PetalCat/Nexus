<script lang="ts">
	interface Props {
		progress: number;
		chapters: Array<{ position: number; title: string }>;
		currentPage: number;
		totalPages: number;
		onSeek: (position: number) => void;
	}

	let { progress, chapters, currentPage, totalPages, onSeek }: Props = $props();

	let trackEl: HTMLDivElement | undefined = $state();
	let dragging = $state(false);
	let pageInputOverride = $state<string | null>(null);

	let pageInput = $derived(pageInputOverride ?? String(currentPage));
	let percentText = $derived(`${Math.round(progress * 100)}%`);

	function handleTrackClick(e: MouseEvent) {
		if (!trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		onSeek(pos);
	}

	function handlePointerDown(e: PointerEvent) {
		e.preventDefault();
		dragging = true;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragging || !trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		onSeek(pos);
	}

	function handlePointerUp() {
		dragging = false;
		pageInputOverride = null;
	}

	function handlePageInputChange(e: Event) {
		pageInputOverride = (e.target as HTMLInputElement).value;
	}

	function handlePageInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			const val = pageInputOverride ?? String(currentPage);
			const page = parseInt(val, 10);
			if (!isNaN(page) && page >= 1 && page <= totalPages) {
				onSeek((page - 1) / Math.max(1, totalPages - 1));
			}
			pageInputOverride = null;
		}
	}
</script>

<div class="progress-bar">
	<div class="page-info">
		<input
			class="page-input"
			type="text"
			value={pageInput}
			oninput={handlePageInputChange}
			onkeydown={handlePageInputKeydown}
			aria-label="Current page"
		/>
		<span class="page-total">/ {totalPages}</span>
	</div>

	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="track-container" bind:this={trackEl} onclick={handleTrackClick}>
		<div class="track">
			<div class="glow" style="width: {progress * 100}%;"></div>
			<div class="fill" style="width: {progress * 100}%;"></div>

			{#each chapters as chapter, i (i)}
				<div class="chapter-mark" style="left: {chapter.position * 100}%;" title={chapter.title}></div>
			{/each}
		</div>

		<div
			class="scrubber"
			style="left: {progress * 100}%;"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			role="slider"
			aria-valuenow={Math.round(progress * 100)}
			aria-valuemin={0}
			aria-valuemax={100}
			tabindex="0"
		></div>
	</div>

	<div class="percent">{percentText}</div>
</div>

<style>
	.progress-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		background: var(--color-void);
		border-top: 1px solid rgba(240, 235, 227, 0.04);
		padding: 8px 16px;
		backdrop-filter: blur(24px);
		box-sizing: border-box;
	}

	.page-info {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.page-input {
		font-family: var(--font-mono);
		font-size: 11px;
		width: 30px;
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 4px;
		color: var(--color-cream);
		text-align: center;
		padding: 2px 4px;
		outline: none;
	}

	.page-input:focus {
		border-color: var(--color-accent);
	}

	.page-total {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-faint);
		white-space: nowrap;
	}

	.track-container {
		flex: 1;
		position: relative;
		height: 20px;
		display: flex;
		align-items: center;
		cursor: pointer;
	}

	.track {
		width: 100%;
		height: 4px;
		background: var(--color-raised);
		border-radius: 2px;
		position: relative;
		overflow: visible;
	}

	.fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		border-radius: 2px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 60%, transparent), var(--color-accent));
	}

	.glow {
		position: absolute;
		top: -2px;
		left: 0;
		height: 8px;
		border-radius: 4px;
		background: rgba(212, 162, 83, 0.15);
		filter: blur(4px);
		pointer-events: none;
	}

	.chapter-mark {
		position: absolute;
		top: -3px;
		width: 1px;
		height: 10px;
		background: rgba(240, 235, 227, 0.1);
		pointer-events: none;
	}

	.scrubber {
		position: absolute;
		top: 50%;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-accent);
		border: 2px solid white;
		box-shadow: 0 0 12px rgba(212, 162, 83, 0.4);
		transform: translate(-50%, -50%);
		cursor: grab;
		touch-action: none;
		z-index: 2;
	}

	.scrubber:active {
		cursor: grabbing;
	}

	.percent {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-faint);
		flex-shrink: 0;
		min-width: 32px;
		text-align: right;
	}
</style>
