<script lang="ts">
	import type { SocialSession } from '$lib/types/media-ui';
	import { getFriendById } from '$lib/stores/socialStore.svelte';
	import { Mic, MicOff, Send, UserPlus } from 'lucide-svelte';
	import FriendAvatar from './FriendAvatar.svelte';

	interface Props {
		session: SocialSession;
	}

	let { session }: Props = $props();

	let messageText = $state('');

	const host = $derived(getFriendById(session.hostId));

	const statusLabel = $derived(
		session.status === 'active' ? 'Active' :
		session.status === 'waiting' ? 'Waiting' :
		'Paused'
	);

	const statusColor = $derived(
		session.status === 'active' ? 'text-steel-light' :
		session.status === 'waiting' ? 'text-accent' :
		'text-faint'
	);

	function handleSend() {
		if (!messageText.trim()) return;
		messageText = '';
	}
</script>

<div class="overflow-hidden rounded-xl border border-cream/[0.06] bg-nexus-raised/60">
	<div class="flex items-center justify-between border-b border-cream/[0.06] px-4 py-3">
		<div>
			<h3 class="font-display text-sm font-semibold text-cream">{session.mediaTitle}</h3>
			{#if host}
				<p class="mt-0.5 text-xs text-muted">Hosted by {host.displayName}</p>
			{/if}
		</div>
		<span class="text-xs font-medium {statusColor}">{statusLabel}</span>
	</div>

	<div class="border-b border-cream/[0.06] px-4 py-3">
		<p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">Participants</p>
		<div class="space-y-2">
			{#each session.participants as participant (participant.userId)}
				{@const pFriend = getFriendById(participant.userId)}
				{#if pFriend}
					<div class="flex items-center gap-2.5">
						<FriendAvatar
							src={pFriend.avatar}
							name={pFriend.displayName}
							status={pFriend.status}
							size="sm"
						/>
						<span class="flex-1 truncate text-sm text-cream/80">{pFriend.displayName}</span>
						{#if participant.role === 'host'}
							<span class="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">Host</span>
						{/if}
						{#if participant.voiceActive}
							<Mic size={13} strokeWidth={1.5} class="text-steel-light" />
						{:else}
							<MicOff size={13} strokeWidth={1.5} class="text-faint/40" />
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	</div>

	<div class="flex max-h-60 flex-col">
		<div class="flex-1 overflow-y-auto bg-nexus-deep/40 px-4 py-3">
			<div class="space-y-2">
				{#each session.messages as msg (msg.id)}
					{@const msgFriend = getFriendById(msg.userId)}
					<div class="flex items-start gap-2">
						<span class="flex-shrink-0 text-xs font-medium text-steel-light">
							{msgFriend?.displayName ?? 'Unknown'}
						</span>
						<p class="text-xs text-cream/70">{msg.text}</p>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div class="flex items-center gap-2 border-t border-cream/[0.06] px-4 py-3">
		<button
			class="flex items-center gap-1.5 rounded-lg bg-cream/[0.04] px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-cream/[0.08] hover:text-cream"
		>
			<UserPlus size={13} strokeWidth={1.5} />
			Invite
		</button>
		<div class="flex flex-1 items-center gap-2 rounded-lg bg-nexus-deep/60 px-3 py-1.5">
			<input
				type="text"
				bind:value={messageText}
				placeholder="Send a message..."
				class="flex-1 bg-transparent text-xs text-cream/80 placeholder:text-faint/40 outline-none"
				onkeydown={(e) => e.key === 'Enter' && handleSend()}
			/>
			<button
				onclick={handleSend}
				class="text-muted transition-colors hover:text-steel-light"
				disabled={!messageText.trim()}
			>
				<Send size={13} strokeWidth={1.5} />
			</button>
		</div>
	</div>
</div>
