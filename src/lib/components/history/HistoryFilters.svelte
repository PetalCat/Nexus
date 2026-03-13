<script lang="ts">
	import { Search, List, LayoutGrid } from 'lucide-svelte';

	interface Props {
		services: { id: string; name: string; type: string }[];
		selectedTypes: string[];
		searchQuery: string;
		selectedService: string;
		viewMode: 'feed' | 'table';
		onfilter: () => void;
	}

	let {
		services,
		selectedTypes = $bindable([]),
		searchQuery = $bindable(''),
		selectedService = $bindable(''),
		viewMode = $bindable('feed'),
		onfilter
	}: Props = $props();

	const mediaTypes = [
		{ id: 'all', label: 'All' },
		{ id: 'movie', label: 'Movies' },
		{ id: 'show', label: 'Shows' },
		{ id: 'episode', label: 'Episodes' },
		{ id: 'book', label: 'Books' },
		{ id: 'game', label: 'Games' },
		{ id: 'music', label: 'Music' }
	];

	function toggleType(type: string) {
		if (type === 'all') {
			selectedTypes = [];
		} else {
			const idx = selectedTypes.indexOf(type);
			if (idx >= 0) {
				selectedTypes = selectedTypes.filter((t) => t !== type);
			} else {
				selectedTypes = [...selectedTypes, type];
			}
		}
		onfilter();
	}

	const isAllSelected = $derived(selectedTypes.length === 0);
</script>

<div class="flex flex-wrap items-center gap-3">
	<!-- Media type chips -->
	<div class="flex flex-wrap gap-1.5">
		{#each mediaTypes as mt (mt.id)}
			{@const active = mt.id === 'all' ? isAllSelected : selectedTypes.includes(mt.id)}
			<button
				onclick={() => toggleType(mt.id)}
				class="rounded-lg px-3 py-1.5 text-xs font-medium transition-all
					{active ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-muted hover:text-cream'}"
			>
				{mt.label}
			</button>
		{/each}
	</div>

	<!-- Search -->
	<div class="relative min-w-[140px] flex-1">
		<Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
		<input
			type="text"
			placeholder="Search titles..."
			bind:value={searchQuery}
			oninput={() => onfilter()}
			class="w-full rounded-lg border border-cream/[0.06] bg-raised py-1.5 pl-8 pr-3 text-xs text-cream placeholder:text-faint"
		/>
	</div>

	<!-- Service filter -->
	{#if services.length > 1}
		<select
			bind:value={selectedService}
			onchange={() => onfilter()}
			class="rounded-lg border border-cream/[0.06] bg-raised px-2.5 py-1.5 text-xs text-cream"
		>
			<option value="">All services</option>
			{#each services as svc (svc.id)}
				<option value={svc.id}>{svc.name}</option>
			{/each}
		</select>
	{/if}

	<!-- View toggle -->
	<div class="flex gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
		<button
			onclick={() => { viewMode = 'feed'; }}
			class="rounded-md p-1.5 transition-all {viewMode === 'feed' ? 'bg-accent/15 text-accent' : 'text-faint hover:text-cream'}"
			title="Feed view"
		>
			<LayoutGrid size={14} />
		</button>
		<button
			onclick={() => { viewMode = 'table'; }}
			class="rounded-md p-1.5 transition-all {viewMode === 'table' ? 'bg-accent/15 text-accent' : 'text-faint hover:text-cream'}"
			title="Table view"
		>
			<List size={14} />
		</button>
	</div>
</div>
