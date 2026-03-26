<script lang="ts">
	import type { PageData } from './$types';
	import { ThumbsUp, ThumbsDown, X } from 'lucide-svelte';
	import type { UnifiedMedia } from '$lib/adapters/types';

	let { data }: { data: PageData } = $props();

	let recommendations = $state<UnifiedMedia[]>([]);
	let recsLoading = $state(true);
	let recsError = $state<string | null>(null);
	let feedbackList: typeof data.feedback = $state([]);
	$effect(() => { feedbackList = data.feedback; });

	let preferences: typeof data.preferences = $state({ mediaTypeWeights: {}, genrePreferences: {}, similarityThreshold: 0.5 });
	$effect(() => { preferences = data.preferences; });
	let savingPrefs = $state(false);

	async function loadRecs() {
		if (!data.hasStreamyStats) { recsLoading = false; return; }
		try {
			const res = await fetch('/api/recommendations');
			const json = await res.json();
			recommendations = json.recommendations ?? [];
			recsError = json.error ?? null;
		} catch {
			recsError = "Couldn't reach StreamyStats.";
		} finally {
			recsLoading = false;
		}
	}

	$effect(() => { loadRecs(); });

	async function giveFeedback(mediaId: string, mediaTitle: string | undefined, fb: 'up' | 'down' | 'dismiss', reason?: string) {
		await fetch('/api/recommendations/feedback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mediaId, mediaTitle, feedback: fb, reason })
		});
		recommendations = recommendations.filter((r) => r.id !== mediaId);
		const res = await fetch('/api/recommendations/feedback');
		feedbackList = (await res.json()).feedback;
	}

	async function deleteFeedback(id: number) {
		await fetch(`/api/recommendations/feedback/${id}`, { method: 'DELETE' });
		feedbackList = feedbackList.filter((f: any) => f.id !== id);
	}

	async function savePreferences() {
		savingPrefs = true;
		await fetch('/api/recommendations/preferences', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(preferences)
		});
		savingPrefs = false;
		recsLoading = true;
		await loadRecs();
	}

	function toggleGenre(genre: string) {
		const current = preferences.genrePreferences[genre] ?? 'neutral';
		const cycle: Record<string, string> = { neutral: 'boost', boost: 'suppress', suppress: 'neutral' };
		preferences.genrePreferences = { ...preferences.genrePreferences, [genre]: cycle[current] };
	}

	const WEIGHT_TYPES = ['movie', 'show', 'book', 'game', 'music', 'video'];
</script>

<div class="px-3 sm:px-4 lg:px-6">
	{#if !data.hasStreamyStats}
		<div class="rounded-xl border border-cream/[0.06] bg-raised p-8 text-center">
			<p class="text-sm text-muted">Connect StreamyStats in Settings to get personalized recommendations.</p>
			<a href="/settings/accounts" class="mt-3 inline-block rounded-lg bg-accent/15 px-4 py-2 text-xs font-medium text-accent hover:bg-accent/25">
				Go to Settings
			</a>
		</div>
	{:else}
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
							<div class="mt-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
								<button
									onclick={() => giveFeedback(rec.id, rec.title, 'up')}
									class="rounded-md bg-emerald-500/10 p-1.5 text-emerald-400 hover:bg-emerald-500/20"
									title="Like"
								>
									<ThumbsUp size={12} />
								</button>
								<button
									onclick={() => giveFeedback(rec.id, rec.title, 'down')}
									class="rounded-md bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20"
									title="Dislike"
								>
									<ThumbsDown size={12} />
								</button>
								<button
									onclick={() => giveFeedback(rec.id, rec.title, 'dismiss')}
									class="rounded-md bg-cream/[0.04] p-1.5 text-faint hover:bg-cream/[0.08] hover:text-cream"
									title="Not interested"
								>
									<X size={12} />
								</button>
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
				<h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Media Type Weights</h3>
				<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
					{#each WEIGHT_TYPES as type (type)}
						<div>
							<label class="mb-1 block text-[11px] capitalize text-muted">
								{type}
								<input
									type="range"
									min="0" max="100"
									bind:value={preferences.mediaTypeWeights[type]}
									class="w-full accent-[#d4a253]"
								/>
							</label>
							<span class="text-[10px] text-faint">{preferences.mediaTypeWeights[type]}</span>
						</div>
					{/each}
				</div>

				{#if data.consumedGenres.length > 0}
					<h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Genre Preferences</h3>
					<div class="mb-6 flex flex-wrap gap-2">
						{#each data.consumedGenres as genre (genre)}
							{@const pref = preferences.genrePreferences[genre] ?? 'neutral'}
							<button
								onclick={() => toggleGenre(genre)}
								class="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all
									{pref === 'boost' ? 'bg-emerald-500/15 text-emerald-400'
									: pref === 'suppress' ? 'bg-red-500/15 text-red-400'
									: 'bg-cream/[0.04] text-muted'}"
							>
								{genre}
								{#if pref === 'boost'}↑{:else if pref === 'suppress'}↓{/if}
							</button>
						{/each}
					</div>
				{/if}

				<h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Discovery Level</h3>
				<div class="mb-4 flex items-center gap-3">
					<span class="text-[10px] text-muted">Adventurous</span>
					<input
						type="range"
						min="0.3" max="0.9" step="0.05"
						bind:value={preferences.similarityThreshold}
						class="flex-1 accent-[#d4a253]"
					/>
					<span class="text-[10px] text-muted">Safe</span>
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

		<!-- Feedback History -->
		{#if feedbackList.length > 0}
			<section>
				<h2 class="mb-4 text-base font-semibold text-cream">Feedback History</h2>
				<div class="overflow-hidden rounded-xl border border-cream/[0.06]">
					<table class="w-full text-xs">
						<thead>
							<tr class="border-b border-cream/[0.06] text-left text-[10px] uppercase tracking-wide text-faint">
								<th class="px-3 py-2">Title</th>
								<th class="px-3 py-2">Feedback</th>
								<th class="px-3 py-2">Date</th>
								<th class="px-3 py-2"></th>
							</tr>
						</thead>
						<tbody>
							{#each feedbackList as fb (fb.id)}
								<tr class="border-b border-cream/[0.03] hover:bg-cream/[0.02]">
									<td class="px-3 py-2 text-cream/80">{fb.media_title ?? fb.media_id}</td>
									<td class="px-3 py-2">
										<span class="rounded px-1.5 py-0.5 text-[10px]
											{fb.feedback === 'up' ? 'bg-emerald-500/15 text-emerald-400'
											: fb.feedback === 'down' ? 'bg-red-500/15 text-red-400'
											: 'bg-cream/[0.04] text-faint'}">
											{fb.feedback === 'up' ? '👍' : fb.feedback === 'down' ? '👎' : '✕'}
										</span>
									</td>
									<td class="px-3 py-2 text-faint">
										{new Date(fb.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
									</td>
									<td class="px-3 py-2">
										<button
											onclick={() => deleteFeedback(fb.id)}
											class="text-faint hover:text-red-400"
											title="Undo"
										>
											<X size={12} />
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	{/if}
</div>
