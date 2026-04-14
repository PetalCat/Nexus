<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';
	import AccountLinkModal from '$lib/components/account-linking/AccountLinkModal.svelte';
	import StaleCredentialBanner from '$lib/components/account-linking/StaleCredentialBanner.svelte';
	import type { AccountServiceSummary } from '$lib/components/account-linking/types';

	let { data }: { data: PageData } = $props();

	// ── State ──────────────────────────────────
	let linkModalServiceId = $state<string | null>(null);
	let linkUsername = $state('');
	let linkPassword = $state('');
	let linking = $state(false);
	let linkError = $state<string | null>(null);

	let confirmUnlinkId = $state<string | null>(null);
	let retrying = $state<string | null>(null);
	let creatingManaged = $state<string | null>(null);

	// ── Derived ──────────────────────────────────
	const services = $derived((data as any).accountServices ?? []);
	const summaries = $derived<AccountServiceSummary[]>(
		((data as unknown as { accountSummaries?: AccountServiceSummary[] }).accountSummaries) ?? []
	);

	const linkedServices = $derived(services.filter((s: any) => s.isLinked));
	const unlinkedServices = $derived(services.filter((s: any) => !s.isLinked));

	const linkModalService = $derived(
		services.find((s: any) => s.id === linkModalServiceId) ?? null
	);

	const linkModalSummary = $derived<AccountServiceSummary | null>(
		linkModalServiceId
			? summaries.find((s) => s.id === linkModalServiceId) ?? null
			: null
	);

	// Stale credential summaries surface at the top of the page so users
	// see broken sessions before scrolling.
	const staleSummaries = $derived(summaries.filter((s) => s.isLinked && s.staleSince));

	// Services that would be cascade-unlinked if a parent is unlinked
	function getCascadeServices(serviceId: string) {
		const svc = services.find((s: any) => s.id === serviceId);
		if (!svc) return [];
		return services.filter(
			(s: any) => s.isLinked && s.linkedVia === svc.type
		);
	}

	// ── Actions ──────────────────────────────────
	async function unlinkService(serviceId: string) {
		try {
			const res = await fetch(
				`/api/user/credentials?serviceId=${encodeURIComponent(serviceId)}`,
				{ method: 'DELETE' }
			);
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				toast.error(body.error ?? 'Failed to unlink account');
				return;
			}
			confirmUnlinkId = null;
			toast.success('Account unlinked');
			await invalidateAll();
		} catch (e) {
			toast.error('Failed to unlink account');
		}
	}

	async function createManagedAccount(serviceId: string) {
		creatingManaged = serviceId;
		try {
			const res = await fetch(`/api/user/credentials/${encodeURIComponent(serviceId)}/managed`, {
				method: 'POST'
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(body.error ?? 'Failed to create managed account');
				return;
			}
			toast.success('Managed account created');
			await invalidateAll();
		} catch (e) {
			toast.error('Failed to create managed account');
		} finally {
			creatingManaged = null;
		}
	}

	async function linkAccount(serviceId: string, username: string, password: string) {
		if (!username || !password) return;
		linking = true;
		linkError = null;
		try {
			const res = await fetch('/api/user/credentials', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId, username, password })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				linkError = body.error ?? 'Failed to link account';
				return;
			}
			linkModalServiceId = null;
			linkUsername = '';
			linkPassword = '';
			toast.success(`Linked as ${body.externalUsername}`);
			await invalidateAll();
		} catch (e) {
			linkError = String(e);
		} finally {
			linking = false;
		}
	}

	async function retryDerivedLink(serviceId: string) {
		retrying = serviceId;
		try {
			const res = await fetch('/api/user/credentials', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId, autoLink: true })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(body.error ?? 'Auto-link failed');
				return;
			}
			toast.success(`Linked as ${body.externalUsername}`);
			await invalidateAll();
		} catch (e) {
			toast.error('Auto-link failed');
		} finally {
			retrying = null;
		}
	}

	function openLinkModal(serviceId: string) {
		linkModalServiceId = serviceId;
		const svc = services.find((s: any) => s.id === serviceId);
		linkUsername = '';
		linkPassword = '';
		linkError = null;
	}

	function closeLinkModal() {
		linkModalServiceId = null;
		linkUsername = '';
		linkPassword = '';
		linkError = null;
	}

	function requestUnlink(serviceId: string) {
		const cascade = getCascadeServices(serviceId);
		if (cascade.length > 0 || services.find((s: any) => s.id === serviceId)?.managed) {
			confirmUnlinkId = serviceId;
		} else {
			unlinkService(serviceId);
		}
	}
</script>

