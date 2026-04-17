<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// ── Autoplay trailers preference ──────────────────────────
	let autoplayTrailers = $state(data.autoplayTrailers ?? true);
	let autoplaySaving = $state(false);

	async function saveAutoplayTrailers(value: boolean) {
		autoplaySaving = true;
		try {
			const res = await fetch('/api/user/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ key: 'autoplayTrailers', value: String(value) })
			});
			if (!res.ok) throw new Error('Failed to save');
			await invalidateAll();
		} catch {
			toast.error('Failed to save autoplay preference');
			autoplayTrailers = !value; // revert on error
		} finally {
			autoplaySaving = false;
		}
	}

	// ── Autoplay next preference (issue #20) ──────────────────
	let autoplayNext = $state((data as any).autoplayNext ?? false);
	let autoplayNextSaving = $state(false);

	async function saveAutoplayNext(value: boolean) {
		autoplayNextSaving = true;
		try {
			const res = await fetch('/api/user/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ key: 'autoplayNext', value: String(value) })
			});
			if (!res.ok) throw new Error('Failed to save');
			await invalidateAll();
		} catch {
			toast.error('Failed to save autoplay-next preference');
			autoplayNext = !value;
		} finally {
			autoplayNextSaving = false;
		}
	}

	// ── Playback speed state ──────────────────────────────────
	type SpeedRule = { id?: number; scope: string; scopeValue: string | null; scopeName: string | null; speed: number };
	let speedRules = $state<SpeedRule[]>([]);
	let speedLoading = $state(false);
	let speedSaving = $state(false);
	let newRuleScope = $state<'default' | 'type' | 'channel'>('default');
	let newRuleScopeValue = $state('');
	let newRuleScopeName = $state('');
	let newRuleSpeed = $state(1);

	async function loadSpeedRules() {
		speedLoading = true;
		try {
			const res = await fetch('/api/speed');
			if (res.ok) {
				const { rules } = await res.json();
				speedRules = rules;
			}
		} catch { toast.error('Failed to load speed rules'); }
		finally { speedLoading = false; }
	}

	async function saveSpeedRule() {
		speedSaving = true;
		try {
			await fetch('/api/speed', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					scope: newRuleScope,
					scopeValue: newRuleScope === 'default' ? null : newRuleScopeValue || null,
					scopeName: newRuleScope === 'default' ? null : newRuleScopeName || null,
					speed: newRuleSpeed
				})
			});
			newRuleScopeValue = '';
			newRuleScopeName = '';
			newRuleSpeed = 1;
			await loadSpeedRules();
		} catch { toast.error('Failed to save speed rule'); }
		finally { speedSaving = false; }
	}

	async function deleteSpeedRule(id: number) {
		await fetch(`/api/speed?id=${id}`, { method: 'DELETE' });
		await loadSpeedRules();
	}

	// ── SponsorBlock preferences state ─────────────────────────
	// Per 2026-04-17 player alignment plan (#20): only 'skip' and 'off'
	// are honored by the player this cycle. 'mute' would need an audio-
	// ducking path on the <video> element, 'ask' would need a blocking
	// modal, and 'show' (scrub-bar segments) needs a renderer — none of
	// which exist yet. Rather than lie to the user, we remove those
	// controls entirely until an implementation lands. The stored
	// showOnTimeline field was dropped entirely in migration 0011 (#34).
	type SBAction = 'skip' | 'off';
	type SBCategory = 'sponsor' | 'selfpromo' | 'interaction' | 'intro' | 'outro' | 'preview' | 'music_offtopic' | 'filler' | 'poi_highlight' | 'chapter';
	const SB_CATEGORIES: { key: SBCategory; label: string; color: string; desc: string }[] = [
		{ key: 'sponsor', label: 'Sponsor', color: '#00d400', desc: 'Paid promotion, sponsorship' },
		{ key: 'selfpromo', label: 'Self-Promotion', color: '#ffff00', desc: 'Unpaid self-promo, links' },
		{ key: 'interaction', label: 'Interaction', color: '#cc00ff', desc: '"Subscribe", "like" reminders' },
		{ key: 'intro', label: 'Intro', color: '#00ffff', desc: 'Intro animation / title card' },
		{ key: 'outro', label: 'Outro', color: '#0202ed', desc: 'End cards, credits, outro' },
		{ key: 'preview', label: 'Preview', color: '#008fd6', desc: 'Preview of upcoming content' },
		{ key: 'music_offtopic', label: 'Non-Music', color: '#ff9900', desc: 'Non-music sections in music videos' },
		{ key: 'filler', label: 'Filler', color: '#7300FF', desc: 'Tangential / off-topic content' },
		{ key: 'poi_highlight', label: 'Highlight', color: '#ff1684', desc: 'The point/highlight of the video' },
		{ key: 'chapter', label: 'Chapter', color: '#ffd679', desc: 'User-submitted chapters' }
	];
	const SB_ACTIONS: { value: SBAction; label: string }[] = [
		{ value: 'skip', label: 'Auto-Skip' },
		{ value: 'off', label: 'Off' }
	];

	let sbEnabled = $state(true);
	let sbCategorySettings = $state<Record<string, SBAction>>({
		sponsor: 'skip', selfpromo: 'skip', interaction: 'skip',
		intro: 'off', outro: 'off', preview: 'off',
		music_offtopic: 'off', filler: 'off', poi_highlight: 'off', chapter: 'off'
	});
	let sbShowSkipNotice = $state(true);
	let sbSkipNoticeDuration = $state(3000);
	let sbLoading = $state(false);
	let sbSaving = $state(false);

	/** Coerce any non-honored action stored upstream to a safe value.
	 *  We don't remove removed-action rows from the DB — the API can still
	 *  accept them — but the UI only exposes skip/off, so we normalize
	 *  anything else to 'off' for display purposes. */
	function normalizeAction(value: string): SBAction {
		return value === 'skip' ? 'skip' : 'off';
	}

	async function loadSBPrefs() {
		sbLoading = true;
		try {
			const res = await fetch('/api/sponsorblock/preferences');
			if (res.ok) {
				const data = await res.json();
				sbEnabled = data.enabled;
				const cs: Record<string, SBAction> = {};
				for (const k of Object.keys(data.categorySettings ?? {})) {
					cs[k] = normalizeAction(data.categorySettings[k]);
				}
				sbCategorySettings = { ...sbCategorySettings, ...cs };
				sbShowSkipNotice = data.showSkipNotice ?? sbShowSkipNotice;
				sbSkipNoticeDuration = data.skipNoticeDuration ?? sbSkipNoticeDuration;
			}
		} catch { toast.error('Failed to load SponsorBlock preferences'); }
		finally { sbLoading = false; }
	}

	async function saveSBPrefs() {
		sbSaving = true;
		try {
			await fetch('/api/sponsorblock/preferences', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					enabled: sbEnabled,
					categorySettings: sbCategorySettings,
					// showOnTimeline entirely removed 2026-04-17 — schema,
					// API, and UI all dropped it together (wire-or-remove).
					showSkipNotice: sbShowSkipNotice,
					skipNoticeDuration: sbSkipNoticeDuration
				})
			});
		} catch { toast.error('Failed to save SponsorBlock preferences'); }
		finally { sbSaving = false; }
	}

	// Load data on mount
	$effect(() => {
		loadSpeedRules();
		loadSBPrefs();
	});
