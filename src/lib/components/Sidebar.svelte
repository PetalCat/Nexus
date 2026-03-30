<script lang="ts">
	import { page } from '$app/stores';

	interface Props {
		open?: boolean;
		onclose?: () => void;
		pendingRequests?: number;
		isAdmin?: boolean;
	}

	let { open = false, onclose, pendingRequests = 0, isAdmin = false }: Props = $props();

	const topNav = [
		{ href: '/', label: 'Home', icon: 'home' },
		{ href: '/discover', label: 'Discover', icon: 'discover' },
		{ href: '/movies', label: 'Movies', icon: 'movies' },
		{ href: '/shows', label: 'TV Shows', icon: 'shows' },
		{ href: '/music', label: 'Music', icon: 'music' },
		{ href: '/books', label: 'Books', icon: 'books' },
		{ href: '/games', label: 'Games', icon: 'games' },
		{ href: '/videos', label: 'Videos', icon: 'videos' },
		{ href: '/live', label: 'Live TV', icon: 'live' }
	];

	const secondaryNav = [
		{ href: '/requests', label: 'Requests', icon: 'requests' },
		{ href: '/collections', label: 'Collections', icon: 'collections' },
		{ href: '/calendar', label: 'Calendar', icon: 'calendar' },
		{ href: '/activity', label: 'Activity', icon: 'activity' },
		{ href: '/wrapped', label: 'Wrapped', icon: 'wrapped' }
	];

	function isActive(href: string) {
		if (href === '/') return $page.url.pathname === '/';
		return $page.url.pathname.startsWith(href);
	}

	function handleNavClick() {
		onclose?.();
	}
</script>

