<script lang="ts">
	import type { PageData } from './$types';
	import type { MediaEvent } from '$lib/db/schema';
	import HistoryFilters from '$lib/components/history/HistoryFilters.svelte';
	import HistoryFeed from '$lib/components/history/HistoryFeed.svelte';
	import HistoryTable from '$lib/components/history/HistoryTable.svelte';

	let { data }: { data: PageData } = $props();

	let viewMode = $state<'feed' | 'table'>('feed');
	let selectedTypes = $state<string[]>([]);
	let searchQuery = $state('');
	let selectedService = $state('');

	let allEvents = $state<MediaEvent[]>(data.events as MediaEvent[]);
	let loading = $state(false);
	let hasMore = $state(data.events.length < data.total);

	const filteredEvents = $derived.by(() => {
		let result = allEvents;
		if (selectedTypes.length > 0) {
			result = result.filter((e) => selectedTypes.includes(e.mediaType));
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter((e) => (e.mediaTitle ?? '').toLowerCase().includes(q));
		}
		if (selectedService) {
			result = result.filter((e) => e.serviceId === selectedService);
		}
		return result;
	});

	async function loadMore() {
		if (loading || !hasMore) return;
		loading = true;
		try {
			const params = new URLSearchParams({
				limit: '50',
				offset: String(allEvents.length)
			});
			if (selectedService) params.set('serviceId', selectedService);
			if (searchQuery.trim()) params.set('titleSearch', searchQuery.trim());

			const res = await fetch(`/api/user/stats/events?${params}`);
			const json = await res.json();
			allEvents = [...allEvents, ...json.events];
			hasMore = allEvents.length < json.total;
		} catch (e) {
			console.error('Failed to load more events:', e);
		} finally {
			loading = false;
		}
	}

	async function applyServerFilters() {
		loading = true;
		try {
			const params = new URLSearchParams({ limit: '50', offset: '0' });
			if (selectedService) params.set('serviceId', selectedService);
			if (searchQuery.trim()) params.set('titleSearch', searchQuery.trim());
			if (selectedTypes.length === 1) params.set('type', selectedTypes[0]);

			const res = await fetch(`/api/user/stats/events?${params}`);
			const json = await res.json();
			allEvents = json.events;
			hasMore = allEvents.length < json.total;
		} catch (e) {
			console.error('Failed to filter events:', e);
		} finally {
			loading = false;
		}
	}

	let filterTimeout: ReturnType<typeof setTimeout>;
	function onFilterChange() {
		clearTimeout(filterTimeout);
		filterTimeout = setTimeout(applyServerFilters, 300);
	}
</script>

<div class="px-3 sm:px-4 lg:px-6">
	<div class="mb-4">
		<HistoryFilters
			services={data.services}
			bind:selectedTypes
			bind:searchQuery
			bind:selectedService
			bind:viewMode
			onfilter={onFilterChange}
		/>
	</div>

	{#if viewMode === 'feed'}
		<HistoryFeed events={filteredEvents} />
	{:else}
		<HistoryTable events={filteredEvents} services={data.services} />
	{/if}

	{#if hasMore}
		<div class="mt-6 flex justify-center">
			<button
				onclick={loadMore}
				disabled={loading}
				class="rounded-lg bg-white/[0.04] px-6 py-2 text-xs font-medium text-muted transition-colors hover:bg-white/[0.08] disabled:opacity-50"
			>
				{loading ? 'Loading...' : 'Load More'}
			</button>
		</div>
	{/if}
</div>
