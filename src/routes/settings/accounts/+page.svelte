<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	// ── Account linking state ──────────────────────────────────
	let linkServiceId = $state('');
	let linkUsername = $state('');
	let linkPassword = $state('');
	let linking = $state(false);
	let linkError = $state<string | null>(null);
	let linkSuccess = $state<string | null>(null);

	const credMap = $derived(Object.fromEntries((data as any).myCredentials?.map((c: any) => [c.serviceId, c]) ?? []));
	const unlinkableServices = $derived(((data as any).linkableServices ?? []).filter((s: any) => !credMap[s.id]));
	const hasJellyfinLinked = $derived(
		data.services.some((s: any) => s.type === 'jellyfin' && credMap[s.id])
	);

	const serviceColors: Record<string, string> = {
		jellyfin: '#00a4dc', calibre: '#7b68ee', romm: '#e84393', overseerr: '#f59e0b',
		radarr: '#fbbf24', sonarr: '#00d4aa', lidarr: '#1db954', prowlarr: '#ef4444',
		streamystats: '#b088f9'
	};

	async function linkAccount() {
		if (!linkServiceId || !linkUsername || !linkPassword) return;
		linking = true; linkError = null; linkSuccess = null;
		try {
			const res = await fetch('/api/user/credentials', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId: linkServiceId, username: linkUsername, password: linkPassword })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) { linkError = body.error ?? 'Failed to link account'; return; }
			linkSuccess = `Linked as ${body.externalUsername}`;
			linkServiceId = ''; linkUsername = ''; linkPassword = '';
			await invalidateAll();
		} catch (e) { linkError = String(e); }
		finally { linking = false; }
	}

	async function autoLinkAccount(serviceId: string) {
		linking = true; linkError = null; linkSuccess = null;
		try {
			const res = await fetch('/api/user/credentials', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId, autoLink: true })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) { linkError = body.error ?? 'Auto-link failed'; return; }
			linkSuccess = `Auto-linked as ${body.externalUsername}`;
			await invalidateAll();
		} catch (e) { linkError = String(e); }
		finally { linking = false; }
	}

	async function unlinkAccount(serviceId: string) {
		await fetch(`/api/user/credentials?serviceId=${encodeURIComponent(serviceId)}`, { method: 'DELETE' });
		await invalidateAll();
	}
</script>

