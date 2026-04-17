<script lang="ts">
	import type { PageData } from './$types';
	import { Star, ThumbsDown, X } from 'lucide-svelte';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import type { RecProfileConfig } from '$lib/server/recommendations/types';

	let { data }: { data: PageData } = $props();

	let recommendations = $state<UnifiedMedia[]>([]);
	let recsLoading = $state(true);
	let recsError = $state<string | null>(null);

	// Canonical RecProfileConfig blob. The UI sliders mutate this in place and
	// PUT the whole thing back to /api/recommendations/preferences on save.
	// svelte-ignore state_referenced_locally — the initial-capture is the desired
	// behavior here; SSR navigation remounts the page.
	let profile = $state<RecProfileConfig>(structuredClone(data.profile));
	let savingPrefs = $state(false);

	// svelte-ignore state_referenced_locally
	let hiddenItems: typeof data.hiddenItems = $state(data.hiddenItems);

	// One-tap 5-star replacement for the old "thumbs-up" button. Fires the
	// canonical rating endpoint so a click shows up in ratings/history, not a
	// rec-specific table.
	async function starRate(item: UnifiedMedia, rating: number) {
		await fetch(`/api/media/${item.sourceId}/ratings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				service: item.serviceId,
				serviceType: item.serviceType,
				mediaType: item.type,
				rating
			})
		});
		recommendations = recommendations.filter((r) => r.id !== item.id);
	}

	// Thumbs-down / not-interested both write to user_hidden_items via the
	// canonical feedback endpoint.
	async function hide(item: UnifiedMedia, reason: 'not_interested' | 'hide') {
		await fetch('/api/user/recommendations/feedback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				mediaId: item.sourceId,
				action: reason,
				reason
			})
		});
		recommendations = recommendations.filter((r) => r.id !== item.id);
		await refreshHidden();
	}

	async function refreshHidden() {
		try {
			const res = await fetch('/api/recommendations/preferences');
			if (res.ok) {
				const body = await res.json();
				hiddenItems = (body.hiddenItems ?? []).map((h: any) => ({
					id: h.id ?? 0,
					media_id: h.media_id,
					service_id: h.service_id,
					reason: h.reason,
					created_at: h.created_at
				}));
			}
		} catch { /* silent */ }
	}

	async function loadRecs() {
		if (!data.hasStreamyStats) { recsLoading = false; return; }
		try {
			const res = await fetch('/api/recommendations');
			const json = await res.json();
			recommendations = json.recommendations ?? [];
			recsError = json.error ?? null;
		} catch {
			recsError = "Couldn't load recommendations.";
		} finally {
			recsLoading = false;
		}
	}

	$effect(() => { loadRecs(); });

	async function savePreferences() {
		savingPrefs = true;
		try {
			const res = await fetch('/api/recommendations/preferences', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(profile)
			});
			if (res.ok) {
				recsLoading = true;
				await loadRecs();
			}
		} finally {
			savingPrefs = false;
		}
	}

	function toggleGenre(genre: string) {
		const bans = new Set(profile.genreBans ?? []);
		const boosts = { ...(profile.genreBoosts ?? {}) };
		if (boosts[genre] && boosts[genre] > 1) {
			// Boosted → banned
			delete boosts[genre];
			bans.add(genre);
		} else if (bans.has(genre)) {
			// Banned → neutral
			bans.delete(genre);
		} else {
			// Neutral → boosted
			boosts[genre] = 1.5;
		}
		profile.genreBoosts = boosts;
		profile.genreBans = Array.from(bans);
	}

	function genreState(genre: string): 'boost' | 'ban' | 'neutral' {
		if ((profile.genreBans ?? []).includes(genre)) return 'ban';
		if ((profile.genreBoosts ?? {})[genre] && (profile.genreBoosts ?? {})[genre]! > 1) return 'boost';
		return 'neutral';
	}

	const WEIGHT_KEYS: Array<keyof RecProfileConfig['weights']> = [
		'contentBased', 'collaborative', 'social', 'trending', 'external'
	];
	const WEIGHT_LABELS: Record<keyof RecProfileConfig['weights'], string> = {
		contentBased: 'Similar content',
		collaborative: 'Similar users',
		social: 'Friends',
		trending: 'Trending',
		external: 'External'
	};
</script>

<div class="px-3 sm:px-4 lg:px-6">
	<!-- Active Recommendations -->
	<section class="mb-8">
		<h2 class="mb-4 text-base font-semibold text-cream">Recommendations</h2>
		{#if recsLoading}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{#each Array(6) as _}
					<div class="h-64 animate-pulse rounded-xl bg-cream/[0.03]"></div>
				{/each}
			</div>
		{:else if recsError && recommendations.length === 0}
			<div class="rounded-xl border border-cream/[0.06] bg-raised p-6 text-center text-sm text-faint">
				{recsError}
			</div>
		{:else if recommendations.length === 0}
			<div class="rounded-xl border border-cream/[0.06] bg-raised p-6 text-center text-sm text-faint">
				Not enough watch history for recommendations yet. Keep watching!
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{#each recommendations as rec (rec.id)}
					<div class="group rounded-xl border border-cream/[0.06] bg-raised p-3">
						{#if rec.poster}
							<img src={rec.poster} alt={rec.title} class="mb-2 aspect-[2/3] w-full rounded-lg object-cover" loading="lazy" />
						{:else}
							<div class="mb-2 flex aspect-[2/3] w-full items-center justify-center rounded-lg bg-cream/[0.03] text-xs text-faint">
								No poster
							</div>
						{/if}
						<p class="truncate text-xs font-medium text-cream">{rec.title}</p>
						<p class="text-[10px] capitalize text-faint">{rec.type}</p>
						{#if (rec as any).reason}
							<p class="mt-1 text-[10px] text-muted">{(rec as any).reason}</p>
						{/if}
						{#if (rec as any).similarity != null}
							<p class="text-[10px] text-accent">{Math.round((rec as any).similarity * 100)}% match</p>
						{/if}
						<div class="mt-2 flex items-center justify-between gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
							<div class="flex items-center gap-0.5">
								{#each [1, 2, 3, 4, 5] as n (n)}
									<button
										onclick={() => starRate(rec, n)}
										class="rounded p-1 text-faint hover:text-accent"
										title="Rate {n} star{n > 1 ? 's' : ''}"
										aria-label="Rate {n} stars"
									>
										<Star size={12} />
									</button>
								{/each}
							</div>
							<div class="flex gap-1">
								<button
									onclick={() => hide(rec, 'not_interested')}
									class="rounded-md bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20"
									title="Not for me"
								>
									<ThumbsDown size={12} />
								</button>
								<button
									onclick={() => hide(rec, 'hide')}
									class="rounded-md bg-cream/[0.04] p-1.5 text-faint hover:bg-cream/[0.08] hover:text-cream"
									title="Hide"
								>
									<X size={12} />
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Algorithm Tuning -->
	<section class="mb-8">
		<h2 class="mb-4 text-base font-semibold text-cream">Algorithm Tuning</h2>
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-4">
			<h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Provider Mix</h3>
			<div class="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each WEIGHT_KEYS as key (key)}
					<div>
						<label class="mb-1 block text-[11px] capitalize text-muted">
							{WEIGHT_LABELS[key]}
							<input
								type="range"
								min="0" max="1" step="0.05"
								bind:value={profile.weights[key]}
								class="w-full accent-[#d4a253]"
							/>
						</label>
						<span class="text-[10px] text-faint">{Math.round((profile.weights[key] ?? 0) * 100)}%</span>
					</div>
				{/each}
			</div>

			{#if data.consumedGenres.length > 0}
				<h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Genre Preferences</h3>
				<div class="mb-6 flex flex-wrap gap-2">
					{#each data.consumedGenres as genre (genre)}
						{@const state = genreState(genre)}
						<button
							onclick={() => toggleGenre(genre)}
							class="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all
								{state === 'boost' ? 'bg-emerald-500/15 text-emerald-400'
								: state === 'ban' ? 'bg-red-500/15 text-red-400'
								: 'bg-cream/[0.04] text-muted'}"
						>
							{genre}
							{#if state === 'boost'}↑{:else if state === 'ban'}↓{/if}
						</button>
					{/each}
				</div>
			{/if}

			<h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Discovery Level</h3>
			<div class="mb-4 flex items-center gap-3">
				<span class="text-[10px] text-muted">Familiar</span>
				<input
					type="range"
					min="0" max="1" step="0.05"
					bind:value={profile.noveltyFactor}
					class="flex-1 accent-[#d4a253]"
				/>
				<span class="text-[10px] text-muted">Adventurous</span>
			</div>

			<button
				onclick={savePreferences}
				disabled={savingPrefs}
				class="rounded-lg bg-accent/15 px-4 py-2 text-xs font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
			>
				{savingPrefs ? 'Saving...' : 'Save & Refresh'}
			</button>
		</div>
	</section>

	<!-- Hidden History -->
	{#if hiddenItems.length > 0}
		<section>
			<h2 class="mb-4 text-base font-semibold text-cream">Hidden Items</h2>
			<div class="overflow-hidden rounded-xl border border-cream/[0.06]">
				<table class="w-full text-xs">
					<thead>
						<tr class="border-b border-cream/[0.06] text-left text-[10px] uppercase tracking-wide text-faint">
							<th class="px-3 py-2">Media</th>
							<th class="px-3 py-2">Reason</th>
							<th class="px-3 py-2">Date</th>
						</tr>
					</thead>
					<tbody>
						{#each hiddenItems as h (h.id)}
							<tr class="border-b border-cream/[0.03] hover:bg-cream/[0.02]">
								<td class="px-3 py-2 text-cream/80">{h.media_id}</td>
								<td class="px-3 py-2 text-faint">{h.reason ?? '—'}</td>
								<td class="px-3 py-2 text-faint">
									{new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>
