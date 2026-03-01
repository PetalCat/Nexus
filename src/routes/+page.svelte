<script lang="ts">
	import type { PageData } from './$types';
	import MediaRow from '$lib/components/MediaRow.svelte';
	import ServiceBadge from '$lib/components/ServiceBadge.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Nexus — Home</title>
</svelte:head>

<div class="py-6">
	<!-- Hero -->
	{#if data.hero}
		<div class="relative mb-8 overflow-hidden mx-6 rounded-2xl" style="height: 280px">
			{#if data.hero.backdrop}
				<img src={data.hero.backdrop} alt={data.hero.title} class="h-full w-full object-cover" />
			{:else}
				<div class="h-full w-full bg-gradient-to-br from-[var(--color-nebula-dim)] to-[var(--color-deep)]"></div>
			{/if}
			<div class="absolute inset-0 bg-gradient-to-t from-[var(--color-void)] via-[var(--color-void)]/60 to-transparent"></div>
			<div class="absolute bottom-0 left-0 p-6">
				<ServiceBadge type={data.hero.serviceType} />
				<h1 class="text-display mt-2 text-2xl font-bold">{data.hero.title}</h1>
				{#if data.hero.description}
					<p class="mt-1 max-w-xl text-sm text-[var(--color-subtle)] line-clamp-2">{data.hero.description}</p>
				{/if}
				<div class="mt-3 flex gap-2">
					<a href="/media/{data.hero.type}/{data.hero.sourceId}?service={data.hero.serviceId}" class="btn btn-primary">
						{data.hero.actionLabel ?? "Watch"}
					</a>
					<a href="/media/{data.hero.type}/{data.hero.sourceId}?service={data.hero.serviceId}" class="btn btn-ghost">
						More Info
					</a>
				</div>
			</div>
		</div>
	{/if}

	<!-- Media rows -->
	{#if data.rows.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-4 text-5xl opacity-30">✦</div>
			<h2 class="text-display text-xl font-semibold">No services connected</h2>
			<p class="mt-2 text-sm text-[var(--color-subtle)]">Add your media services to get started.</p>
			<a href="/settings" class="btn btn-primary mt-6">Configure Services</a>
		</div>
	{:else}
		<div class="flex flex-col gap-8">
			{#each data.rows as row (row.id)}
				<MediaRow {row} />
			{/each}
		</div>
	{/if}
</div>
