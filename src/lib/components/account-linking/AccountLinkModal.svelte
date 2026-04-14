<script lang="ts">
	/**
	 * Shared account-linking modal. Replaces the bespoke modal in
	 * /settings/accounts with a service-agnostic component that any route can
	 * mount. Consumes AccountServiceSummary so every service gets the same
	 * sign-in UX.
	 *
	 * Two modes: 'signin' (default) and 'register' (when the adapter declares
	 * userAuth.supportsRegistration). The register mode adds a confirm-password
	 * field and uses authenticateUser with mode='register' — for adapters like
	 * Invidious whose /login handles both.
	 */
	import type { AccountServiceSummary } from './types';
	import { errorCopyForKind } from './errorCopy';

	interface Props {
		service: AccountServiceSummary;
		prefillUsername?: string;
		onSuccess: (result: { externalUsername: string }) => void;
		onCancel: () => void;
	}

	let { service, prefillUsername = '', onSuccess, onCancel }: Props = $props();

	type ModalState =
		| { kind: 'idle' }
		| { kind: 'submitting' }
		| { kind: 'error'; message: string };

	let mode = $state<'signin' | 'register'>('signin');
	let username = $state(prefillUsername);
	let password = $state('');
	let confirmPassword = $state('');
	let savePassword = $state(true);
	let showPassword = $state(false);
	let formState: ModalState = $state({ kind: 'idle' } as ModalState);

	const userAuth = $derived(service.capabilities.userAuth);
	const supportsRegistration = $derived(userAuth?.supportsRegistration === true);
	const supportsPasswordStorage = $derived(userAuth?.supportsPasswordStorage === true);
	const usernameLabel = $derived(userAuth?.usernameLabel ?? 'Username');
	const isRegisterMode = $derived(mode === 'register');
	const canSubmit = $derived(
		formState.kind !== 'submitting' &&
			username.length > 0 &&
			password.length > 0 &&
			(!isRegisterMode || password === confirmPassword)
	);

	async function submit() {
		if (!canSubmit) return;
		formState = { kind: 'submitting' };
		try {
			const res = await fetch('/api/user/credentials', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					serviceId: service.id,
					username,
					password,
					mode,
					storePassword: supportsPasswordStorage && savePassword
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				const kind = body?.kind ?? 'unknown';
				formState = { kind: 'error', message: body?.error ?? errorCopyForKind(kind, service.name) };
				return;
			}
			onSuccess({ externalUsername: body?.externalUsername ?? username });
		} catch (err) {
			formState = {
				kind: 'error',
				message: err instanceof Error ? err.message : 'Network error — please try again.'
			};
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onCancel();
		if (e.key === 'Enter' && canSubmit) submit();
	}

	function toggleMode() {
		mode = mode === 'signin' ? 'register' : 'signin';
		formState = { kind: 'idle' };
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
	onkeydown={handleKeydown}
	onclick={(e) => {
		if (e.target === e.currentTarget) onCancel();
	}}
	role="dialog"
	aria-modal="true"
	aria-labelledby="account-link-modal-title"
>
	<div
		class="mx-4 w-full max-w-md rounded-2xl p-6"
		style="background: var(--color-surface); border: 1px solid rgba(255,255,255,0.08)"
	>
		<h3 id="account-link-modal-title" class="text-base font-semibold mb-1">
			{#if isRegisterMode}
				Create {service.name} account
			{:else}
				Connect {service.name} account
			{/if}
		</h3>
		<p class="text-xs text-[var(--color-muted)] mb-5">
			{#if isRegisterMode}
				Creates a new account on
				<span class="font-mono">{service.url}</span>. You'll own this account — Nexus just uses
				it to fetch your personal data.
			{:else}
				Connecting to <span class="font-mono">{service.url}</span>
			{/if}
		</p>

		<div class="flex flex-col gap-3">
			<div>
				<label
					for="acct-link-username"
					class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
				>{usernameLabel}</label>
				<input
					id="acct-link-username"
					bind:value={username}
					class="input w-full text-sm"
					placeholder={usernameLabel.toLowerCase()}
					autocomplete="username"
				/>
			</div>

			<div>
				<label
					for="acct-link-password"
					class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
				>Password</label>
				<div class="relative">
					<input
						id="acct-link-password"
						bind:value={password}
						class="input w-full pr-16 text-sm"
						type={showPassword ? 'text' : 'password'}
						placeholder="Your password"
						autocomplete={isRegisterMode ? 'new-password' : 'current-password'}
					/>
					<button
						type="button"
						class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
						onclick={() => (showPassword = !showPassword)}
					>
						{showPassword ? 'Hide' : 'Show'}
					</button>
				</div>
			</div>

			{#if isRegisterMode}
				<div>
					<label
						for="acct-link-confirm"
						class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
					>Confirm password</label>
					<input
						id="acct-link-confirm"
						bind:value={confirmPassword}
						class="input w-full text-sm"
						type={showPassword ? 'text' : 'password'}
						placeholder="Type it again"
						autocomplete="new-password"
					/>
					{#if confirmPassword.length > 0 && password !== confirmPassword}
						<p class="mt-1 text-xs" style="color: #f87171">Passwords don't match.</p>
					{/if}
				</div>
			{/if}

			{#if supportsPasswordStorage}
				<label class="flex items-start gap-2 text-xs text-[var(--color-muted)]">
					<input
						type="checkbox"
						bind:checked={savePassword}
						class="mt-[2px]"
					/>
					<span>
						<span class="font-semibold text-[var(--color-text)]">Save password for auto-reconnect.</span>
						Nexus encrypts and stores this password locally so your session can refresh
						automatically when {service.name} expires it. Uncheck to require manual reconnect
						each time.
					</span>
				</label>
			{/if}
		</div>

		{#if formState.kind === 'error'}
			<div
				class="mt-3 rounded-lg px-3 py-2 text-xs"
				style="background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.15); color: #f87171"
			>
				{formState.message}
			</div>
		{/if}

		{#if supportsRegistration}
			<div class="mt-4 text-center text-xs text-[var(--color-muted)]">
				{#if isRegisterMode}
					Already have an account?
					<button
						type="button"
						class="text-[var(--color-accent)] hover:underline"
						onclick={toggleMode}
					>Sign in instead</button>
				{:else}
					First time?
					<button
						type="button"
						class="text-[var(--color-accent)] hover:underline"
						onclick={toggleMode}
					>Create a new account →</button>
				{/if}
			</div>
		{/if}

		<div class="mt-5 flex items-center justify-end gap-2">
			<button class="btn btn-ghost text-sm" onclick={onCancel}>Cancel</button>
			<button class="btn btn-primary text-sm" onclick={submit} disabled={!canSubmit}>
				{#if formState.kind === 'submitting'}
					Connecting...
				{:else if isRegisterMode}
					Create account
				{:else}
					Connect
				{/if}
			</button>
		</div>
	</div>
</div>
