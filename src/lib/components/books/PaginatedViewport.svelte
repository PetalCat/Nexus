<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { ReaderSettings } from './reader-settings';
	import { resolveSpread } from './reader-settings';
	import { useReaderInputs } from './useReaderInputs.svelte';

	interface Props {
		settings: ReaderSettings;
		onPrev: () => void;
		onNext: () => void;
		onToggleUI: () => void;
		children: Snippet<[{ effectiveSpread: 'single' | 'dual'; animationKey: number }]>;
	}

	let { settings, onPrev, onNext, onToggleUI, children }: Props = $props();

	let containerEl = $state<HTMLDivElement | undefined>();
	let viewportWidth = $state<number>(typeof window !== 'undefined' ? window.innerWidth : 1024);
	let animationKey = $state<number>(0);

	const effectiveSpread = $derived(resolveSpread(settings.spread, viewportWidth));

	const inputs = useReaderInputs({
		getSettings: () => settings,
		onPrev: () => { animationKey++; onPrev(); },
		onNext: () => { animationKey++; onNext(); },
		onToggleUI: () => onToggleUI()
	});

	onMount(() => {
		const onResize = () => { viewportWidth = window.innerWidth; };
		window.addEventListener('resize', onResize);
		const detach = inputs.attachKeyboard(window);
		return () => {
			window.removeEventListener('resize', onResize);
			detach();
		};
	});

	const animClass = $derived.by(() => {
		if (settings.flow !== 'paginated') return '';
		switch (settings.pageAnimation) {
			case 'slide': return 'reader-anim-slide';
			case 'fade': return 'reader-anim-fade';
			default: return '';
		}
	});
</script>

<div
	bind:this={containerEl}
	class="reader-viewport {animClass}"
	data-flow={settings.flow}
	data-spread={effectiveSpread}
	data-direction={settings.direction}
	{...inputs.swipeHandlers}
>
	<!--
		Do NOT wrap children in {#key animationKey}. EPUB's foliate-js host
		is the same DOM node across pages; remounting it kills the iframe
		mid-load and throws "Cannot read properties of null (reading 'head')".
		Animations are driven by the CSS class plus the natural remount that
		happens in PDF paginated mode (the page-card snippet keys on
		currentPage and remounts each navigation).
	-->
	<div class="reader-page-layer">
		{@render children({ effectiveSpread, animationKey })}
	</div>
	{#if settings.flow === 'paginated' && settings.inputs.tapZones}
		<div class="reader-tap-overlay" {...inputs.tapHandlers} aria-hidden="true"></div>
	{/if}
</div>

<style>
	.reader-viewport {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		touch-action: pan-y;
	}
	.reader-viewport[data-flow='scrolled'] {
		overflow-y: auto;
	}
	.reader-page-layer {
		width: 100%;
		height: 100%;
	}
	.reader-tap-overlay {
		position: absolute;
		inset: 0;
		z-index: 5;
		background: transparent;
	}
	.reader-anim-slide .reader-page-layer {
		animation: reader-slide-in 220ms ease-out;
	}
	.reader-anim-fade .reader-page-layer {
		animation: reader-fade-in 150ms ease-out;
	}
	@keyframes reader-slide-in {
		from { transform: translateX(20%); opacity: 0; }
		to { transform: translateX(0); opacity: 1; }
	}
	@keyframes reader-fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}
</style>
