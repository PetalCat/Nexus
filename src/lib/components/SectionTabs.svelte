<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';

	interface TabItem {
		label: string;
		href: string;
		icon?: string;
		badge?: number | string;
	}

	let {
		title,
		subtitle,
		icon,
		items
	}: {
		title: string;
		subtitle: string;
		icon?: Snippet;
		items: TabItem[];
	} = $props();

	function isActive(href: string, index: number): boolean {
		const pathname = $page.url.pathname;
		if (index === 0) {
			return pathname === href;
		}
		return pathname.startsWith(href);
	}
</script>

<!-- Page header -->
<div class="mb-6 flex items-center gap-3">
	{#if icon}
		<div
			class="flex h-9 w-9 items-center justify-center rounded-xl"
			style="background: rgba(212,162,83,0.12); border: 1px solid rgba(212,162,83,0.25)"
		>
			{@render icon()}
		</div>
	{/if}
	<div>
		<h1 class="text-lg font-bold tracking-tight" style="color: var(--color-display)">
			{title}
		</h1>
		<p class="text-xs" style="color: var(--color-muted)">{subtitle}</p>
	</div>
</div>

<!-- Tab bar -->
<div
	class="mb-6 flex gap-1 overflow-x-auto rounded-lg p-1 scrollbar-none"
	style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)"
	data-sveltekit-noscroll
>
	{#each items as item, index (item.href)}
		{@const active = isActive(item.href, index)}
		<a
			href={item.href}
			class="tab-pill flex-shrink-0 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-all"
			class:active
			data-sveltekit-noscroll
		>
			{item.label}
			{#if item.badge != null}
				<span class="badge">{item.badge}</span>
			{/if}
		</a>
	{/each}
</div>

<style>
	.tab-pill {
		color: var(--color-muted);
		text-decoration: none;
		position: relative;
	}

	.tab-pill:hover {
		color: var(--color-body);
	}

	.tab-pill.active {
		background: var(--color-raised);
		color: var(--color-display);
	}

	.tab-pill.active::after {
		content: '';
		position: absolute;
		bottom: 0;
		left: 25%;
		right: 25%;
		height: 2px;
		background: var(--color-accent, #d4a253);
		border-radius: 1px;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-left: 0.375rem;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.35rem;
		font-size: 0.65rem;
		font-weight: 600;
		border-radius: 9999px;
		background: rgba(212, 162, 83, 0.2);
		color: var(--color-accent, #d4a253);
	}
</style>
