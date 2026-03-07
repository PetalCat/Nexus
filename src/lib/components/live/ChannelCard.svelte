<script lang="ts">
	import type { UnifiedMedia, ChannelCategory } from '$lib/types/media-ui';
	import { CHANNEL_CATEGORY_COLORS } from '$lib/types/media-ui';
	import { getCurrentProgram } from '$lib/liveHelpers';

	interface Props {
		channel: UnifiedMedia;
		schedule?: any[];
		onclick?: () => void;
	}

	let { channel, schedule = [], onclick }: Props = $props();

	const category = $derived(channel.metadata.category as ChannelCategory);
	const categoryColor = $derived(CHANNEL_CATEGORY_COLORS[category] ?? '#a09890');
	const channelNumber = $derived(channel.metadata.channelNumber as number);
	const current = $derived(getCurrentProgram(schedule));
</script>

<button
	class="group relative flex shrink-0 items-center gap-2.5 overflow-hidden rounded-lg border border-cream/[0.06] bg-cream/[0.02] px-3 py-2 text-left transition-all duration-200 hover:border-cream/[0.12] hover:bg-cream/[0.05] active:scale-[0.98]"
	style="border-left: 3px solid {categoryColor}; min-width: 210px;"
	{onclick}
>
	<span
		class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[11px] font-bold"
		style="background: {categoryColor}22; color: {categoryColor};"
	>
		{channelNumber}
	</span>

	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-1.5">
			<span class="truncate text-xs font-semibold text-cream/90">{channel.title}</span>
			{#if current}
				<span class="text-cream/20">&middot;</span>
				<span class="truncate text-xs text-muted/80">{current.program.title}</span>
			{/if}
		</div>
	</div>

	<!-- Mini progress bar -->
	{#if current}
		<div class="absolute bottom-0 left-0 right-0 h-[2px] bg-cream/[0.04]">
			<div
				class="h-full transition-all duration-1000"
				style="width: {current.progress * 100}%; background: {categoryColor};"
			></div>
		</div>
	{/if}
</button>
