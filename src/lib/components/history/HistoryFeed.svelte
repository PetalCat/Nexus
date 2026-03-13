<script lang="ts">
	import type { MediaEvent } from '$lib/db/schema';

	interface Props {
		events: MediaEvent[];
	}

	let { events }: Props = $props();

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
		const groups: { label: string; date: string; events: MediaEvent[] }[] = [];
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

	function progressPct(pos: number | null, dur: number | null): string | null {
		if (!pos || !dur || dur <= 0) return null;
		return `${Math.max(0, Math.min(Math.round((pos / dur) * 100), 100))}%`;
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
						{@const progress = progressPct(event.positionTicks, event.durationTicks)}
						<a
							href="/media/{event.mediaType}/{event.serviceId}:{event.mediaId}"
							class="flex items-center gap-3 rounded-lg bg-white/[0.02] p-2.5 transition-colors hover:bg-white/[0.04]"
						>
							<div
								class="h-11 w-8 flex-shrink-0 rounded"
								style="background: {TYPE_COLORS[event.mediaType] ?? 'rgba(255,255,255,0.03)'};"
							></div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-xs font-medium text-cream/90">{event.mediaTitle ?? 'Untitled'}</p>
								<p class="text-[10px] text-faint">
									<span style="color: {TYPE_TEXT_COLORS[event.mediaType] ?? 'inherit'}">{event.mediaType}</span>
									{#if event.playDurationMs}· {formatDuration(event.playDurationMs)}{/if}
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