<section class="mb-8">
	<h2 class="text-display text-base font-semibold mb-1">Linked Accounts</h2>
	<p class="text-sm text-[var(--color-muted)] mb-6">
		Connect your accounts to enable personalized content, watch history, and recommendations.
	</p>

	<!-- Stale-credential banners for any linked service whose session expired -->
	{#if staleSummaries.length > 0}
		<div class="mb-6 flex flex-col gap-2">
			{#each staleSummaries as summary (summary.id)}
				<StaleCredentialBanner
					service={summary}
					onReconnected={() => invalidateAll()}
				/>
			{/each}
		</div>
	{/if}

	{#if services.length === 0}
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
		<!-- Linked Services -->
		{#if linkedServices.length > 0}
			<div class="mb-6">
				<h3
					class="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)] mb-3"
				>
					Connected
				</h3>
				<div class="flex flex-col gap-2">
					{#each linkedServices as svc (svc.id)}
						{@const cascade = getCascadeServices(svc.id)}
						<div
							class="rounded-2xl overflow-hidden"
							style="background: {svc.color}08; border: 1px solid {svc.color}26"
						>
							<div class="flex items-center gap-4 px-5 py-4">
								<div
									class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold"
									style="background: {svc.color}26; color: {svc.color}"
								>
									{svc.abbreviation}
								</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<span class="font-semibold text-sm">{svc.name}</span>
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
									</div>
									<p class="text-xs text-[var(--color-body)] mt-0.5">
										{#if svc.managed}
											<span
												class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
												style="background: rgba(124,108,248,0.10); color: var(--color-accent); border: 1px solid rgba(124,108,248,0.18)"
											>Managed by Nexus</span>
										{:else if svc.linkedVia}
											<span
												class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
												style="background: rgba(124,108,248,0.10); color: var(--color-accent); border: 1px solid rgba(124,108,248,0.18)"
											>Linked via {svc.linkedVia}</span>
										{:else if svc.externalUsername}
											Signed in as <span class="font-medium">@{svc.externalUsername}</span>
										{:else}
											Linked
										{/if}
									</p>
								</div>
								<div class="flex-shrink-0">
									<button
										class="btn btn-ghost text-xs text-[var(--color-warm)]"
										onclick={() => requestUnlink(svc.id)}
									>Disconnect</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Unlinked Services -->
		{#if unlinkedServices.length > 0}
			<div>
				<h3
					class="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)] mb-3"
				>
					Available Services
				</h3>
				<div class="flex flex-col gap-2">
					{#each unlinkedServices as svc (svc.id)}
						<div class="card-raised overflow-hidden">
							<div class="flex items-center gap-3 px-4 py-3">
								<div
									class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold"
									style="background: {svc.color}18; color: {svc.color}"
								>
									{svc.abbreviation}
								</div>
								<div class="flex-1 min-w-0">
									<span class="font-medium text-sm">{svc.name}</span>

									<!-- Derived + parentRequired + parent NOT linked -->
									{#if svc.derivedFrom && svc.parentRequired && !svc.parentLinked}
										<p class="text-xs text-[var(--color-muted)] mt-1">
											Requires {svc.derivedFrom.join(' or ')}. Set it up first.
										</p>

									<!-- Derived + parentRequired + parent IS linked -->
									{:else if svc.derivedFrom && svc.parentRequired && svc.parentLinked}
										<p class="text-xs text-[var(--color-muted)] mt-1">
											Auto-link didn't find your account in {svc.name}. Ask your admin to check the setup.
										</p>

									<!-- Derived + NOT parentRequired + parent linked -->
									{:else if svc.derivedFrom && !svc.parentRequired && svc.parentLinked}
										<p class="text-xs text-[var(--color-muted)] mt-1">
											Auto-link didn't find your account. You can retry or sign in manually.
										</p>

									<!-- Derived + NOT parentRequired + parent NOT linked -->
									{:else if svc.derivedFrom && !svc.parentRequired && !svc.parentLinked}
										<p class="text-xs text-[var(--color-muted)] mt-1">
											{svc.derivedFrom.join(' or ')} link enables auto-connect, or sign in manually.
										</p>

									<!-- Standard linkable -->
									{:else}
										<p class="text-xs text-[var(--color-muted)] mt-1">
											Not connected
										</p>
									{/if}
								</div>
								<div class="flex-shrink-0 flex items-center gap-2">
									<!-- Derived + parentRequired + parent NOT linked: just a link to set up parent -->
									{#if svc.derivedFrom && svc.parentRequired && !svc.parentLinked}
										<!-- No action — parent needs setup first -->

									<!-- Derived + parentRequired + parent linked: retry button -->
									{:else if svc.derivedFrom && svc.parentRequired && svc.parentLinked}
										<button
											class="btn btn-ghost text-xs text-[var(--color-accent)]"
											disabled={retrying === svc.id}
											onclick={() => retryDerivedLink(svc.id)}
										>
											{retrying === svc.id ? 'Retrying...' : 'Retry'}
										</button>

									<!-- Derived + NOT parentRequired: retry + manual options -->
									{:else if svc.derivedFrom && svc.parentLinked}
										<button
											class="btn btn-ghost text-xs text-[var(--color-accent)]"
											disabled={retrying === svc.id}
											onclick={() => retryDerivedLink(svc.id)}
										>
											{retrying === svc.id ? 'Retrying...' : 'Retry'}
										</button>
										{#if svc.canAuthenticate}
											<button
												class="btn btn-ghost text-xs text-[var(--color-muted)]"
												onclick={() => openLinkModal(svc.id)}
											>Sign In</button>
										{/if}

									<!-- Standard linkable: link + managed options -->
									{:else}
										{#if svc.canAuthenticate}
											<button
												class="btn btn-ghost text-xs text-[var(--color-accent)]"
												onclick={() => openLinkModal(svc.id)}
											>Sign In</button>
										{/if}
										{#if svc.canCreateUser}
											<button
												class="btn btn-ghost text-xs text-[var(--color-muted)]"
												disabled={creatingManaged === svc.id}
												onclick={() => createManagedAccount(svc.id)}
											>
												{creatingManaged === svc.id ? 'Creating...' : 'Create Managed'}
											</button>
										{/if}
									{/if}
								</div>
							</div>

							<!-- Managed account description -->
							{#if svc.canCreateUser && !svc.derivedFrom}
								<div class="px-4 pb-3 -mt-1">
									<p class="text-[11px] text-[var(--color-muted)] leading-relaxed">
										"Create Managed" lets Nexus create and manage an account on {svc.name} for you. You won't need to log into {svc.name} directly.
									</p>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</section>

<!-- Link Modal — shared AccountLinkModal component -->
{#if linkModalSummary}
	<AccountLinkModal
		service={linkModalSummary}
		onSuccess={async (result) => {
			closeLinkModal();
			toast.success(`Connected as ${result.externalUsername}`);
			await invalidateAll();
		}}
		onCancel={closeLinkModal}
	/>
{/if}

<!-- Unlink Confirmation Dialog -->
{#if confirmUnlinkId}
	{@const unlinkSvc = services.find((s: any) => s.id === confirmUnlinkId)}
	{@const cascade = getCascadeServices(confirmUnlinkId)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onkeydown={(e) => e.key === 'Escape' && (confirmUnlinkId = null)}
		onclick={(e) => { if (e.target === e.currentTarget) confirmUnlinkId = null; }}
		role="dialog"
		aria-modal="true"
		aria-labelledby="unlink-modal-title"
	>
		<div
			class="rounded-2xl w-full max-w-md mx-4 p-6"
			style="background: var(--color-surface); border: 1px solid rgba(255,255,255,0.08)"
		>
			<h3 id="unlink-modal-title" class="text-base font-semibold mb-2">
				Disconnect {unlinkSvc?.name}?
			</h3>

			{#if unlinkSvc?.managed}
				<div
					class="rounded-lg px-3 py-2 text-xs mb-3"
					style="background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.15); color: #f59e0b"
				>
					This is a managed account. Disconnecting will delete the managed account on {unlinkSvc.name}.
				</div>
			{/if}

			{#if cascade.length > 0}
				<p class="text-sm text-[var(--color-body)] mb-2">
					The following services are linked through {unlinkSvc?.name} and will also be disconnected:
				</p>
				<ul class="list-disc list-inside text-sm text-[var(--color-muted)] mb-3">
					{#each cascade as dep}
						<li>{dep.name}</li>
					{/each}
				</ul>
			{/if}

			{#if !unlinkSvc?.managed && cascade.length === 0}
				<p class="text-sm text-[var(--color-body)] mb-3">
					You can reconnect at any time.
				</p>
			{/if}

			<div class="flex items-center justify-end gap-2 mt-4">
				<button
					class="btn btn-ghost text-sm"
					onclick={() => (confirmUnlinkId = null)}
				>Cancel</button>
				<button
					class="rounded-lg px-4 py-2 text-sm font-medium text-white"
					style="background: var(--color-warm)"
					onclick={() => unlinkService(confirmUnlinkId!)}
				>Disconnect</button>
			</div>
		</div>
	</div>
{/if}
