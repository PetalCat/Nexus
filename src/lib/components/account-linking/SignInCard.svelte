<script lang="ts">
	/**
	 * Inline affordance that replaces dead-end "link your account in settings"
	 * messaging on consumer pages. Clicking the button opens an AccountLinkModal
	 * in place — no navigation away from the current page.
	 *
	 * Two variants: 'inline' (compact row, top-of-section) and 'hero' (large
	 * empty-state for pages whose primary purpose is the unlinked service).
	 */
	import type { AccountServiceSummary } from './types';
	import AccountLinkModal from './AccountLinkModal.svelte';

	interface Props {
		service: AccountServiceSummary;
		features?: string[];
		variant?: 'inline' | 'hero';
		onConnected?: (result: { externalUsername: string }) => void;
	}

	let { service, features = [], variant = 'inline', onConnected }: Props = $props();

	let modalOpen = $state(false);

	const featureSentence = $derived(
		features.length === 0
			? ''
			: features.length === 1
			  ? features[0]
			  : features.length === 2
			    ? `${features[0]} and ${features[1]}`
			    : `${features.slice(0, -1).join(', ')}, and ${features[features.length - 1]}`
	);

	function handleSuccess(result: { externalUsername: string }) {
		modalOpen = false;
		onConnected?.(result);
	}
</script>

{#if variant === 'hero'}
	<div
		class="flex flex-col items-center justify-center rounded-2xl px-6 py-12 text-center"
		style="background: var(--color-surface); border: 1px solid rgba(255,255,255,0.06)"
	>
		<div
			class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold"
			style="background: {service.color}22; color: {service.color}"
		>
			{service.abbreviation}
		</div>
		<h3 class="font-display text-lg font-semibold">Connect your {service.name} account</h3>
		{#if featureSentence}
			<p class="mt-1 max-w-md text-sm text-[var(--color-muted)]">
				See your {featureSentence} from <span class="font-mono">{service.url}</span>.
			</p>
		{:else}
			<p class="mt-1 max-w-md text-sm text-[var(--color-muted)]">
				Connect to <span class="font-mono">{service.url}</span>.
			</p>
		{/if}
		<button class="btn btn-primary mt-4 text-sm" onclick={() => (modalOpen = true)}>
			Connect account
		</button>
		{#if service.capabilities.userAuth?.supportsRegistration}
			<p class="mt-2 text-xs text-[var(--color-muted)]">
				Don't have an account?
				<button
					type="button"
					class="text-[var(--color-accent)] hover:underline"
					onclick={() => (modalOpen = true)}
				>Create one →</button>
			</p>
		{/if}
	</div>
{:else}
	<div
		class="flex items-center justify-between gap-4 rounded-xl px-4 py-3"
		style="background: var(--color-surface); border: 1px solid rgba(255,255,255,0.06)"
	>
		<div class="flex items-center gap-3">
			<div
				class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold"
				style="background: {service.color}22; color: {service.color}"
			>
				{service.abbreviation}
			</div>
			<div class="min-w-0">
				<div class="text-sm font-medium">Connect your {service.name} account</div>
				{#if featureSentence}
					<div class="truncate text-xs text-[var(--color-muted)]">
						See {featureSentence}
					</div>
				{:else}
					<div class="truncate text-xs text-[var(--color-muted)]">{service.url}</div>
				{/if}
			</div>
		</div>
		<button class="btn btn-primary flex-shrink-0 text-xs" onclick={() => (modalOpen = true)}>
			Connect
		</button>
	</div>
{/if}

{#if modalOpen}
	<AccountLinkModal
		{service}
		onSuccess={handleSuccess}
		onCancel={() => (modalOpen = false)}
	/>
{/if}
