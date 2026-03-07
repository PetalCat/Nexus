<script lang="ts">
	import type { ActivityEvent } from '$lib/types/media-ui';
	import ActivityFeedItem from './ActivityFeedItem.svelte';

	interface Props {
		events: ActivityEvent[];
		maxItems?: number;
	}

	let { events, maxItems = 10 }: Props = $props();

	const visibleEvents = $derived(events.slice(0, maxItems));
</script>

<div class="divide-y divide-cream/[0.04]">
	{#each visibleEvents as event, i (event.id)}
		<div class="nexus-stagger-item" style="--stagger-index: {i}">
			<ActivityFeedItem {event} />
		</div>
	{/each}

	{#if visibleEvents.length === 0}
		<div class="px-3 py-8 text-center text-sm text-faint">
			No recent activity
		</div>
	{/if}
</div>
