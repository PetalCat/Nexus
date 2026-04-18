<script lang="ts">
	/**
	 * /welcome — unified first-run + per-user onboarding (#24).
	 *
	 * Mode A (admin-create): when data.needsAdminCreation is true (fresh
	 * install, no users yet, no session), renders the first-admin form.
	 * Submitting creates the user + session and reloads into Mode B.
	 *
	 * Mode B (per-user wizard): Wizarr-inspired three-phase flow —
	 *   Phase 1 — Welcome copy
	 *   Phase 2 — Connect services (each card opens AccountLinkModal)
	 *   Phase 3 — Summary + Done button (POSTs to ?/complete to mark
	 *             welcome_completed_at)
	 */
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import AccountLinkModal from '$lib/components/account-linking/AccountLinkModal.svelte';
	import type { AccountServiceSummary } from '$lib/components/account-linking/types';
	import CommunityLinks from '$lib/components/CommunityLinks.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Mode A state — admin-create form submission in progress.
	let adminCreateLoading = $state(false);

	type Phase = 'welcome' | 'connect' | 'summary';
	let phase = $state<Phase>('welcome');

	let linkedPersonalServiceIds = $state<string[]>([]);
	let personalLinkModalServiceId = $state<string | null>(null);

	const summaries = $derived<AccountServiceSummary[]>(data.linkableSummaries ?? []);
	const alreadyLinked = $derived(
		summaries.filter((s) => s.isLinked || linkedPersonalServiceIds.includes(s.id))
	);
	const pending = $derived(
		summaries.filter((s) => !s.isLinked && !linkedPersonalServiceIds.includes(s.id))
	);
	const modalSummary = $derived<AccountServiceSummary | null>(
		personalLinkModalServiceId
			? summaries.find((s) => s.id === personalLinkModalServiceId) ?? null
			: null
	);

	function openModal(serviceId: string) {
		personalLinkModalServiceId = serviceId;
	}
	function closeModal() {
		personalLinkModalServiceId = null;
	}
	async function handleSuccess(serviceId: string) {
		linkedPersonalServiceIds = [...linkedPersonalServiceIds, serviceId];
		personalLinkModalServiceId = null;
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Welcome to Nexus</title>
</svelte:head>

<div class="flex min-h-screen flex-col" style="background: var(--color-void)">
	{#if data.needsAdminCreation}
		<!-- Mode A: fresh-install admin-create form. No step dots; the user has
		     not entered the wizard proper yet. -->
		<div class="flex flex-1 flex-col items-center justify-center px-6 pb-16 pt-16">
			<div class="flex w-full max-w-sm flex-col items-center gap-10 text-center">
				<div>
					<h1 class="text-display text-4xl font-bold tracking-tight">Welcome to Nexus</h1>
					<p class="mt-3 text-[var(--color-muted)]">
						Create your admin account to get started.
					</p>
				</div>

				<form
					method="POST"
					action="?/createAccount"
					class="flex w-full flex-col gap-5 rounded-3xl border border-white/[0.06] bg-white/[0.02] p-8"
					use:enhance={() => {
						adminCreateLoading = true;
						return async ({ update }) => {
							await update({ reset: false });
							adminCreateLoading = false;
						};
					}}
				>
					{#if form?.error && form.step === 'account'}
						<div
							class="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
						>
							{form.error}
						</div>
					{/if}

					<label class="flex flex-col gap-2 text-left">
						<span
							class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
							>Username</span
						>
						<input
							name="username"
							class="input py-3"
							placeholder="admin"
							autocomplete="username"
							required
						/>
					</label>
					<label class="flex flex-col gap-2 text-left">
						<span
							class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
							>Display Name</span
						>
						<input
							name="displayName"
							class="input py-3"
							placeholder="Your name"
							required
						/>
					</label>
					<div class="grid grid-cols-2 gap-4">
						<label class="flex flex-col gap-2 text-left">
							<span
								class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
								>Password</span
							>
							<input
								name="password"
								type="password"
								class="input py-3"
								placeholder="--------"
								autocomplete="new-password"
								required
							/>
						</label>
						<label class="flex flex-col gap-2 text-left">
							<span
								class="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
								>Confirm</span
							>
							<input
								name="confirm"
								type="password"
								class="input py-3"
								placeholder="--------"
								autocomplete="new-password"
								required
							/>
						</label>
					</div>

					<button
						type="submit"
						class="btn btn-primary mt-2 py-3 text-base"
						disabled={adminCreateLoading}
					>
						{adminCreateLoading ? 'Creating...' : 'Continue'}
					</button>
				</form>

				<div class="w-full">
					<CommunityLinks heading="Community" center />
				</div>
			</div>
		</div>
	{:else}
		<!-- Mode B: per-user wizard phases -->
		<!-- Step dots -->
		<div class="fixed top-6 left-1/2 -translate-x-1/2 z-10 flex gap-2">
			{#each ['welcome', 'connect', 'summary'] as p, i (p)}
				<div
					class="h-1.5 rounded-full transition-all duration-500"
					style="width: {p === phase ? '24px' : '6px'}; background: {p === phase ? 'var(--color-cream)' : ['welcome', 'connect', 'summary'].indexOf(p) < ['welcome', 'connect', 'summary'].indexOf(phase) ? 'var(--color-accent)' : 'rgba(255,255,255,0.15)'}"
				></div>
			{/each}
		</div>

		<div class="flex flex-1 flex-col items-center justify-center px-6 pb-16 pt-16">
			{#if phase === 'welcome'}
			<div class="flex max-w-lg flex-col items-center gap-8 text-center">
				<div class="relative">
					<div
						class="absolute -inset-8 rounded-full blur-[60px]"
						style="background: var(--color-accent); opacity: 0.15"
					></div>
					<div
						class="relative flex h-20 w-20 items-center justify-center rounded-2xl"
						style="background: var(--color-accent); color: var(--color-void)"
					>
						<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M20 6L9 17l-5-5" />
						</svg>
					</div>
				</div>

				<div>
					<h1 class="text-display text-4xl font-bold">Welcome, {data.displayName}</h1>
					<p class="mt-4 text-lg text-[var(--color-muted)]">
						Nexus gives you one place to browse and play all your self-hosted media. Your admin
						already set up a few services — let's connect your personal accounts so you see
						your own library, not just the shared admin view.
					</p>
				</div>

				<div class="text-xs text-[var(--color-muted)]">
					Takes about a minute. You can skip anything and come back from Settings → Accounts.
				</div>

				<button
					class="btn btn-primary px-10 py-3.5 text-base"
					onclick={() => (phase = summaries.length > 0 ? 'connect' : 'summary')}
				>
					Let's go →
				</button>

				<CommunityLinks heading="Community" center />
			</div>
		{:else if phase === 'connect'}
			<div class="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
				<div>
					<h2 class="text-display text-3xl font-bold">
						{#if summaries.length === 0 && data.isAdmin && !data.hasAnyServices}
							Add your first service
						{:else}
							Connect your accounts
						{/if}
					</h2>
					<p class="mt-3 text-[var(--color-muted)]">
						{#if summaries.length === 0 && data.isAdmin && !data.hasAnyServices}
							Nexus needs at least one backend to show you anything — Jellyfin,
							Plex, Calibre, Invidious, RomM, or any supported service. Head to
							Services to connect your first one.
						{:else if summaries.length === 0}
							Your admin hasn't registered any user-linkable services yet. You're all set.
						{:else}
							You have {summaries.length} service{summaries.length === 1 ? '' : 's'} available.
							Link yours to see your own library, subscriptions, and history.
						{/if}
					</p>
					{#if summaries.length === 0 && data.isAdmin && !data.hasAnyServices}
						<a
							href="/admin/services"
							class="btn btn-primary mt-6 inline-flex px-10 py-3"
						>
							Go to Services →
						</a>
					{/if}
				</div>

				{#if summaries.length > 0}
					<div class="flex w-full flex-col gap-3 text-left">
						{#each summaries as summary (summary.id)}
							{@const isDone = alreadyLinked.some((s) => s.id === summary.id)}
							<div
								class="flex items-center justify-between gap-4 rounded-xl px-4 py-3 transition-all"
								style="background: {isDone ? summary.color + '10' : 'var(--color-surface)'}; border: 1px solid {isDone ? summary.color + '40' : 'rgba(255,255,255,0.06)'}"
							>
								<div class="flex min-w-0 items-center gap-3">
									<div
										class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold"
										style="background: {summary.color}22; color: {summary.color}"
									>
										{summary.abbreviation}
									</div>
									<div class="min-w-0">
										<div class="text-sm font-semibold">{summary.name}</div>
										<div class="truncate text-xs text-[var(--color-muted)]">
											{#if isDone}
												✓ Connected{#if summary.externalUsername}
													{' '}as {summary.externalUsername}{/if}
											{:else}
												{summary.url}
											{/if}
										</div>
									</div>
								</div>
								{#if isDone}
									<span class="text-xs font-semibold" style="color: {summary.color}">Done</span>
								{:else}
									<button class="btn btn-primary flex-shrink-0 text-xs" onclick={() => openModal(summary.id)}>
										Connect
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<div class="flex w-full items-center justify-between">
					<button
						class="text-sm text-[var(--color-muted)] hover:text-[var(--color-cream)] transition-colors"
						onclick={() => (phase = 'summary')}
					>
						{pending.length > 0 ? 'Skip remaining' : '\u00A0'}
					</button>
					<button class="btn btn-primary px-10 py-3" onclick={() => (phase = 'summary')}>
						Continue
					</button>
				</div>
			</div>
		{:else if phase === 'summary'}
			<div class="flex max-w-lg flex-col items-center gap-8 text-center">
				<div class="relative">
					<div class="absolute -inset-8 rounded-full blur-[60px]" style="background: #22c55e; opacity: 0.12"></div>
					<div class="relative flex h-24 w-24 items-center justify-center rounded-full bg-green-500/10">
						<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M20 6L9 17l-5-5" />
						</svg>
					</div>
				</div>

				<div>
					<h2 class="text-display text-4xl font-bold">You're all set</h2>
					<p class="mt-3 text-lg text-[var(--color-muted)]">
						{#if alreadyLinked.length === 0}
							You can connect accounts anytime from Settings → Accounts.
						{:else}
							{alreadyLinked.length} account{alreadyLinked.length === 1 ? '' : 's'} connected and
							ready.
						{/if}
					</p>
				</div>

				{#if alreadyLinked.length > 0}
					<div class="flex flex-wrap justify-center gap-3">
						{#each alreadyLinked as summary (summary.id)}
							<div
								class="flex items-center gap-2 rounded-full px-4 py-2"
								style="background: {summary.color}12; border: 1px solid {summary.color}25"
							>
								<div
									class="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold"
									style="background: {summary.color}22; color: {summary.color}"
								>
									{summary.abbreviation}
								</div>
								<span class="text-sm font-medium" style="color: {summary.color}">
									{summary.name}
								</span>
							</div>
						{/each}
					</div>
				{/if}

				<form method="POST" action="?/complete">
					<button type="submit" class="btn btn-primary px-12 py-3.5 text-lg">
						Enter Nexus
					</button>
				</form>
			</div>
		{/if}
		</div>
	{/if}
</div>

<!-- Personal-account-linking modal (only meaningful in wizard mode) -->
{#if !data.needsAdminCreation && modalSummary}
	<AccountLinkModal
		service={modalSummary}
		onSuccess={() => handleSuccess(modalSummary!.id)}
		onCancel={closeModal}
	/>
{/if}
