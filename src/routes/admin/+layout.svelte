<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import SectionTabs from '$lib/components/SectionTabs.svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<svelte:head>
	<title>Admin — Nexus</title>
</svelte:head>

<div class="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
	<SectionTabs
		title="Admin Dashboard"
		subtitle="Server intelligence & management"
		items={[
			{ label: 'Overview', href: '/admin' },
			{ label: 'Analytics', href: '/admin/analytics' },
			{ label: 'Users', href: '/admin/users' },
			{ label: 'Content', href: '/admin/content' },
			{ label: 'Services', href: '/admin/services' },
			{ label: 'System', href: '/admin/system' }
		]}
	>
		{#snippet icon()}
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--color-accent)" stroke-width="1.5">
				<rect x="1" y="1" width="6" height="6" rx="1.5" />
				<rect x="9" y="1" width="6" height="6" rx="1.5" />
				<rect x="1" y="9" width="6" height="6" rx="1.5" />
				<rect x="9" y="9" width="6" height="6" rx="1.5" />
			</svg>
		{/snippet}
	</SectionTabs>

	{@render children()}
</div>
