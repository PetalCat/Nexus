<script lang="ts">
	/**
	 * /welcome — non-admin first-run flow. Three-phase Wizarr-inspired wizard:
	 *
	 * Phase 1 — Welcome copy
	 * Phase 2 — Connect services (each card opens AccountLinkModal)
	 * Phase 3 — Summary + Done button (POSTs to ?/complete to mark
	 *           welcome_completed_at)
	 *
	 * The admin never sees this page — they go through /setup instead. See
	 * the umbrella spec for the full design.
	 */
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	import AccountLinkModal from '$lib/components/account-linking/AccountLinkModal.svelte';
	import type { AccountServiceSummary } from '$lib/components/account-linking/types';

	let { data }: { data: PageData } = $props();

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
			</div>
		{:else if phase === 'connect'}
			<div class="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
				<div>
					<h2 class="text-display text-3xl font-bold">Connect your accounts</h2>
					<p class="mt-3 text-[var(--color-muted)]">
						{#if summaries.length === 0}
							Your admin hasn't registered any user-linkable services yet. You're all set.
						{:else}
							You have {summaries.length} service{summaries.length === 1 ? '' : 's'} available.
							Link yours to see your own library, subscriptions, and history.
						{/if}
					</p>
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
</div>

<!-- Personal-account-linking modal -->
{#if modalSummary}
	<AccountLinkModal
		service={modalSummary}
		onSuccess={() => handleSuccess(modalSummary!.id)}
		onCancel={closeModal}
	/>
{/if}
