<script lang="ts">
	import {
		Home,
		Film,
		Tv,
		Music,
		BookOpen,
		Gamepad2,
		Radio,
		PlaySquare,
		Users,
		Plus,
		Activity,
		Settings,
		ChevronsLeft,
		ChevronsRight,
		X,
		Shield,
		Bookmark,
		FolderOpen,
		Share2
	} from 'lucide-svelte';

	interface NavItem {
		id: string;
		label: string;
		href: string;
	}

	interface Props {
		activeId?: string;
		collapsed?: boolean;
		mobileOpen?: boolean;
		pendingRequests?: number;
		unseenShares?: number;
		isAdmin?: boolean;
	}

	let {
		activeId = 'home',
		collapsed = $bindable(false),
		mobileOpen = $bindable(false),
		pendingRequests = 0,
		unseenShares = 0,
		isAdmin = false
	}: Props = $props();

	const navItems: NavItem[] = [
		{ id: 'home', label: 'Home', href: '/' },
		{ id: 'movies', label: 'Movies', href: '/movies' },
		{ id: 'shows', label: 'TV Shows', href: '/shows' },
		{ id: 'music', label: 'Music', href: '/music' },
		{ id: 'books', label: 'Books', href: '/books' },
		{ id: 'games', label: 'Games', href: '/games' },
		{ id: 'live', label: 'Live TV', href: '/live' },
		{ id: 'videos', label: 'Videos', href: '/videos' },
		{ id: 'friends', label: 'Friends', href: '/friends' }
	];

	const secondaryNavItems: NavItem[] = [
		{ id: 'requests', label: 'Requests', href: '/requests' },
		{ id: 'activity', label: 'Activity', href: '/activity' },
		{ id: 'settings', label: 'Settings', href: '/settings' }
	];

	const libraryNavItems: NavItem[] = [
		{ id: 'watchlist', label: 'Watchlist', href: '/library/watchlist' },
		{ id: 'collections', label: 'Collections', href: '/library/collections' },
		{ id: 'shared', label: 'Shared', href: '/library/shared' }
	];

	const iconMap: Record<string, typeof Home> = {
		home: Home,
		movies: Film,
		shows: Tv,
		music: Music,
		books: BookOpen,
		games: Gamepad2,
		live: Radio,
		videos: PlaySquare,
		friends: Users,
		watchlist: Bookmark,
		collections: FolderOpen,
		shared: Share2,
		requests: Plus,
		activity: Activity,
		settings: Settings,
		admin: Shield
	};

	function getIcon(id: string) {
		return iconMap[id] ?? Home;
	}

	function closeMobile() {
		mobileOpen = false;
	}
</script>

