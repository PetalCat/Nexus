<script lang="ts">
	import { Heart } from 'lucide-svelte';

	let {
		trackCount,
		isActive = false,
		onclick
	}: {
		trackCount: number;
		isActive?: boolean;
		onclick?: () => void;
	} = $props();
</script>

<button
	class="group/liked flex w-40 shrink-0 cursor-pointer flex-col text-left transition-all duration-300"
	onclick={() => onclick?.()}
>
	<div
		class="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl transition-all duration-300"
		style="background: linear-gradient(135deg, #b8862e 0%, #d4a253 40%, #e8bc6a 100%);
			box-shadow: {isActive
			? '0 8px 32px rgba(212, 162, 83, 0.3), 0 0 0 2px rgba(212, 162, 83, 0.5)'
			: '0 2px 12px rgba(212, 162, 83, 0.15)'};"
	>
		<Heart size={48} strokeWidth={1.5} class="text-nexus-void/60 fill-nexus-void/30 transition-transform duration-300 group-hover/liked:scale-110" />
	</div>
	<div class="mt-2 px-0.5">
		<p class="truncate text-sm font-medium text-cream">Liked Songs</p>
		<p class="text-xs text-faint">{trackCount} tracks</p>
	</div>
</button>
