<script lang="ts">
	import type { UnifiedMedia, ChannelCategory } from '$lib/types/media-ui';
	import { CHANNEL_CATEGORY_COLORS } from '$lib/types/media-ui';
	import { getDaySchedule, formatTime } from '$lib/liveHelpers';
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';

	interface Props {
		channels: UnifiedMedia[];
		getChannelSchedule: (channelId: string) => any[];
	}

	let { channels, getChannelSchedule }: Props = $props();

	// 6-hour window: 2h past, 4h future
	const WINDOW_MINUTES = 360;
	const PAST_MINUTES = 120;
	const PX_PER_MINUTE = 3;
	const CHANNEL_COL_WIDTH = 170;
	const ROW_HEIGHT = 68;
	const HEADER_HEIGHT = 44;

	let scrollContainer: HTMLDivElement | undefined = $state();
	let now = $state(getMinuteOfDay());
	let timer: ReturnType<typeof setInterval>;

	function getMinuteOfDay(): number {
		const d = new Date();
		return d.getHours() * 60 + d.getMinutes();
	}

	const windowStart = $derived(now - PAST_MINUTES);
	const windowEnd = $derived(windowStart + WINDOW_MINUTES);
	const nowLineX = $derived(PAST_MINUTES * PX_PER_MINUTE);
	const totalWidth = $derived(WINDOW_MINUTES * PX_PER_MINUTE);

	// Half-hour markers
	const timeMarkers = $derived.by(() => {
		const markers: { minute: number; label: string; x: number; isHour: boolean }[] = [];
		const firstSlot = Math.ceil(windowStart / 30) * 30;
		for (let m = firstSlot; m <= windowEnd; m += 30) {
			markers.push({
				minute: m,
				label: formatTime(m),
				x: (m - windowStart) * PX_PER_MINUTE,
				isHour: m % 60 === 0
			});
		}
		return markers;
	});

	onMount(() => {
		if (scrollContainer) {
			const containerWidth = scrollContainer.clientWidth;
			const scrollTo = nowLineX - containerWidth / 3;
			scrollContainer.scrollLeft = Math.max(0, scrollTo);
		}
		timer = setInterval(() => {
			now = getMinuteOfDay();
		}, 60000);
	});

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	function getVisiblePrograms(channelId: string) {
		const schedule = getChannelSchedule(channelId);
		const entries = getDaySchedule(schedule);

		return entries
			.filter((entry) => entry.endMinute > windowStart && entry.startMinute < windowEnd)
			.map((entry) => {
				const visibleStart = Math.max(entry.startMinute, windowStart);
				const visibleEnd = Math.min(entry.endMinute, windowEnd);
				const x = (visibleStart - windowStart) * PX_PER_MINUTE;
				const width = (visibleEnd - visibleStart) * PX_PER_MINUTE;
				return { ...entry, x, width };
			});
	}

	// Tooltip
	interface TooltipData {
		title: string;
		description: string;
		genre: string;
		timeRange: string;
	}
	let hoveredProg = $state<TooltipData | null>(null);
	let tooltipPos = $state({ x: 0, y: 0 });

	function onProgEnter(e: MouseEvent, prog: ReturnType<typeof getVisiblePrograms>[number]) {
		hoveredProg = {
			title: prog.program.title,
			description: prog.program.description,
			genre: prog.program.genre ?? '',
			timeRange: `${prog.startTime} - ${prog.endTime}`
		};
		tooltipPos = { x: e.clientX, y: e.clientY };
	}

	function onProgMove(e: MouseEvent) {
		if (hoveredProg) {
			tooltipPos = { x: e.clientX, y: e.clientY };
		}
	}

	function onProgLeave() {
		hoveredProg = null;
	}
</script>

