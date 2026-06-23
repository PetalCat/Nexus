<script lang="ts">
	import '@fontsource-variable/playfair-display';
	import '@fontsource-variable/dm-sans';
	import '@fontsource-variable/jetbrains-mono';
	import '../app.css';
	import { page } from '$app/stores';
	import Stickies from '$lib/components/Stickies.svelte';

	let { children }: { children: import('svelte').Snippet } = $props();

	const noLayoutPaths = [
		'/',
		'/welcome',
		'/login',
		'/register',
		'/pending-approval',
		'/reset-password',
		'/test-play'
	];
	const noLayout = $derived(
		noLayoutPaths.some((path) => $page.url.pathname === path || $page.url.pathname.startsWith(`${path}/`))
	);
</script>

<svelte:head>
	<title>Nexus</title>
	<meta name="description" content="Your unified media platform" />
</svelte:head>

{#if noLayout}
	{@render children()}
{:else}
	<main>
		{@render children()}
	</main>
{/if}

<!-- Page-anchored post-it annotations for design critique, on every page.
     Off by default (the FAB toggles it), so it never blocks normal use. -->
<Stickies />
