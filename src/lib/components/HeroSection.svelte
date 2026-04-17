<!-- src/lib/components/HeroSection.svelte -->
<!-- CANONICAL: layout hero wrapper with backdrop + trailer + slotted content.
     Do not create a second HeroSection; extend this via props/snippets. -->

<script lang="ts">
	import TrailerPlayer from './TrailerPlayer.svelte';
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';

	let {
		backdrop = null,
		trailerUrl = null,
		trailerAudioUrl = null,
		mode = 'carousel',
		autoplay = true,
		delay = 5000,
		children
	}: {
		backdrop?: string | null;
		trailerUrl?: string | null;
		trailerAudioUrl?: string | null;
		mode?: 'carousel' | 'detail' | 'browse';
		autoplay?: boolean;
		delay?: number;
		children: Snippet;
	} = $props();

	let muted = $state(true);
	let playing = $state(false);

	if (browser) {
		const stored = localStorage.getItem('nexus:trailer-muted');
		if (stored !== null) muted = stored === 'true';
	}

	function toggleMute() {
		muted = !muted;
		if (browser) localStorage.setItem('nexus:trailer-muted', String(muted));
	}

	const heightClass: Record<string, string> = {
		carousel: 'hero--carousel',
		detail: 'hero--detail',
		browse: 'hero--browse'
	};
</script>

<div class="hero {heightClass[mode]}">
	{#if backdrop}
		<div
			class="hero-backdrop"
			style="background-image: url('{backdrop}');"
		></div>
	{:else}
		<div class="hero-backdrop hero-backdrop--empty"></div>
	{/if}

	<TrailerPlayer
		src={trailerUrl}
		audioSrc={trailerAudioUrl}
		{autoplay}
		{delay}
		bind:muted
		bind:playing
	/>

	<div class="hero-gradient-left"></div>
	<div class="hero-gradient-bottom"></div>

	{#if playing || trailerUrl}
		<div class="hero-controls">
			{#if playing}
				<span class="hero-badge">
					{mode === 'browse' ? 'Preview' : 'Trailer'}
				</span>
			{/if}
			{#if playing}
				<button
					class="hero-mute-btn"
					onclick={toggleMute}
					aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
				>
					{#if muted}
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
					{:else}
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
					{/if}
				</button>
			{/if}
		</div>
	{/if}

	{#if playing}
		<div class="hero-progress">
			<div class="hero-progress-bar"></div>
		</div>
	{/if}

	<div class="hero-content">
		{@render children()}
	</div>
</div>

<style>
	.hero {
		position: relative;
		width: 100%;
		overflow: hidden;
	}
	.hero--carousel { height: clamp(300px, 50vh, 520px); }
	.hero--detail { height: clamp(320px, 55vh, 560px); }
	.hero--browse { height: clamp(200px, 30vh, 300px); }

	.hero-backdrop {
		position: absolute; inset: 0;
		background-size: cover;
		background-position: center top;
		z-index: 0;
	}
	.hero-backdrop--empty {
		background: linear-gradient(135deg, #1a1816 0%, #0d0b0a 100%);
	}

	.hero-gradient-left {
		position: absolute; inset: 0; z-index: 2;
		background: linear-gradient(to right, rgba(13,11,10,0.7) 0%, transparent 60%);
	}
	.hero-gradient-bottom {
		position: absolute; bottom: 0; left: 0; right: 0; z-index: 2;
		height: 65%;
		background: linear-gradient(to top, #0d0b0a 0%, rgba(13,11,10,0.85) 40%, transparent 100%);
	}

	.hero-controls {
		position: absolute; top: 16px; right: 16px; z-index: 10;
		display: flex; align-items: center; gap: 8px;
	}
	.hero-badge {
		font-size: 9px; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.08em;
		color: rgba(240,235,227,0.4);
		background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
		padding: 4px 10px; border-radius: 4px;
		border: 1px solid rgba(240,235,227,0.08);
	}
	.hero-mute-btn {
		width: 32px; height: 32px; border-radius: 50%;
		background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
		border: 1px solid rgba(240,235,227,0.15);
		color: rgba(240,235,227,0.7); cursor: pointer;
		display: flex; align-items: center; justify-content: center;
		transition: all 0.2s;
	}
	.hero-mute-btn:hover { background: rgba(0,0,0,0.7); color: #f0ebe3; }

	.hero-progress {
		position: absolute; bottom: 0; left: 0; right: 0;
		height: 2px; z-index: 10;
		background: rgba(240,235,227,0.08);
	}
	.hero-progress-bar {
		height: 100%;
		background: var(--color-accent, #d4a253);
		border-radius: 0 1px 1px 0;
		animation: progress 30s linear forwards;
	}
	@keyframes progress { from { width: 0; } to { width: 100%; } }

	.hero-content {
		position: relative;
		z-index: 5;
		height: 100%;
	}
</style>