<div class="relative">
	<div class="overflow-hidden rounded-xl border border-cream/[0.06]">
		<div
			class="overflow-auto"
			style="max-height: min(75vh, 780px);"
			bind:this={scrollContainer}
		>
			<div style="min-width: {CHANNEL_COL_WIDTH + totalWidth}px;">
				<!-- Time header (sticky top) -->
				<div
					class="sticky top-0 z-20 flex border-b border-cream/[0.08]"
					style="height: {HEADER_HEIGHT}px;"
				>
					<!-- Corner cell -->
					<div
						class="sticky left-0 z-30 flex shrink-0 items-end border-r border-cream/[0.08] px-4 pb-2"
						style="width: {CHANNEL_COL_WIDTH}px; background: #141210;"
					>
						<span
							class="text-[10px] font-semibold uppercase tracking-widest text-cream/25"
							>Channel</span
						>
					</div>
					<!-- Time markers -->
					<div class="relative" style="width: {totalWidth}px; background: #141210;">
						{#each timeMarkers as marker}
							<div
								class="absolute top-0 flex h-full flex-col justify-end pb-2"
								style="left: {marker.x}px;"
							>
								<div
									class="mb-1 h-3 w-px {marker.isHour
										? 'bg-cream/[0.15]'
										: 'bg-cream/[0.06]'}"
								></div>
								<span
									class="ml-1 whitespace-nowrap {marker.isHour
										? 'text-[11px] font-medium text-cream/50'
										: 'text-[10px] text-cream/25'}"
								>
									{marker.label}
								</span>
							</div>
						{/each}

						<!-- Now indicator with time label -->
						<div
							class="absolute top-0 h-full"
							style="left: {nowLineX}px;"
						>
							<!-- Time badge -->
							<div
								class="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-warm px-2.5 py-0.5 text-[10px] font-bold text-cream shadow-[0_2px_10px_rgba(196,92,92,0.5)]"
							>
								{formatTime(now)}
							</div>
							<!-- Line below badge -->
							<div
								class="absolute bottom-0 left-0 w-[3px] -translate-x-[1px] bg-warm shadow-[0_0_12px_rgba(196,92,92,0.6)]"
								style="top: 24px;"
							></div>
						</div>
					</div>
				</div>

				<!-- Channel rows -->
				{#each channels as channel, i (channel.id)}
					{@const category = channel.metadata.category as ChannelCategory}
					{@const categoryColor = CHANNEL_CATEGORY_COLORS[category] ?? '#a09890'}
					{@const programs = getVisiblePrograms(channel.id)}
					{@const isOdd = i % 2 === 1}
					{@const hasCurrent = programs.some((p) => p.isCurrent)}

					<div
						class="flex border-b border-cream/[0.04] last:border-b-0"
						style="height: {ROW_HEIGHT}px;"
					>
						<!-- Channel info (sticky left) -->
						<button
							class="sticky left-0 z-10 flex shrink-0 items-center gap-2.5 border-r border-cream/[0.06] px-4 text-left transition-colors hover:brightness-110"
							style="width: {CHANNEL_COL_WIDTH}px; background: {isOdd
								? '#1a1816'
								: '#161412'}; border-left: 2px solid {categoryColor}50;"
							onclick={() => goto(`/live/${channel.id}`)}
						>
							<div class="min-w-0 flex-1">
								<span class="block truncate text-[13px] font-semibold text-cream/85"
									>{channel.title}</span
								>
								<span class="block text-[10px] text-cream/30"
									>Ch. {channel.metadata.channelNumber}</span
								>
							</div>
							{#if hasCurrent}
								<span class="relative flex h-1.5 w-1.5 shrink-0">
									<span
										class="absolute inline-flex h-full w-full animate-ping rounded-full bg-warm opacity-60"
									></span>
									<span
										class="relative inline-flex h-1.5 w-1.5 rounded-full bg-warm"
									></span>
								</span>
							{/if}
						</button>

						<!-- Programs timeline -->
						<div
							class="relative"
							style="width: {totalWidth}px; background: {hasCurrent
								? 'rgba(196,92,92,0.025)'
								: isOdd
									? 'rgba(240,235,227,0.012)'
									: 'transparent'};"
						>
							<!-- Gridlines -->
							{#each timeMarkers as marker}
								<div
									class="absolute inset-y-0 w-px {marker.isHour
										? 'bg-cream/[0.04]'
										: 'bg-cream/[0.015]'}"
									style="left: {marker.x}px;"
									aria-hidden="true"
								></div>
							{/each}

							<!-- Program blocks -->
							{#each programs as prog}
								<button
									class="absolute inset-y-[6px] flex items-center overflow-hidden rounded-md px-3 text-[12px] transition-all duration-150 cursor-pointer
										{prog.isCurrent
										? 'z-[2] font-semibold'
										: prog.isPast
											? 'opacity-20'
											: 'opacity-55 hover:opacity-80'}"
									style="left: {prog.x}px; width: {Math.max(
										prog.width - 3,
										0
									)}px; background: {prog.isCurrent
										? 'rgba(196,92,92,0.18)'
										: 'rgba(240,235,227,0.035)'}; border: 1px solid {prog.isCurrent
										? 'rgba(196,92,92,0.3)'
										: 'rgba(240,235,227,0.03)'};"
									onclick={() => goto(`/live/${channel.id}`)}
									onmouseenter={(e) => onProgEnter(e, prog)}
									onmousemove={onProgMove}
									onmouseleave={onProgLeave}
								>
									<span
										class="truncate {prog.isCurrent
											? 'text-cream'
											: 'text-cream/50'}"
									>
										{prog.program.title}
									</span>
								</button>
							{/each}

							<!-- Now line -->
							<div
								class="pointer-events-none absolute inset-y-0 z-[3]"
								style="left: {nowLineX}px;"
							>
								<div
									class="h-full w-[3px] -translate-x-[1px] bg-warm shadow-[0_0_12px_rgba(196,92,92,0.6)]"
								></div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<!-- Tooltip -->
	{#if hoveredProg}
		<div
			class="pointer-events-none fixed z-[100] w-60 rounded-lg border border-cream/[0.1] p-3 shadow-2xl"
			style="left: {tooltipPos.x + 16}px; top: {tooltipPos.y - 12}px; background: #2a2623;"
		>
			<p class="text-[13px] font-semibold text-cream">{hoveredProg.title}</p>
			<p class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-cream/60">
				{hoveredProg.description}
			</p>
			<div class="mt-2 flex items-center gap-2 text-[10px] text-cream/40">
				<span>{hoveredProg.timeRange}</span>
				{#if hoveredProg.genre}
					<span class="h-3 w-px bg-cream/[0.1]"></span>
					<span>{hoveredProg.genre}</span>
				{/if}
			</div>
		</div>
	{/if}
</div>
