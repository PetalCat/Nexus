<!-- src/lib/components/TrailerPlayer.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let {
		src,
		delay = 5000,
		autoplay = true,
		muted = $bindable(true),
		playing = $bindable(false)
	}: {
		src?: string | null;
		delay?: number;
		autoplay?: boolean;
		muted?: boolean;
		playing?: boolean;
	} = $props();

	let videoEl: HTMLVideoElement | undefined = $state();
	let visible = $state(false);
	let loaded = $state(false);
	let failed = $state(false);

	// Respect prefers-reduced-motion
	const reducedMotion = browser
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;

	const shouldAutoplay = $derived(autoplay && !reducedMotion && !!src);

	$effect(() => {
		if (!videoEl || !src || failed) return;
		loaded = false;
		visible = false;
		playing = false;
		videoEl.src = src;
		videoEl.load();
	});

	$effect(() => {
		if (videoEl) {
			videoEl.muted = muted;
		}
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
	}

	function onEnded() {
		visible = false;
		playing = false;
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
		return () => observer.disconnect();
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
