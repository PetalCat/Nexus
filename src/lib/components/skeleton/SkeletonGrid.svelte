<script lang="ts">
	import SkeletonCard from './SkeletonCard.svelte';

	interface Props {
		count?: number;
		aspect?: 'portrait' | 'square' | 'video';
	}

	let { count = 12, aspect = 'portrait' }: Props = $props();
</script>

<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
	{#each Array(count) as _}
		<SkeletonCard fill {aspect} />
	{/each}
</div>