<section class="mb-8">
	<div class="flex items-center gap-2 mb-2">
		<h2 class="text-display text-base font-semibold">My Linked Accounts</h2>
		<span class="badge text-[10px] bg-[var(--color-steel)]/20 text-[var(--color-steel)]">Personal</span>
	</div>
	<p class="text-sm text-[var(--color-muted)] mb-1">These are <strong class="text-[var(--color-body)]">your</strong> credentials — only you can see them. Linking lets Nexus show your personal watch history, reading progress, and request media on your behalf.</p>
	<div class="mb-4 flex items-start gap-2 rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-muted)]">
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="mt-0.5 flex-shrink-0 text-[var(--color-muted)]"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
		<span>Your admin has set up these services. Enter <em>your own</em> username/password for each one — not the admin's API key.</span>
	</div>

	{#if data.linkableServices.length === 0}
		<div class="card py-12 text-center">
			<p class="text-sm text-[var(--color-muted)]">No user-linkable services configured yet.</p>
			<p class="text-xs text-[var(--color-muted)] mt-1">Ask your admin to add Jellyfin, Overseerr, or Calibre.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each data.linkableServices as svc}
				{@const cred = credMap[svc.id]}
				{@const color = serviceColors[svc.type] ?? 'var(--color-accent)'}
				{@const isLinking = linkServiceId === svc.id}
				{@const isAuto = svc.authMode === 'auto-jellyfin'}
				{@const isProvisioned = svc.authMode === 'auto-provisioned'}
				{@const isNeedsReauth = svc.authMode === 'needs-reauth'}
				{@const autoConnected = isAuto && (svc.type === 'streamystats' ? hasJellyfinLinked : (hasJellyfinLinked && !!cred))}
				{@const autoWaiting = isAuto && hasJellyfinLinked && !cred && svc.type !== 'streamystats'}
				<div class="card-raised overflow-hidden">
					<!-- Service row -->
					<div class="flex items-center gap-3 px-4 py-3">
						<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold" style="background: {color}18; color: {color}">
							{svc.type.slice(0, 2).toUpperCase()}
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-medium text-sm">{svc.name}</span>
								<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)]">{svc.type}</span>
								{#if isAuto}
									{#if autoConnected}
										<span class="badge text-[10px] bg-[var(--color-steel)]/20 text-[var(--color-steel)]">Auto-connected</span>
									{:else if autoWaiting}
										<span class="badge text-[10px] bg-amber-500/20 text-amber-400">Setting up...</span>
									{:else}
										<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)]">Needs Jellyfin</span>
									{/if}
								{:else if isProvisioned}
									<span class="badge text-[10px] bg-[var(--color-steel)]/20 text-[var(--color-steel)]">Connected</span>
								{:else if isNeedsReauth}
									<span class="badge text-[10px] bg-amber-500/20 text-amber-400">Session expired</span>
								{:else if cred}
									<span class="badge text-[10px] bg-[var(--color-steel)]/20 text-[var(--color-steel)]">Connected</span>
								{/if}
							</div>

							{#if isAuto}
								{#if autoConnected}
									<div class="mt-0.5 flex items-center gap-2 flex-wrap">
										{#if cred?.externalUsername}
											<span class="text-xs text-[var(--color-body)] font-medium">@{cred.externalUsername}</span>
										{/if}
										<span class="text-xs text-[var(--color-muted)]">via Jellyfin — no separate login needed</span>
									</div>
								{:else if autoWaiting}
									<p class="mt-0.5 text-xs text-[var(--color-muted)]">Refresh to retry — Jellyfin is linked but {svc.name} couldn't be reached</p>
								{:else}
									<p class="mt-0.5 text-xs text-[var(--color-muted)]">Link your Jellyfin account above to activate</p>
								{/if}
							{:else if isProvisioned}
								<div class="mt-0.5 flex items-center gap-2 flex-wrap">
									{#if cred?.externalUsername}
										<span class="text-xs text-[var(--color-body)] font-medium">@{cred.externalUsername}</span>
									{/if}
									<span class="text-xs text-[var(--color-muted)]">set up by admin</span>
								</div>
							{:else if isNeedsReauth}
								<p class="mt-0.5 text-xs text-amber-400/80">Refresh your session to activate personalized features like For You recommendations</p>
							{:else if cred}
								<div class="mt-0.5 flex items-center gap-2 flex-wrap">
									<span class="text-xs text-[var(--color-body)] font-medium">@{cred.externalUsername ?? 'unknown'}</span>
									{#if cred.externalUserId}
										<span class="font-mono text-[10px] text-[var(--color-muted)]">id:{cred.externalUserId}</span>
									{/if}
									{#if cred.linkedAt}
										<span class="text-[10px] text-[var(--color-muted)]">connected {new Date(cred.linkedAt).toLocaleDateString()}</span>
									{/if}
								</div>
							{:else}
								<p class="mt-0.5 text-xs text-[var(--color-muted)]">Not connected — click Link to connect your account</p>
							{/if}
						</div>

						<div class="flex-shrink-0">
							{#if isAuto || isProvisioned}
								<!-- Fully automatic — no action needed -->
							{:else if isNeedsReauth}
								<button
									class="btn btn-ghost text-xs {linkServiceId === svc.id ? 'text-[var(--color-accent)]' : 'text-amber-400'}"
									onclick={() => { linkServiceId = linkServiceId === svc.id ? '' : svc.id; linkUsername = (svc as any).prefillUsername ?? ''; linkPassword = ''; linkError = null; linkSuccess = null; }}
								>{linkServiceId === svc.id ? 'Cancel' : 'Refresh'}</button>
							{:else if cred}
								<button class="btn btn-ghost text-xs text-[var(--color-warm)]" onclick={() => unlinkAccount(svc.id)}>Unlink</button>
							{:else}
								<button
									class="btn btn-ghost text-xs {isLinking ? 'text-[var(--color-accent)]' : ''}"
									onclick={() => { linkServiceId = isLinking ? '' : svc.id; linkUsername = ''; linkPassword = ''; linkError = null; linkSuccess = null; }}
								>{isLinking ? 'Cancel' : 'Link'}</button>
							{/if}
						</div>
					</div>

					<!-- Manual link feedback -->
					{#if !isLinking && (linkError || linkSuccess)}
						<div class="border-t border-[rgba(240,235,227,0.06)] px-4 py-2 bg-[var(--color-surface)]/50">
							{#if linkError}<p class="text-xs text-[var(--color-warm)]">{linkError}</p>{/if}
							{#if linkSuccess}<p class="text-xs text-[var(--color-steel)]">{linkSuccess}</p>{/if}
						</div>
					{/if}

					<!-- Inline manual link form -->
					{#if isLinking}
						<div class="border-t border-[rgba(240,235,227,0.06)] px-4 pt-3 pb-4 bg-[var(--color-surface)]/50">
							<div class="grid gap-3 sm:grid-cols-2">
								<div>
									<label for="link-u-{svc.id}" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{svc.authUsernameLabel ?? 'Username'}</label>
									<input id="link-u-{svc.id}" bind:value={linkUsername} class="input text-sm" placeholder={svc.type === 'overseerr' ? 'Your email address' : `Your ${svc.type} username`} autocomplete="username" />
								</div>
								<div>
									<label for="link-p-{svc.id}" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</label>
									<input id="link-p-{svc.id}" bind:value={linkPassword} class="input text-sm" type="password" placeholder="Your password" autocomplete="current-password" />
								</div>
							</div>
							{#if linkError}
								<div class="mt-2 rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-xs text-[var(--color-warm)]">{linkError}</div>
							{/if}
							{#if linkSuccess}
								<div class="mt-2 rounded-lg border border-[var(--color-steel)]/30 bg-[rgba(61,143,132,0.1)] px-3 py-2 text-xs text-[var(--color-steel)]">{linkSuccess}</div>
							{/if}
							<button class="btn btn-primary text-sm mt-3" onclick={linkAccount} disabled={linking || !linkUsername || !linkPassword}>
								{linking ? 'Linking...' : 'Link Account'}
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>
