<script lang="ts">
	import type { LayoutData } from './$types';
	import { page } from '$app/stores';
	import { BarChart3, Clock, Sparkles } from 'lucide-svelte';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const tabs = [
		{ id: 'insights', label: 'Insights', href: '/activity/insights', icon: BarChart3 },
		{ id: 'history', label: 'History', href: '/activity/history', icon: Clock },
		{ id: 'recommendations', label: 'Recommendations', href: '/activity/recommendations', icon: Sparkles }
	];

	const activeTab = $derived.by(() => {
		const path = $page.url.pathname;
		if (path.startsWith('/activity/history')) return 'history';
		if (path.startsWith('/activity/recommendations')) return 'recommendations';
		return 'insights';
	});
</script>

<svelte:head>
	<title>Activity Hub — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-6 pb-10">
	<div class="px-3 pt-4 sm:px-4 lg:px-6">
		<h1 class="font-display text-2xl font-bold text-cream sm:text-3xl">Activity Hub</h1>
		<p class="mt-1 text-sm text-muted">Analytics, history, and personalized recommendations.</p>

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
				</a>
			{/each}
		</nav>
	</div>

	{@render children()}
</div>
