<script lang="ts">
	import type { FriendProfile } from '$lib/types/media-ui';
	import FriendAvatar from './FriendAvatar.svelte';

	interface Props {
		friend: FriendProfile;
	}

	let { friend }: Props = $props();

	const verbMap: Record<string, string> = {
		watched: 'Watched',
		playing: 'Playing',
		listening: 'Listening to',
		reading: 'Reading',
		finished: 'Finished',
		rated: 'Rated',
		shared: 'Shared',
		joined_session: 'In a session for'
	};

	const statusLabels: Record<string, string> = {
		online: 'Online',
		away: 'Away',
		dnd: 'Do Not Disturb',
		offline: 'Offline',
		ghost: 'Ghost'
	};

	const subtitle = $derived(
		friend.customStatus
			? friend.customStatus
			: friend.currentActivity
				? `${verbMap[friend.currentActivity.type] ?? ''} ${friend.currentActivity.mediaTitle}`
				: statusLabels[friend.status]
	);
</script>

<a
	href="/friends/{friend.id}"
	class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-cream/[0.04]"
>
	<FriendAvatar
		src={friend.avatar}
		name={friend.displayName}
		status={friend.status}
		size="md"
	/>
	<div class="min-w-0 flex-1">
		<p class="truncate text-sm font-medium text-cream">{friend.displayName}</p>
		<p class="mt-0.5 truncate text-xs text-muted">{subtitle}</p>
	</div>
</a>
