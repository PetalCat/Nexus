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
		Shield
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
		isAdmin?: boolean;
	}

	let {
		activeId = 'home',
		collapsed = $bindable(false),
		mobileOpen = $bindable(false),
		pendingRequests = 0,
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
			<a href="/" class="flex items-center justify-center font-display text-[22px] font-black italic text-accent transition-colors hover:text-accent-light" aria-label="Nexus home">
				N
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
		{#each [navItems[0]] as homeItem}
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

		{#each navItems.slice(1) as item}
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

		<!-- System section label -->
		{#if !collapsed || mobileOpen}
			<p class="!mt-5 !mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-faint/50">System</p>
		{:else}
			<div class="!my-3 mx-3 h-px bg-cream/[0.04]" aria-hidden="true"></div>
		{/if}

		{#each secondaryNavItems as item}
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
