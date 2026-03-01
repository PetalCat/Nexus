<script lang="ts">
	import { page } from '$app/stores';

	const nav = [
		{ href: '/', label: 'Home', icon: 'home' },
		{ href: '/search', label: 'Search', icon: 'search' },
		{ href: '/library', label: 'Library', icon: 'library' },
		{ href: '/discover', label: 'Discover', icon: 'compass' },
		{ href: '/live', label: 'Live', icon: 'live' },
		{ href: '/automation', label: 'Automation', icon: 'automation' },
		{ href: '/activity', label: 'Activity', icon: 'activity' }
	];

	const bottomNav = [{ href: '/settings', label: 'Settings', icon: 'settings' }];

	function isActive(href: string) {
		if (href === '/') return $page.url.pathname === '/';
		return $page.url.pathname.startsWith(href);
	}
</script>

<aside
	class="fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-[var(--color-border)] bg-[var(--color-deep)]"
>
	<!-- Logo -->
	<div class="flex items-center gap-2.5 px-5 py-5">
		<div
			class="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-nebula)] text-white shadow-[0_0_20px_var(--color-nebula-dim)]"
		>
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<path
					d="M9 1L11.5 6.5H17L12.5 10L14.5 16L9 12.5L3.5 16L5.5 10L1 6.5H6.5L9 1Z"
					fill="currentColor"
				/>
			</svg>
		</div>
		<span class="text-display text-base font-bold tracking-tight">Nexus</span>
	</div>

	<!-- Main nav -->
	<nav class="flex flex-1 flex-col gap-0.5 px-2 py-2">
		{#each nav as item}
			<a
				href={item.href}
				class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150
					{isActive(item.href)
					? 'bg-[var(--color-nebula-dim)] text-[var(--color-text)] font-medium'
					: 'text-[var(--color-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'}"
			>
				<NavIcon name={item.icon} active={isActive(item.href)} />
				{item.label}
				{#if item.icon === 'live'}
					<span
						class="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-nova)]"
					></span>
				{/if}
			</a>
		{/each}
	</nav>

	<!-- Bottom nav -->
	<div class="border-t border-[var(--color-border)] px-2 py-2">
		{#each bottomNav as item}
			<a
				href={item.href}
				class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--color-subtle)] transition-all hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
			>
				<NavIcon name={item.icon} active={false} />
				{item.label}
			</a>
		{/each}
	</div>
</aside>

<!-- Icon component -->
{#snippet NavIcon({ name, active }: { name: string; active: boolean })}
	<span
		class="flex h-4 w-4 items-center justify-center opacity-{active ? '100' : '70'}"
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
		{:else if name === 'search'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5" />
				<path d="M10 10L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
		{:else if name === 'library'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<rect x="1.5" y="1.5" width="4" height="12" rx="1" stroke="currentColor" stroke-width="1.5" />
				<rect x="7.5" y="1.5" width="6" height="5" rx="1" stroke="currentColor" stroke-width="1.5" />
				<rect x="7.5" y="8.5" width="6" height="5" rx="1" stroke="currentColor" stroke-width="1.5" />
			</svg>
		{:else if name === 'compass'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<circle cx="7.5" cy="7.5" r="6" stroke="currentColor" stroke-width="1.5" />
				<path d="M9.5 5.5L8 9.5L5.5 9.5L7 5.5L9.5 5.5Z" fill="currentColor" />
			</svg>
		{:else if name === 'live'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<rect x="1.5" y="3.5" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5" />
				<path d="M5 13.5H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				<circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
			</svg>
		{:else if name === 'automation'}
			<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
				<circle cx="7.5" cy="7.5" r="2" stroke="currentColor" stroke-width="1.5" />
				<path
					d="M7.5 1.5V3M7.5 12V13.5M1.5 7.5H3M12 7.5H13.5M3.5 3.5L4.5 4.5M10.5 10.5L11.5 11.5M3.5 11.5L4.5 10.5M10.5 4.5L11.5 3.5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/>
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
		{/if}
	</span>
{/snippet}
