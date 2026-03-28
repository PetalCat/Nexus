<script lang="ts">
	import {
		musicPlayer,
		togglePlay,
		skipNext,
		skipPrev,
		toggleShuffle,
		cycleQueueMode,
		seek,
		toggleLikeTrack
	} from '$lib/stores/musicStore.svelte';
	import {
		Play,
		Pause,
		SkipBack,
		SkipForward,
		Shuffle,
		Repeat,
		Repeat1,
		Heart,
		ListMusic,
		Music,
		Smartphone,
		X
	} from 'lucide-svelte';
	import QueuePanel from './QueuePanel.svelte';

	interface Props {
		visible: boolean;
		onClose: () => void;
	}

	let { visible, onClose }: Props = $props();

	let showQueue = $state(false);
	let closing = $state(false);
	let liked = $state(false);

	const track = $derived(musicPlayer.currentTrack);
	const repeatMode = $derived(musicPlayer.repeat);

	// Seek bar drag state
	let seekBar: HTMLDivElement | undefined = $state();
	let dragging = $state(false);

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function handleSeekClick(e: MouseEvent) {
		if (!seekBar) return;
		const rect = seekBar.getBoundingClientRect();
		seek((e.clientX - rect.left) / rect.width);
	}

	function handleSeekPointerDown(e: PointerEvent) {
		dragging = true;
		(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
	}

	function handleSeekPointerMove(e: PointerEvent) {
		if (!dragging || !seekBar) return;
		const rect = seekBar.getBoundingClientRect();
		seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
	}

	function handleSeekPointerUp() {
		dragging = false;
	}

	function handleClose() {
		closing = true;
		setTimeout(() => {
			closing = false;
			onClose();
		}, 400);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') handleClose();
	}

	async function handleLike() {
		if (!track) return;
		liked = !liked;
		await toggleLikeTrack(track.sourceId, track.serviceId);
	}
</script>

{#if visible}
	<div
		class="overlay"
		class:active={!closing}
		class:closing
		role="dialog"
		tabindex="-1"
		aria-label="Now Playing"
		onkeydown={handleKeydown}
	>
		<!-- Close button -->
		<button
			class="close-btn"
			onclick={handleClose}
			aria-label="Close"
		>
			<X size={20} strokeWidth={1.5} />
		</button>

		{#if track}
			<div class="content">
				<!-- Album art -->
				<div class="album-art">
					<img
						src={track.image}
						alt={track.album}
						draggable="false"
					/>
				</div>

				<!-- Track info -->
				<div class="track-info">
					<h2 class="track-title">{track.title}</h2>
					<p class="track-meta">
						<a href="/music/artists/{track.albumId}?service={track.serviceId}" class="artist-link">{track.artist}</a>
						{#if track.album}
							<span class="separator">&middot;</span>
							<span class="album-name">{track.album}</span>
						{/if}
					</p>
				</div>

				<!-- Seek bar -->
				<div class="seek-section">
					<div
						bind:this={seekBar}
						class="seek-track"
						role="slider"
						tabindex="0"
						aria-label="Seek"
						aria-valuemin={0}
						aria-valuemax={track.duration}
						aria-valuenow={Math.floor(musicPlayer.currentTime)}
						onclick={handleSeekClick}
						onpointerdown={handleSeekPointerDown}
						onpointermove={handleSeekPointerMove}
						onpointerup={handleSeekPointerUp}
						onkeydown={(e) => {
							if (e.key === 'ArrowRight') seek(musicPlayer.progress + 0.02);
							if (e.key === 'ArrowLeft') seek(musicPlayer.progress - 0.02);
						}}
					>
						<div class="seek-bg"></div>
						<div class="seek-fill" style="width: {musicPlayer.progress * 100}%;"></div>
						<div
							class="seek-dot"
							class:active={dragging}
							style="left: {musicPlayer.progress * 100}%;"
						></div>
					</div>
					<div class="time-display">
						<span>{formatTime(musicPlayer.currentTime)}</span>
						<span>{formatTime(track.duration)}</span>
					</div>
				</div>

				<!-- Transport controls -->
				<div class="transport">
					<button
						class="transport-btn"
						class:active={musicPlayer.shuffle}
						onclick={(e) => { e.stopPropagation(); toggleShuffle(); }}
						aria-label="Toggle shuffle"
					>
						<Shuffle size={18} strokeWidth={musicPlayer.shuffle ? 2.5 : 1.5} />
					</button>
					<button
						class="transport-btn"
						onclick={(e) => { e.stopPropagation(); skipPrev(); }}
						aria-label="Previous track"
					>
						<SkipBack size={22} strokeWidth={1.5} class="fill-current" />
					</button>
					<button
						class="play-btn"
						onclick={(e) => { e.stopPropagation(); togglePlay(); }}
						aria-label={musicPlayer.playing ? 'Pause' : 'Play'}
					>
						{#if musicPlayer.playing}
							<Pause size={24} strokeWidth={0} class="fill-current" />
						{:else}
							<Play size={24} strokeWidth={0} class="ml-0.5 fill-current" />
						{/if}
					</button>
					<button
						class="transport-btn"
						onclick={(e) => { e.stopPropagation(); skipNext(); }}
						aria-label="Next track"
					>
						<SkipForward size={22} strokeWidth={1.5} class="fill-current" />
					</button>
					<button
						class="transport-btn"
						class:active={repeatMode !== 'off'}
						onclick={(e) => { e.stopPropagation(); cycleQueueMode(); }}
						aria-label="Repeat mode"
					>
						{#if repeatMode === 'one'}
							<Repeat1 size={18} strokeWidth={2} />
						{:else}
							<Repeat size={18} strokeWidth={repeatMode === 'all' ? 2.5 : 1.5} />
						{/if}
					</button>
				</div>

				<!-- Secondary actions -->
				<div class="secondary-actions">
					<button
						class="action-btn"
						class:liked
						onclick={handleLike}
						aria-label="Like"
					>
						<Heart size={18} strokeWidth={1.5} class={liked ? 'fill-current' : ''} />
					</button>
					<button
						class="action-btn"
						onclick={() => { showQueue = true; }}
						aria-label="Queue"
					>
						<ListMusic size={18} strokeWidth={1.5} />
					</button>
					<button class="action-btn" aria-label="Lyrics" disabled>
						<Music size={18} strokeWidth={1.5} />
					</button>
					<button class="action-btn" aria-label="Devices" disabled>
						<Smartphone size={18} strokeWidth={1.5} />
					</button>
				</div>
			</div>
		{/if}
	</div>

	<QueuePanel visible={showQueue} onClose={() => { showQueue = false; }} />
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		background: linear-gradient(160deg, #2a1810 0%, #0d0b0a 35%, #1a0d0d 70%, #0d0b0a 100%);
		opacity: 0;
		transform: translateY(50%) scale(0.4);
	}

	.overlay.active {
		animation: morphIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	.overlay.closing {
		animation: morphOut 0.4s cubic-bezier(0.7, 0, 0.84, 0) forwards;
	}

	@keyframes morphIn {
		from {
			opacity: 0;
			transform: translateY(50%) scale(0.4);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes morphOut {
		from {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
		to {
			opacity: 0;
			transform: translateY(50%) scale(0.4);
		}
	}

	.close-btn {
		position: absolute;
		top: 24px;
		right: 24px;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: rgba(240, 235, 227, 0.06);
		border: none;
		color: var(--color-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s ease;
		z-index: 10;
	}

	.close-btn:hover {
		background: rgba(240, 235, 227, 0.12);
		color: var(--color-cream);
	}

	.content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 28px;
		max-width: 400px;
		width: 100%;
		padding: 0 20px;
	}

	.album-art {
		width: 320px;
		height: 320px;
		border-radius: 16px;
		overflow: hidden;
		box-shadow:
			0 24px 80px rgba(0, 0, 0, 0.6),
			0 0 60px rgba(212, 162, 83, 0.08);
	}

	.album-art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.track-info {
		text-align: center;
		width: 100%;
	}

	.track-title {
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 600;
		color: var(--color-cream);
		margin: 0;
		line-height: 1.3;
	}

	.track-meta {
		font-size: 14px;
		color: var(--color-muted);
		margin: 6px 0 0 0;
	}

	.artist-link {
		color: var(--color-cream);
		text-decoration: none;
		transition: color 0.2s ease;
	}

	.artist-link:hover {
		color: var(--color-accent);
	}

	.separator {
		margin: 0 6px;
		color: var(--color-faint);
	}

	.album-name {
		color: var(--color-muted);
	}

	/* Seek bar */
	.seek-section {
		width: 360px;
		max-width: 100%;
	}

	.seek-track {
		position: relative;
		height: 4px;
		width: 100%;
		cursor: pointer;
		border-radius: 2px;
		touch-action: none;
	}

	.seek-bg {
		position: absolute;
		inset: 0;
		border-radius: 2px;
		background: rgba(240, 235, 227, 0.1);
	}

	.seek-fill {
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		border-radius: 2px;
		background: var(--color-accent);
		transition: width 0.1s linear;
	}

	.seek-dot {
		position: absolute;
		top: 50%;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--color-accent);
		border: 2px solid white;
		box-shadow: 0 0 8px rgba(212, 162, 83, 0.5);
		transform: translate(-50%, -50%) scale(0);
		transition: transform 0.15s ease;
	}

	.seek-track:hover .seek-dot,
	.seek-dot.active {
		transform: translate(-50%, -50%) scale(1);
	}

	.time-display {
		display: flex;
		justify-content: space-between;
		margin-top: 8px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-faint);
	}

	/* Transport */
	.transport {
		display: flex;
		align-items: center;
		gap: 20px;
	}

	.transport-btn {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: none;
		border: none;
		color: var(--color-cream);
		opacity: 0.7;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.transport-btn:hover {
		opacity: 1;
	}

	.transport-btn.active {
		color: var(--color-accent);
		opacity: 1;
	}

	.play-btn {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--color-accent);
		border: none;
		color: #0d0b0a;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow:
			0 8px 24px rgba(212, 162, 83, 0.3),
			0 0 40px rgba(212, 162, 83, 0.1);
	}

	.play-btn:hover {
		transform: scale(1.06);
		box-shadow:
			0 8px 32px rgba(212, 162, 83, 0.4),
			0 0 48px rgba(212, 162, 83, 0.15);
	}

	.play-btn:active {
		transform: scale(0.96);
	}

	/* Secondary actions */
	.secondary-actions {
		display: flex;
		align-items: center;
		gap: 24px;
	}

	.action-btn {
		background: none;
		border: none;
		color: var(--color-faint);
		cursor: pointer;
		padding: 8px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
	}

	.action-btn:hover:not(:disabled) {
		color: var(--color-cream);
	}

	.action-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.action-btn.liked {
		color: #e74c3c;
	}
</style>
