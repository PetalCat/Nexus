<script lang="ts">
	import '../app.css';
	import NavSidebar from '$lib/components/NavSidebar.svelte';
	import NotificationPanel from '$lib/components/NotificationPanel.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { onNavigate, afterNavigate, invalidateAll } from '$app/navigation';
	import { initAnalytics, trackPageView, destroyAnalytics } from '$lib/stores/analytics';
	import { connectWs, disconnectWs, onMessage } from '$lib/stores/ws';
	import { setNavigating } from '$lib/transition';
	import { togglePalette } from '$lib/stores/commandPalette.svelte';
	import { Bell, Menu, User, Search } from 'lucide-svelte';
	import { browser } from '$app/environment';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	let notifOpen = $state(false);
	let notifList = $state<Array<{
		id: string; type: string; title: string; message?: string | null;
		icon?: string | null; href?: string | null; actorId?: string | null;
		actorName?: string | null; metadata?: Record<string, unknown> | null;
		read: boolean; createdAt: number;
	}>>([]);
	let unreadCount = $state(data.unreadNotifications ?? 0);
	let pendingRequests = $state(0);

	// Resolve streamed pending count (may be Promise or already resolved number)
	$effect(() => {
		const val = data.pendingRequests;
		if (val && typeof val === 'object' && 'then' in val) {
			(val as Promise<number>).then((n) => { pendingRequests = n; }).catch(() => {});
		} else {
			pendingRequests = (val as unknown as number) ?? 0;
		}
	});
	let notifLoaded = $state(false);

	async function fetchNotifications() {
		try {
			const res = await fetch('/api/notifications?limit=30');
			const json = await res.json();
			notifList = json.notifications ?? [];
			unreadCount = json.unreadCount ?? 0;
			notifLoaded = true;
		} catch { /* ignore */ }
	}

	function handleBellClick() {
		if (!notifLoaded) fetchNotifications();
		notifOpen = !notifOpen;
	}

	let unsubWs: (() => void) | null = null;
	let unsubRecovery: (() => void) | null = null;

	const noLayoutPaths = ['/setup', '/login', '/register', '/pending-approval', '/reset-password', '/books/read', '/play'];
	const noLayout = $derived(noLayoutPaths.some((p) => $page.url.pathname === p || $page.url.pathname.startsWith(p + '/')));

	let sidebarCollapsed = $state(false);
	let mobileOpen = $state(false);

	onMount(() => {
		initAnalytics();
		if (data.user) {
			connectWs();
			unsubWs = onMessage('notification:new', () => {
				// Re-fetch notifications when a new one arrives
				fetchNotifications();
			});
			// When backend services recover from an outage, reload all page data
			unsubRecovery = onMessage('services:recovered', () => {
				console.log('[Nexus] Backend service(s) recovered — refreshing data');
				invalidateAll();
			});
		}
	});
	onDestroy(() => {
		destroyAnalytics();
		disconnectWs();
		unsubWs?.();
		unsubRecovery?.();
	});
	afterNavigate(({ to }) => {
		if (to?.url) trackPageView(to.url.pathname);
		mobileOpen = false;
	});

	// View transition hook
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			setNavigating(true);
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
				setNavigating(false);
			});
		});
	});

	const activeId = $derived.by(() => {
		const path = $page.url.pathname;
		if (path === '/') return 'home';
		const segment = path.split('/')[1];
		const map: Record<string, string> = {
			movies: 'movies',
			shows: 'shows',
			music: 'music',
			books: 'books',
			games: 'games',
			live: 'live',
			videos: 'videos',
			friends: 'friends',
			requests: 'requests',
			activity: 'activity',
			settings: 'settings',
			admin: 'admin'
		};
		return map[segment] ?? 'home';
	});

	const scopeMap: Record<string, string> = {
		'/movies': 'movie',
		'/shows': 'show',
		'/music': 'music',
		'/books': 'book',
		'/games': 'game',
		'/videos': 'video'
	};
	const searchScope = $derived(scopeMap[$page.url.pathname]);

	const isMac = $derived(browser ? navigator.platform?.includes('Mac') : true);

	function handleGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			togglePalette(searchScope);
		}
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<svelte:head>
	<title>Nexus</title>
	<meta name="description" content="Your unified media platform" />
