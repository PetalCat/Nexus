<script lang="ts">
	/**
	 * Red banner shown when a credential is stale. One-click reconnect tries
	 * silent auto-reauth via /api/user/credentials/reconnect first, falling
	 * back to the AccountLinkModal prefilled with the known username if the
	 * silent path fails (or if no stored password is available).
	 */
	import type { AccountServiceSummary } from './types';
	import { errorCopyForKind } from './errorCopy';
	import AccountLinkModal from './AccountLinkModal.svelte';

	interface Props {
		service: AccountServiceSummary;
		context?: string;
		onReconnected?: () => void;
	}

	let { service, context, onReconnected }: Props = $props();

	type BannerState =
		| { kind: 'idle' }
		| { kind: 'reconnecting' }
		| { kind: 'error'; message: string };

	let bannerState: BannerState = $state({ kind: 'idle' } as BannerState);
	let modalOpen = $state(false);

	async function tryReconnect() {
		if (bannerState.kind === 'reconnecting') return;

		// If no stored password, go straight to the modal.
		if (!service.hasStoredPassword) {
			modalOpen = true;
			return;
		}

		bannerState = { kind: 'reconnecting' };
		try {
			const res = await fetch('/api/user/credentials/reconnect', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId: service.id })
			});
			const body = await res.json().catch(() => ({}));
			if (res.ok && body?.success) {
				bannerState = { kind: 'idle' };
				onReconnected?.();
				return;
			}
			// Silent reconnect failed — fall through to the modal so the user
			// can type credentials manually.
			const copy = errorCopyForKind(body?.kind ?? 'unknown', service.name);
			bannerState = { kind: 'error', message: copy };
			modalOpen = true;
		} catch (err) {
			bannerState = {
				kind: 'error',
				message: err instanceof Error ? err.message : 'Reconnect failed — please try again.'
			};
			modalOpen = true;
		}
	}

	function handleModalSuccess() {
		modalOpen = false;
		bannerState = { kind: 'idle' };
		onReconnected?.();
	}
</script>

<div
	class="flex items-center justify-between gap-4 rounded-xl px-4 py-3"
	style="background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2)"
>
	<div class="flex items-center gap-3">
		<div
			class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-base"
			style="color: #f87171"
		>
			⚠
		</div>
		<div class="min-w-0">
			<div class="text-sm font-medium" style="color: #f87171">
				Your {service.name} session expired
			</div>
			<div class="truncate text-xs text-[var(--color-muted)]">
				{context ?? service.url}
				{#if bannerState.kind === 'error'}— {bannerState.message}{/if}
			</div>
		</div>
	</div>
	<button
		class="btn flex-shrink-0 text-xs"
		style="background: #f87171; color: #0a0a0a"
		onclick={tryReconnect}
		disabled={bannerState.kind === 'reconnecting'}
	>
		{#if bannerState.kind === 'reconnecting'}
			Reconnecting...
		{:else}
			Reconnect
		{/if}
	</button>
</div>

{#if modalOpen}
	<AccountLinkModal
		{service}
		prefillUsername={service.externalUsername ?? ''}
		onSuccess={handleModalSuccess}
		onCancel={() => (modalOpen = false)}
	/>
{/if}
