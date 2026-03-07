<script lang="ts">
	let {
		onSaveState,
		onLoadState,
		onScreenshot,
		onFullscreen,
		onExit
	}: {
		onSaveState: () => void;
		onLoadState: () => void;
		onScreenshot: () => void;
		onFullscreen: () => void;
		onExit: () => void;
	} = $props();
</script>

<div class="emu-toolbar">
	<button class="emu-toolbar__btn" onclick={onSaveState} title="Save State">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
			<polyline points="17 21 17 13 7 13 7 21"/>
			<polyline points="7 3 7 8 15 8"/>
		</svg>
		<span>Save</span>
	</button>
	<button class="emu-toolbar__btn" onclick={onLoadState} title="Load State">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4"/>
			<polyline points="17 8 12 3 7 8"/>
			<line x1="12" y1="3" x2="12" y2="15"/>
		</svg>
		<span>Load</span>
	</button>
	<button class="emu-toolbar__btn" onclick={onScreenshot} title="Screenshot">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
			<circle cx="12" cy="13" r="4"/>
		</svg>
		<span>Screenshot</span>
	</button>
	<button class="emu-toolbar__btn" onclick={onFullscreen} title="Fullscreen">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
		</svg>
		<span>Fullscreen</span>
	</button>
	<button class="emu-toolbar__btn emu-toolbar__btn--exit" onclick={onExit} title="Exit">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M18 6L6 18M6 6l12 12"/>
		</svg>
		<span>Exit</span>
	</button>
</div>

<style>
	.emu-toolbar {
		display: flex;
		gap: 0.25rem;
		padding: 0.375rem;
		background: rgba(10, 10, 20, 0.9);
		backdrop-filter: blur(8px);
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.06);
	}

	.emu-toolbar__btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.emu-toolbar__btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}

	.emu-toolbar__btn--exit:hover {
		background: rgba(239, 68, 68, 0.2);
		color: #f87171;
	}
</style>