</svelte:head>

{#if noLayout}
	{@render children()}
{:else}
	<!-- Skip to content link for accessibility -->
	<a href="#main-content" class="skip-to-content">Skip to content</a>

	<div class="flex min-h-screen">
		<NavSidebar
			{activeId}
			bind:collapsed={sidebarCollapsed}
			bind:mobileOpen
			{pendingRequests}
			isAdmin={data.user?.isAdmin ?? false}
		/>

		<div class="flex min-w-0 flex-1 flex-col">
			<!-- Top bar — glass effect -->
			<header
				class="sticky top-0 z-30 flex items-center gap-3 border-b border-cream/[0.04] px-4 py-3 sm:px-6 lg:px-10"
				style="background: rgba(13, 11, 10, 0.85); backdrop-filter: blur(20px) saturate(1.3); -webkit-backdrop-filter: blur(20px) saturate(1.3);"
			>
				<!-- Mobile hamburger -->
				<button
					class="shrink-0 rounded-xl p-2 text-faint transition-colors hover:bg-cream/[0.04] hover:text-cream lg:hidden"
					onclick={() => (mobileOpen = true)}
					aria-label="Open navigation menu"
				>
					<Menu size={20} strokeWidth={1.5} />
				</button>

				<button
					onclick={() => togglePalette(searchScope)}
					class="flex h-8 w-full items-center gap-2 rounded-xl border border-cream/[0.06] bg-cream/[0.03] px-3 text-sm text-faint transition-colors hover:border-cream/[0.1] hover:bg-cream/[0.05] hover:text-muted sm:w-48"
				>
					<Search size={14} strokeWidth={1.5} />
					<span class="flex-1 text-left">Search...</span>
					<kbd class="hidden rounded border border-cream/[0.08] bg-cream/[0.03] px-1.5 py-0.5 font-mono text-[10px] leading-none text-faint sm:inline">
						{isMac ? '⌘' : 'Ctrl+'}K
					</kbd>
				</button>

				<!-- Right side actions -->
				<div class="ml-auto flex items-center gap-1.5 sm:gap-2">
					<div class="relative">
						<button
							class="relative rounded-xl p-2 text-faint transition-colors duration-200 hover:bg-cream/[0.04] hover:text-cream sm:p-2.5"
							aria-label="Notifications"
							onclick={handleBellClick}
						>
							<Bell size={18} strokeWidth={1.5} />
							{#if unreadCount > 0}
								<span class="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-void sm:right-1.5 sm:top-1.5">
									{unreadCount > 9 ? '9+' : unreadCount}
								</span>
							{/if}
						</button>
						<NotificationPanel
							bind:open={notifOpen}
							notifications={notifList}
							{unreadCount}
							onrefresh={fetchNotifications}
						/>
					</div>
					{#if data.user}
						<form method="POST" action="/api/auth/logout">
							<button
								type="submit"
								class="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 text-accent transition-all duration-200 hover:bg-accent/20 sm:h-9 sm:w-9"
								title="Sign out ({data.user.displayName})"
							>
								<span class="text-xs font-semibold">{data.user.displayName.slice(0, 1).toUpperCase()}</span>
							</button>
						</form>
					{:else}
						<a
							href="/login"
							class="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 text-accent transition-all duration-200 hover:bg-accent/20 sm:h-9 sm:w-9"
							aria-label="Sign in"
						>
							<User size={15} strokeWidth={2} />
						</a>
					{/if}
				</div>
			</header>

			<!-- Main content -->
			<main id="main-content" class="relative flex-1 overflow-x-hidden" tabindex="-1">
				{@render children()}
			</main>
		</div>
	</div>
{/if}

<CommandPalette />
