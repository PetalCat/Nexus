<script lang="ts">
	import type { UnifiedMedia } from '$lib/adapters/types';

	interface Props {
		seriesName: string;
		books: UnifiedMedia[];
		onExpand: () => void;
	}

	let { seriesName, books, onExpand }: Props = $props();

	const cover = $derived(books.find(b => b.poster)?.poster);
	const bookCount = $derived(books.length);
</script>

<button
	type="button"
	onclick={onExpand}
	class="group relative flex w-full flex-col gap-2 text-left"
>
	<!-- Stacked card effect -->
	<div class="relative">
		<!-- Back shadow layer -->
		<div class="stack-layer stack-layer-back"></div>
		<!-- Middle shadow layer -->
		<div class="stack-layer stack-layer-mid"></div>

		<!-- Main card -->
		<div
			class="relative aspect-[2/3] w-full overflow-hidden rounded-[10px] bg-[var(--color-raised)] transition-all duration-250 group-hover:scale-[1.03] group-hover:shadow-[0_8px_40px_rgba(0,0,0,0.7),0_0_0_1px_rgba(212,162,83,0.25)]"
		>
			{#if cover}
				<img
					src={cover}
					alt={seriesName}
					class="h-full w-full object-cover"
					loading="lazy"
					decoding="async"
					fetchpriority="low"
				/>
			{:else}
				<div class="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
					<span class="text-[var(--color-cream)] opacity-25">
						<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/>
							<path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/>
							<path d="M4 20h10"/>
						</svg>
					</span>
					<span class="line-clamp-3 text-center text-xs leading-tight text-[var(--color-muted)]">{seriesName}</span>
				</div>
			{/if}

			<!-- Book count badge -->
			<div class="absolute right-2 top-2 z-10 rounded-md bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-bold leading-tight text-white shadow-md">
				{bookCount} book{bookCount === 1 ? '' : 's'}
			</div>

			<!-- Series name overlay -->
			<div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2.5 pb-2.5 pt-8">
				<p class="line-clamp-2 text-sm font-semibold leading-tight text-[var(--color-cream)]">{seriesName}</p>
			</div>
		</div>
	</div>
</button>

<style>
	.stack-layer {
		position: absolute;
		inset: 0;
		border-radius: 10px;
		background: var(--color-surface);
		border: 1px solid rgba(240, 235, 227, 0.06);
	}

	.stack-layer-back {
		transform: translate(6px, -6px);
		opacity: 0.3;
	}

	.stack-layer-mid {
		transform: translate(3px, -3px);
		opacity: 0.5;
	}
</style>
