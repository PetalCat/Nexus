<script lang="ts">
	import type { PageData } from './$types';
	import MediaRow from '$lib/components/MediaRow.svelte';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';

	let { data }: { data: PageData } = $props();

	function formatDuration(secs?: number) {
		if (!secs) return null;
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}
</script>

<svelte:head>
	<title>Nexus — Home</title>
</svelte:head>

<div class="flex min-w-0 flex-col">
	<!-- ═══ Hero Section ═══ -->
	{#if data.hero}
		{@const hero = data.hero}
		<div class="relative mx-2 mt-2 overflow-hidden rounded-xl sm:mx-4 sm:mt-4 sm:rounded-2xl" style="height: clamp(260px, 45vh, 520px); box-shadow: 0 24px 80px rgba(0,0,0,0.7)">
			<!-- Background image -->
			{#if hero.backdrop}
				<img
					src={hero.backdrop}
					alt={hero.title}
					class="absolute inset-0 h-full w-full object-cover transition-transform duration-[2s] ease-out"
					style="transform: scale(1.02)"
				/>
			{:else}
				<div class="absolute inset-0" style="background: linear-gradient(135deg, #1a1a2e 0%, #0d0d18 50%, #12122a 100%)">
					<div class="absolute inset-0 opacity-20" style="background: radial-gradient(ellipse at 30% 50%, #7c6cf8 0%, transparent 60%)"></div>
				</div>
			{/if}

			<!-- Gradient overlays -->
			<div class="absolute inset-0" style="background: linear-gradient(to top, #05050a 0%, rgba(5,5,10,0.7) 35%, rgba(5,5,10,0.2) 60%, transparent 100%)"></div>
			<div class="absolute inset-0" style="background: linear-gradient(to right, rgba(5,5,10,0.85) 0%, rgba(5,5,10,0.4) 40%, transparent 70%)"></div>

			<!-- Content -->
			<div class="absolute bottom-0 left-0 right-0 flex items-end p-4 pb-5 sm:p-6 sm:pb-8 md:p-8 md:pb-10">
				<div class="max-w-2xl">
					<div class="flex items-center gap-2">
						<ServiceBadge type={hero.serviceType} />
						{#if hero.year}
							<span class="text-xs font-medium text-white/50">{hero.year}</span>
						{/if}
						{#if hero.duration}
							<span class="text-xs text-white/30">·</span>
							<span class="text-xs font-medium text-white/50">{formatDuration(hero.duration)}</span>
						{/if}
						{#if hero.rating}
							<span class="text-xs text-white/30">·</span>
							<span class="flex items-center gap-0.5 text-xs font-medium text-[var(--color-star)]">
								★ {hero.rating.toFixed(1)}
							</span>
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

					{#if hero.description}
						<p class="mt-2 hidden text-sm leading-relaxed text-white/60 line-clamp-2 sm:block sm:max-w-lg sm:mt-3">
							{hero.description}
						</p>
					{/if}

					<!-- Progress bar for continue watching -->
					{#if hero.progress != null && hero.progress > 0 && hero.progress < 1}
						<div class="mt-3 flex items-center gap-2">
							<div class="h-1 w-32 overflow-hidden rounded-full bg-white/15">
								<div class="h-full rounded-full bg-[var(--color-nebula)]" style="width: {hero.progress * 100}%"></div>
							</div>
							<span class="text-xs font-medium text-white/40">{Math.round(hero.progress * 100)}% watched</span>
						</div>
					{/if}

					<div class="mt-3 flex gap-2 sm:mt-5 sm:gap-3">
						{#if hero.streamUrl}
							<a
								href="/media/{hero.type}/{hero.sourceId}?service={hero.serviceId}&play=1"
								class="btn btn-primary text-sm sm:text-base"
								style="padding: 0.5rem 1.25rem;"
							>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>
								{hero.progress ? 'Resume' : 'Play'}
							</a>
						{/if}
						<a
							href="/media/{hero.type}/{hero.sourceId}?service={hero.serviceId}"
							class="btn btn-ghost text-sm sm:text-base"
							style="padding: 0.5rem 1.25rem; border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.8);"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
							More Info
						</a>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- ═══ Media Rows ═══ -->
	{#if data.rows.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--color-surface)] text-[var(--color-nebula)] shadow-[0_0_40px_var(--color-nebula-dim)]">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
					<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
				</svg>
			</div>
			<h2 class="text-display text-xl font-semibold">No services connected</h2>
			<p class="mt-2 text-sm text-[var(--color-subtle)]">Add your media services to populate your dashboard.</p>
			<a href="/settings" class="btn btn-primary mt-6">Configure Services</a>
		</div>
	{:else}
		<div class="mt-6 flex flex-col gap-10 pb-8">
			{#each data.rows as row (row.id)}
				<MediaRow {row} />
			{/each}
		</div>
	{/if}
</div>
