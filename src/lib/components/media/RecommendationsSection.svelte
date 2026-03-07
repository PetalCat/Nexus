<script lang="ts">
	import type { UnifiedMedia } from '$lib/types/media-ui';
	import ContinueRow from './ContinueRow.svelte';

	interface Props {
		pickedForYou?: UnifiedMedia[];
		becauseYouWatched?: { basedOn: { title: string }; items: UnifiedMedia[] } | null;
		newInMusic?: UnifiedMedia[];
		trendingSeries?: UnifiedMedia[];
		onitemclick?: (media: UnifiedMedia) => void;
	}

	let { pickedForYou = [], becauseYouWatched = null, newInMusic = [], trendingSeries = [], onitemclick }: Props = $props();
</script>

<div class="flex flex-col gap-12">
	{#if pickedForYou.length > 0}
		<ContinueRow title="Picked for You" items={pickedForYou} {onitemclick} />
	{/if}

	{#if becauseYouWatched && becauseYouWatched.items.length > 0}
		<ContinueRow
			title="Because You Watched {becauseYouWatched.basedOn.title}"
			items={becauseYouWatched.items}
			{onitemclick}
		/>
	{/if}

	{#if newInMusic.length > 0}
		<ContinueRow title="New in Music" items={newInMusic} {onitemclick} />
	{/if}

	{#if trendingSeries.length > 0}
		<ContinueRow title="Trending Series" items={trendingSeries} {onitemclick} />
	{/if}
</div>
