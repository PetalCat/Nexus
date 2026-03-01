<script lang="ts">
	import type { PageData } from './$types';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';

	let { data }: { data: PageData } = $props();

	const item = data.item;

	const typeLabel: Record<string, string> = {
		movie: 'Movie',
		show: 'TV Show',
		episode: 'Episode',
		book: 'Book',
		game: 'Game',
		music: 'Track',
		album: 'Album',
		live: 'Live Channel'
	};

	const statusClass: Record<string, string> = {
		available: 'badge-available',
		requested: 'badge-requested',
		downloading: 'badge-downloading',
		missing: 'badge-missing'
	};

	function formatDuration(secs?: number) {
		if (!secs) return null;
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}
</script>

<svelte:head>
	<title>{item.title} — Nexus</title>
</svelte:head>

<div class="relative min-h-screen">
	<!-- Backdrop -->
	{#if item.backdrop}
		<div class="pointer-events-none fixed inset-0 z-0">
			<img src={item.backdrop} alt="" class="h-full w-full object-cover opacity-10" />
			<div class="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--color-void)]/80 to-[var(--color-void)]"></div>
		</div>
	{/if}

	<div class="relative z-10 px-6 py-8">
		<div class="flex flex-col gap-8 md:flex-row">
			<!-- Poster -->
			<div class="flex-shrink-0">
				<div class="w-48 overflow-hidden rounded-xl shadow-[var(--shadow-float)]">
					{#if item.poster}
						<img src={item.poster} alt={item.title} class="w-full" />
					{:else}
						<div class="flex h-72 w-48 items-center justify-center bg-[var(--color-raised)] text-4xl opacity-30">
							🎬
						</div>
					{/if}
				</div>
			</div>

			<!-- Info -->
			<div class="flex flex-1 flex-col gap-4">
				<div class="flex flex-wrap items-center gap-2">
					<ServiceBadge type={data.serviceType} />
					<span class="text-xs text-[var(--color-muted)]">{typeLabel[item.type] ?? item.type}</span>
					{#if item.status}
						<span class="badge {statusClass[item.status] ?? ''}">{item.status}</span>
					{/if}
				</div>

				<h1 class="text-display text-3xl font-bold leading-tight">{item.title}</h1>

				<!-- Meta row -->
				<div class="flex flex-wrap items-center gap-3 text-sm text-[var(--color-subtle)]">
					{#if item.year}
						<span>{item.year}</span>
					{/if}
					{#if item.duration}
						<span>·</span>
						<span>{formatDuration(item.duration)}</span>
					{/if}
					{#if item.rating}
						<span>·</span>
						<span class="flex items-center gap-1">
							<span class="text-[var(--color-star)]">★</span>
							{item.rating.toFixed(1)}
						</span>
					{/if}
				</div>

				<!-- Progress -->
				{#if item.progress != null && item.progress > 0 && item.progress < 1}
					<div class="flex items-center gap-2">
						<div class="progress-bar w-48">
							<div class="progress-fill" style="width: {item.progress * 100}%"></div>
						</div>
						<span class="text-xs text-[var(--color-muted)]">{Math.round(item.progress * 100)}%</span>
					</div>
				{/if}

				<!-- Genres -->
				{#if item.genres && item.genres.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each item.genres as genre}
							<span class="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-xs text-[var(--color-subtle)]">
								{genre}
							</span>
						{/each}
					</div>
				{/if}

				<!-- Description -->
				{#if item.description}
					<p class="max-w-2xl text-sm leading-relaxed text-[var(--color-subtle)]">{item.description}</p>
				{/if}

				<!-- Studios -->
				{#if item.studios && item.studios.length > 0}
					<div class="text-xs text-[var(--color-muted)]">
						{item.studios.join(' · ')}
					</div>
				{/if}

				<!-- Actions -->
				<div class="mt-2 flex flex-wrap gap-2">
					{#if item.actionUrl}
						<a href={item.actionUrl} target="_blank" rel="noopener" class="btn btn-primary">
							{item.actionLabel ?? 'Open'}
						</a>
					{/if}
					<a href="javascript:history.back()" class="btn btn-ghost">← Back</a>
				</div>
			</div>
		</div>
	</div>
</div>
