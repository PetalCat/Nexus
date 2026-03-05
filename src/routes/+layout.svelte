<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { initAnalytics, trackPageView, destroyAnalytics } from '$lib/stores/analytics';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const noLayout = $derived($page.url.pathname === '/setup' || $page.url.pathname === '/login');

	let sidebarOpen = $state(false);

	onMount(() => initAnalytics());
	onDestroy(() => destroyAnalytics());
	afterNavigate(({ to }) => {
		if (to?.url) trackPageView(to.url.pathname);
	});

	const scopeMap: Record<string, 'movie' | 'show' | 'music' | 'book' | 'game'> = {
		'/movies': 'movie',
		'/shows': 'show',
		'/music': 'music',
		'/books': 'book',
		'/games': 'game'
	};
	const searchScope = $derived(scopeMap[$page.url.pathname] as 'movie' | 'show' | 'music' | 'book' | 'game' | undefined);

	// Close sidebar on navigation
	$effect(() => {
		$page.url.pathname;
		sidebarOpen = false;
	});
</script>

<svelte:head>
	<title>Nexus</title>
	<meta name="description" content="Your unified media platform" />
</svelte:head>

{#if noLayout}
	{@render children()}
{:else}
	<div class="flex min-h-screen">
		<Sidebar open={sidebarOpen} onclose={() => (sidebarOpen = false)} pendingRequests={data.pendingRequests ?? 0} isAdmin={data.user?.isAdmin ?? false} />
		<div class="flex min-w-0 flex-1 flex-col min-h-screen lg:ml-56">
			<header class="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-void)]/90 px-3 backdrop-blur-xl sm:gap-4 sm:px-4 lg:px-6">
				<!-- Mobile hamburger -->
				<button
					class="btn-icon rounded-lg p-2 text-[var(--color-subtle)] hover:text-[var(--color-text)] lg:hidden"
					onclick={() => (sidebarOpen = !sidebarOpen)}
					aria-label="Toggle menu"
				>
					<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
						<path d="M3 5h12M3 9h12M3 13h12" />
					</svg>
				</button>
				<div class="flex-1">
					<SearchBar compact scope={searchScope} />
				</div>
				<div class="flex items-center gap-2">
					<a href="/settings" class="btn-icon rounded-lg p-2 text-[var(--color-subtle)] hover:text-[var(--color-text)] hidden sm:flex" title="Settings">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
							<circle cx="8" cy="8" r="2" />
							<path d="M8 1V3M8 13V15M1 8H3M13 8H15M3 3L4.5 4.5M11.5 11.5L13 13M3 13L4.5 11.5M11.5 4.5L13 3" stroke-linecap="round" />
						</svg>
					</a>
					{#if data.user}
						<form method="POST" action="/api/auth/logout">
							<button
								type="submit"
								class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all hover:ring-2 hover:ring-[var(--color-nebula)]/40"
								style="background: #7c6cf820; color: var(--color-nebula)"
								title="Sign out ({data.user.displayName})"
							>
								{data.user.displayName.slice(0, 1).toUpperCase()}
							</button>
						</form>
					{/if}
				</div>
			</header>
			<main class="relative flex-1 overflow-x-hidden">
				<!-- Ambient glow — subtle radial light behind content -->
				<div class="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
					<div class="absolute -top-32 left-1/4 h-96 w-96 rounded-full opacity-[0.04]" style="background: radial-gradient(circle, #7c6cf8 0%, transparent 70%); filter: blur(60px)"></div>
				</div>
				<div class="relative z-10">
					{@render children()}
				</div>
			</main>
		</div>
	</div>
{/if}
