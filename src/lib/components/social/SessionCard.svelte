<script lang="ts">
	import type { SocialSession, SessionType, SessionStatus } from '$lib/types/media-ui';
	import { getFriendById } from '$lib/stores/socialStore.svelte';
	import { Tv, Headphones, Gamepad2 } from 'lucide-svelte';
	import FriendAvatar from './FriendAvatar.svelte';

	interface Props {
		session: SocialSession;
		compact?: boolean;
	}

	let { session, compact = false }: Props = $props();

	const host = $derived(getFriendById(session.hostId));

	const typeIcons: Record<SessionType, typeof Tv> = {
		watch_party: Tv,
		listen_party: Headphones,
		netplay: Gamepad2,
		co_op: Gamepad2
	};

	const typeLabels: Record<SessionType, string> = {
		watch_party: 'Watch Party',
		listen_party: 'Listen Party',
		netplay: 'Net-Play',
		co_op: 'Co-Op'
	};

	const statusStyles: Record<SessionStatus, string> = {
		waiting: 'bg-accent/20 text-accent',
		active: 'bg-steel/20 text-steel-light',
		paused: 'bg-faint/20 text-faint'
	};

	const statusLabels: Record<SessionStatus, string> = {
		waiting: 'Waiting',
		active: 'Active',
		paused: 'Paused'
	};

	const TypeIcon = $derived(typeIcons[session.type]);
	const participantCount = $derived(session.participants.length);
</script>

<div class="group relative overflow-hidden rounded-xl border border-cream/[0.06] transition-colors hover:border-cream/[0.1]">
	{#if session.mediaImage}
		<div class="absolute inset-0 z-0">
			<img
				src={session.mediaImage}
				alt=""
				class="h-full w-full object-cover opacity-20 blur-2xl"
				aria-hidden="true"
			/>
			<div class="absolute inset-0 bg-nexus-surface/80 backdrop-blur-xl"></div>
		</div>
	{/if}

	<div class="relative z-10 {compact ? 'p-3' : 'p-4'}">
		<div class="flex items-center gap-2">
			<TypeIcon size={14} strokeWidth={1.5} class="text-cream/60" />
			<span class="text-xs font-medium text-cream/70">{typeLabels[session.type]}</span>
			<span class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium {statusStyles[session.status]}">
				{statusLabels[session.status]}
			</span>
		</div>

		<div class="mt-3 flex items-center gap-3">
			{#if session.mediaImage}
				<img
					src={session.mediaImage}
					alt={session.mediaTitle}
					class="h-12 w-12 flex-shrink-0 rounded-lg object-cover"
					loading="lazy"
				/>
			{/if}
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-medium text-cream">{session.mediaTitle}</p>
				{#if host}
					<p class="mt-0.5 text-xs text-muted">Hosted by {host.displayName}</p>
				{/if}
			</div>
		</div>

		<div class="mt-3 flex items-center justify-between">
			<div class="flex items-center">
				<div class="flex items-center">
					{#each session.participants.slice(0, 5) as participant, i (participant.userId)}
						{@const pFriend = getFriendById(participant.userId)}
						{#if pFriend}
							<div class="{i > 0 ? '-ml-2' : ''} relative z-[{5 - i}]">
								<FriendAvatar
									src={pFriend.avatar}
									name={pFriend.displayName}
									status={pFriend.status}
									size="sm"
									showStatus={false}
								/>
							</div>
						{/if}
					{/each}
				</div>
				<span class="ml-2 text-xs text-muted">
					{participantCount}/{session.maxParticipants}
				</span>
			</div>

			<button
				class="rounded-lg bg-steel/20 px-3 py-1.5 text-xs font-medium text-steel-light transition-colors hover:bg-steel/30"
			>
				Join
			</button>
		</div>
	</div>
</div>
