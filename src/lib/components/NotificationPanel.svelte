<script lang="ts">
	import {
		Bell,
		BellRing,
		Check,
		CheckCheck,
		Trash2,
		UserPlus,
		Share2,
		Play,
		MessageSquare,
		X,
		ExternalLink
	} from 'lucide-svelte';

	interface Notification {
		id: string;
		type: string;
		title: string;
		message?: string | null;
		icon?: string | null;
		href?: string | null;
		actorId?: string | null;
		actorName?: string | null;
		metadata?: Record<string, unknown> | null;
		read: boolean;
		createdAt: number;
	}

	interface Props {
		open: boolean;
		notifications: Notification[];
		unreadCount: number;
		onrefresh?: () => void;
	}

	let { open = $bindable(), notifications, unreadCount, onrefresh }: Props = $props();

	function timeAgo(ts: number): string {
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 30) return `${days}d ago`;
		return `${Math.floor(days / 30)}mo ago`;
	}

	function iconForType(type: string) {
		switch (type) {
			case 'friend_request':
			case 'friend_accept':
				return { component: UserPlus, color: 'text-steel' };
			case 'share_received':
				return { component: Share2, color: 'text-accent' };
			case 'session_invite':
				return { component: Play, color: 'text-accent-light' };
			case 'request_approved':
			case 'request_available':
				return { component: Check, color: 'text-steel' };
			case 'video_subscription':
				return { component: BellRing, color: 'text-warm' };
			case 'system':
			default:
				return { component: MessageSquare, color: 'text-muted' };
		}
	}

	function bgForType(type: string): string {
		switch (type) {
			case 'friend_request':
			case 'friend_accept':
				return 'bg-steel/15';
			case 'share_received':
				return 'bg-accent/15';
			case 'session_invite':
				return 'bg-accent-light/15';
			case 'request_approved':
			case 'request_available':
				return 'bg-steel/15';
			case 'video_subscription':
				return 'bg-warm/15';
			case 'system':
			default:
				return 'bg-muted/10';
		}
	}

	async function markRead(id: string) {
		await fetch(`/api/notifications/${id}`, { method: 'PATCH' });
		onrefresh?.();
	}

	async function markAllRead() {
		await fetch('/api/notifications', { method: 'PATCH' });
		onrefresh?.();
	}

	async function clearAll() {
		await fetch('/api/notifications', { method: 'DELETE' });
		onrefresh?.();
	}

	async function dismissNotification(id: string) {
		await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
		onrefresh?.();
	}

	// CANONICAL: session_invite actions — join existing session endpoint or
	// just dismiss on decline (no dedicated decline endpoint exists). (#35)
	async function acceptSessionInvite(notif: Notification, ev: Event) {
		ev.preventDefault();
		ev.stopPropagation();
		const sessionId = (notif.metadata as { sessionId?: string } | null)?.sessionId;
		if (!sessionId) return;
		try {
			await fetch(`/api/sessions/${sessionId}/join`, { method: 'POST' });
		} finally {
			await dismissNotification(notif.id);
		}
	}

	async function declineSessionInvite(notif: Notification, ev: Event) {
		ev.preventDefault();
		ev.stopPropagation();
		await dismissNotification(notif.id);
	}

	function handleItemClick(notif: Notification) {
		if (!notif.read) {
			markRead(notif.id);
		}
	}

	function closePanel() {
		open = false;
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-40"
		onclick={closePanel}
		onkeydown={(e) => e.key === 'Escape' && closePanel()}
		role="button"
		tabindex="-1"
		aria-label="Close notifications"
	></div>

	<!-- Panel -->
	<div
		class="absolute right-0 top-full z-50 mt-2 w-[360px] overflow-hidden rounded-xl border border-cream/[0.06] bg-raised shadow-2xl"
		style="animation: slideDown 0.2s ease-out;"
	>
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-cream/[0.06] px-4 py-3">
			<h3 class="font-display text-sm font-semibold text-cream">Notifications</h3>
			<div class="flex items-center gap-2">
				{#if unreadCount > 0}
					<button
						onclick={markAllRead}
						class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-cream"
						title="Mark all as read"
					>
						<CheckCheck size={14} />
						<span>Mark all read</span>
					</button>
				{/if}
				<button
					onclick={closePanel}
					class="rounded-lg p-1 text-muted transition-colors hover:bg-hover hover:text-cream"
					title="Close"
				>
					<X size={16} />
				</button>
			</div>
		</div>

		<!-- Notification List -->
		<div class="max-h-[400px] overflow-y-auto">
			{#if notifications.length === 0}
				<div class="flex flex-col items-center justify-center py-12 text-center">
					<Bell size={32} class="mb-3 text-faint" />
					<p class="text-sm text-muted">No notifications</p>
				</div>
			{:else}
				{#each notifications as notif (notif.id)}
					{@const iconInfo = iconForType(notif.type)}
					{@const bg = bgForType(notif.type)}
					{@const Tag = notif.href ? 'a' : 'div'}

					<svelte:element
						this={Tag}
						href={notif.href ?? undefined}
						class="group relative flex gap-3 border-b border-cream/[0.04] px-4 py-3 transition-colors hover:bg-hover {!notif.read ? 'bg-surface/40' : ''}"
						onclick={() => handleItemClick(notif)}
						role={notif.href ? undefined : 'button'}
						tabindex={notif.href ? undefined : 0}
					>
						<!-- Icon -->
						<div class="flex-shrink-0 pt-0.5">
							<div class="flex h-8 w-8 items-center justify-center rounded-full {bg}">
								<iconInfo.component size={15} class={iconInfo.color} />
							</div>
						</div>

						<!-- Content -->
						<div class="min-w-0 flex-1">
							<div class="flex items-start justify-between gap-2">
								<p class="text-sm leading-snug {!notif.read ? 'font-semibold text-cream' : 'text-cream/80'}">
									{notif.title}
								</p>
								<div class="flex flex-shrink-0 items-center gap-1.5">
									<span class="text-[11px] text-faint">{timeAgo(notif.createdAt)}</span>
									{#if !notif.read}
										<span class="h-1.5 w-1.5 rounded-full bg-accent"></span>
									{/if}
								</div>
							</div>
							{#if notif.message}
								<p class="mt-0.5 truncate text-xs text-muted">{notif.message}</p>
							{/if}

							{#if notif.type === 'session_invite'}
								<div class="mt-2 flex gap-2">
									<button
										onclick={(ev) => acceptSessionInvite(notif, ev)}
										class="flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1 text-xs font-medium text-accent-light transition-colors hover:bg-accent/30"
									>
										<Check size={12} />
										<span>Accept</span>
									</button>
									<button
										onclick={(ev) => declineSessionInvite(notif, ev)}
										class="flex items-center gap-1 rounded-md bg-cream/[0.06] px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-cream/[0.1] hover:text-cream"
									>
										<X size={12} />
										<span>Decline</span>
									</button>
								</div>
							{/if}
						</div>

						<!-- External link indicator -->
						{#if notif.href}
							<div class="flex-shrink-0 self-center opacity-0 transition-opacity group-hover:opacity-100">
								<ExternalLink size={12} class="text-faint" />
							</div>
						{/if}
					</svelte:element>
				{/each}
			{/if}
		</div>

		<!-- Footer -->
		{#if notifications.length > 0}
			<div class="border-t border-cream/[0.06] px-4 py-2.5">
				<button
					onclick={clearAll}
					class="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-warm"
				>
					<Trash2 size={13} />
					<span>Clear all notifications</span>
				</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
