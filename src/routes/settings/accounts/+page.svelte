<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';

	let { data }: { data: PageData } = $props();

	// ── State ──────────────────────────────────
	let linkingServiceId = $state<string | null>(null);
	let linkUsername = $state('');
	let linkPassword = $state('');
	let linking = $state(false);
	let linkError = $state<string | null>(null);
	let linkSuccess = $state<string | null>(null);

	// Account picker state
	let pickerServiceId = $state<string | null>(null);
	let pickerUsers = $state<any[]>([]);
	let pickerLoading = $state(false);
	let pickerSelected = $state<string | null>(null);

	const credMap = $derived(
		Object.fromEntries((data as any).myCredentials?.map((c: any) => [c.serviceId, c]) ?? [])
	);
	const unclaimedCounts: Record<string, number> = $derived((data as any).unclaimedCounts ?? {});
	const hasJellyfinLinked = $derived(
		(data as any).linkableServices?.some((s: any) => s.type === 'jellyfin' && credMap[s.id])
	);

	// Categorize services
	const jellyfinServices = $derived(
		((data as any).linkableServices ?? []).filter((s: any) => s.type === 'jellyfin')
	);
	const autoServices = $derived(
		((data as any).linkableServices ?? []).filter(
			(s: any) =>
				s.type !== 'jellyfin' &&
				(s.authMode === 'auto-jellyfin' || s.authMode === 'auto-provisioned')
		)
	);
	const otherServices = $derived(
		((data as any).linkableServices ?? []).filter(
			(s: any) =>
				s.type !== 'jellyfin' &&
				s.authMode !== 'auto-jellyfin' &&
				s.authMode !== 'auto-provisioned'
		)
	);

	const serviceColors: Record<string, string> = {
		jellyfin: '#00a4dc',
		calibre: '#7b68ee',
		romm: '#e84393',
		overseerr: '#f59e0b',
		streamystats: '#b088f9'
	};

	// ── Actions ──────────────────────────────────
	async function openPicker(serviceId: string) {
		pickerServiceId = serviceId;
		pickerLoading = true;
		pickerUsers = [];
		pickerSelected = null;
		linkError = null;
		linkSuccess = null;
		try {
			const res = await fetch(
				`/api/user/credentials/discover?serviceId=${encodeURIComponent(serviceId)}`
			);
			pickerUsers = await res.json();
		} catch {
			pickerUsers = [];
			toast.error('Failed to discover accounts');
		} finally {
			pickerLoading = false;
		}
	}

	async function pickAccount(serviceId: string, externalId: string) {
		linking = true;
		linkError = null;
		linkSuccess = null;
		try {
			const res = await fetch('/api/user/credentials', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId, pickExternalId: externalId })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				linkError = body.error ?? 'Failed to link account';
				return;
			}
			linkSuccess = `Connected as ${body.externalUsername}`;
			pickerServiceId = null;
			pickerUsers = [];
			await invalidateAll();
		} catch (e) {
			linkError = String(e);
		} finally {
			linking = false;
		}
	}

	function openManualLink(serviceId: string) {
		linkingServiceId = serviceId;
		pickerServiceId = null;
		const svc = (data as any).linkableServices?.find((s: any) => s.id === serviceId);
		linkUsername = svc?.prefillUsername ?? '';
		linkPassword = '';
		linkError = null;
		linkSuccess = null;
	}

	async function linkAccount(serviceId: string) {
		if (!linkUsername || !linkPassword) return;
		linking = true;
		linkError = null;
		linkSuccess = null;
		try {
			const res = await fetch('/api/user/credentials', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId, username: linkUsername, password: linkPassword })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				linkError = body.error ?? 'Failed to link account';
				return;
			}
			linkSuccess = `Connected as ${body.externalUsername}`;
			linkingServiceId = null;
			linkUsername = '';
			linkPassword = '';
			await invalidateAll();
		} catch (e) {
			linkError = String(e);
		} finally {
			linking = false;
		}
	}

	async function unlinkAccount(serviceId: string) {
		await fetch(`/api/user/credentials?serviceId=${encodeURIComponent(serviceId)}`, {
			method: 'DELETE'
		});
		await invalidateAll();
	}
