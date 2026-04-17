<script lang="ts">
	import type { OnboardingMeta } from '$lib/adapters/base';
	import ServiceIcon from './ServiceIcon.svelte';

	interface Props {
		adapterId: string;
		displayName: string;
		color: string;
		abbreviation: string;
		defaultPort?: number;
		onboarding: OnboardingMeta;
		connected?: boolean;
		hero?: boolean;
		onConnect?: (data: { type: string; url: string; apiKey?: string; username?: string; password?: string }) => Promise<string | null>;
	}

	let {
		adapterId,
		displayName,
		color,
		abbreviation,
		defaultPort,
		onboarding,
		connected = false,
		hero = false,
		onConnect,
	}: Props = $props();

	const defaultUrl = defaultPort ? `http://localhost:${defaultPort}` : '';

	let expanded = $state(false);
	let url = $state(defaultUrl);
	let apiKey = $state('');
	let username = $state('');
	let password = $state('');
	let testing = $state(false);
	let error = $state('');
	let justConnected = $state(false);

	// ── Plex PIN flow state ────────────────────────────────────────────────
	// Plex auth is token-based. Instead of asking the admin to manually grab
	// an X-Plex-Token out of plex.tv's UI, we run the official plex.tv/link
	// PIN flow: request a PIN, poll until the user enters it, use the returned
	// token as the apiKey.
	const isPlex = $derived(adapterId === 'plex');
	let plexPinId = $state<number | null>(null);
	let plexPinCode = $state<string | null>(null);
	let plexPolling = $state(false);
	let plexServers = $state<Array<{ name: string; clientIdentifier: string; connections: Array<{ uri: string; local: boolean }> }>>([]);
	let plexPollTimer: ReturnType<typeof setInterval> | null = null;

	function toggle() {
		if (!connected && !justConnected) expanded = !expanded;
	}

	async function startPlexFlow() {
		error = '';
		testing = true;
		try {
			const res = await fetch('/api/plex/pin', { method: 'POST' });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Failed to start Plex PIN');
			plexPinId = data.id;
			plexPinCode = data.code;
			plexPolling = true;
			// Poll every 2s for up to ~10 minutes
			let ticks = 0;
			plexPollTimer = setInterval(async () => {
				ticks += 1;
				if (ticks > 300) { stopPlexPolling(); return; }
				try {
					const pollRes = await fetch(`/api/plex/pin?id=${plexPinId}`);
					const pollData = await pollRes.json();
					if (pollData.token) {
						apiKey = pollData.token;
						plexServers = pollData.servers ?? [];
						// Default-select the first local connection if available
						if (plexServers.length > 0 && !url) {
							const first = plexServers[0];
							const localConn = first.connections.find((c) => c.local);
							url = (localConn ?? first.connections[0])?.uri ?? '';
						}
						stopPlexPolling();
					}
				} catch { /* keep polling */ }
			}, 2000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to start Plex PIN';
		} finally {
			testing = false;
		}
	}

	function stopPlexPolling() {
		plexPolling = false;
		if (plexPollTimer) {
			clearInterval(plexPollTimer);
			plexPollTimer = null;
		}
	}

	async function handleConnect() {
		if (!url.trim()) { error = 'URL is required'; return; }
		error = '';
		testing = true;
		const result = await onConnect?.({
			type: adapterId,
			url: url.trim().replace(/\/+$/, ''),
			apiKey: apiKey.trim() || undefined,
			username: username.trim() || undefined,
			password: password || undefined,
		});
		testing = false;
		if (result) { error = result; }
		else { justConnected = true; expanded = false; stopPlexPolling(); }
	}

	const isComplete = $derived(connected || justConnected);
</script>

{#if hero}
	<!-- HERO MODE — Full media server card -->
	<div
		class="relative overflow-hidden rounded-3xl border-2 transition-all duration-500"
		style="border-color: {isComplete ? color : expanded ? color + '60' : 'rgba(255,255,255,0.08)'}; min-height: {expanded ? 'auto' : '220px'}"
	>
		<!-- Background gradient -->
		<div class="absolute inset-0 opacity-[0.07]" style="background: radial-gradient(ellipse at 50% 0%, {color}, transparent 70%)"></div>

		<button
			class="relative flex w-full flex-col items-center gap-5 px-8 py-10 text-center transition-all duration-300 hover:bg-white/[0.02]"
			onclick={toggle}
			disabled={isComplete}
		>
			<!-- Large icon -->
			<div
				class="flex h-20 w-20 items-center justify-center rounded-2xl transition-transform duration-300"
				style="background: {color}20; color: {color}"
				class:scale-110={expanded}
			>
				<ServiceIcon type={adapterId} size={40} />
			</div>

			<div>
				<h3 class="text-xl font-bold text-[var(--color-cream)]">{displayName}</h3>
				<p class="mt-2 text-sm leading-relaxed text-[var(--color-muted)] max-w-xs">{onboarding.description}</p>
			</div>

			{#if isComplete}
				<div class="flex items-center gap-2 rounded-full px-4 py-1.5" style="background: {color}15">
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<circle cx="8" cy="8" r="8" fill="{color}40" />
						<path d="M5 8l2 2 4-4" stroke="{color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<span class="text-sm font-medium" style="color: {color}">Connected</span>
				</div>
			{:else if !expanded}
				<span class="text-sm text-[var(--color-accent)]">Click to connect</span>
			{/if}
		</button>

		{#if expanded && !isComplete}
			<div class="relative border-t px-8 py-6 flex flex-col gap-4" style="border-color: rgba(255,255,255,0.06); background: rgba(0,0,0,0.2)">
				{#if error}
					<div class="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-start gap-2">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
						<span>{error}</span>
					</div>
				{/if}

				{#if isPlex && !apiKey}
					<!-- Plex PIN flow — kicks user over to plex.tv/link -->
					{#if !plexPinCode}
						<p class="text-sm text-[var(--color-muted)]">
							Click below to sign in to Plex. We'll show you a 4-character code to enter at
							<strong>plex.tv/link</strong>.
						</p>
						<button class="btn btn-primary py-3 text-sm" onclick={startPlexFlow} disabled={testing}>
							{testing ? 'Starting...' : 'Sign in with Plex'}
						</button>
						<p class="text-[11px] text-[var(--color-muted)] -mt-1">
							Prefer to paste a token manually?
							<button type="button" class="underline" onclick={() => { plexPinCode = '_manual'; }}>Enter X-Plex-Token</button>
						</p>
					{:else if plexPinCode === '_manual'}
						<label class="flex flex-col gap-2">
							<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">X-Plex-Token</span>
							<input type="text" bind:value={apiKey} placeholder="Paste your X-Plex-Token" class="input font-mono" />
							<span class="text-[11px] text-[var(--color-muted)]">Find yours at plex.tv/security or via any Plex web request.</span>
						</label>
					{:else}
						<div class="rounded-xl border px-4 py-3 text-center" style="border-color: {color}40; background: {color}08">
							<p class="text-xs uppercase tracking-wider text-[var(--color-muted)]">Your PIN</p>
							<p class="mt-1 text-3xl font-mono font-bold tracking-widest" style="color: {color}">{plexPinCode}</p>
							<p class="mt-2 text-xs text-[var(--color-muted)]">
								Enter this at <a href="https://plex.tv/link" target="_blank" rel="noopener" class="underline" style="color: {color}">plex.tv/link</a>
								{#if plexPolling}
									<span class="ml-1 inline-flex items-center gap-1">
										<svg class="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93"/></svg>
										Waiting...
									</span>
								{/if}
							</p>
						</div>
					{/if}
				{/if}

				{#if onboarding.requiredFields.includes('url')}
					<label class="flex flex-col gap-2">
						<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Server URL</span>
						{#if isPlex && plexServers.length > 0}
							<select bind:value={url} class="input">
								{#each plexServers as srv (srv.clientIdentifier)}
									{#each srv.connections as conn (conn.uri)}
										<option value={conn.uri}>{srv.name} — {conn.local ? 'Local' : 'Remote'}: {conn.uri}</option>
									{/each}
								{/each}
							</select>
						{:else}
							<input type="url" bind:value={url} placeholder={defaultUrl || 'http://localhost:8096'} class="input" />
						{/if}
					</label>
				{/if}

				{#if onboarding.supportsAutoAuth}
					<div class="grid grid-cols-2 gap-4">
						{#if onboarding.requiredFields.includes('username')}
							<label class="flex flex-col gap-2">
								<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</span>
								<input type="text" bind:value={username} placeholder="admin" class="input" />
							</label>
						{/if}
						{#if onboarding.requiredFields.includes('password')}
							<label class="flex flex-col gap-2">
								<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</span>
								<input type="password" bind:value={password} placeholder="--------" class="input" />
							</label>
						{/if}
					</div>
					<p class="text-[11px] text-[var(--color-muted)] -mt-1">Nexus will authenticate automatically -- no API key needed.</p>
				{:else if onboarding.requiredFields.includes('apiKey') && !isPlex}
					<label class="flex flex-col gap-2">
						<span class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">API Key</span>
						<input type="text" bind:value={apiKey} placeholder="Paste your API key" class="input font-mono" />
						<span class="text-[11px] text-[var(--color-muted)]">Found in {displayName} Settings &rarr; General</span>
					</label>
				{/if}

				{#if !isPlex || apiKey}
					<button class="btn btn-primary py-3 text-sm" onclick={handleConnect} disabled={testing}>
						{#if testing}
							<span class="flex items-center justify-center gap-2">
								<svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93"/></svg>
								Testing connection...
							</span>
						{:else}
							Connect to {displayName}
						{/if}
					</button>
				{/if}
			</div>
		{/if}
	</div>

{:else}
	<!-- GRID MODE — Compact add-on card -->
	<div
		class="rounded-2xl border transition-all duration-300 overflow-hidden"
		style="border-color: {isComplete ? color + '40' : expanded ? color + '30' : 'rgba(255,255,255,0.06)'}; background: {isComplete ? color + '06' : 'rgba(255,255,255,0.02)'}"
	>
		<button
			class="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
			onclick={toggle}
			disabled={isComplete}
		>
			<div
				class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
				style="background: {color}18; color: {color}"
			>
				<ServiceIcon type={adapterId} size={20} />
			</div>
			<div class="min-w-0 flex-1">
				<div class="text-sm font-semibold text-[var(--color-cream)]">{displayName}</div>
				<div class="text-xs text-[var(--color-muted)] mt-0.5">{onboarding.description}</div>
			</div>
			{#if isComplete}
				<div class="flex items-center gap-1.5 rounded-full px-3 py-1" style="background: {color}12">
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="{color}40"/><path d="M4 6l1.5 1.5 3-3" stroke="{color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
					<span class="text-[11px] font-medium" style="color: {color}">Connected</span>
				</div>
			{:else}
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="text-[var(--color-muted)] transition-transform duration-200 {expanded ? 'rotate-180' : ''}">
					<path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			{/if}
		</button>

		{#if expanded && !isComplete}
			<div class="border-t px-4 py-4 flex flex-col gap-3" style="border-color: rgba(255,255,255,0.06); background: rgba(0,0,0,0.15)">
				{#if error}
					<div class="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>
				{/if}

				{#if onboarding.requiredFields.includes('url')}
					<label class="flex flex-col gap-1.5">
						<span class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Server URL</span>
						<input type="url" bind:value={url} placeholder={defaultUrl || 'http://localhost:8080'} class="input text-sm" />
					</label>
				{/if}

				{#if onboarding.supportsAutoAuth}
					<div class="grid grid-cols-2 gap-3">
						{#if onboarding.requiredFields.includes('username')}
							<label class="flex flex-col gap-1.5">
								<span class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Username</span>
								<input type="text" bind:value={username} placeholder="admin" class="input text-sm" />
							</label>
						{/if}
						{#if onboarding.requiredFields.includes('password')}
							<label class="flex flex-col gap-1.5">
								<span class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Password</span>
								<input type="password" bind:value={password} placeholder="--------" class="input text-sm" />
							</label>
						{/if}
					</div>
				{:else if onboarding.requiredFields.includes('apiKey')}
					<label class="flex flex-col gap-1.5">
						<span class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">API Key</span>
						<input type="text" bind:value={apiKey} placeholder="Paste your API key" class="input text-sm font-mono" />
					</label>
				{/if}

				<button class="btn btn-primary mt-1 text-sm" onclick={handleConnect} disabled={testing}>
					{#if testing}
						<span class="flex items-center justify-center gap-2">
							<svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93"/></svg>
							Testing...
						</span>
					{:else}
						Connect
					{/if}
				</button>
			</div>
		{/if}
	</div>
{/if}