</script>

<!-- Playback Behavior -->
<section class="mb-8">
	<h2 class="text-display mb-3 text-base font-semibold">Playback Behavior</h2>

	<div class="space-y-3">
		<div class="flex items-center justify-between rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-4">
			<div class="pr-4">
				<p class="text-sm font-medium text-[var(--color-display)]">Autoplay Trailers</p>
				<p class="mt-0.5 text-xs text-[var(--color-muted)]">Automatically play trailers in the hero section on movie and show pages. Defaults to off on mobile devices.</p>
			</div>
			<button
				class="relative h-6 w-11 flex-shrink-0 rounded-full transition-colors {autoplayTrailers ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-raised)]'} disabled:opacity-50"
				onclick={() => { autoplayTrailers = !autoplayTrailers; saveAutoplayTrailers(autoplayTrailers); }}
				aria-label="Toggle autoplay trailers"
				disabled={autoplaySaving}
			>
				<span class="absolute top-0.5 h-5 w-5 rounded-full bg-cream shadow transition-transform {autoplayTrailers ? 'translate-x-[22px]' : 'translate-x-0.5'}"></span>
			</button>
		</div>

		<div class="flex items-center justify-between rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-4">
			<div class="pr-4">
				<p class="text-sm font-medium text-[var(--color-display)]">Autoplay Next Episode</p>
				<p class="mt-0.5 text-xs text-[var(--color-muted)]">When an episode ends, start the next one after a 10 second countdown. You can cancel from the up-next card.</p>
			</div>
			<button
				class="relative h-6 w-11 flex-shrink-0 rounded-full transition-colors {autoplayNext ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-raised)]'} disabled:opacity-50"
				onclick={() => { autoplayNext = !autoplayNext; saveAutoplayNext(autoplayNext); }}
				aria-label="Toggle autoplay next episode"
				disabled={autoplayNextSaving}
			>
				<span class="absolute top-0.5 h-5 w-5 rounded-full bg-cream shadow transition-transform {autoplayNext ? 'translate-x-[22px]' : 'translate-x-0.5'}"></span>
			</button>
		</div>
	</div>
