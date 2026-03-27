<script lang="ts">
	import type { LayoutData } from './$types';
	import { page } from '$app/stores';
	import { Bookmark, FolderOpen, Share2 } from 'lucide-svelte';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const tabs = [
		{ id: 'watchlist', label: 'Watchlist', href: '/library/watchlist', icon: Bookmark },
		{ id: 'collections', label: 'Collections', href: '/library/collections', icon: FolderOpen },
		{ id: 'shared', label: 'Shared', href: '/library/shared', icon: Share2 }
	];

	const activeTab = $derived.by(() => {
		const path = $page.url.pathname;
		if (path.startsWith('/library/collections')) return 'collections';
		if (path.startsWith('/library/shared')) return 'shared';
		return 'watchlist';
	});
</script>

<svelte:head>
	<title>Library — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-6 pb-10">
	<!-- Library header with tab nav -->
	<div class="px-3 pt-4 sm:px-4 lg:px-6">
		<h1 class="font-display text-2xl font-bold text-cream sm:text-3xl">Library</h1>
		<p class="mt-1 text-sm text-muted">Your personal collection, curated just for you.</p>

		<!-- Tab navigation -->
		<nav class="mt-5 flex gap-1 overflow-x-auto rounded-xl bg-surface/50 p-1 scrollbar-none" style="backdrop-filter: blur(8px);">
			{#each tabs as tab (tab.id)}
				{@const Icon = tab.icon}
				{@const active = activeTab === tab.id}
				<a
					href={tab.href}
					class="group flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200
						{active
						? 'bg-raised text-cream shadow-sm'
						: 'text-muted hover:text-cream'}"
				>
					<Icon size={15} strokeWidth={active ? 2 : 1.5} class={active ? 'text-accent' : ''} />
					{tab.label}
					{#if tab.id === 'shared' && data.unseenShares > 0}
						<span class="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
							{data.unseenShares > 99 ? '99+' : data.unseenShares}
						</span>
					{/if}
				</a>
			{/each}
		</nav>
	</div>

	{@render children()}
</div>
