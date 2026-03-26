<script lang="ts">
	interface Props {
		shortcuts: Array<{ label: string; key: string }>;
		visible: boolean;
		onClose: () => void;
	}

	let { shortcuts, visible, onClose }: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && visible) {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if visible}
	<div class="shortcuts-panel">
		<div class="title">Keyboard Shortcuts</div>
		<div class="list">
			{#each shortcuts as shortcut, i (i)}
				<div class="row">
					<span class="label">{shortcut.label}</span>
					<kbd class="key">{shortcut.key}</kbd>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.shortcuts-panel {
		position: fixed;
		bottom: 70px;
		right: 16px;
		z-index: 900;
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 12px;
		padding: 14px 16px;
		box-shadow: var(--shadow-float);
		min-width: 200px;
		animation: slideUp 0.2s ease forwards;
	}

	.title {
		color: var(--color-accent);
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.08em;
		font-weight: 600;
		font-family: var(--font-body);
		margin-bottom: 10px;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.label {
		color: var(--color-muted);
		font-size: 11px;
		font-family: var(--font-body);
	}

	.key {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--color-faint);
		background: var(--color-surface);
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 4px;
		padding: 2px 6px;
		line-height: 1.4;
	}
</style>
