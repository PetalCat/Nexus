<script lang="ts">
	import type { FriendProfile } from '$lib/types/media-ui';
	import { Check } from 'lucide-svelte';
	import FriendAvatar from './FriendAvatar.svelte';

	interface Props {
		friends: FriendProfile[];
		selected?: string[];
		onselect?: (ids: string[]) => void;
	}

	let { friends, selected = $bindable([]), onselect }: Props = $props();

	function toggle(id: string) {
		if (selected.includes(id)) {
			selected = selected.filter((s) => s !== id);
		} else {
			selected = [...selected, id];
		}
		onselect?.(selected);
	}
</script>

<div class="space-y-0.5">
	{#each friends as friend (friend.id)}
		{@const isSelected = selected.includes(friend.id)}
		<button
			onclick={() => toggle(friend.id)}
			class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors
				{isSelected ? 'bg-steel/10' : 'hover:bg-cream/[0.04]'}"
		>
			<FriendAvatar
				src={friend.avatar}
				name={friend.displayName}
				status={friend.status}
				size="sm"
			/>
			<span class="flex-1 truncate text-sm text-cream/80">{friend.displayName}</span>
			{#if isSelected}
				<Check size={14} strokeWidth={2} class="text-steel-light" />
			{/if}
		</button>
	{/each}

	{#if friends.length === 0}
		<p class="px-3 py-4 text-center text-xs text-faint">No friends available</p>
	{/if}
</div>