<!-- Mobile backdrop -->
{#if mobileOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden"
		onclick={closeMobile}
		onkeydown={(e) => e.key === 'Escape' && closeMobile()}
		role="button"
		tabindex="-1"
		aria-label="Close navigation"
	></div>
{/if}

<!-- Sidebar -->
<aside
	class="group/sidebar fixed top-0 z-50 flex h-screen flex-col transition-all duration-500
		lg:sticky lg:z-40
		{collapsed ? 'lg:w-[68px]' : 'lg:w-60'}
		{mobileOpen ? 'left-0 w-72' : '-left-72 w-72 lg:left-0'}"
	style="background: rgba(13, 11, 10, 0.92); backdrop-filter: blur(24px) saturate(1.5); -webkit-backdrop-filter: blur(24px) saturate(1.5); border-right: 1px solid rgba(240, 235, 227, 0.05);"
>
	<!-- Logo -->
	<div class="flex items-center justify-between px-5 pt-7 pb-1">
		{#if !collapsed || mobileOpen}
			<a href="/" class="group/logo font-display text-[22px] font-bold tracking-[0.02em] transition-colors duration-300" aria-label="Nexus home" onclick={closeMobile}>
				<span class="font-black italic text-accent group-hover/logo:text-accent-light">N</span><span class="text-cream/85 group-hover/logo:text-cream">exus</span>
			</a>
		{:else}
			<a href="/" class="flex items-center justify-center" aria-label="Nexus home">
				<svg width="22" height="22" viewBox="-85 -754 1058 828" fill="none">
					<g transform="scale(1,-1)"><path d="M543 -5 275 483Q275 483 277.0 501.0Q279 519 281.0 542.5Q283 566 285.0 584.0Q287 602 287 602Q295 639 292.5 656.5Q290 674 272.5 680.5Q255 687 216 688L221 708Q237 707 260.5 706.0Q284 705 310 705Q357 705 391 708L615 272Q615 272 611.5 252.0Q608 232 602.0 200.5Q596 169 590.0 133.5Q584 98 578.0 66.5Q572 35 568.5 15.0Q565 -5 565 -5ZM851 737Q826 737 804.0 721.0Q782 705 766 682Q720 614 672.0 443.0Q624 272 565 -5L551 23Q566 90 583.0 167.5Q600 245 619.5 323.0Q639 401 659.5 472.0Q680 543 702.5 599.5Q725 656 748 690Q767 717 793.0 735.5Q819 754 856 754Q909 754 941.0 723.0Q973 692 973 647Q973 599 940.5 570.5Q908 542 861 542Q821 542 796.5 561.5Q772 581 772 616Q772 661 802.0 691.5Q832 722 876 729Q872 733 865.5 735.0Q859 737 851 737ZM37 -57Q65 -57 86.0 -41.5Q107 -26 123 -1Q152 45 181.5 143.0Q211 241 241.5 380.0Q272 519 303 685L320 664Q304 582 286.5 497.5Q269 413 251.0 332.5Q233 252 214.0 183.0Q195 114 176.0 63.5Q157 13 139 -11Q121 -35 96.5 -54.5Q72 -74 32 -74Q-21 -74 -53.0 -43.0Q-85 -12 -85 33Q-85 81 -52.0 109.5Q-19 138 27 138Q68 138 92.0 118.5Q116 99 116 64Q116 19 86.0 -11.0Q56 -41 12 -49Q16 -53 22.5 -55.0Q29 -57 37 -57Z" fill="currentColor" class="text-accent"/></g>
				</svg>
			</a>
		{/if}

		<!-- Mobile close button -->
		<button
			class="rounded-lg p-1.5 text-faint transition-colors hover:text-cream lg:hidden"
			onclick={closeMobile}
			aria-label="Close navigation"
		>
			<X size={20} strokeWidth={1.5} />
		</button>
	</div>

	<!-- Primary Nav -->
	<nav class="mt-6 flex-1 space-y-0.5 overflow-y-auto px-2.5" aria-label="Main navigation">
		<!-- Home -->
		{#each [navItems[0]] as homeItem (homeItem.id)}
			{@const HomeIcon = getIcon(homeItem.id)}
			{@const homeActive = homeItem.id === activeId}
			<a
				href={homeItem.href}
				class="group/item relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-[13px] font-medium transition-all duration-300
					{homeActive
					? 'bg-accent/[0.08] text-cream'
					: 'text-muted hover:bg-cream/[0.03] hover:text-cream'}"
				aria-current={homeActive ? 'page' : undefined}
				onclick={closeMobile}
			>
				{#if homeActive}
					<div
						class="absolute left-0 top-1/2 h-6 w-[2.5px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_8px_rgba(212,162,83,0.4)]"
						aria-hidden="true"
					></div>
				{/if}
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-300
					{homeActive
					? 'bg-accent/15 text-accent'
					: 'text-muted group-hover/item:bg-cream/[0.04] group-hover/item:text-cream'}"
				>
					<HomeIcon size={17} strokeWidth={homeActive ? 2 : 1.5} />
				</div>
				{#if !collapsed || mobileOpen}
					<span class="truncate">{homeItem.label}</span>
				{/if}
			</a>
		{/each}

		<!-- Library section label -->
		{#if !collapsed || mobileOpen}
			<p class="!mt-5 !mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-faint/50">Library</p>
		{:else}
			<div class="!my-3 mx-3 h-px bg-cream/[0.04]" aria-hidden="true"></div>
		{/if}

		{#each navItems.slice(1) as item (item.id)}
			{@const Icon = getIcon(item.id)}
			{@const active = item.id === activeId}
			<a
				href={item.href}
				class="group/item relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-[13px] font-medium transition-all duration-300
					{active
					? 'bg-accent/[0.08] text-cream'
					: 'text-muted hover:bg-cream/[0.03] hover:text-cream'}"
				aria-current={active ? 'page' : undefined}
				onclick={closeMobile}
			>
				{#if active}
					<div
						class="absolute left-0 top-1/2 h-6 w-[2.5px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_8px_rgba(212,162,83,0.4)]"
						aria-hidden="true"
					></div>
				{/if}

				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-300
					{active
					? 'bg-accent/15 text-accent'
					: 'text-muted group-hover/item:bg-cream/[0.04] group-hover/item:text-cream'}"
				>
					<Icon size={17} strokeWidth={active ? 2 : 1.5} />
				</div>

				{#if !collapsed || mobileOpen}
					<span class="truncate">{item.label}</span>
					{#if item.id === 'live'}
						<span class="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-warm" aria-hidden="true"></span>
					{/if}
				{/if}
			</a>
		{/each}

		<!-- My Library section label -->
		{#if !collapsed || mobileOpen}
			<p class="!mt-5 !mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-faint/50">My Library</p>
		{:else}
			<div class="!my-3 mx-3 h-px bg-cream/[0.04]" aria-hidden="true"></div>
		{/if}

		{#each libraryNavItems as item (item.id)}
			{@const Icon = getIcon(item.id)}
			{@const active = item.id === activeId}
			<a
				href={item.href}
				class="group/item relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-[13px] font-medium transition-all duration-300
					{active
					? 'bg-accent/[0.08] text-cream'
					: 'text-muted hover:bg-cream/[0.03] hover:text-cream'}"
				aria-current={active ? 'page' : undefined}
				onclick={closeMobile}
			>
				{#if active}
					<div
						class="absolute left-0 top-1/2 h-6 w-[2.5px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_8px_rgba(212,162,83,0.4)]"
						aria-hidden="true"
					></div>
				{/if}

				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-300
					{active
					? 'bg-accent/15 text-accent'
					: 'text-muted group-hover/item:bg-cream/[0.04] group-hover/item:text-cream'}"
				>
					<Icon size={17} strokeWidth={active ? 2 : 1.5} />
				</div>

				{#if !collapsed || mobileOpen}
					<span class="truncate">{item.label}</span>
					{#if item.id === 'shared' && unseenShares > 0}
						<span class="ml-auto rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
							{unseenShares > 99 ? '99+' : unseenShares}
						</span>
					{/if}
				{/if}
			</a>
		{/each}

		<!-- System section label -->
		{#if !collapsed || mobileOpen}
			<p class="!mt-5 !mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-faint/50">System</p>
		{:else}
			<div class="!my-3 mx-3 h-px bg-cream/[0.04]" aria-hidden="true"></div>
		{/if}

		{#each secondaryNavItems as item (item.id)}
			{@const Icon = getIcon(item.id)}
			{@const active = item.id === activeId}
			<a
				href={item.href}
				class="group/item relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-[13px] font-medium transition-all duration-300
					{active
					? 'bg-accent/[0.08] text-cream'
					: 'text-faint hover:bg-cream/[0.03] hover:text-muted'}"
				onclick={closeMobile}
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-300
					{active
					? 'bg-accent/15 text-accent'
					: 'text-faint group-hover/item:text-muted'}"
				>
					<Icon size={17} strokeWidth={1.5} />
				</div>
				{#if !collapsed || mobileOpen}
					<span class="truncate">{item.label}</span>
					{#if item.id === 'requests' && pendingRequests > 0}
						<span class="ml-auto rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
							{pendingRequests > 99 ? '99+' : pendingRequests}
						</span>
					{/if}
				{/if}
			</a>
		{/each}

		<!-- Admin link -->
		{#if isAdmin}
			{@const adminActive = activeId === 'admin'}
			<a
				href="/admin"
				class="group/item relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-[13px] font-medium transition-all duration-300
					{adminActive
					? 'bg-accent/[0.08] text-cream'
					: 'text-faint hover:bg-cream/[0.03] hover:text-muted'}"
				onclick={closeMobile}
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-300
					{adminActive
					? 'bg-accent/15 text-accent'
					: 'text-faint group-hover/item:text-muted'}"
				>
					<Shield size={17} strokeWidth={1.5} />
				</div>
				{#if !collapsed || mobileOpen}
					<span class="truncate">Admin</span>
				{/if}
			</a>
		{/if}
	</nav>

	<!-- Collapse toggle — desktop only -->
	<div class="hidden border-t border-cream/[0.04] p-2.5 lg:block">
		<button
			onclick={() => (collapsed = !collapsed)}
			class="flex w-full items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-faint transition-all duration-300 hover:bg-cream/[0.03] hover:text-muted"
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
		>
			{#if collapsed}
				<ChevronsRight size={16} strokeWidth={1.5} />
			{:else}
				<ChevronsLeft size={16} strokeWidth={1.5} />
				<span class="flex-1 text-left font-body text-xs">Collapse</span>
			{/if}
		</button>
	</div>
</aside>
