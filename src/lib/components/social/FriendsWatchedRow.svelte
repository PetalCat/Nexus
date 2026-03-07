<script lang="ts">
	import type { FriendProfile } from '$lib/types/media-ui';
	import FriendAvatar from './FriendAvatar.svelte';

	interface Props {
		friends: FriendProfile[];
		label?: string;
	}

	let { friends, label = 'Friends who watched this' }: Props = $props();

	const visible = $derived(friends.slice(0, 6));
	const remaining = $derived(friends.length - 6);
	const showNames = $derived(friends.length <= 3);
</script>

{#if friends.length > 0}
	<div>
		<p class="mb-2 text-xs font-medium text-muted">{label}</p>
		<div class="flex items-center">
			<div class="flex items-center">
				{#each visible as friend, i (friend.id)}
					<a
						href="/friends/{friend.id}"
						class="{i > 0 ? '-ml-2' : ''} relative z-[{6 - i}] transition-transform hover:z-10 hover:scale-110"
						title={friend.displayName}
					>
						<FriendAvatar
							src={friend.avatar}
							name={friend.displayName}
							status={friend.status}
							size="sm"
							showStatus={false}
						/>
					</a>
				{/each}
			</div>

			{#if remaining > 0}
				<span class="ml-2 text-xs text-faint">+{remaining} more</span>
			{/if}

			{#if showNames}
				<span class="ml-2 text-xs text-cream/60">
					{friends.map((f) => f.displayName.split(' ')[0]).join(', ')}
				</span>
			{/if}
		</div>
	</div>
{/if}
