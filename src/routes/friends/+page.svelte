<script lang="ts">
	import type { PageData } from './$types';
	import { Users, UserPlus, Search, UserX, Clock, Check, X } from 'lucide-svelte';
	import { toast } from '$lib/stores/toast.svelte';

	let { data }: { data: PageData } = $props();

	let searchQuery = $state('');
	let searchResults = $state<{ id: string; username: string; displayName: string }[]>([]);
	let searching = $state(false);
	let tab = $state<'friends' | 'requests' | 'blocked'>('friends');

	const onlineFriends = $derived(data.friends.filter((f) => data.onlineIds.has(f.userId)));
	const offlineFriends = $derived(data.friends.filter((f) => !data.onlineIds.has(f.userId)));

	async function searchUsers() {
		if (!searchQuery.trim()) { searchResults = []; return; }
		searching = true;
		try {
			const res = await fetch('/api/friends', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query: searchQuery })
			});
			const json = await res.json();
			searchResults = json.users ?? [];
		} finally {
			searching = false;
		}
	}

	async function sendRequest(userId: string) {
		try {
			const res = await fetch('/api/friends/requests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			if (res.ok) {
				searchResults = searchResults.filter((u) => u.id !== userId);
				toast.success('Friend request sent');
			} else {
				toast.error('Failed to send request');
			}
		} catch {
			toast.error('Failed to send request');
		}
	}

	async function respondRequest(requestId: string, action: 'accept' | 'reject') {
		try {
			const res = await fetch(`/api/friends/requests/${requestId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action })
			});
			if (res.ok) {
				toast.success(action === 'accept' ? 'Friend request accepted' : 'Request declined');
				location.reload();
			} else {
				toast.error('Failed to respond to request');
			}
		} catch {
			toast.error('Failed to respond to request');
		}
	}
</script>

<svelte:head>
	<title>Friends — Nexus</title>
</svelte:head>

<div class="flex flex-col gap-6 p-4 sm:p-6 lg:p-10">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="font-display text-2xl font-bold text-cream">Friends</h1>
			<p class="mt-1 text-sm text-muted">{data.friends.length} friend{data.friends.length === 1 ? '' : 's'}</p>
		</div>
	</div>

	<!-- Search to add friends -->
	<div class="flex gap-2">
		<div class="relative flex-1">
			<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
			<input
				bind:value={searchQuery}
				oninput={searchUsers}
				class="input pl-9"
				placeholder="Search users to add..."
			/>
		</div>
	</div>

	{#if searchResults.length > 0}
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-2">
			{#each searchResults as user}
				<div class="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-cream/[0.03]">
					<div>
						<p class="text-sm font-medium text-cream">{user.displayName}</p>
						<p class="text-xs text-muted">@{user.username}</p>
					</div>
					<button
						onclick={() => sendRequest(user.id)}
						class="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
					>
						<UserPlus size={14} />
						Add
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Tabs -->
	<div class="flex gap-1 rounded-lg bg-surface p-1">
		<button
			onclick={() => (tab = 'friends')}
			class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all {tab === 'friends' ? 'bg-raised text-cream' : 'text-muted hover:text-cream'}"
		>
			<Users size={14} />
			Friends
		</button>
		<button
			onclick={() => (tab = 'requests')}
			class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all {tab === 'requests' ? 'bg-raised text-cream' : 'text-muted hover:text-cream'}"
		>
			<Clock size={14} />
			Requests
			{#if data.requests.length > 0}
				<span class="rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold text-accent">{data.requests.length}</span>
			{/if}
		</button>
	</div>

	{#if tab === 'friends'}
		{#if data.friends.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-center">
				<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-muted">
					<Users size={28} strokeWidth={1.5} />
				</div>
				<p class="font-medium text-cream">No friends yet</p>
				<p class="mt-1 text-sm text-muted">Search for users above to add friends.</p>
			</div>
		{:else}
			<!-- Online -->
			{#if onlineFriends.length > 0}
				<div>
					<p class="mb-2 text-xs font-semibold uppercase tracking-widest text-faint/50">Online — {onlineFriends.length}</p>
					<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{#each onlineFriends as friend}
							<div class="flex items-center gap-3 rounded-xl border border-cream/[0.06] bg-raised px-4 py-3">
								<div class="relative">
									<div class="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
										{friend.displayName.slice(0, 1).toUpperCase()}
									</div>
									<span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-raised bg-steel"></span>
								</div>
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-cream">{friend.displayName}</p>
									<p class="truncate text-xs text-muted">@{friend.username}</p>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Offline -->
			{#if offlineFriends.length > 0}
				<div>
					<p class="mb-2 text-xs font-semibold uppercase tracking-widest text-faint/50">Offline — {offlineFriends.length}</p>
					<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{#each offlineFriends as friend}
							<div class="flex items-center gap-3 rounded-xl border border-cream/[0.06] bg-raised px-4 py-3 opacity-60">
								<div class="flex h-10 w-10 items-center justify-center rounded-full bg-cream/[0.06] text-sm font-semibold text-muted">
									{friend.displayName.slice(0, 1).toUpperCase()}
								</div>
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-cream">{friend.displayName}</p>
									<p class="truncate text-xs text-muted">@{friend.username}</p>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	{:else if tab === 'requests'}
		{#if data.requests.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-center">
				<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-muted">
					<UserPlus size={28} strokeWidth={1.5} />
				</div>
				<p class="font-medium text-cream">No pending requests</p>
				<p class="mt-1 text-sm text-muted">Friend requests you receive will appear here.</p>
			</div>
		{:else}
			<div class="grid gap-2">
				{#each data.requests as req}
					<div class="flex items-center justify-between rounded-xl border border-cream/[0.06] bg-raised px-4 py-3">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
								{req.fromDisplayName.slice(0, 1).toUpperCase()}
							</div>
							<div>
								<p class="text-sm font-medium text-cream">{req.fromDisplayName}</p>
								<p class="text-xs text-muted">@{req.fromUsername}</p>
							</div>
						</div>
						<div class="flex gap-1.5">
							<button
								onclick={() => respondRequest(req.id, 'accept')}
								class="flex items-center gap-1 rounded-lg bg-steel/15 px-3 py-1.5 text-xs font-medium text-steel-light transition-colors hover:bg-steel/25"
							>
								<Check size={14} />
								Accept
							</button>
							<button
								onclick={() => respondRequest(req.id, 'reject')}
								class="flex items-center gap-1 rounded-lg bg-warm/10 px-3 py-1.5 text-xs font-medium text-warm transition-colors hover:bg-warm/20"
							>
								<X size={14} />
								Decline
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
