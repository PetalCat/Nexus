<script lang="ts">
	import {
		musicPlayer,
		removeFromQueue,
		playIndex
	} from '$lib/stores/musicStore.svelte';
	import { X, GripVertical } from 'lucide-svelte';

	interface Props {
		visible: boolean;
		onClose: () => void;
	}

	let { visible, onClose }: Props = $props();

	let closing = $state(false);

	const currentTrack = $derived(musicPlayer.currentTrack);
	const upcomingTracks = $derived(
		musicPlayer.queue
			.map((track, index) => ({ track, index }))
			.filter((item) => item.index > musicPlayer.currentIndex)
	);

	function handleClose() {
		closing = true;
		setTimeout(() => {
			closing = false;
			onClose();
		}, 300);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') handleClose();
	}

	function handlePlayTrack(index: number) {
		playIndex(index);
	}

	function handleRemove(e: MouseEvent, index: number) {
		e.stopPropagation();
		removeFromQueue(index);
	}
</script>

{#if visible}
	<!-- Backdrop -->
	<button
		class="backdrop"
		class:active={!closing}
		class:closing
		onclick={handleClose}
		onkeydown={handleKeydown}
		aria-label="Close queue panel"
		tabindex="-1"
	></button>

	<!-- Panel -->
	<div
		class="panel"
		class:active={!closing}
		class:closing
		role="dialog"
		tabindex="-1"
		aria-label="Queue"
		onkeydown={handleKeydown}
	>
		<!-- Header -->
		<div class="panel-header">
			<h2 class="panel-title">Queue</h2>
			<button
				class="close-btn"
				onclick={handleClose}
				aria-label="Close queue"
			>
				<X size={18} strokeWidth={1.5} />
			</button>
		</div>

		<!-- Currently playing -->
		{#if currentTrack}
			<div class="section">
				<h3 class="section-label">Now Playing</h3>
				<div class="queue-item current">
					<div class="item-art">
						<img src={currentTrack.image} alt={currentTrack.album} />
					</div>
					<div class="item-info">
						<p class="item-title">{currentTrack.title}</p>
						<p class="item-artist">{currentTrack.artist}</p>
					</div>
				</div>
			</div>
		{/if}

		<!-- Next up -->
		{#if upcomingTracks.length > 0}
			<div class="section">
				<h3 class="section-label">Next Up</h3>
				<div class="queue-list">
					{#each upcomingTracks as { track, index } (track.id)}
						<div
							class="queue-item"
							role="button"
							tabindex="0"
							onclick={() => handlePlayTrack(index)}
							onkeydown={(e) => { if (e.key === 'Enter') handlePlayTrack(index); }}
						>
							<div class="drag-handle">
								<GripVertical size={14} strokeWidth={1.5} />
							</div>
							<div class="item-art">
								<img src={track.image} alt={track.album} />
							</div>
							<div class="item-info">
								<p class="item-title">{track.title}</p>
								<p class="item-artist">{track.artist}</p>
							</div>
							<button
								class="remove-btn"
								onclick={(e) => handleRemove(e, index)}
								aria-label="Remove from queue"
							>
								<X size={14} strokeWidth={1.5} />
							</button>
						</div>
					{/each}
				</div>
			</div>
		{:else}
			<div class="empty-state">
				<p>No upcoming tracks</p>
			</div>
		{/if}
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 101;
		background: rgba(0, 0, 0, 0.5);
		border: none;
		cursor: default;
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.backdrop.active {
		opacity: 1;
	}

	.backdrop.closing {
		opacity: 0;
	}

	.panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 360px;
		max-width: 100vw;
		z-index: 102;
		background: var(--color-deep);
		border-left: 1px solid rgba(240, 235, 227, 0.06);
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		transform: translateX(100%);
		transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.panel.active {
		transform: translateX(0);
	}

	.panel.closing {
		transform: translateX(100%);
		transition: transform 0.3s cubic-bezier(0.7, 0, 0.84, 0);
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 20px 16px;
		border-bottom: 1px solid rgba(240, 235, 227, 0.06);
	}

	.panel-title {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 600;
		color: var(--color-cream);
		margin: 0;
	}

	.close-btn {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: rgba(240, 235, 227, 0.06);
		border: none;
		color: var(--color-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.close-btn:hover {
		background: rgba(240, 235, 227, 0.12);
		color: var(--color-cream);
	}

	.section {
		padding: 16px 20px;
	}

	.section-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-faint);
		margin: 0 0 12px 0;
	}

	.queue-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.queue-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 10px;
		border-radius: 10px;
		background: none;
		border: none;
		width: 100%;
		text-align: left;
		color: var(--color-cream);
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.queue-item:hover {
		background: rgba(240, 235, 227, 0.04);
	}

	.queue-item.current {
		background: rgba(212, 162, 83, 0.06);
		border-left: 2px solid var(--color-accent);
		cursor: default;
	}

	.drag-handle {
		color: var(--color-faint);
		opacity: 0;
		transition: opacity 0.15s ease;
		flex-shrink: 0;
	}

	.queue-item:hover .drag-handle {
		opacity: 0.6;
	}

	.item-art {
		width: 40px;
		height: 40px;
		border-radius: 6px;
		overflow: hidden;
		flex-shrink: 0;
	}

	.item-art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.item-info {
		flex: 1;
		min-width: 0;
	}

	.item-title {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-cream);
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-artist {
		font-size: 11px;
		color: var(--color-muted);
		margin: 2px 0 0 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.remove-btn {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: none;
		border: none;
		color: var(--color-faint);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		opacity: 0;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.queue-item:hover .remove-btn {
		opacity: 1;
	}

	.remove-btn:hover {
		background: rgba(240, 235, 227, 0.08);
		color: var(--color-cream);
	}

	.empty-state {
		padding: 40px 20px;
		text-align: center;
		color: var(--color-faint);
		font-size: 13px;
	}
</style>
