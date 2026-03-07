<script lang="ts">
	interface Props {
		author: { name: string; bookCount: number };
		representativeCover?: string;
	}

	let { author, representativeCover }: Props = $props();
</script>

<a
	href="/books?author={encodeURIComponent(author.name)}&tab=all"
	class="group flex items-center gap-3 overflow-hidden rounded-xl bg-[var(--color-raised)] p-3 transition-all hover:bg-[var(--color-hover)] hover:shadow-[var(--shadow-card)]"
>
	<!-- Avatar / cover -->
	<div class="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[var(--color-surface)]">
		{#if representativeCover}
			<img src={representativeCover} alt="" class="h-full w-full object-cover" loading="lazy" />
		{:else}
			<div class="flex h-full w-full items-center justify-center text-lg font-bold text-[var(--color-faint)]">
				{author.name.charAt(0).toUpperCase()}
			</div>
		{/if}
	</div>

	<!-- Info -->
	<div class="min-w-0 flex-1">
		<p class="truncate text-sm font-semibold text-[var(--color-cream)] transition-colors group-hover:text-[var(--color-accent)]">{author.name}</p>
		<p class="text-xs text-[var(--color-muted)]">{author.bookCount} book{author.bookCount === 1 ? '' : 's'}</p>
	</div>
</a>
