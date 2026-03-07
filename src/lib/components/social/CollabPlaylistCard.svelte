<script lang="ts">
	import type { CollaborativePlaylist } from '$lib/types/media-ui';
	import { getFriendById } from '$lib/stores/socialStore.svelte';
	import { ListMusic, Music, Lock, Globe } from 'lucide-svelte';
	import FriendAvatar from './FriendAvatar.svelte';

	interface Props {
		playlist: CollaborativePlaylist;
	}

	let { playlist }: Props = $props();

	const isMusic = $derived(playlist.mediaType === 'music');
	const creator = $derived(getFriendById(playlist.createdBy));

	const collaboratorProfiles = $derived(
		playlist.collaborators
			.map((c) => ({ ...c, profile: getFriendById(c.userId) }))
			.filter((c): c is typeof c & { profile: NonNullable<typeof c.profile> } => c.profile != null)
	);

	const allContributors = $derived(
		creator
			? [{ profile: creator, role: 'owner' as const }, ...collaboratorProfiles.map((c) => ({ profile: c.profile, role: c.role }))]
			: collaboratorProfiles.map((c) => ({ profile: c.profile, role: c.role }))
	);

	const itemCount = $derived(isMusic ? playlist.trackIds.length : playlist.mediaIds.length);

	const updatedLabel = $derived(() => {
		const d = new Date(playlist.updatedAt);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	});

	const roleColors: Record<string, string> = {
		owner: 'bg-accent/15 text-accent',
		editor: 'bg-steel/15 text-steel-light',
		viewer: 'bg-cream/[0.08] text-faint'
	};
</script>

<div
	class="group rounded-xl border border-cream/[0.06] bg-nexus-surface/40 p-4 transition-all hover:border-cream/[0.12] hover:bg-nexus-surface/60"
>
	<div class="flex items-start gap-3">
		<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg {isMusic ? 'bg-accent/10' : 'bg-cream/[0.06]'}">
			{#if isMusic}
				<Music size={18} strokeWidth={1.5} class="text-accent/70" />
			{:else}
				<ListMusic size={18} strokeWidth={1.5} class="text-cream/50" />
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<h3 class="truncate font-display text-sm font-semibold text-cream">{playlist.name}</h3>
				{#if playlist.isPublic}
					<Globe size={11} strokeWidth={1.5} class="flex-shrink-0 text-faint" />
				{:else}
					<Lock size={11} strokeWidth={1.5} class="flex-shrink-0 text-faint" />
				{/if}
			</div>
			{#if playlist.description}
				<p class="mt-1 line-clamp-2 text-xs text-muted">{playlist.description}</p>
			{/if}
		</div>
	</div>

	<div class="mt-3 flex items-center justify-between">
		<div class="flex items-center">
			{#each allContributors.slice(0, 4) as contributor, i (contributor.profile.id)}
				<div class="relative {i > 0 ? '-ml-2' : ''}">
					<FriendAvatar
						src={contributor.profile.avatar}
						name={contributor.profile.displayName}
						size="sm"
						showStatus={false}
					/>
					{#if contributor.role === 'owner'}
						<div class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-1 ring-nexus-surface" title="Owner"></div>
					{/if}
				</div>
			{/each}
			{#if allContributors.length > 4}
				<span class="ml-1.5 text-[11px] text-faint">+{allContributors.length - 4}</span>
			{/if}
		</div>

		<div class="flex items-center gap-3 text-[11px] text-faint">
			<span>{itemCount} {isMusic ? 'track' : 'item'}{itemCount !== 1 ? 's' : ''}</span>
			<span>{updatedLabel()}</span>
		</div>
	</div>
</div>
