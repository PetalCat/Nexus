<!-- src/lib/components/TrailerPlayer.svelte -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	let {
		src,
		audioSrc = null,
		delay = 5000,
		autoplay = true,
		muted = $bindable(true),
		playing = $bindable(false)
	}: {
		src?: string | null;
		audioSrc?: string | null;
		delay?: number;
		autoplay?: boolean;
		muted?: boolean;
		playing?: boolean;
	} = $props();

	let videoEl: HTMLVideoElement | undefined = $state();
	let syncAudioEl: HTMLAudioElement | null = null;
	let visible = $state(false);
	let loaded = $state(false);
	let failed = $state(false);

	// Respect prefers-reduced-motion
	const reducedMotion = browser
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;

	const shouldAutoplay = $derived(autoplay && !reducedMotion && !!src);

	// Load video source
	$effect(() => {
		if (!videoEl || !src || failed) return;
		loaded = false;
		visible = false;
		playing = false;
		cleanupSyncAudio();
		videoEl.src = src;
		videoEl.load();
	});

	// Sync muted state to both video and audio
	$effect(() => {
		if (videoEl) videoEl.muted = muted;
		if (syncAudioEl) syncAudioEl.muted = muted;
	});

	function onCanPlay() {
		loaded = true;
		if (shouldAutoplay) {
			setTimeout(() => {
				if (!videoEl || failed) return;
				videoEl
					.play()
					.then(() => {
						visible = true;
						playing = true;
						// Set up synced audio after video starts
						if (audioSrc && !syncAudioEl) setupSyncAudio();
					})
					.catch(() => {
						failed = true;
						playing = false;
					});
			}, delay);
		}
	}

	function onError() {
		failed = true;
		visible = false;
		playing = false;
		cleanupSyncAudio();
	}

	function onEnded() {
		visible = false;
		playing = false;
		cleanupSyncAudio();
	}

	// ── Synced audio for adaptive (video-only) streams ──

	function setupSyncAudio() {
		if (!audioSrc || !videoEl) return;
		cleanupSyncAudio();

		const el = document.createElement('audio');
		el.src = audioSrc;
		el.preload = 'auto';
		el.muted = muted;
		document.body.appendChild(el);
		syncAudioEl = el;

		const onPlay = () => {
			el.currentTime = videoEl!.currentTime;
			el.play().catch(() => {});
		};
		const onPause = () => el.pause();
		const onSeeked = () => {
			el.currentTime = videoEl!.currentTime;
			if (!videoEl!.paused) el.play().catch(() => {});
		};
		const onVolumeChange = () => {
			el.volume = videoEl!.volume;
			el.muted = videoEl!.muted;
		};

		videoEl.addEventListener('play', onPlay);
		videoEl.addEventListener('pause', onPause);
		videoEl.addEventListener('seeked', onSeeked);
		videoEl.addEventListener('volumechange', onVolumeChange);

		// Start audio immediately if video is already playing
		if (!videoEl.paused) {
			el.currentTime = videoEl.currentTime;
			el.play().catch(() => {});
		}

		// Store cleanup references
		(el as any).__cleanups = () => {
			videoEl?.removeEventListener('play', onPlay);
			videoEl?.removeEventListener('pause', onPause);
			videoEl?.removeEventListener('seeked', onSeeked);
			videoEl?.removeEventListener('volumechange', onVolumeChange);
		};
	}

	function cleanupSyncAudio() {
		if (syncAudioEl) {
			(syncAudioEl as any).__cleanups?.();
			syncAudioEl.pause();
			syncAudioEl.removeAttribute('src');
			syncAudioEl.remove();
			syncAudioEl = null;
		}
	}

	// IntersectionObserver — pause when off-screen
	let containerEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		if (!containerEl) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting && videoEl && playing) {
					videoEl.pause();
				} else if (entry.isIntersecting && videoEl && playing) {
					videoEl.play().catch(() => {});
				}
			},
			{ threshold: 0.3 }
		);
		observer.observe(containerEl);
		return () => {
			observer.disconnect();
			cleanupSyncAudio();
		};
	});

	onDestroy(() => {
		cleanupSyncAudio();
	});
</script>

<div bind:this={containerEl} class="trailer-player" class:trailer-visible={visible}>
	{#if src && !failed}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			oncanplay={onCanPlay}
			onerror={onError}
			onended={onEnded}
			muted={muted}
			playsinline
			preload="auto"
			class="trailer-video"
		></video>
	{/if}
</div>

<style>
	.trailer-player {
		position: absolute;
		inset: 0;
		z-index: 1;
		overflow: hidden;
		opacity: 0;
		transition: opacity 1.2s ease;
		pointer-events: none;
	}
	.trailer-visible {
		opacity: 1;
	}
	.trailer-video {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
