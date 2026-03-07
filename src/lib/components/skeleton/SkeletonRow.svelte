<script lang="ts">
	import SkeletonCard from './SkeletonCard.svelte';

	interface Props {
		count?: number;
		cardSize?: 'sm' | 'md' | 'lg' | 'xl';
		aspect?: 'portrait' | 'square' | 'video';
	}

	let { count = 8, cardSize = 'md', aspect = 'portrait' }: Props = $props();
</script>

<div>
	<!-- Header placeholder -->
	<div class="mb-4 flex items-center gap-3 sm:mb-5">
		<div class="h-[18px] w-[3px] shrink-0 rounded-full bg-accent/20" aria-hidden="true"></div>
		<div class="skeleton-bone h-5 w-32 rounded"></div>
	</div>

	<!-- Cards row -->
	<div class="flex gap-3 overflow-hidden">
		{#each Array(count) as _, i}
			<SkeletonCard size={cardSize} {aspect} />
		{/each}
	</div>
</div>
