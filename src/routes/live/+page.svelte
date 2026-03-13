<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';

	let { data }: { data: PageData } = $props();

	let filter = $state('');
	const filtered = $derived(
		filter
			? data.channels.filter((c: UnifiedMedia) => c.title.toLowerCase().includes(filter.toLowerCase()))
			: data.channels
	);
</script>

<svelte:head>
	<title>Live TV — Nexus</title>
</svelte:head>

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">
	<div class="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h1 class="text-display text-2xl font-bold">Live TV</h1>
			<p class="mt-1 text-sm text-[var(--color-muted)]">
				{#if data.channels.length > 0}
					{data.channels.length} channels available
				{:else}
					Live TV channels from Jellyfin
				{/if}
			</p>
		</div>
		{#if data.channels.length > 0}
			<input bind:value={filter} class="input w-full text-sm sm:w-44" placeholder="Filter channels…" />
		{/if}
	</div>

	{#if data.channels.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 relative">
				<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-muted)]">
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<rect x="2" y="7" width="20" height="15" rx="2"/>
						<path d="M17 2l-5 5-5-5"/>
						<circle cx="12" cy="14" r="3"/>
					</svg>
				</div>
				<span class="absolute -top-1 -right-1 flex h-3 w-3">
					<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-warm)] opacity-75"></span>
					<span class="relative inline-flex h-3 w-3 rounded-full bg-[var(--color-warm)]"></span>
				</span>
			</div>
			<p class="font-medium">No live channels found</p>
			<p class="mt-1 max-w-xs text-sm text-[var(--color-muted)]">
				Connect a Jellyfin server with Live TV configured to watch live channels here.
			</p>
			<a href="/settings/accounts" class="btn btn-primary mt-4 text-sm">Manage Services</a>
		</div>
	{:else}
		<div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:gap-3">
			{#each filtered as channel (channel.id)}
				<a
					href={channel.actionUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="card-raised group flex flex-col gap-3 p-3 transition-all hover:border-[var(--color-accent)]/30"
				>
					<!-- Channel logo / number -->
					<div class="flex items-center gap-2">
						{#if channel.poster}
							<img src={channel.poster} alt={channel.title} class="h-8 w-8 rounded object-contain bg-[var(--color-raised)]" />
						{:else}
							<div class="flex h-8 w-8 items-center justify-center rounded bg-[var(--color-raised)] text-xs font-bold text-[var(--color-accent)]">
								{channel.metadata?.channelNumber ?? '?'}
							</div>
						{/if}
						<!-- Live dot -->
						<span class="ml-auto flex items-center gap-1 text-[10px] font-medium text-[var(--color-warm)]">
							<span class="h-1.5 w-1.5 rounded-full bg-[var(--color-warm)] animate-pulse"></span>
							LIVE
						</span>
					</div>
					<div>
						<p class="font-medium text-sm leading-tight truncate">{channel.title}</p>
						{#if channel.metadata?.currentProgram}
							<p class="mt-0.5 text-xs text-[var(--color-muted)] truncate">{channel.metadata.currentProgram}</p>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
