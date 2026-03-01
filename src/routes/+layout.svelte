<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import { page } from '$app/stores';

	let { children } = $props();

	const noLayout = $derived($page.url.pathname === '/setup');
</script>

<svelte:head>
	<title>Nexus</title>
	<meta name="description" content="Your unified media platform" />
</svelte:head>

{#if noLayout}
	{@render children()}
{:else}
	<div class="flex min-h-screen">
		<Sidebar />
		<div class="ml-56 flex flex-1 flex-col min-h-screen">
			<header class="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-void)]/80 px-6 backdrop-blur-xl">
				<SearchBar compact />
				<div class="flex items-center gap-2">
					<a href="/settings" class="btn-icon rounded-lg p-2" title="Settings">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
							<circle cx="8" cy="8" r="2" />
							<path d="M8 1V3M8 13V15M1 8H3M13 8H15M3 3L4.5 4.5M11.5 11.5L13 13M3 13L4.5 11.5M11.5 4.5L13 3" stroke-linecap="round" />
						</svg>
					</a>
				</div>
			</header>
			<main class="flex-1">
				{@render children()}
			</main>
		</div>
	</div>
{/if}
