import { onMount } from 'svelte';
import { isNavigating } from '$lib/transition';

/**
 * Returns a reactive object with a `ready` getter that flips to `true`
 * after one animation frame on mount.
 *
 * Skips the delay during view transitions so the real content is available
 * for the browser to snapshot (otherwise it captures the skeleton).
 *
 * Usage: `const state = useReady();` then `{#if !state.ready}` in template.
 * Do NOT destructure — `const { ready } = useReady()` loses reactivity.
 */
export function useReady() {
	// If a view-transition navigation is in progress, skip skeleton so the
	// browser captures real content with view-transition-name elements.
	let ready = $state(isNavigating());

	onMount(() => {
		if (ready) return;
		requestAnimationFrame(() => {
			ready = true;
		});
	});

	return {
		get ready() {
			return ready;
		}
	};
}
