<!-- src/lib/components/TrailerPlayer.svelte -->
<script lang="ts">
	import { browser } from '$app/environment';

	let {
		src = null,
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
	let containerEl: HTMLDivElement | undefined = $state();
	let visible = $state(false);
	let failed = $state(false);

	const reducedMotion = browser
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;

	const shouldAutoplay = $derived(autoplay && !reducedMotion && !!src);

	// Sync muted state imperatively
	$effect(() => {
		if (videoEl) videoEl.muted = muted;
	});

	// Reload when src changes
	$effect(() => {
		if (!videoEl || !src) return;
		failed = false;
		visible = false;
		playing = false;
		videoEl.src = src;
		videoEl.load();
	});

	// IntersectionObserver — pause when scrolled off-screen
	$effect(() => {
		if (!containerEl) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting && videoEl && playing) videoEl.pause();
				else if (entry.isIntersecting && videoEl && playing) videoEl.play().catch(() => {});
			},
			{ threshold: 0.3 }
		);
		observer.observe(containerEl);
		return () => observer.disconnect();
	});

	// ── Synced audio element for adaptive (video-only) streams ──

	let syncAudioEl: HTMLAudioElement | null = null;

	function setupSyncAudio() {
		cleanupSyncAudio();
		if (!audioSrc || !videoEl) return;
		const el = document.createElement('audio');
		el.src = audioSrc;
		el.preload = 'auto';
		el.muted = muted;
		document.body.appendChild(el);
		const onPlay = () => { el.currentTime = videoEl!.currentTime; el.play().catch(() => {}); };
		const onPause = () => el.pause();
		const onSeeked = () => { el.currentTime = videoEl!.currentTime; if (!videoEl!.paused) el.play().catch(() => {}); };
		const onVolumeChange = () => { el.volume = videoEl!.volume; el.muted = videoEl!.muted; };
		videoEl.addEventListener('play', onPlay);
		videoEl.addEventListener('pause', onPause);
		videoEl.addEventListener('seeked', onSeeked);
		videoEl.addEventListener('volumechange', onVolumeChange);
		if (!videoEl.paused) { el.currentTime = videoEl.currentTime; el.play().catch(() => {}); }
		(el as any).__cleanup = () => {
			videoEl?.removeEventListener('play', onPlay);
			videoEl?.removeEventListener('pause', onPause);
			videoEl?.removeEventListener('seeked', onSeeked);
			videoEl?.removeEventListener('volumechange', onVolumeChange);
		};
		syncAudioEl = el;
	}

	function cleanupSyncAudio() {
		if (!syncAudioEl) return;
		(syncAudioEl as any).__cleanup?.();
		syncAudioEl.pause();
		syncAudioEl.removeAttribute('src');
		syncAudioEl.remove();
		syncAudioEl = null;
	}

	function onCanPlay() {
		if (!shouldAutoplay || !videoEl || failed) return;
		setTimeout(() => {
			if (!videoEl || failed) return;
			videoEl.play()
				.then(() => { visible = true; playing = true; if (audioSrc) setupSyncAudio(); })
				.catch(() => { failed = true; playing = false; });
		}, delay);
	}

	function handleEnded() { visible = false; playing = false; cleanupSyncAudio(); }
	function handleError() { failed = true; visible = false; playing = false; cleanupSyncAudio(); }
</script>

<div bind:this={containerEl} class="trailer-player" class:trailer-visible={visible}>
	{#if src && !failed}
		<video
			bind:this={videoEl}
			oncanplay={onCanPlay}
			onerror={handleError}
			onended={handleEnded}
			{muted}
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
