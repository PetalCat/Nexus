<script lang="ts">
	import type { UnifiedMedia } from '$lib/adapters/types';

	interface Props {
		items: UnifiedMedia[];
	}

	let { items }: Props = $props();

	const booksPerShelf = 7;
	const shelves = $derived(() => {
		const result: UnifiedMedia[][] = [];
		for (let i = 0; i < items.length; i += booksPerShelf) {
			result.push(items.slice(i, i + booksPerShelf));
		}
		return result;
	});
</script>

<div class="bookshelf-container flex flex-col gap-0">
	{#each shelves() as shelf, shelfIdx}
		<div class="bookshelf-row">
			<!-- Books -->
			<div class="flex items-end justify-start gap-2 px-4 pb-1 sm:gap-3 sm:px-6 md:gap-4">
				{#each shelf as book (book.id)}
					{@const detailUrl = `/media/${book.type}/${book.sourceId}?service=${book.serviceId}`}
					<a
						href={detailUrl}
						class="book-spine group relative shrink-0"
						title={book.title}
					>
						<div class="book-3d relative transition-transform duration-300 group-hover:-translate-y-2">
							{#if book.poster}
								<img
									src={book.poster}
									alt={book.title}
									class="h-[140px] w-auto rounded-[3px] object-cover shadow-[2px_2px_8px_rgba(0,0,0,0.5)] sm:h-[170px] md:h-[200px]"
									loading="lazy"
									style="aspect-ratio: 2/3;"
								/>
							{:else}
								<div class="flex h-[140px] w-[93px] items-center justify-center rounded-[3px] bg-[var(--color-raised)] p-2 shadow-[2px_2px_8px_rgba(0,0,0,0.5)] sm:h-[170px] sm:w-[113px] md:h-[200px] md:w-[133px]">
									<span class="text-center text-[10px] leading-tight text-[var(--color-muted)] line-clamp-4">{book.title}</span>
								</div>
							{/if}
							<!-- Spine edge -->
							<div class="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[3px]" style="background: linear-gradient(to right, rgba(0,0,0,0.3), transparent)"></div>
						</div>
						<!-- Title tooltip -->
						<div class="pointer-events-none absolute -bottom-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--color-surface)] px-2 py-1 text-[10px] text-[var(--color-cream)] opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
							{book.title}
						</div>
					</a>
				{/each}
			</div>
			<!-- Shelf wood -->
			<div class="shelf-wood relative h-3 rounded-b-sm shadow-[0_4px_12px_rgba(0,0,0,0.5)]" style="background: linear-gradient(to bottom, #5a3e2e 0%, #3d2b1f 60%, #2d1f16 100%)">
				<div class="absolute inset-0 rounded-b-sm opacity-20" style="background-image: url(&quot;data:image/svg+xml,%3Csvg width='200' height='12' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='g'%3E%3CfeTurbulence baseFrequency='0.02 0.8' numOctaves='2' seed='{shelfIdx}'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E&quot;)"></div>
				<!-- Front edge highlight -->
				<div class="absolute top-0 left-0 right-0 h-px" style="background: linear-gradient(to right, transparent, rgba(255,255,255,0.12) 20%, rgba(255,255,255,0.12) 80%, transparent)"></div>
			</div>
		</div>
	{/each}
</div>

<style>
	.bookshelf-row {
		perspective: 800px;
	}
	.book-3d {
		transform-style: preserve-3d;
		transform: rotateY(-2deg);
	}
	.book-spine:hover .book-3d {
		transform: rotateY(0deg) translateY(-8px);
	}
</style>
