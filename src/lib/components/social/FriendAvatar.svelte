<script lang="ts">
	import type { PresenceStatus } from '$lib/types/media-ui';

	interface Props {
		src: string;
		name: string;
		status?: PresenceStatus;
		size?: 'sm' | 'md' | 'lg';
		showStatus?: boolean;
	}

	let { src, name, status = 'offline', size = 'md', showStatus = true }: Props = $props();

	let imageError = $state(false);

	const sizeClasses: Record<string, string> = {
		sm: 'h-7 w-7',
		md: 'h-9 w-9',
		lg: 'h-12 w-12'
	};

	const dotSizeClasses: Record<string, string> = {
		sm: 'h-2 w-2',
		md: 'h-2.5 w-2.5',
		lg: 'h-3 w-3'
	};

	const statusColors: Record<PresenceStatus, string> = {
		online: 'bg-steel',
		away: 'bg-accent',
		dnd: 'bg-warm',
		offline: 'bg-faint',
		ghost: 'bg-faint'
	};

	const initials = $derived(
		name
			.split(' ')
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase()
	);

	const textSize = $derived(size === 'sm' ? 'text-[10px]' : size === 'md' ? 'text-xs' : 'text-sm');
</script>

<div class="relative inline-flex flex-shrink-0">
	{#if src && !imageError}
		<img
			{src}
			alt={name}
			class="rounded-full object-cover {sizeClasses[size]}"
			loading="lazy"
			onerror={() => (imageError = true)}
		/>
	{:else}
		<div
			class="flex items-center justify-center rounded-full bg-cream/[0.08] {sizeClasses[size]}"
		>
			<span class="font-body font-medium text-cream/60 {textSize}">{initials}</span>
		</div>
	{/if}

	{#if showStatus && status !== 'ghost'}
		<span
			class="absolute bottom-0 right-0 rounded-full ring-2 ring-nexus-base {dotSizeClasses[size]} {statusColors[status]}"
		></span>
	{/if}
</div>
