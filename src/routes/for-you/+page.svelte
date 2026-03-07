<script lang="ts">
	import type { PageData } from './$types';
	import MediaRow from '$lib/components/MediaRow.svelte';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Nexus — For You</title>
</svelte:head>

<div class="flex min-w-0 flex-col">
	<!-- Hero: Top Recommendation -->
	{#if data.hero}
		{@const hero = data.hero}
		<div class="relative mx-2 mt-2 overflow-hidden rounded-xl sm:mx-4 sm:mt-4 sm:rounded-2xl" style="height: clamp(240px, 40vh, 460px); box-shadow: 0 24px 80px rgba(0,0,0,0.7)">
			{#if hero.backdrop}
				<img
					src={hero.backdrop}
					alt={hero.title}
					class="absolute inset-0 h-full w-full object-cover"
					style="transform: scale(1.02)"
				/>
			{:else}
				<div class="absolute inset-0" style="background: linear-gradient(135deg, var(--color-raised) 0%, var(--color-deep) 50%, var(--color-base) 100%)">
					<div class="absolute inset-0 opacity-20" style="background: radial-gradient(ellipse at 30% 50%, var(--color-accent) 0%, transparent 60%)"></div>
				</div>
			{/if}

			<div class="absolute inset-0" style="background: linear-gradient(to top, var(--color-void) 0%, rgba(13,11,10,0.7) 35%, rgba(13,11,10,0.2) 60%, transparent 100%)"></div>
			<div class="absolute inset-0" style="background: linear-gradient(to right, rgba(13,11,10,0.85) 0%, rgba(13,11,10,0.4) 40%, transparent 70%)"></div>

			<div class="absolute bottom-0 left-0 right-0 flex items-end p-4 pb-5 sm:p-6 sm:pb-8 md:p-8 md:pb-10">
				<div class="max-w-2xl">
					<div class="flex items-center gap-2">
						<span class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]" style="background: color-mix(in srgb, var(--color-accent) 20%, transparent)">Top Pick</span>
						<ServiceBadge type={hero.serviceType} />
						{#if hero.year}
							<span class="text-xs font-medium text-white/50">{hero.year}</span>
						{/if}
					</div>

					<h1 class="text-display mt-2 text-2xl font-bold leading-[1.1] tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] sm:mt-3 sm:text-3xl md:text-4xl lg:text-5xl">
						{hero.title}
					</h1>

					{#if hero.genres && hero.genres.length > 0}
						<div class="mt-2 flex flex-wrap gap-1">
							{#each hero.genres.slice(0, 3) as genre}
								<span class="text-xs font-medium text-white/40">{genre}</span>
								{#if genre !== hero.genres.slice(0, 3).at(-1)}
									<span class="text-xs text-white/20">·</span>
								{/if}
							{/each}
						</div>
					{/if}

					{#if hero.metadata?.recReason}
						<p class="mt-2 text-sm" style="color: color-mix(in srgb, var(--color-accent) 80%, transparent)">
							{hero.metadata.recReason}
						</p>
					{/if}

					{#if hero.description}
						<p class="mt-2 hidden text-sm leading-relaxed text-white/60 line-clamp-2 sm:block sm:max-w-lg">
							{hero.description}
						</p>
					{/if}

					<div class="mt-3 flex gap-2 sm:mt-5 sm:gap-3">
						<a
							href="/media/{hero.type}/{hero.sourceId}?service={hero.serviceId}"
							class="btn btn-primary text-sm sm:text-base"
							style="padding: 0.5rem 1.25rem;"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
							More Info
						</a>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Provider status pills -->
	{#if data.providers && data.providers.length > 0}
		<div class="mx-4 mt-4 flex flex-wrap gap-2">
			{#each data.providers as provider}
				<span
					class="rounded-full px-2.5 py-1 text-[11px] font-medium {provider.ready ? 'text-green-400' : 'text-white/30'}"
					style="background: {provider.ready ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)'}"
				>
					{provider.displayName}
				</span>
			{/each}
		</div>
	{/if}

	<!-- Recommendation Rows -->
	{#if data.rows.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[0_0_40px_rgba(212,162,83,0.12)]">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
				</svg>
			</div>
			<h2 class="text-display text-xl font-semibold">No recommendations yet</h2>
			<p class="mt-2 max-w-sm text-sm text-[var(--color-muted)]">
				Start watching content to build your taste profile. The recommendation engine learns from your viewing history.
			</p>
			<a href="/" class="btn btn-primary mt-6">Back to Home</a>
		</div>
	{:else}
		<div class="mt-6 flex flex-col gap-10 pb-8">
			{#each data.rows as row (row.id)}
				<MediaRow {row} />
			{/each}
		</div>
	{/if}
</div>
