<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	const item = $derived(data.item);
	const ejsConfig = $derived(data.ejsConfig);

	let emulatorReady = $state(false);
	let emulatorContainer: HTMLDivElement | undefined = $state();

	onMount(() => {
		// Set EmulatorJS config on window before loading the script
		const w = window as any;
		w.EJS_player = '#emulator-game';
		w.EJS_core = ejsConfig.core;
		w.EJS_gameUrl = ejsConfig.gameUrl;
		w.EJS_pathtodata = ejsConfig.pathtodata;
		w.EJS_color = ejsConfig.color;
		w.EJS_startOnLoaded = true;
		w.EJS_oldCores = false;
		w.EJS_Settings = {};

		// Load EmulatorJS loader script from CDN
		const script = document.createElement('script');
		script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
		script.async = true;
		script.onload = () => {
			emulatorReady = true;
		};
		document.body.appendChild(script);

		return () => {
			// Cleanup
			script.remove();
			delete w.EJS_player;
			delete w.EJS_core;
			delete w.EJS_gameUrl;
			delete w.EJS_pathtodata;
			delete w.EJS_color;
			delete w.EJS_startOnLoaded;
			delete w.EJS_oldCores;
			delete w.EJS_Settings;
			delete w.EJS_emulator;
		};
	});

	function exitEmulator() {
		goto(`/media/game/${item.sourceId}?service=${data.serviceId}`);
	}

	function toggleFullscreen() {
		if (!emulatorContainer) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			emulatorContainer.requestFullscreen();
		}
	}
</script>

<svelte:head>
	<title>{item.title} - Play | Nexus</title>
</svelte:head>

<div class="play-page">
	<!-- Header bar -->
	<header class="play-header">
		<button class="play-header__back" onclick={exitEmulator} title="Back to game">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M19 12H5M12 19l-7-7 7-7"/>
			</svg>
		</button>
		<div class="play-header__info">
			{#if item.poster}
				<img src={item.poster} alt="" class="play-header__cover" />
			{/if}
			<div>
				<h1 class="play-header__title">{item.title}</h1>
				<span class="play-header__platform">{item.metadata?.platform ?? ''}</span>
			</div>
		</div>
		<div class="play-header__actions">
			<button class="play-toolbar-btn" onclick={toggleFullscreen} title="Fullscreen">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
				</svg>
			</button>
			<button class="play-toolbar-btn play-toolbar-btn--exit" onclick={exitEmulator} title="Exit">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>
	</header>

	<!-- Emulator container -->
	<div class="play-emulator" bind:this={emulatorContainer}>
		<div id="emulator-game" class="play-emulator__canvas"></div>
	</div>
</div>

<style>
	.play-page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #000;
		color: #fff;
	}

	.play-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		background: rgba(10, 10, 20, 0.95);
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		z-index: 10;
		flex-shrink: 0;
	}

	.play-header__back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		border: none;
		background: rgba(255, 255, 255, 0.06);
		color: #fff;
		cursor: pointer;
		transition: background 0.15s;
	}
	.play-header__back:hover { background: rgba(255, 255, 255, 0.12); }

	.play-header__info {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex: 1;
		min-width: 0;
	}

	.play-header__cover {
		width: 32px;
		height: 42px;
		object-fit: cover;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.play-header__title {
		font-size: 0.9375rem;
		font-weight: 600;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.play-header__platform {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.45);
	}

	.play-header__actions {
		display: flex;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.play-toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		border: none;
		background: rgba(255, 255, 255, 0.06);
		color: #fff;
		cursor: pointer;
		transition: background 0.15s;
	}
	.play-toolbar-btn:hover { background: rgba(255, 255, 255, 0.12); }
	.play-toolbar-btn--exit:hover { background: rgba(239, 68, 68, 0.3); color: #f87171; }

	.play-emulator {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: #000;
	}

	.play-emulator__canvas {
		width: 100%;
		height: 100%;
	}

	:global(.play-emulator__canvas > div) {
		width: 100% !important;
		height: 100% !important;
	}
</style>
