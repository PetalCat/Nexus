<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import AdminOverview from '$lib/components/admin/AdminOverview.svelte';
	import AdminAnalytics from '$lib/components/admin/AdminAnalytics.svelte';
	import AdminUsers from '$lib/components/admin/AdminUsers.svelte';
	import AdminContent from '$lib/components/admin/AdminContent.svelte';
	import AdminServices from '$lib/components/admin/AdminServices.svelte';
	import AdminSystem from '$lib/components/admin/AdminSystem.svelte';

	let { data }: { data: PageData } = $props();

	const tabs = [
		{ id: 'overview', label: 'Overview', icon: 'grid' },
		{ id: 'analytics', label: 'Analytics', icon: 'chart' },
		{ id: 'users', label: 'Users', icon: 'users' },
		{ id: 'content', label: 'Content', icon: 'film' },
		{ id: 'services', label: 'Services', icon: 'server' },
		{ id: 'system', label: 'System', icon: 'settings' }
	] as const;

	type TabId = (typeof tabs)[number]['id'];

	const activeTab = $derived(($page.url.searchParams.get('tab') as TabId) || 'overview');

	function switchTab(tabId: TabId) {
		const url = new URL($page.url);
		if (tabId === 'overview') {
			url.searchParams.delete('tab');
		} else {
			url.searchParams.set('tab', tabId);
		}
		goto(url.toString(), { replaceState: true, noScroll: true });
	}
</script>

<svelte:head>
	<title>Admin — Nexus</title>
</svelte:head>

<div class="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
	<!-- Page header -->
	<div class="mb-6 flex items-center gap-3">
		<div class="flex h-9 w-9 items-center justify-center rounded-xl" style="background: rgba(124,108,248,0.15); border: 1px solid rgba(124,108,248,0.25)">
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--color-accent)" stroke-width="1.5">
				<rect x="1" y="1" width="6" height="6" rx="1.5" />
				<rect x="9" y="1" width="6" height="6" rx="1.5" />
				<rect x="1" y="9" width="6" height="6" rx="1.5" />
				<rect x="9" y="9" width="6" height="6" rx="1.5" />
			</svg>
		</div>
		<div>
			<h1 class="text-display text-lg font-bold tracking-tight">Admin Dashboard</h1>
			<p class="text-xs text-[var(--color-muted)]">Server intelligence &amp; management</p>
		</div>
	</div>

	<!-- Tab bar -->
	<div class="mb-6 flex gap-1 overflow-x-auto rounded-lg p-1 scrollbar-none" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
		{#each tabs as tab (tab.id)}
			<button
				class="flex-shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-all whitespace-nowrap {activeTab === tab.id ? 'bg-[var(--color-raised)] text-[var(--color-display)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
				onclick={() => switchTab(tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- Tab content -->
	{#if activeTab === 'overview'}
		<AdminOverview {data} />
	{:else if activeTab === 'analytics'}
		<AdminAnalytics />
	{:else if activeTab === 'users'}
		<AdminUsers />
	{:else if activeTab === 'content'}
		<AdminContent />
	{:else if activeTab === 'services'}
		<AdminServices {data} />
	{:else if activeTab === 'system'}
		<AdminSystem />
	{/if}
</div>
