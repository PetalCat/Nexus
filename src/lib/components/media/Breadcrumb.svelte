<script lang="ts">
	import { ChevronRight } from 'lucide-svelte';

	interface Crumb {
		label: string;
		href?: string;
	}

	let { crumbs }: { crumbs: Crumb[] } = $props();
</script>

<nav class="flex items-center gap-1.5 text-sm">
	{#each crumbs as crumb, i (i)}
		{#if i > 0}
			<ChevronRight size={14} strokeWidth={1.5} class="text-faint" />
		{/if}
		{#if crumb.href}
			<a href={crumb.href} class="text-muted transition-all hover:translate-x-0.5 hover:text-cream">{crumb.label}</a>
		{:else}
			<span class="text-cream">{crumb.label}</span>
		{/if}
	{/each}
</nav>