</section>

<!-- Playback Speed Rules -->
<section class="mb-8">
	<h2 class="text-display mb-1 text-base font-semibold">Playback Speed Rules</h2>
	<p class="text-body-muted mb-5 text-xs">Set default playback speeds. More specific rules (video &gt; channel &gt; type) take priority.</p>

	{#if speedLoading}
		<div class="space-y-3">
			{#each { length: 3 } as _, i (i)}
				<div class="flex items-center justify-between rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-4">
					<div class="h-4 w-40 rounded bg-[var(--color-raised)] animate-pulse"></div>
					<div class="h-4 w-12 rounded bg-[var(--color-raised)] animate-pulse"></div>
				</div>
			{/each}
		</div>
	{:else}
		<!-- Existing rules -->
		{#if speedRules.length > 0}
			<div class="space-y-2 mb-6">
				{#each speedRules as rule (rule.id)}
					<div class="flex items-center justify-between rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-4">
						<div>
							<p class="text-sm font-medium text-[var(--color-display)]">
								{#if rule.scope === 'default'}Global Default
								{:else if rule.scope === 'type'}Type: {rule.scopeName || rule.scopeValue}
								{:else if rule.scope === 'channel'}Channel: {rule.scopeName || rule.scopeValue}
								{:else}Video: {rule.scopeName || rule.scopeValue}{/if}
							</p>
							<p class="mt-0.5 text-xs text-[var(--color-muted)]">{rule.speed}x</p>
						</div>
						<button class="text-xs text-red-400 hover:text-red-300 transition-colors" onclick={() => rule.id && deleteSpeedRule(rule.id)}>Remove</button>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-body-muted mb-6 text-xs">No speed rules yet. Add one below.</p>
		{/if}

		<!-- Add new rule -->
		<div class="rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-5">
			<h3 class="text-sm font-medium text-[var(--color-display)] mb-3">Add Speed Rule</h3>
			<div class="flex flex-wrap gap-3 items-end">
				<div>
					<label for="speed-scope" class="block text-xs text-[var(--color-muted)] mb-1">Scope</label>
					<select id="speed-scope" class="rounded-md border border-[rgba(240,235,227,0.1)] bg-[var(--color-raised)] px-3 py-1.5 text-sm text-[var(--color-body)]" bind:value={newRuleScope}>
						<option value="default">Global Default</option>
						<option value="type">Media Type</option>
						<option value="channel">Channel</option>
					</select>
				</div>

				{#if newRuleScope !== 'default'}
					<div>
						<label for="speed-scope-value" class="block text-xs text-[var(--color-muted)] mb-1">
							{newRuleScope === 'type' ? 'Type (e.g. movie, show, video)' : 'Channel ID'}
						</label>
						<input id="speed-scope-value" type="text" class="rounded-md border border-[rgba(240,235,227,0.1)] bg-[var(--color-raised)] px-3 py-1.5 text-sm text-[var(--color-body)] w-48" bind:value={newRuleScopeValue} placeholder={newRuleScope === 'type' ? 'movie' : 'channel-id'} />
					</div>
					<div>
						<label for="speed-scope-name" class="block text-xs text-[var(--color-muted)] mb-1">Display Name</label>
						<input id="speed-scope-name" type="text" class="rounded-md border border-[rgba(240,235,227,0.1)] bg-[var(--color-raised)] px-3 py-1.5 text-sm text-[var(--color-body)] w-48" bind:value={newRuleScopeName} placeholder="Optional label" />
					</div>
				{/if}

				<div>
					<label for="speed-value" class="block text-xs text-[var(--color-muted)] mb-1">Speed</label>
					<input id="speed-value" type="number" class="rounded-md border border-[rgba(240,235,227,0.1)] bg-[var(--color-raised)] px-3 py-1.5 text-sm text-[var(--color-body)] w-24" bind:value={newRuleSpeed} min="0.1" max="16" step="0.05" />
				</div>

				<button
					class="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
					onclick={saveSpeedRule}
					disabled={speedSaving || (newRuleScope !== 'default' && !newRuleScopeValue)}
				>
					{speedSaving ? 'Saving...' : 'Save Rule'}
				</button>
			</div>
		</div>
	{/if}
</section>

<!-- SponsorBlock -->
<section class="mb-8">
	<div class="flex items-center justify-between mb-1">
		<h2 class="text-display text-base font-semibold">SponsorBlock</h2>
		<button
			class="relative h-6 w-11 rounded-full transition-colors {sbEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-raised)]'}"
			onclick={() => { sbEnabled = !sbEnabled; saveSBPrefs(); }}
			aria-label="Toggle SponsorBlock"
		>
			<span class="absolute top-0.5 h-5 w-5 rounded-full bg-cream shadow transition-transform {sbEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'}"></span>
		</button>
	</div>
	<p class="text-body-muted mb-5 text-xs">Skip sponsor segments and other categories in YouTube videos using <a href="https://sponsor.ajay.app" target="_blank" class="text-[var(--color-accent)] hover:underline">SponsorBlock</a>.</p>

	{#if sbLoading}
		<div class="space-y-3">
			{#each { length: 5 } as _, i (i)}
				<div class="flex items-center justify-between rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-4">
					<div class="h-4 w-32 rounded bg-[var(--color-raised)] animate-pulse"></div>
					<div class="h-6 w-24 rounded bg-[var(--color-raised)] animate-pulse"></div>
				</div>
			{/each}
		</div>
	{:else if sbEnabled}
		<!-- Category settings -->
		<div class="space-y-2 mb-6">
			{#each SB_CATEGORIES as cat (cat.key)}
				<div class="flex items-center justify-between rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-4">
					<div class="flex items-center gap-3">
						<span class="h-3 w-3 rounded-full flex-shrink-0" style="background:{cat.color}"></span>
						<div>
							<p class="text-sm font-medium text-[var(--color-display)]">{cat.label}</p>
							<p class="mt-0.5 text-xs text-[var(--color-muted)]">{cat.desc}</p>
						</div>
					</div>
					<select
						class="rounded-md border border-[rgba(240,235,227,0.1)] bg-[var(--color-raised)] px-2 py-1 text-xs text-[var(--color-body)]"
						value={sbCategorySettings[cat.key] ?? 'off'}
						onchange={(e) => { sbCategorySettings[cat.key] = e.currentTarget.value as SBAction; saveSBPrefs(); }}
					>
						{#each SB_ACTIONS as action}
							<option value={action.value}>{action.label}</option>
						{/each}
					</select>
				</div>
			{/each}
		</div>

		<!-- Display options -->
		<div class="rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-5 space-y-4">
			<h3 class="text-sm font-medium text-[var(--color-display)]">Display Options</h3>

			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm text-[var(--color-display)]">Show skip notifications</p>
					<p class="text-xs text-[var(--color-muted)]">Toast when a segment is skipped</p>
				</div>
				<button
					class="relative h-6 w-11 rounded-full transition-colors {sbShowSkipNotice ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-raised)]'}"
					onclick={() => { sbShowSkipNotice = !sbShowSkipNotice; saveSBPrefs(); }} aria-label="Toggle show skip notifications"
				>
					<span class="absolute top-0.5 h-5 w-5 rounded-full bg-cream shadow transition-transform {sbShowSkipNotice ? 'translate-x-[22px]' : 'translate-x-0.5'}"></span>
				</button>
			</div>

			{#if sbShowSkipNotice}
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm text-[var(--color-display)]">Skip notice duration</p>
						<p class="text-xs text-[var(--color-muted)]">How long the notice shows (ms, 0 = until dismissed)</p>
					</div>
					<input
						type="number"
						class="rounded-md border border-[rgba(240,235,227,0.1)] bg-[var(--color-raised)] px-2 py-1 text-xs text-[var(--color-body)] w-20"
						value={sbSkipNoticeDuration}
						min="0"
						max="30000"
						step="500"
						onchange={(e) => { sbSkipNoticeDuration = parseInt(e.currentTarget.value) || 0; saveSBPrefs(); }}
					/>
				</div>
			{/if}
		</div>
	{/if}
</section>
