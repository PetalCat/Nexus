<script lang="ts">
	import type { MediaEvent } from '$lib/db/schema';

	interface Props {
		events: MediaEvent[];
		services: { id: string; name: string }[];
	}

	let { events, services }: Props = $props();

	const serviceNameMap = $derived(new Map(services.map((s) => [s.id, s.name])));

	let sortCol = $state<'title' | 'type' | 'duration' | 'service' | 'date'>('date');
	let sortDir = $state<'asc' | 'desc'>('desc');

	function toggleSort(col: typeof sortCol) {
		if (sortCol === col) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortCol = col;
			sortDir = 'desc';
		}
	}

	const sorted = $derived.by(() => {
		const copy = [...events];
		const dir = sortDir === 'asc' ? 1 : -1;
		copy.sort((a, b) => {
			switch (sortCol) {
				case 'title': return dir * ((a.mediaTitle ?? '').localeCompare(b.mediaTitle ?? ''));
				case 'type': return dir * (a.mediaType.localeCompare(b.mediaType));
				case 'duration': return dir * ((a.playDurationMs ?? 0) - (b.playDurationMs ?? 0));
				case 'service': return dir * (a.serviceId.localeCompare(b.serviceId));
				case 'date': return dir * (a.timestamp - b.timestamp);
				default: return 0;
			}
		});
		return copy;
	});

	function formatDuration(ms: number | null): string {
		if (!ms || ms <= 0) return '—';
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${mins}m`;
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	}

	function sortIndicator(col: string): string {
		if (sortCol !== col) return '';
		return sortDir === 'asc' ? ' ↑' : ' ↓';
	}
</script>

<div class="overflow-x-auto">
	{#if events.length === 0}
		<p class="py-12 text-center text-sm text-faint">No history yet.</p>
	{:else}
		<table class="w-full text-xs">
			<thead>
				<tr class="border-b border-cream/[0.06] text-left text-[10px] uppercase tracking-wide text-faint">
					<th class="cursor-pointer px-3 py-2" onclick={() => toggleSort('title')}>Title{sortIndicator('title')}</th>
					<th class="cursor-pointer px-3 py-2" onclick={() => toggleSort('type')}>Type{sortIndicator('type')}</th>
					<th class="cursor-pointer px-3 py-2" onclick={() => toggleSort('duration')}>Duration{sortIndicator('duration')}</th>
					<th class="cursor-pointer px-3 py-2" onclick={() => toggleSort('service')}>Service{sortIndicator('service')}</th>
					<th class="cursor-pointer px-3 py-2" onclick={() => toggleSort('date')}>Date{sortIndicator('date')}</th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as event (event.id)}
					<tr class="border-b border-cream/[0.03] hover:bg-white/[0.02]">
						<td class="max-w-[200px] truncate px-3 py-2 text-cream/80">{event.mediaTitle ?? 'Untitled'}</td>
						<td class="px-3 py-2 capitalize text-muted">{event.mediaType}</td>
						<td class="px-3 py-2 text-muted">{formatDuration(event.playDurationMs)}</td>
						<td class="px-3 py-2 text-muted">{serviceNameMap.get(event.serviceId) ?? event.serviceId}</td>
						<td class="px-3 py-2 text-faint">{formatDate(event.timestamp)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
