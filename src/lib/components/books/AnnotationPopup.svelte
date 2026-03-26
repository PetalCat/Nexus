<script lang="ts">
	interface Props {
		x: number;
		y: number;
		onHighlight: (color: string) => void;
		onNote: () => void;
		onCopy: () => void;
		onSearch: () => void;
		onDismiss: () => void;
	}

	let { x, y, onHighlight, onNote, onCopy, onSearch, onDismiss }: Props = $props();

	const colors = [
		'rgba(250,204,21,0.85)',
		'rgba(74,222,128,0.85)',
		'rgba(96,165,250,0.85)',
		'rgba(251,113,133,0.85)'
	];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onDismiss} onkeydown={() => {}}></div>

<div class="popup" style="left: {x}px; top: {y}px;">
	<div class="colors">
		{#each colors as color, i (i)}
			<button class="color-dot" style="background: {color};" onclick={() => onHighlight(color)}
				aria-label="Highlight {color}"
			></button>
		{/each}
	</div>

	<div class="separator"></div>

	<div class="actions">
		<button class="action highlight" onclick={() => onHighlight(colors[0])}>Highlight</button>
		<button class="action" onclick={onNote}>Note</button>
		<button class="action" onclick={onCopy}>Copy</button>
		<button class="action" onclick={onSearch}>Search</button>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 999;
	}

	.popup {
		position: fixed;
		z-index: 1000;
		transform: translateX(-50%);
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.08);
		border-radius: 10px;
		box-shadow: var(--shadow-float);
		backdrop-filter: blur(20px);
		padding: 8px 10px;
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-body);
	}

	.colors {
		display: flex;
		gap: 5px;
		align-items: center;
	}

	.color-dot {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
		transition: border-color 0.15s ease, transform 0.15s ease;
	}

	.color-dot:hover {
		border-color: rgba(240, 235, 227, 0.3);
		transform: scale(1.15);
	}

	.separator {
		width: 1px;
		height: 20px;
		background: rgba(240, 235, 227, 0.08);
	}

	.actions {
		display: flex;
		gap: 2px;
		align-items: center;
	}

	.action {
		background: none;
		border: none;
		color: var(--color-muted);
		font-family: var(--font-body);
		font-size: 11px;
		padding: 4px 8px;
		border-radius: 5px;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.action:hover {
		background: var(--color-surface);
		color: var(--color-cream);
	}

	.action.highlight {
		color: var(--color-accent);
		font-weight: 600;
	}

	.action.highlight:hover {
		color: var(--color-accent-light);
	}
</style>
