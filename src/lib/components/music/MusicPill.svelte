<script lang="ts">
	import {
		musicPlayer,
		togglePlay,
		skipNext,
		skipPrev,
		seek,
		setVolume,
		toggleMute,
		toggleShuffle,
		cycleQueueMode
	} from '$lib/stores/musicStore.svelte';
	import type { QueueMode } from '$lib/stores/musicStore.svelte';
	import {
		Play,
		Pause,
		SkipBack,
		SkipForward,
		Shuffle,
		Repeat1,
		ListMusic,
		Radio,
		Repeat,
		Volume2,
		Volume1,
		VolumeX
	} from 'lucide-svelte';
	import NowPlayingOverlay from './NowPlayingOverlay.svelte';

	let showNowPlaying = $state(false);

	const modeIcons: Record<QueueMode, { icon: typeof Shuffle; label: string }> = {
		single: { icon: Repeat1, label: '1 Song' },
		loop: { icon: Repeat, label: 'Loop' },
		'playlist-only': { icon: ListMusic, label: 'Playlist Only' },
		flow: { icon: Radio, label: 'Flow' }
	};

	const modeInfo = $derived(modeIcons[musicPlayer.queueMode]);

	let expanded = $state(false);
	let hoverTimeout: ReturnType<typeof setTimeout> | undefined;
	let entered = $state(false);

	const track = $derived(musicPlayer.currentTrack);
	const effectiveVolume = $derived(musicPlayer.muted ? 0 : musicPlayer.volume);

	// Circular progress for pill thumbnail
	const CIRCLE_R = 18;
	const CIRCLE_C = 2 * Math.PI * CIRCLE_R;
	const strokeOffset = $derived(CIRCLE_C * (1 - musicPlayer.progress));

	// Entry animation
	$effect(() => {
		if (musicPlayer.visible && track) {
			requestAnimationFrame(() => {
				entered = true;
			});
		} else {
			entered = false;
		}
	});

	function handleMouseEnter() {
		clearTimeout(hoverTimeout);
		expanded = true;
	}

	function handleMouseLeave() {
		hoverTimeout = setTimeout(() => {
			expanded = false;
		}, 300);
	}

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	// Seek bar drag
	let progressBar: HTMLDivElement | undefined = $state();
	let volumeBar: HTMLDivElement | undefined = $state();
	let draggingProgress = $state(false);
	let draggingVolume = $state(false);

	function handleProgressClick(e: MouseEvent) {
		if (!progressBar) return;
		const rect = progressBar.getBoundingClientRect();
		seek((e.clientX - rect.left) / rect.width);
	}

	function handleVolumeClick(e: MouseEvent) {
		if (!volumeBar) return;
		const rect = volumeBar.getBoundingClientRect();
		setVolume((e.clientX - rect.left) / rect.width);
	}

	function handleGlobalMouseUp() {
		draggingProgress = false;
		draggingVolume = false;
	}

	function handleGlobalMouseMove(e: MouseEvent) {
		if (draggingProgress && progressBar) {
			const rect = progressBar.getBoundingClientRect();
			seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
		}
		if (draggingVolume && volumeBar) {
			const rect = volumeBar.getBoundingClientRect();
			setVolume(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
		}
	}
</script>

<svelte:window onmouseup={handleGlobalMouseUp} onmousemove={handleGlobalMouseMove} />

{#if musicPlayer.visible && track}
	<!-- Hover zone with padding -->
	<div
		class="fixed z-50"
		style="
			bottom: 24px;
			right: 24px;
			padding: 16px;
		"
		onmouseenter={handleMouseEnter}
		onmouseleave={handleMouseLeave}
		role="complementary"
		aria-label="Music player"
	>
		<div
			class="pill-container overflow-hidden border border-cream/[0.08]"
			class:expanded
			class:entered
			class:playing={musicPlayer.playing}
			onclick={() => { if (!expanded) showNowPlaying = true; }}
			role="button"
			tabindex="0"
			onkeydown={(e) => { if (e.key === 'Enter' && !expanded) showNowPlaying = true; }}
		>
			{#if !expanded}
				<!-- COLLAPSED: compact horizontal pill -->
				<div class="flex h-full items-center gap-2.5 px-2.5">
					<!-- Album art with progress ring -->
					<div class="relative shrink-0">
						<svg width="40" height="40" viewBox="0 0 40 40" class="absolute -left-0 -top-0">
							<circle
								cx="20" cy="20" r={CIRCLE_R}
								fill="none"
								stroke="rgba(212, 162, 83, 0.15)"
								stroke-width="2"
							/>
							<circle
								cx="20" cy="20" r={CIRCLE_R}
								fill="none"
								stroke="#d4a253"
								stroke-width="2"
								stroke-linecap="round"
								stroke-dasharray={CIRCLE_C}
								stroke-dashoffset={strokeOffset}
								transform="rotate(-90 20 20)"
								class="progress-ring"
							/>
						</svg>
						<div class="album-thumb">
							<img
								src={track.image}
								alt={track.album}
								class="h-full w-full object-cover"
															/>
						</div>
					</div>

					<!-- Track title -->
					<div class="min-w-0 flex-1">
						<p class="truncate text-[12px] font-medium text-cream/80">{track.title}</p>
						<p class="truncate text-[10px] text-muted">{track.artist}</p>
					</div>

					<!-- Equalizer bars -->
					{#if musicPlayer.playing}
						<div class="flex h-3.5 items-end gap-[2px] shrink-0">
							<span class="w-[2.5px] rounded-full bg-accent animate-equalizer-1"></span>
							<span class="w-[2.5px] rounded-full bg-accent animate-equalizer-2" style="animation-delay: 0.15s"></span>
							<span class="w-[2.5px] rounded-full bg-accent animate-equalizer-3" style="animation-delay: 0.3s"></span>
						</div>
					{/if}

					<!-- Play/pause -->
					<button
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cream/[0.08] transition-all duration-200 hover:bg-cream/[0.15] active:scale-90"
						onclick={(e) => { e.stopPropagation(); togglePlay(); }}
						aria-label={musicPlayer.playing ? 'Pause' : 'Play'}
					>
						{#if musicPlayer.playing}
							<Pause size={12} strokeWidth={0} class="fill-cream" />
						{:else}
							<Play size={12} strokeWidth={0} class="ml-0.5 fill-cream" />
						{/if}
					</button>
				</div>

			{:else}
				<!-- EXPANDED: full controls -->
				<div class="flex h-full flex-col px-5 py-3.5">
					<!-- Top row: art + info + transport -->
					<div class="flex items-center gap-3.5">
						<!-- Album art -->
						<div class="album-thumb-lg shrink-0">
							<img
								src={track.image}
								alt={track.album}
								class="h-full w-full object-cover"
															/>
						</div>

						<!-- Track info -->
						<div class="min-w-0 flex-1">
							<p class="truncate text-[13px] font-semibold text-cream">{track.title}</p>
							<p class="truncate text-[11px] text-muted mt-0.5">{track.artist}</p>
						</div>

						<!-- Transport controls -->
						<div class="flex items-center gap-0.5 shrink-0">
							<button
								class="rounded-full p-1.5 transition-colors {musicPlayer.shuffle ? 'text-accent' : 'text-faint hover:text-cream'}"
								onclick={(e) => { e.stopPropagation(); toggleShuffle(); }}
								aria-label="Toggle shuffle"
							>
								<Shuffle size={13} strokeWidth={musicPlayer.shuffle ? 2.5 : 1.5} />
							</button>
							<button
								class="rounded-full p-1.5 text-cream/70 transition-all hover:text-cream active:scale-90"
								onclick={(e) => { e.stopPropagation(); skipPrev(); }}
								aria-label="Previous track"
							>
								<SkipBack size={15} strokeWidth={1.5} class="fill-current" />
							</button>
							<button
								class="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-nexus-void transition-all duration-300 hover:scale-105 hover:shadow-[0_0_20px_rgba(212,162,83,0.3)] active:scale-95"
								onclick={(e) => { e.stopPropagation(); togglePlay(); }}
								aria-label={musicPlayer.playing ? 'Pause' : 'Play'}
							>
								{#if musicPlayer.playing}
									<Pause size={15} strokeWidth={0} class="fill-current" />
								{:else}
									<Play size={15} strokeWidth={0} class="ml-0.5 fill-current" />
								{/if}
							</button>
							<button
								class="rounded-full p-1.5 text-cream/70 transition-all hover:text-cream active:scale-90"
								onclick={(e) => { e.stopPropagation(); skipNext(); }}
								aria-label="Next track"
							>
								<SkipForward size={15} strokeWidth={1.5} class="fill-current" />
							</button>
							<button
								class="rounded-full p-1.5 text-accent transition-colors hover:text-accent-light"
								onclick={(e) => { e.stopPropagation(); cycleQueueMode(); }}
								aria-label="Queue mode: {modeInfo.label}"
								title={modeInfo.label}
							>
								<modeInfo.icon size={13} strokeWidth={2} />
							</button>
						</div>
					</div>

					<!-- Seek bar -->
					<div class="mt-3">
						<div
							bind:this={progressBar}
							class="group/progress relative h-1 w-full cursor-pointer rounded-full transition-all hover:h-1.5"
							role="slider"
							tabindex="0"
							aria-label="Seek"
							aria-valuemin={0}
							aria-valuemax={track.duration}
							aria-valuenow={Math.floor(musicPlayer.currentTime)}
							onclick={handleProgressClick}
							onmousedown={() => (draggingProgress = true)}
							onkeydown={(e) => {
								if (e.key === 'ArrowRight') seek(musicPlayer.progress + 0.02);
								if (e.key === 'ArrowLeft') seek(musicPlayer.progress - 0.02);
							}}
						>
							<div class="absolute inset-0 rounded-full bg-cream/[0.08]"></div>
							<div
								class="absolute inset-y-0 left-0 rounded-full bg-accent"
								style="width: {musicPlayer.progress * 100}%;"
							></div>
							<div
								class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150
									{draggingProgress ? 'h-3 w-3 opacity-100' : 'h-0 w-0 opacity-0 group-hover/progress:h-2.5 group-hover/progress:w-2.5 group-hover/progress:opacity-100'}"
								style="left: {musicPlayer.progress * 100}%; background: #d4a253; box-shadow: 0 0 8px rgba(212,162,83,0.5);"
							></div>
						</div>
						<div class="flex items-center justify-between mt-1">
							<span class="text-[10px] tabular-nums text-faint">{formatTime(musicPlayer.currentTime)}</span>
							<!-- Volume inline -->
							<div class="flex items-center gap-1.5">
								<button
									class="shrink-0 rounded-full p-1 text-faint transition-colors hover:text-cream"
									onclick={toggleMute}
									aria-label={musicPlayer.muted ? 'Unmute' : 'Mute'}
								>
									{#if effectiveVolume === 0}
										<VolumeX size={12} strokeWidth={1.5} />
									{:else if effectiveVolume < 0.5}
										<Volume1 size={12} strokeWidth={1.5} />
									{:else}
										<Volume2 size={12} strokeWidth={1.5} />
									{/if}
								</button>
								<div
									bind:this={volumeBar}
									class="group/vol relative h-1 w-16 cursor-pointer rounded-full"
									role="slider"
									tabindex="0"
									aria-label="Volume"
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={Math.round(effectiveVolume * 100)}
									onclick={handleVolumeClick}
									onmousedown={() => (draggingVolume = true)}
									onkeydown={(e) => {
										if (e.key === 'ArrowRight') setVolume(musicPlayer.volume + 0.05);
										if (e.key === 'ArrowLeft') setVolume(musicPlayer.volume - 0.05);
									}}
								>
									<div class="absolute inset-0 rounded-full bg-cream/[0.08]"></div>
									<div
										class="absolute inset-y-0 left-0 rounded-full bg-cream/40 transition-colors group-hover/vol:bg-cream/60"
										style="width: {effectiveVolume * 100}%;"
									></div>
									<div
										class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150
											{draggingVolume ? 'h-2 w-2 bg-cream opacity-100' : 'h-0 w-0 opacity-0 group-hover/vol:h-1.5 group-hover/vol:w-1.5 group-hover/vol:bg-cream group-hover/vol:opacity-100'}"
										style="left: {effectiveVolume * 100}%;"
									></div>
								</div>
							</div>
							<span class="text-[10px] tabular-nums text-faint">{formatTime(track.duration)}</span>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<NowPlayingOverlay visible={showNowPlaying} onClose={() => showNowPlaying = false} />
{/if}

<style>
	.pill-container {
		height: 56px;
		width: 220px;
		border-radius: 28px;
		background: rgba(13, 11, 10, 0.88);
		backdrop-filter: blur(32px) saturate(1.5);
		-webkit-backdrop-filter: blur(32px) saturate(1.5);
		box-shadow:
			0 8px 32px rgba(13, 11, 10, 0.5),
			0 0 0 rgba(212, 162, 83, 0);
		opacity: 0;
		transform: translateY(20px);
		transition:
			width 0.5s cubic-bezier(0.16, 1, 0.3, 1),
			height 0.5s cubic-bezier(0.16, 1, 0.3, 1),
			border-radius 0.5s cubic-bezier(0.16, 1, 0.3, 1),
			box-shadow 0.5s cubic-bezier(0.16, 1, 0.3, 1),
			opacity 0.4s ease,
			transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.pill-container.entered {
		opacity: 1;
		transform: translateY(0);
	}

	.pill-container.playing {
		box-shadow:
			0 8px 32px rgba(13, 11, 10, 0.5),
			0 0 24px rgba(212, 162, 83, 0.1);
	}

	.pill-container.expanded {
		width: 480px;
		height: 120px;
		border-radius: 20px;
	}

	.album-thumb {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		overflow: hidden;
		margin: 3px;
		box-shadow: 0 0 0 rgba(212, 162, 83, 0);
		transition: box-shadow 0.5s ease;
	}

	.playing .album-thumb {
		box-shadow: 0 0 10px rgba(212, 162, 83, 0.25);
	}

	.album-thumb-lg {
		width: 52px;
		height: 52px;
		border-radius: 12px;
		overflow: hidden;
		box-shadow: 0 4px 16px rgba(13, 11, 10, 0.5), 0 0 12px rgba(212, 162, 83, 0.08);
	}

	.progress-ring {
		transition: stroke-dashoffset 0.3s ease;
	}
</style>
