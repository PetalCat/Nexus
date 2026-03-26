<script lang="ts">
	import type { MediaType } from '$lib/types/media-ui';

	interface Props {
		type: MediaType;
		size?: 'sm' | 'md';
	}

	let { type, size = 'sm' }: Props = $props();

	const config: Record<MediaType, { label: string; bg: string }> = {
		movie: { label: 'Movie', bg: '#7a5a1a' },
		show: { label: 'Series', bg: '#1e6055' },
		book: { label: 'Book', bg: '#256b60' },
		game: { label: 'Game', bg: '#8c2e2e' },
		music: { label: 'Music', bg: '#543d8a' },
		live: { label: 'Live', bg: '#961c1c' },
		video: { label: 'Video', bg: '#7a3a1a' }
	};

	const badge = $derived(config[type]);
	const sizeClass = $derived(
		size === 'sm' ? 'px-2.5 py-[4px] text-[10px]' : 'px-3.5 py-[6px] text-xs'
	);
</script>

<span
	class="inline-flex items-center gap-1.5 rounded font-body font-bold uppercase tracking-[0.1em] text-cream {sizeClass}"
	style="background: {badge.bg};"
>
	{#if type === 'live'}
		<span class="relative flex h-1.5 w-1.5" aria-hidden="true">
			<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-cream opacity-60"></span>
			<span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-cream"></span>
		</span>
	{/if}
	{badge.label}
</span>
