<script lang="ts">
	import { Ghost } from 'lucide-svelte';
	import { social, toggleGhostMode } from '$lib/stores/socialStore.svelte';
</script>

<button
	onclick={toggleGhostMode}
	class="relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all
		{social.ghostMode
			? 'bg-faint/10 text-faint ring-1 ring-faint/20'
			: 'bg-cream/[0.04] text-muted hover:bg-cream/[0.08] hover:text-cream'}"
	aria-label={social.ghostMode ? 'Disable ghost mode' : 'Enable ghost mode'}
>
	<Ghost size={14} strokeWidth={1.5} />
	Ghost
	{#if social.ghostMode}
		<span class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-faint animate-glow-pulse"></span>
	{/if}
</button>
