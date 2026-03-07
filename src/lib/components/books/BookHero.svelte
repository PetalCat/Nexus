<script lang="ts">
	import type { UnifiedMedia } from '$lib/adapters/types';

	interface Props {
		book: UnifiedMedia;
	}

	let { book }: Props = $props();

	const detailUrl = $derived(`/media/${book.type}/${book.sourceId}?service=${book.serviceId}`);
	const readUrl = $derived(book.actionUrl ?? detailUrl);
	const authorName = $derived((book.metadata?.author as string) ?? '');
	const seriesInfo = $derived(
		book.metadata?.seriesName
			? `${book.metadata.seriesName}${book.metadata.seriesIndex ? ` #${book.metadata.seriesIndex}` : ''}`
			: ''
	);
</script>

<div
	class="book-hero relative mx-2 mt-2 overflow-hidden rounded-xl sm:mx-4 sm:mt-4 sm:rounded-2xl"
	style="height: clamp(280px, 48vh, 520px); box-shadow: 0 24px 80px rgba(0,0,0,0.7)"
>
	<!-- Blurred backdrop -->
	{#if book.poster}
		<img
			src={book.poster}
			alt=""
			class="absolute inset-0 h-full w-full object-cover blur-2xl scale-110 opacity-40"
			aria-hidden="true"
		/>
	{/if}
	<div
		class="absolute inset-0"
		style="background: linear-gradient(135deg, rgba(13,11,10,0.85) 0%, rgba(13,11,10,0.6) 40%, rgba(13,11,10,0.85) 100%)"
	></div>
	<div
		class="absolute inset-0"
		style="background: linear-gradient(to top, var(--color-void) 0%, rgba(13,11,10,0.5) 40%, transparent 100%)"
	></div>

	<!-- Content -->
	<div class="absolute inset-0 flex items-center gap-6 p-4 sm:gap-10 sm:p-8 md:p-12">
		<!-- Cover -->
		{#if book.poster}
			<div class="hero-cover shrink-0" style="animation: heroSlideUp 0.6s ease-out both">
				<img
					src={book.poster}
					alt={book.title}
					class="h-[220px] w-auto rounded-lg object-cover shadow-[0_8px_40px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.08)] sm:h-[300px] md:h-[360px]"
				/>
			</div>
		{/if}

		<!-- Info -->
		<div class="min-w-0 flex-1" style="animation: heroFadeIn 0.8s ease-out 0.15s both">
			{#if seriesInfo}
				<p class="mb-1 text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)]">
					{seriesInfo}
				</p>
			{/if}

			<h1 class="text-display text-2xl font-bold leading-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] sm:text-3xl md:text-4xl lg:text-5xl">
				{book.title}
			</h1>

			{#if authorName}
				<p class="mt-1.5 text-sm font-medium text-white/60 sm:text-base">
					by {authorName}
				</p>
			{/if}

			<div class="mt-2 flex flex-wrap items-center gap-2">
				{#if book.year}
					<span class="text-xs font-medium text-white/40">{book.year}</span>
				{/if}
				{#if book.rating}
					<span class="text-xs text-white/20">·</span>
					<span class="flex items-center gap-0.5 text-xs font-medium text-[var(--color-accent)]">
						<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9 3 10.5l.5-3.5L1 4.5 4.5 4z"/></svg>
						{book.rating.toFixed(1)}
					</span>
				{/if}
			</div>

			{#if book.genres && book.genres.length > 0}
				<div class="mt-2.5 flex flex-wrap gap-1.5">
					{#each book.genres.slice(0, 4) as genre}
						<span class="rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] font-medium text-white/60">{genre}</span>
					{/each}
				</div>
			{/if}

			{#if book.description}
				<p class="mt-3 hidden max-w-lg text-sm leading-relaxed text-white/55 line-clamp-3 sm:block">
					{book.description}
				</p>
			{/if}

			<div class="mt-4 flex items-center gap-3 sm:mt-6">
				<a
					href={readUrl}
					class="flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--color-void)] shadow-[0_0_24px_rgba(212,162,83,0.2)] transition-all hover:brightness-110 active:scale-95"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
						<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
					</svg>
					Read
				</a>
				<a
					href={detailUrl}
					class="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur-sm transition-all hover:bg-white/10 active:scale-95"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
					Details
				</a>
			</div>
		</div>
	</div>
</div>

<style>
	@keyframes heroSlideUp {
		from { opacity: 0; transform: translateY(24px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes heroFadeIn {
		from { opacity: 0; transform: translateX(-12px); }
		to { opacity: 1; transform: translateX(0); }
	}
</style>