<!-- Mobile backdrop overlay -->
{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
		onclick={onclose}
		onkeydown={(e) => e.key === 'Escape' && onclose?.()}
		role="presentation"
	></div>
{/if}

<aside class="fixed inset-y-0 left-0 z-50 flex w-56 flex-col transition-transform duration-300 ease-out lg:translate-x-0 {open ? 'translate-x-0' : '-translate-x-full'}" style="background: linear-gradient(180deg, #0d0d18 0%, #0a0a12 100%); border-right: 1px solid rgba(255,255,255,0.06);">
	<!-- Subtle radial glow at the top of sidebar -->
	<div class="pointer-events-none absolute inset-x-0 top-0 h-48 opacity-30" style="background: radial-gradient(ellipse at 50% -20%, #7c6cf840 0%, transparent 70%)"></div>

	<!-- Logo -->
	<div class="relative flex items-center gap-2.5 px-5 py-5">
		<div class="relative flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-nebula)] shadow-[0_0_24px_#7c6cf850]">
			<svg width="16" height="16" viewBox="-85 -754 1058 828" fill="none">
				<g transform="scale(1,-1)"><path d="M543 -5 275 483Q275 483 277.0 501.0Q279 519 281.0 542.5Q283 566 285.0 584.0Q287 602 287 602Q295 639 292.5 656.5Q290 674 272.5 680.5Q255 687 216 688L221 708Q237 707 260.5 706.0Q284 705 310 705Q357 705 391 708L615 272Q615 272 611.5 252.0Q608 232 602.0 200.5Q596 169 590.0 133.5Q584 98 578.0 66.5Q572 35 568.5 15.0Q565 -5 565 -5ZM851 737Q826 737 804.0 721.0Q782 705 766 682Q720 614 672.0 443.0Q624 272 565 -5L551 23Q566 90 583.0 167.5Q600 245 619.5 323.0Q639 401 659.5 472.0Q680 543 702.5 599.5Q725 656 748 690Q767 717 793.0 735.5Q819 754 856 754Q909 754 941.0 723.0Q973 692 973 647Q973 599 940.5 570.5Q908 542 861 542Q821 542 796.5 561.5Q772 581 772 616Q772 661 802.0 691.5Q832 722 876 729Q872 733 865.5 735.0Q859 737 851 737ZM37 -57Q65 -57 86.0 -41.5Q107 -26 123 -1Q152 45 181.5 143.0Q211 241 241.5 380.0Q272 519 303 685L320 664Q304 582 286.5 497.5Q269 413 251.0 332.5Q233 252 214.0 183.0Q195 114 176.0 63.5Q157 13 139 -11Q121 -35 96.5 -54.5Q72 -74 32 -74Q-21 -74 -53.0 -43.0Q-85 -12 -85 33Q-85 81 -52.0 109.5Q-19 138 27 138Q68 138 92.0 118.5Q116 99 116 64Q116 19 86.0 -11.0Q56 -41 12 -49Q16 -53 22.5 -55.0Q29 -57 37 -57Z" fill="white"/></g>
			</svg>
		</div>
		<span class="text-display text-base font-bold tracking-tight">Nexus</span>
	</div>

	<!-- Top nav group -->
	<nav class="relative flex flex-col gap-0.5 px-2 py-2">
		{#each topNav as item}
			{@render NavLink({ item })}
		{/each}
	</nav>

	<!-- Separator -->
	<div class="mx-4 border-t border-cream/[0.06]"></div>

	<!-- Secondary nav group -->
	<nav class="relative flex flex-col gap-0.5 px-2 py-2">
		{#each secondaryNav as item}
			{@render NavLink({ item })}
		{/each}
	</nav>

	<!-- Spacer to push bottom nav down -->
	<div class="flex-1"></div>

	<!-- Pinned bottom nav -->
	<div class="relative border-t border-cream/[0.06] px-2 py-2">
		{@render NavLink({ item: { href: '/settings', label: 'Settings', icon: 'settings' } })}
		{#if isAdmin}
			{@render NavLink({ item: { href: '/admin', label: 'Admin', icon: 'admin' } })}
		{/if}
	</div>
</aside>

<!-- Reusable nav link snippet -->
{#snippet NavLink({ item }: { item: { href: string; label: string; icon: string } })}
	<a
		href={item.href}
		onclick={handleNavClick}
		class="relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150
			{isActive(item.href)
			? 'text-[var(--color-text)] font-medium'
			: 'text-[var(--color-subtle)] hover:text-[var(--color-text)]'}"
	>
		{#if isActive(item.href)}
			<!-- Active background with subtle gradient -->
			<span class="absolute inset-0 rounded-lg" style="background: linear-gradient(90deg, #7c6cf818 0%, #7c6cf808 100%)"></span>
			<!-- Left accent bar -->
			<span class="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--color-nebula)] shadow-[0_0_8px_var(--color-nebula)]"></span>
		{:else}
			<span class="absolute inset-0 rounded-lg transition-colors duration-100 hover:bg-cream/[0.04]"></span>
		{/if}
		<span class="relative">
			{@render NavIcon({ name: item.icon, active: isActive(item.href) })}
		</span>
		<span class="relative">{item.label}</span>
		{#if item.icon === 'live'}
			<span class="relative ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-nova)]"></span>
		{:else if item.icon === 'requests' && pendingRequests > 0}
			<span class="relative ml-auto flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold bg-[#f59e0b] text-black">{pendingRequests > 99 ? '99+' : pendingRequests}</span>
		{/if}
	</a>
{/snippet}

<!-- Icon component -->
{#snippet NavIcon({ name, active }: { name: string; active: boolean })}
	<span
		class="flex h-4 w-4 items-center justify-center transition-colors duration-150"
		style="color: {active ? 'var(--color-nebula)' : 'inherit'}"
		aria-hidden="true"
	>
		{#if name === 'home'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<path
					d="M7.5 1.5L1.5 6V13.5H5.5V9.5H9.5V13.5H13.5V6L7.5 1.5Z"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linejoin="round"
				/>
			</svg>
		{:else if name === 'movies'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<rect x="1.5" y="2.5" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
				<path d="M1.5 5H13.5M1.5 10H13.5M4.5 2.5V5M10.5 2.5V5M4.5 10V12.5M10.5 10V12.5" stroke="currentColor" stroke-width="1.2"/>
			</svg>
		{:else if name === 'shows'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<rect x="1.5" y="2.5" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
				<path d="M4.5 13.5H10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				<path d="M6 6L10 7.5L6 9V6Z" fill="currentColor"/>
			</svg>
		{:else if name === 'music'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<circle cx="4.5" cy="11" r="2" stroke="currentColor" stroke-width="1.5"/>
				<path d="M6.5 11V2.5L13 1.5V9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
				<circle cx="11" cy="9.5" r="2" stroke="currentColor" stroke-width="1.5"/>
			</svg>
		{:else if name === 'books'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<path d="M7.5 3C6 1.5 3 1.5 1.5 2V12.5C3 12 6 12 7.5 13.5C9 12 12 12 13.5 12.5V2C12 1.5 9 1.5 7.5 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
				<path d="M7.5 3V13.5" stroke="currentColor" stroke-width="1.5"/>
			</svg>
		{:else if name === 'games'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<path d="M2 5.5C1 5.5 0.5 7 1 9.5C1.5 12 2.5 12.5 3 12.5C3.5 12.5 4 12 4.5 11L5.5 9H9.5L10.5 11C11 12 11.5 12.5 12 12.5C12.5 12.5 13.5 12 14 9.5C14.5 7 14 5.5 13 5.5H2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
				<path d="M4 7V9M3 8H5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
				<circle cx="10.5" cy="7.5" r="0.7" fill="currentColor"/>
				<circle cx="12" cy="8.5" r="0.7" fill="currentColor"/>
			</svg>
		{:else if name === 'live'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<rect x="1.5" y="3.5" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5" />
				<path d="M5 13.5H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				<circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
			</svg>
		{:else if name === 'requests'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<rect x="1.5" y="1.5" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
				<path d="M4.5 7.5H10.5M7.5 4.5V10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			</svg>
		{:else if name === 'activity'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<path
					d="M1.5 7.5H4L5.5 3.5L7.5 11.5L9 5.5L10.5 9.5H13.5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		{:else if name === 'settings'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<circle cx="7.5" cy="7.5" r="2" stroke="currentColor" stroke-width="1.5" />
				<path
					d="M7.5 1.5V3M7.5 12V13.5M1.5 7.5H3M12 7.5H13.5M3.5 3.5L4.5 4.5M10.5 10.5L11.5 11.5M3.5 11.5L4.5 10.5M10.5 4.5L11.5 3.5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/>
			</svg>
		{:else if name === 'admin'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5" />
				<rect x="8.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5" />
				<rect x="1.5" y="8.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5" />
				<rect x="8.5" y="8.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5" />
			</svg>
		{/if}
	</span>
{/snippet}
