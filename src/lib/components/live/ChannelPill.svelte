<script lang="ts">
	import type { VideoChannel } from '$lib/types/media-ui';

	interface Props {
		channel: VideoChannel;
		active?: boolean;
		onclick?: () => void;
	}

	let { channel, active = false, onclick }: Props = $props();

	let avatarError = $state(false);
	let hovered = $state(false);
</script>

<button
	class="flex flex-shrink-0 items-center gap-2.5 rounded-full px-4 py-2 transition-[background,border-color,box-shadow] duration-150"
	style="background: {active ? 'rgba(196, 92, 92, 0.12)' : hovered ? 'rgba(240, 235, 227, 0.06)' : 'rgba(240, 235, 227, 0.03)'};
		border: 1px solid {active ? 'rgba(196, 92, 92, 0.3)' : 'rgba(240, 235, 227, 0.06)'};
		box-shadow: {active ? '0 0 16px rgba(196, 92, 92, 0.08)' : 'none'};"
	onmouseenter={() => (hovered = true)}
	onmouseleave={() => (hovered = false)}
	{onclick}
>
	<div class="h-7 w-7 flex-shrink-0 overflow-hidden rounded-full bg-nexus-surface"
		style="ring: {active ? '2px solid rgba(196, 92, 92, 0.4)' : 'none'};">
		{#if !avatarError}
			<img
				src={channel.avatar}
				alt={channel.name}
				class="h-full w-full object-cover"
				loading="lazy"
				onerror={() => (avatarError = true)}
			/>
		{:else}
			<div class="flex h-full w-full items-center justify-center text-[11px] font-bold"
				style="color: {active ? 'rgba(216, 116, 116, 1)' : 'rgba(160, 152, 144, 0.8)'};">
				{channel.name[0]}
			</div>
		{/if}
	</div>
	<span class="whitespace-nowrap text-xs font-medium transition-colors duration-200"
		style="color: {active ? 'rgba(240, 235, 227, 0.95)' : hovered ? 'rgba(240, 235, 227, 0.8)' : 'rgba(160, 152, 144, 0.8)'};">
		{channel.name}
	</span>
</button>
