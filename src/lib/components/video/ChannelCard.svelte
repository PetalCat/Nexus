<script lang="ts">
	import { CheckCircle, Bell, BellOff } from 'lucide-svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { lowResImageUrl } from '$lib/image-hint';

	interface Props {
		authorId: string;
		author: string;
		authorVerified?: boolean;
		subCountText?: string;
		thumbnail?: string;
		isSubscribed: boolean;
		hasLinkedAccount: boolean;
		serviceId: string;
		notifyEnabled?: boolean;
	}

	let {
		authorId,
		author,
		authorVerified = false,
		subCountText = '',
		thumbnail = '',
		isSubscribed,
		hasLinkedAccount,
		serviceId,
		notifyEnabled = false
	}: Props = $props();

	let subscribed = $state(false);
	let toggling = $state(false);
	let notify = $state(false);
	let togglingNotify = $state(false);
	let imgLoaded = $state(false);

	const lowResSrc = $derived(lowResImageUrl(thumbnail));

	$effect(() => {
		subscribed = isSubscribed;
	});
	$effect(() => {
		notify = notifyEnabled;
	});

	async function toggleSubscription() {
		if (toggling) return;
		toggling = true;
		const method = subscribed ? 'DELETE' : 'POST';
		try {
			const res = await fetch(`/api/video/subscriptions/${authorId}`, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId })
			});
			if (res.ok) {
				subscribed = !subscribed;
				if (!subscribed) notify = false;
			}
		} catch { toast.error('Failed to update subscription'); } finally {
			toggling = false;
		}
	}

	async function toggleNotify() {
		if (togglingNotify) return;
		togglingNotify = true;
		const method = notify ? 'DELETE' : 'POST';
		try {
			const res = await fetch(`/api/video/subscriptions/${authorId}/notifications`, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ channelName: author })
			});
			if (res.ok) notify = !notify;
		} catch { toast.error('Failed to update notifications'); } finally {
			togglingNotify = false;
		}
	}
</script>

<div class="flex items-center gap-3 py-3">
	<a href="/videos/channel/{authorId}" class="relative flex-shrink-0">
		{#if thumbnail}
			<div class="relative h-12 w-12 overflow-hidden rounded-full">
				{#if lowResSrc && !imgLoaded}
					<img
						src={lowResSrc}
						alt=""
						aria-hidden="true"
						class="absolute inset-0 h-full w-full object-cover blur-lg scale-110"
						loading="lazy"
						decoding="async"
					/>
				{/if}
				<img
					src={thumbnail}
					alt={author}
					class="relative h-full w-full object-cover"
					loading="lazy"
					decoding="async"
					onload={() => (imgLoaded = true)}
				/>
			</div>
		{:else}
			<div class="flex h-12 w-12 items-center justify-center rounded-full bg-nexus-surface text-sm font-bold text-cream/40">
				{author.charAt(0).toUpperCase()}
			</div>
		{/if}
	</a>

	<div class="min-w-0 flex-1">
		<a href="/videos/channel/{authorId}" class="flex items-center gap-1.5 hover:underline">
			<span class="truncate text-sm font-medium text-cream">{author}</span>
			{#if authorVerified}
				<CheckCircle size={16} class="flex-shrink-0 text-accent" />
			{/if}
		</a>
		{#if subCountText}
			<p class="text-xs text-muted">{subCountText}</p>
		{/if}
	</div>

	{#if hasLinkedAccount}
		<div class="flex flex-shrink-0 items-center gap-1.5">
			{#if subscribed}
				<button
					class="rounded-full p-2 transition-colors {notify
						? 'bg-warm/15 text-warm hover:bg-warm/25'
						: 'text-muted/50 hover:bg-raised hover:text-cream'}"
					disabled={togglingNotify}
					onclick={toggleNotify}
					title={notify ? 'Turn off notifications' : 'Get notified of new uploads'}
				>
					{#if notify}
						<Bell size={16} fill="currentColor" />
					{:else}
						<BellOff size={16} />
					{/if}
				</button>
			{/if}
			<button
				class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors {subscribed
					? 'bg-transparent text-muted border border-cream/10 hover:border-cream/20'
					: 'bg-accent text-nexus-void hover:bg-accent/90'}"
				disabled={toggling}
				onclick={toggleSubscription}
			>
				{subscribed ? 'Subscribed' : 'Subscribe'}
			</button>
		</div>
	{/if}
</div>
