<script lang="ts">
	import { Share2 } from 'lucide-svelte';
	import { social } from '$lib/stores/socialStore.svelte';
	import FriendSelector from './FriendSelector.svelte';

	interface Props {
		mediaId: string;
		mediaTitle: string;
	}

	let { mediaId, mediaTitle }: Props = $props();

	let open = $state(false);
	let selectedIds = $state<string[]>([]);

	function handleToggle() {
		open = !open;
		if (!open) selectedIds = [];
	}

	function handleSend() {
		open = false;
		selectedIds = [];
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.share-menu-container')) {
			open = false;
			selectedIds = [];
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="share-menu-container relative inline-block" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (open = false)} role="group">
	<button
		onclick={handleToggle}
		class="flex items-center gap-1.5 rounded-lg bg-cream/[0.04] px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-cream/[0.08] hover:text-cream"
	>
		<Share2 size={13} strokeWidth={1.5} />
		Share
	</button>

	{#if open}
		<div class="animate-fade-in absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-cream/[0.08] bg-nexus-raised p-3 shadow-xl">
			<p class="mb-2 text-xs font-medium text-cream/70">Share "{mediaTitle}"</p>

			<div class="max-h-48 overflow-y-auto">
				<FriendSelector friends={social.onlineFriends} bind:selected={selectedIds} />
			</div>

			{#if selectedIds.length > 0}
				<button
					onclick={handleSend}
					class="mt-2 w-full rounded-lg bg-steel/20 py-1.5 text-xs font-medium text-steel-light transition-colors hover:bg-steel/30"
				>
					Send to {selectedIds.length} friend{selectedIds.length > 1 ? 's' : ''}
				</button>
			{/if}
		</div>
	{/if}
</div>
