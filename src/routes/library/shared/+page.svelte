<script lang="ts">
	import type { PageData } from './$types';
	import { Share2, Eye, ExternalLink } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	function timeAgo(ts: number): string {
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 7) return `${days}d ago`;
		return new Date(ts).toLocaleDateString();
	}

	async function markSeen(shareId: string) {
		await fetch(`/api/shared/${shareId}/seen`, { method: 'POST' });
		const item = data.items.find((i) => i.id === shareId);
		if (item) {
			item.seen = 1;
			data.items = [...data.items];
		}
	}
</script>

<svelte:head>
	<title>Shared With You — Nexus</title>
</svelte:head>

<div class="px-3 sm:px-4 lg:px-6">
	{#if data.items.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-surface text-muted"
				style="box-shadow: 0 0 40px rgba(212, 162, 83, 0.06);">
				<Share2 size={32} strokeWidth={1.2} />
			</div>
			<p class="font-display text-lg font-semibold text-cream">Nothing shared yet</p>
			<p class="mt-2 max-w-xs text-sm text-muted">
				When friends share movies, shows, or music with you, they'll appear here.
			</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each data.items as item, i (item.id)}
				<div
					class="group flex gap-3 rounded-xl border border-cream/[0.04] bg-surface/30 p-3 transition-all duration-200 hover:border-cream/[0.08] hover:bg-surface/50
						{item.seen ? 'opacity-70' : ''}"
					style="animation: stagger-reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; animation-delay: {Math.min(i * 40, 400)}ms; opacity: 0;"
				>
					<!-- Poster thumbnail -->
					<a href="/media/{item.mediaType}/{item.mediaId}?service={item.serviceId}" class="shrink-0">
						{#if item.mediaPoster}
							<img
								src={item.mediaPoster}
								alt={item.mediaTitle}
								class="h-20 w-14 rounded-lg object-cover transition-transform duration-300 group-hover:scale-[1.03]"
								style="box-shadow: 0 4px 12px rgba(0,0,0,0.3);"
							/>
						{:else}
							<div class="flex h-20 w-14 items-center justify-center rounded-lg bg-raised text-faint">
								<Share2 size={16} />
							</div>
						{/if}
					</a>

					<!-- Content -->
					<div class="flex min-w-0 flex-1 flex-col justify-between">
						<div>
							<a href="/media/{item.mediaType}/{item.mediaId}?service={item.serviceId}" class="font-display text-sm font-semibold text-cream hover:text-accent-light transition-colors">
								{item.mediaTitle}
							</a>
							<div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
								<!-- Sender info -->
								<span class="font-medium text-muted">{item.fromDisplayName ?? item.fromUsername}</span>
								<span>·</span>
								<span>{timeAgo(item.createdAt)}</span>
								{#if !item.seen}
									<span class="ml-1 h-1.5 w-1.5 rounded-full bg-accent" aria-label="Unseen"></span>
								{/if}
							</div>
							{#if item.message}
								<p class="mt-1 line-clamp-2 text-xs text-muted/80 italic">"{item.message}"</p>
							{/if}
						</div>

						<!-- Actions -->
						<div class="mt-1.5 flex items-center gap-2">
							{#if !item.seen}
								<button
									onclick={() => markSeen(item.id)}
									class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-faint transition-colors hover:bg-cream/[0.04] hover:text-muted"
								>
									<Eye size={11} strokeWidth={1.5} />
									Mark seen
								</button>
							{/if}
							<a
								href="/media/{item.mediaType}/{item.mediaId}?service={item.serviceId}"
								class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-faint transition-colors hover:bg-cream/[0.04] hover:text-muted"
							>
								<ExternalLink size={11} strokeWidth={1.5} />
								View
							</a>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
