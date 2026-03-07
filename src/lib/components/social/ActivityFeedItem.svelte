<script lang="ts">
	import type { ActivityEvent } from '$lib/types/media-ui';
	import { getFriendById } from '$lib/stores/socialStore.svelte';
	import FriendAvatar from './FriendAvatar.svelte';

	interface Props {
		event: ActivityEvent;
	}

	let { event }: Props = $props();

	const friend = $derived(getFriendById(event.userId));

	const verbMap: Record<string, string> = {
		watched: 'watched',
		playing: 'is playing',
		listening: 'is listening to',
		reading: 'is reading',
		finished: 'finished',
		rated: 'rated',
		shared: 'shared',
		joined_session: 'joined a session for'
	};

	const verb = $derived(verbMap[event.type] ?? event.type);

	const timeAgo = $derived(() => {
		const now = Date.now();
		const then = new Date(event.timestamp).getTime();
		const diff = Math.floor((now - then) / 1000);
		if (diff < 60) return 'just now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	});
</script>

<div class="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-cream/[0.03]">
	{#if friend}
		<a href="/friends/{friend.id}" class="flex-shrink-0">
			<FriendAvatar src={friend.avatar} name={friend.displayName} status={friend.status} size="sm" />
		</a>
	{/if}

	<div class="min-w-0 flex-1">
		<p class="truncate text-sm text-cream/80">
			{#if friend}
				<a href="/friends/{friend.id}" class="font-medium text-cream hover:text-steel-light transition-colors">
					{friend.displayName}
				</a>
			{/if}
			<span class="text-muted">{verb}</span>
			<span class="font-medium text-cream/90">{event.mediaTitle}</span>
		</p>
		{#if event.detail}
			<p class="mt-0.5 truncate text-xs text-faint">{event.detail}</p>
		{/if}
		<p class="mt-0.5 text-[11px] text-faint/60">{timeAgo()}</p>
	</div>

	{#if event.mediaImage}
		<div class="hidden flex-shrink-0 sm:block">
			<img
				src={event.mediaImage}
				alt={event.mediaTitle}
				class="h-10 w-10 rounded object-cover"
				loading="lazy"
			/>
		</div>
	{/if}
</div>
