<script lang="ts">
	import { lowResImageUrl } from '$lib/image-hint';

	interface HistoryEvent {
		id: string;
		userId: string;
		serviceId: string;
		mediaId: string;
		mediaType: string;
		mediaTitle: string | null;
		timestamp: number;
		durationMs: number | null;
		mediaDurationMs: number | null;
		progress: number | null;
		completed: number | null;
	}

	interface Props {
		events: HistoryEvent[];
		serviceUrls?: Record<string, string>;
	}

	let { events, serviceUrls = {} }: Props = $props();

	let loadedPosters = $state<Record<string, boolean>>({});

	function posterUrl(event: HistoryEvent): string | null {
		if (!event.serviceId || !event.mediaId) return null;
		const path = `/Items/${event.mediaId}/Images/Primary?maxHeight=88&quality=80`;
		return `/api/media/image?service=${encodeURIComponent(event.serviceId)}&path=${encodeURIComponent(path)}`;
	}

	const TYPE_COLORS: Record<string, string> = {
		movie: 'rgba(212,162,83,0.15)',
		show: 'rgba(61,143,132,0.15)',
		episode: 'rgba(61,143,132,0.15)',
		book: 'rgba(196,92,92,0.15)',
		game: 'rgba(86,169,157,0.15)',
		music: 'rgba(232,188,106,0.15)',
		video: 'rgba(212,162,83,0.1)'
	};

	const TYPE_TEXT_COLORS: Record<string, string> = {
		movie: '#d4a253',
		show: '#3d8f84',
		episode: '#3d8f84',
		book: '#c45c5c',
		game: '#56a99d',
		music: '#e8bc6a'
	};

	const groupedByDay = $derived.by(() => {
		const groups: { label: string; date: string; events: HistoryEvent[] }[] = [];
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);

		const todayStr = today.toISOString().slice(0, 10);
		const yesterdayStr = yesterday.toISOString().slice(0, 10);

		for (const event of events) {
			const d = new Date(event.timestamp);
			const dateStr = d.toISOString().slice(0, 10);
			let label: string;
			if (dateStr === todayStr) label = 'Today';
			else if (dateStr === yesterdayStr) label = 'Yesterday';
			else label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

			const last = groups[groups.length - 1];
			if (last && last.date === dateStr) {
				last.events.push(event);
			} else {
				groups.push({ label, date: dateStr, events: [event] });
			}
		}
		return groups;
	});

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	}

	function formatDuration(ms: number | null): string {
		if (!ms || ms <= 0) return '';
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${mins}m`;
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

</script>

<div class="flex flex-col gap-4">
	{#if events.length === 0}
		<p class="py-12 text-center text-sm text-faint">No history yet. Start watching, reading, or playing something!</p>
	{:else}
		{#each groupedByDay as group (group.date)}
			<div>
				<p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{group.label}</p>
				<div class="flex flex-col gap-1.5">
					{#each group.events as event (event.id)}
						{@const progress = event.progress != null ? `${Math.round(event.progress * 100)}%` : null}
						{@const poster = posterUrl(event)}
						<a
							href="/media/{event.mediaType}/{event.serviceId}:{event.mediaId}"
							class="flex items-center gap-3 rounded-lg bg-cream/[0.02] p-2.5 transition-colors hover:bg-cream/[0.04]"
						>
							{#if poster}
								{@const lowResPoster = lowResImageUrl(poster)}
								<div
									class="relative h-11 w-8 flex-shrink-0 overflow-hidden rounded"
									style="background: {TYPE_COLORS[event.mediaType] ?? 'rgba(255,255,255,0.03)'};"
								>
									{#if lowResPoster && !loadedPosters[event.id]}
										<img
											src={lowResPoster}
											alt=""
											aria-hidden="true"
											class="absolute inset-0 h-full w-full object-cover blur-lg scale-110"
											loading="lazy"
											decoding="async"
										/>
									{/if}
									<img
										src={poster}
										alt=""
										class="relative h-full w-full object-cover"
										loading="lazy"
										decoding="async"
										onload={() => (loadedPosters = { ...loadedPosters, [event.id]: true })}
										onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
									/>
								</div>
							{:else}
								<div
									class="h-11 w-8 flex-shrink-0 rounded"
									style="background: {TYPE_COLORS[event.mediaType] ?? 'rgba(255,255,255,0.03)'};"
								></div>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="truncate text-xs font-medium text-cream/90">{event.mediaTitle ?? 'Untitled'}</p>
								<p class="text-[10px] text-faint">
									<span style="color: {TYPE_TEXT_COLORS[event.mediaType] ?? 'inherit'}">{event.mediaType}</span>
									{#if event.durationMs}· {formatDuration(event.durationMs)}{/if}
									{#if progress}· {progress}{/if}
								</p>
							</div>
							<span class="flex-shrink-0 text-[10px] text-faint">{formatTime(event.timestamp)}</span>
						</a>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>