</script>

<section class="mb-8">
	<h2 class="text-display text-base font-semibold mb-1">Linked Accounts</h2>
	<p class="text-sm text-[var(--color-muted)] mb-6">
		Connect your accounts to enable personalized content, watch history, and recommendations.
	</p>

	{#if (data as any).linkableServices?.length === 0}
		<div class="card py-12 text-center">
			<p class="text-sm text-[var(--color-muted)]">
				{#if (data as any).isAdmin}
					No services configured yet. <a
						href="/admin/services"
						class="text-[var(--color-accent)] hover:underline">Add services</a
					> to get started.
				{:else}
					No services available yet.
				{/if}
			</p>
		</div>
	{:else}
		<!-- Jellyfin (Primary) -->
		{#if jellyfinServices.length > 0}
			<div class="mb-6">
				<h3
					class="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)] mb-3"
				>
					Media Server
				</h3>
				{#each jellyfinServices as svc (svc.id)}
					{@const cred = credMap[svc.id]}
					{@const unclaimed = unclaimedCounts[svc.id] ?? 0}
					{@const isPicking = pickerServiceId === svc.id}
					{@const isManualLink = linkingServiceId === svc.id}
					{@const needsReauth = svc.authMode === 'needs-reauth'}
					<div
						class="rounded-2xl overflow-hidden"
						style="background: rgba(0,164,220,0.04); border: 1px solid rgba(0,164,220,0.15)"
					>
						<div class="flex items-center gap-4 px-5 py-4">
							<div
								class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold"
								style="background: rgba(0,164,220,0.15); color: #00a4dc"
							>
								JF
							</div>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="font-semibold text-sm">{svc.name}</span>
									{#if cred}
										<span
											class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
											style="background: rgba(52,211,153,0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.2)"
										>
											<span
												class="h-1.5 w-1.5 rounded-full bg-[#34d399]"
												style="box-shadow: 0 0 4px #34d39988"
											></span>
											Connected
										</span>
									{:else if needsReauth}
										<span
											class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
											style="background: rgba(245,158,11,0.12); color: #f59e0b; border: 1px solid rgba(245,158,11,0.2)"
											>Session Expired</span
										>
									{/if}
								</div>
								{#if cred}
									<p class="text-xs text-[var(--color-body)] mt-0.5">
										Signed in as <span class="font-medium"
											>@{cred.externalUsername}</span
										>
									</p>
								{:else if unclaimed > 0}
									<p class="text-xs text-[var(--color-muted)] mt-0.5">
										{unclaimed} account{unclaimed !== 1 ? 's' : ''} available — select
										yours below
									</p>
								{:else}
									<p class="text-xs text-[var(--color-muted)] mt-0.5">
										Sign in with your Jellyfin credentials
									</p>
								{/if}
							</div>
							<div class="flex-shrink-0">
								{#if cred && !needsReauth}
									<button
										class="btn btn-ghost text-xs text-[var(--color-warm)]"
										onclick={() => unlinkAccount(svc.id)}>Disconnect</button
									>
								{:else if !isPicking && !isManualLink}
									{#if needsReauth}
										<button
											class="btn btn-ghost text-xs text-[#f59e0b]"
											onclick={() => openManualLink(svc.id)}>Refresh</button
										>
									{:else if unclaimed > 0}
										<button
											class="btn btn-ghost text-xs text-[var(--color-accent)]"
											onclick={() => openPicker(svc.id)}>Choose Account</button
										>
									{:else}
										<button
											class="btn btn-ghost text-xs text-[var(--color-accent)]"
											onclick={() => openManualLink(svc.id)}>Sign In</button
										>
									{/if}
								{:else}
									<button
										class="btn btn-ghost text-xs text-[var(--color-muted)]"
										onclick={() => {
											pickerServiceId = null;
											linkingServiceId = null;
										}}>Cancel</button
									>
								{/if}
							</div>
						</div>

						<!-- Account picker -->
						{#if isPicking}
							<div
								class="border-t px-5 py-4"
								style="border-color: rgba(0,164,220,0.1); background: rgba(0,164,220,0.02)"
							>
								{#if pickerLoading}
									<p class="text-xs text-[var(--color-muted)]">
										Loading accounts...
									</p>
								{:else if pickerUsers.length === 0}
									<p class="text-xs text-[var(--color-muted)] mb-2">
										No unclaimed accounts found.
									</p>
									<button
										class="text-xs text-[var(--color-accent)] hover:underline"
										onclick={() => openManualLink(svc.id)}
										>Sign in manually instead</button
									>
								{:else}
									<p class="text-xs text-[var(--color-muted)] mb-3">
										Select your account:
									</p>
									<div
										class="flex flex-col divide-y rounded-xl overflow-hidden mb-3"
										style="border: 1px solid rgba(255,255,255,0.08); divide-color: rgba(255,255,255,0.04)"
									>
										{#each pickerUsers as user (user.externalId)}
											<button
												class="flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-cream/[0.04] {pickerSelected === user.externalId ? 'bg-cream/[0.06]' : ''}"
												onclick={() => {
													pickerSelected = user.externalId;
												}}
											>
												<div
													class="h-2.5 w-2.5 rounded-full border-2 flex-shrink-0 {pickerSelected === user.externalId ? 'border-[var(--color-accent)] bg-[var(--color-accent)]' : 'border-[var(--color-muted)]'}"
												></div>
												<span class="text-sm font-medium"
													>{user.username}</span
												>
												{#if user.isAdmin}
													<span
														class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
														style="background: rgba(124,108,248,0.12); color: var(--color-accent)"
														>Admin</span
													>
												{/if}
											</button>
										{/each}
									</div>
									<div class="flex items-center gap-2">
										<button
											class="rounded-lg px-4 py-1.5 text-xs font-medium text-[var(--color-cream)] disabled:opacity-40"
											style="background: #00a4dc"
											disabled={!pickerSelected || linking}
											onclick={() =>
												pickerSelected && pickAccount(svc.id, pickerSelected)}
										>
											{linking ? 'Connecting...' : "This is me"}
										</button>
										<button
											class="text-xs text-[var(--color-muted)] hover:underline"
											onclick={() => openManualLink(svc.id)}
											>Sign in manually</button
										>
									</div>
								{/if}
								{#if linkError}
									<div
										class="mt-2 rounded-lg px-3 py-2 text-xs"
										style="background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.15); color: #f87171"
									>
										{linkError}
									</div>
								{/if}
							</div>
						{/if}

						<!-- Manual sign in form -->
						{#if isManualLink || needsReauth}
							<div
								class="border-t px-5 py-4"
								style="border-color: rgba(0,164,220,0.1); background: rgba(0,164,220,0.02)"
							>
								<div class="grid gap-3 sm:grid-cols-2">
									<div>
										<label
											for="jf-u-{svc.id}"
											class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
											>Username</label
										>
										<input
											id="jf-u-{svc.id}"
											bind:value={linkUsername}
											class="input text-sm"
											placeholder="Your Jellyfin username"
											autocomplete="username"
										/>
									</div>
									<div>
										<label
											for="jf-p-{svc.id}"
											class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
											>Password</label
										>
										<input
											id="jf-p-{svc.id}"
											bind:value={linkPassword}
											class="input text-sm"
											type="password"
											placeholder="Your password"
											autocomplete="current-password"
										/>
									</div>
								</div>
								{#if linkError}
									<div
										class="mt-2 rounded-lg px-3 py-2 text-xs"
										style="background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.15); color: #f87171"
									>
										{linkError}
									</div>
								{/if}
								{#if linkSuccess}
									<div
										class="mt-2 rounded-lg px-3 py-2 text-xs"
										style="background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.15); color: #34d399"
									>
										{linkSuccess}
									</div>
								{/if}
								<button
									class="btn btn-primary text-sm mt-3"
									onclick={() => linkAccount(svc.id)}
									disabled={linking || !linkUsername || !linkPassword}
								>
									{linking ? 'Connecting...' : 'Sign In'}
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Auto-Connected Services -->
		{#if autoServices.length > 0 && hasJellyfinLinked}
			<div class="mb-6">
				<h3
					class="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)] mb-3"
				>
					Connected via Jellyfin
				</h3>
				<div class="flex flex-wrap gap-2">
					{#each autoServices as svc (svc.id)}
						{@const cred = credMap[svc.id]}
						{@const color = serviceColors[svc.type] ?? 'var(--color-accent)'}
						<div
							class="flex items-center gap-2 rounded-xl px-4 py-2.5"
							style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08)"
						>
							<div
								class="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold"
								style="background: {color}18; color: {color}"
							>
								{svc.type.slice(0, 2).toUpperCase()}
							</div>
							<div>
								<span class="text-xs font-medium">{svc.name}</span>
								{#if cred?.externalUsername}
									<span class="text-[10px] text-[var(--color-muted)] ml-1"
										>@{cred.externalUsername}</span
									>
								{/if}
							</div>
							<span
								class="h-1.5 w-1.5 rounded-full bg-[#34d399] ml-1"
								style="box-shadow: 0 0 4px #34d39988"
							></span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Other Services -->
		{#if otherServices.length > 0}
			<div>
				<h3
					class="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)] mb-3"
				>
					Other Services
				</h3>
				<div class="flex flex-col gap-2">
					{#each otherServices as svc (svc.id)}
						{@const cred = credMap[svc.id]}
						{@const color = serviceColors[svc.type] ?? 'var(--color-accent)'}
						{@const unclaimed = unclaimedCounts[svc.id] ?? 0}
						{@const isPicking = pickerServiceId === svc.id}
						{@const isManualLink = linkingServiceId === svc.id}
						<div class="card-raised overflow-hidden">
							<div class="flex items-center gap-3 px-4 py-3">
								<div
									class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold"
									style="background: {color}18; color: {color}"
								>
									{svc.type.slice(0, 2).toUpperCase()}
								</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<span class="font-medium text-sm">{svc.name}</span>
										{#if cred}
											<span
												class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
												style="background: rgba(52,211,153,0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.2)"
											>
												<span
													class="h-1.5 w-1.5 rounded-full bg-[#34d399]"
													style="box-shadow: 0 0 4px #34d39988"
												></span>
												Connected
											</span>
										{/if}
									</div>
									{#if cred}
										<p class="text-xs text-[var(--color-body)] mt-0.5">
											@{cred.externalUsername ?? 'unknown'}
										</p>
									{:else if unclaimed > 0}
										<p class="text-xs text-[var(--color-muted)] mt-0.5">
											{unclaimed} account{unclaimed !== 1 ? 's' : ''} available
										</p>
									{:else}
										<p class="text-xs text-[var(--color-muted)] mt-0.5">
											Not connected
										</p>
									{/if}
								</div>
								<div class="flex-shrink-0">
									{#if cred}
										<button
											class="btn btn-ghost text-xs text-[var(--color-warm)]"
											onclick={() => unlinkAccount(svc.id)}>Disconnect</button
										>
									{:else if !isPicking && !isManualLink}
										{#if unclaimed > 0}
											<button
												class="btn btn-ghost text-xs text-[var(--color-accent)]"
												onclick={() => openPicker(svc.id)}
												>Choose Account</button
											>
										{:else}
											<button
												class="btn btn-ghost text-xs text-[var(--color-accent)]"
												onclick={() => openManualLink(svc.id)}>Sign In</button
											>
										{/if}
									{:else}
										<button
											class="btn btn-ghost text-xs text-[var(--color-muted)]"
											onclick={() => {
												pickerServiceId = null;
												linkingServiceId = null;
											}}>Cancel</button
										>
									{/if}
								</div>
							</div>

							<!-- Account picker for other services -->
							{#if isPicking}
								<div
									class="border-t border-[rgba(240,235,227,0.06)] px-4 py-3"
									style="background: rgba(255,255,255,0.02)"
								>
									{#if pickerLoading}
										<p class="text-xs text-[var(--color-muted)]">
											Loading accounts...
										</p>
									{:else if pickerUsers.length === 0}
										<p class="text-xs text-[var(--color-muted)] mb-2">
											No unclaimed accounts.
										</p>
										<button
											class="text-xs text-[var(--color-accent)] hover:underline"
											onclick={() => openManualLink(svc.id)}
											>Sign in manually</button
										>
									{:else}
										<p class="text-xs text-[var(--color-muted)] mb-2">
											Select your account:
										</p>
										<div
											class="flex flex-col divide-y rounded-lg overflow-hidden mb-2"
											style="border: 1px solid rgba(255,255,255,0.06); divide-color: rgba(255,255,255,0.04)"
										>
											{#each pickerUsers as user (user.externalId)}
												<button
													class="flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-cream/[0.04] {pickerSelected === user.externalId ? 'bg-cream/[0.06]' : ''}"
													onclick={() => {
														pickerSelected = user.externalId;
													}}
												>
													<div
														class="h-2 w-2 rounded-full border-2 flex-shrink-0 {pickerSelected === user.externalId ? 'border-[var(--color-accent)] bg-[var(--color-accent)]' : 'border-[var(--color-muted)]'}"
													></div>
													<span class="text-xs font-medium"
														>{user.username}</span
													>
												</button>
											{/each}
										</div>
										<button
											class="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-cream)] disabled:opacity-40"
											style="background: var(--color-accent)"
											disabled={!pickerSelected || linking}
											onclick={() =>
												pickerSelected &&
												pickAccount(svc.id, pickerSelected)}
										>
											{linking ? 'Connecting...' : "This is me"}
										</button>
									{/if}
									{#if linkError}
										<div
											class="mt-2 rounded-lg px-3 py-2 text-xs text-[var(--color-warm)]"
											style="background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.15)"
										>
											{linkError}
										</div>
									{/if}
								</div>
							{/if}

							<!-- Manual link form for other services -->
							{#if isManualLink}
								<div
									class="border-t border-[rgba(240,235,227,0.06)] px-4 pt-3 pb-4"
									style="background: rgba(255,255,255,0.02)"
								>
									<div class="grid gap-3 sm:grid-cols-2">
										<div>
											<label
												for="link-u-{svc.id}"
												class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
												>{svc.authUsernameLabel ?? 'Username'}</label
											>
											<input
												id="link-u-{svc.id}"
												bind:value={linkUsername}
												class="input text-sm"
												placeholder="Your username"
												autocomplete="username"
											/>
										</div>
										<div>
											<label
												for="link-p-{svc.id}"
												class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
												>Password</label
											>
											<input
												id="link-p-{svc.id}"
												bind:value={linkPassword}
												class="input text-sm"
												type="password"
												placeholder="Your password"
												autocomplete="current-password"
											/>
										</div>
									</div>
									{#if linkError}
										<div
											class="mt-2 rounded-lg px-3 py-2 text-xs text-[var(--color-warm)]"
											style="background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.15)"
										>
											{linkError}
										</div>
									{/if}
									<button
										class="btn btn-primary text-sm mt-3"
										onclick={() => linkAccount(svc.id)}
										disabled={linking || !linkUsername || !linkPassword}
									>
										{linking ? 'Connecting...' : 'Sign In'}
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Global success message -->
		{#if linkSuccess && !pickerServiceId && !linkingServiceId}
			<div
				class="mt-4 rounded-lg px-3 py-2 text-xs"
				style="background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.15); color: #34d399"
			>
				{linkSuccess}
			</div>
		{/if}
	{/if}
</section>
