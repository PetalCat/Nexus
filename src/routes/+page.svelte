<script lang="ts">
	import type { PageData } from './$types';
	import type { MediaType } from '$lib/adapters/types';
	import HeroCarousel from '$lib/components/HeroCarousel.svelte';
	import ContinueWatchingCard from '$lib/components/ContinueWatchingCard.svelte';
	import MediaRow from '$lib/components/MediaRow.svelte';
	import CalendarRow from '$lib/components/CalendarRow.svelte';
	import GettingStartedChecklist from '$lib/components/onboarding/GettingStartedChecklist.svelte';

	let { data }: { data: PageData } = $props();

	const calendarItems = $derived(data.calendarItems ?? []);

	let nudgeDismissed = $state(false);
</script>

<svelte:head>
	<title>Nexus — Home</title>
</svelte:head>

<div class="flex min-w-0 flex-col">
	<!-- ═══ Hero Carousel ═══ -->
	{#if data.hero.length > 0}
		<HeroCarousel items={data.hero} />
	{/if}

	<!-- ═══ Getting Started Checklist (admin only) ═══ -->
	{#if data.checklistData}
		<GettingStartedChecklist
			groups={data.checklistData.groups}
			completedCount={data.checklistData.completedCount}
			totalCount={data.checklistData.totalCount}
			registrationConfigured={data.checklistData.registrationConfigured}
		/>
	{/if}

	<!-- ═══ Unlinked Services Nudge ═══ -->
	{#if data.unlinkedServiceCount > 0 && !nudgeDismissed}
		<div class="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl px-4 py-2.5" style="background: rgba(124,108,248,0.08); border: 1px solid rgba(124,108,248,0.18)">
			<p class="text-xs text-[var(--color-muted)]">
				{data.unlinkedServiceCount} service{data.unlinkedServiceCount > 1 ? 's' : ''} not linked to your account.
				<a href="/settings/accounts" class="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline">Set up your accounts</a> to unlock more features.
			</p>
			<button
				onclick={() => nudgeDismissed = true}
				class="flex-shrink-0 rounded-md p-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]"
				aria-label="Dismiss"
			>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
					<path d="M2 2l8 8M10 2l-8 8" />
				</svg>
			</button>
		</div>
	{/if}

	<!-- ═══ Content Rows ═══ -->
	{#if data.rows.length === 0 && calendarItems.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[0_0_40px_rgba(212,162,83,0.12)]">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
					<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
				</svg>
			</div>
			<h2 class="text-display text-xl font-semibold">
				{data.hasServices ? 'Your dashboard is still warming up' : 'No services connected'}
			</h2>
			<p class="mt-2 text-sm text-[var(--color-muted)]">
				{data.hasServices
					? 'Your services are connected, but there is no dashboard content available yet. They may still be syncing or temporarily unavailable.'
					: 'Add your media services to populate your dashboard.'}
			</p>
			{#if !data.hasServices}
				<a href="/settings/accounts" class="btn btn-primary mt-6">Configure Services</a>
			{/if}
		</div>
	{:else}
		<div class="mt-6 flex flex-col gap-10 pb-8">
			{#each data.rows as row, i (row.id)}
				{#if row.id === 'continue'}
					<div class="px-4">
						<h2 class="mb-3 text-base font-semibold text-cream sm:text-lg">{row.title}</h2>
						<div class="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
							{#each row.items as item (item.id)}
								<ContinueWatchingCard {item} />
							{/each}
						</div>
					</div>
					<!-- Calendar row appears right after Continue Watching -->
					{#if calendarItems.length > 0}
						<CalendarRow items={calendarItems} />
					{/if}
				{:else}
					<!-- Show calendar row before first non-continue row if there was no continue row -->
					{#if i === 0 && calendarItems.length > 0}
						<CalendarRow items={calendarItems} />
					{/if}
					{@const dashRow = {
						id: row.id,
						title: row.title,
						subtitle: row.subtitle,
						items: row.items.map(item => ({
							id: item.id,
							sourceId: item.sourceId,
							serviceId: item.serviceId,
							serviceType: item.serviceType,
							type: item.mediaType as MediaType,
							title: item.title,
							description: item.description ?? '',
							poster: item.poster,
							backdrop: item.backdrop,
							year: item.year,
							rating: item.rating,
							genres: item.genres,
							streamUrl: item.streamUrl,
							metadata: item.context ? { recReason: item.context } : undefined
						}))
					}}
					<MediaRow row={dashRow} />
				{/if}
			{/each}
		</div>
	{/if}
</div>
