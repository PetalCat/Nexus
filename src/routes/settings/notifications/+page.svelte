<script lang="ts">
	// ── Notification preferences state ─────────────────────────
	let notifPrefs = $state<Record<string, boolean>>({});
	let notifTypes = $state<Record<string, { label: string; description: string }>>({});
	let notifPrefsLoading = $state(false);
	let notifPrefsLoaded = $state(false);
	let notifPrefSaving = $state<string | null>(null);

	async function loadNotifPrefs() {
		if (notifPrefsLoaded) return;
		notifPrefsLoading = true;
		try {
			const res = await fetch('/api/notifications/preferences');
			const json = await res.json();
			notifPrefs = json.preferences ?? {};
			notifTypes = json.types ?? {};
			notifPrefsLoaded = true;
		} catch { /* silent */ }
		finally { notifPrefsLoading = false; }
	}

	async function toggleNotifPref(type: string) {
		const newVal = !notifPrefs[type];
		notifPrefs[type] = newVal;
		notifPrefSaving = type;
		try {
			await fetch('/api/notifications/preferences', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ preferences: { [type]: newVal } })
			});
		} catch {
			notifPrefs[type] = !newVal; // revert
		}
		finally { notifPrefSaving = null; }
	}

	$effect(() => {
		loadNotifPrefs();
	});
</script>

<section class="mb-8">
	<h2 class="text-display mb-1 text-base font-semibold">Notification Preferences</h2>
	<p class="text-body-muted mb-5 text-xs">Choose which notifications you want to receive.</p>

	{#if notifPrefsLoading}
		<div class="space-y-3">
			{#each { length: 6 } as _, i (i)}
				<div class="flex items-center justify-between rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-4">
					<div class="space-y-1.5">
						<div class="h-4 w-32 rounded bg-[var(--color-raised)] animate-pulse"></div>
						<div class="h-3 w-48 rounded bg-[var(--color-raised)] animate-pulse"></div>
					</div>
					<div class="h-6 w-11 rounded-full bg-[var(--color-raised)] animate-pulse"></div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="space-y-2">
			{#each Object.entries(notifTypes) as [type, meta] (type)}
				<div class="flex items-center justify-between rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-4">
					<div>
						<p class="text-sm font-medium text-[var(--color-display)]">{meta.label}</p>
						<p class="mt-0.5 text-xs text-[var(--color-muted)]">{meta.description}</p>
					</div>
					<button
						class="relative h-6 w-11 rounded-full transition-colors {notifPrefs[type] ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-raised)]'}"
						onclick={() => toggleNotifPref(type)}
						disabled={notifPrefSaving === type}
						aria-label="Toggle {meta.label}"
					>
						<span
							class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform {notifPrefs[type] ? 'translate-x-[22px]' : 'translate-x-0.5'}"
						></span>
					</button>
				</div>
			{/each}
		</div>
	{/if}
</section>
