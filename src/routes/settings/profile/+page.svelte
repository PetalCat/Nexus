<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';

	let { data }: { data: PageData } = $props();

	// ── Display name editing ──────────────────────────────────
	let editingName = $state(false);
	let displayNameInput = $state('');
	let nameSaving = $state(false);
	let nameError = $state<string | null>(null);
	let nameSuccess = $state(false);

	async function saveDisplayName() {
		if (!displayNameInput.trim()) return;
		nameSaving = true;
		nameError = null;
		nameSuccess = false;
		try {
			const res = await fetch('/api/user/profile', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ displayName: displayNameInput.trim() })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				nameError = body.message ?? 'Failed to update display name';
				return;
			}
			nameSuccess = true;
			editingName = false;
			await invalidateAll();
			setTimeout(() => (nameSuccess = false), 3000);
		} catch (e) {
			nameError = String(e);
		} finally {
			nameSaving = false;
		}
	}

	// ── Avatar upload ─────────────────────────────────────────
	let avatarUploading = $state(false);

	async function uploadAvatar(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		avatarUploading = true;
		try {
			const formData = new FormData();
			formData.append('avatar', file);
			const res = await fetch('/api/user/avatar', { method: 'POST', body: formData });
			if (res.ok) await invalidateAll();
		} catch { toast.error('Failed to upload avatar'); }
		finally { avatarUploading = false; }
	}

	async function removeAvatar() {
		await fetch('/api/user/avatar', { method: 'DELETE' });
		await invalidateAll();
	}

	// ── Change password ───────────────────────────────────────
	let showPasswordForm = $state(false);
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordSaving = $state(false);
	let passwordError = $state<string | null>(null);
	let passwordSuccess = $state(false);

	const passwordsMatch = $derived(newPassword === confirmPassword);
	const passwordValid = $derived(newPassword.length >= 6 && passwordsMatch && currentPassword.length > 0);

	async function changePassword() {
		if (!passwordValid) return;
		passwordSaving = true;
		passwordError = null;
		passwordSuccess = false;
		try {
			const res = await fetch('/api/user/password', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				passwordError = body.message ?? 'Failed to change password';
				return;
			}
			passwordSuccess = true;
			showPasswordForm = false;
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			setTimeout(() => (passwordSuccess = false), 3000);
		} catch (e) {
			passwordError = String(e);
		} finally {
			passwordSaving = false;
		}
	}

	const initials = $derived(
		(data.user?.displayName ?? data.user?.username ?? '?')
			.split(' ')
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2)
	);
</script>

{#if data.user}
	<!-- Avatar + Name card -->
	<section class="card-raised mb-6 overflow-hidden">
		<div class="flex items-center gap-4 px-5 py-5">
			<!-- Avatar -->
			<div class="relative group">
				{#if data.user.avatar}
					<img
						src={data.user.avatar}
						alt={data.user.displayName}
						class="h-16 w-16 rounded-full object-cover ring-2 ring-[rgba(240,235,227,0.08)]"
					/>
				{:else}
					<div
						class="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold ring-2 ring-[rgba(240,235,227,0.08)]"
						style="background: rgba(212,162,83,0.15); color: var(--color-accent)"
					>
						{initials}
					</div>
				{/if}
				<label
					class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
						<circle cx="12" cy="13" r="4" />
					</svg>
					<input type="file" accept="image/*" class="hidden" onchange={uploadAvatar} disabled={avatarUploading} />
				</label>
			</div>

			<div class="flex-1 min-w-0">
				{#if editingName}
					<div class="flex items-center gap-2">
						<input
							bind:value={displayNameInput}
							class="input text-sm flex-1"
							placeholder="Display name"
							onkeydown={(e) => { if (e.key === 'Enter') saveDisplayName(); if (e.key === 'Escape') { editingName = false; displayNameInput = data.user?.displayName ?? ''; } }}
						/>
						<button class="btn btn-primary text-xs" onclick={saveDisplayName} disabled={nameSaving || !displayNameInput.trim()}>
							{nameSaving ? 'Saving...' : 'Save'}
						</button>
						<button class="btn btn-ghost text-xs" onclick={() => { editingName = false; displayNameInput = data.user?.displayName ?? ''; }}>Cancel</button>
					</div>
				{:else}
					<div class="flex items-center gap-2">
						<h2 class="text-lg font-semibold" style="color: var(--color-display)">{data.user.displayName}</h2>
						<button
							class="btn-icon p-1 text-[var(--color-muted)] hover:text-[var(--color-body)]"
							onclick={() => { editingName = true; displayNameInput = data.user?.displayName ?? ''; }}
							title="Edit display name"
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
								<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
								<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
							</svg>
						</button>
					</div>
					<p class="text-sm text-[var(--color-muted)]">@{data.user.username}</p>
				{/if}
			</div>
		</div>

		{#if nameError}
			<div class="border-t border-[rgba(240,235,227,0.06)] px-5 py-2 bg-[var(--color-warm)]/10">
				<p class="text-xs text-[var(--color-warm)]">{nameError}</p>
			</div>
		{/if}
		{#if nameSuccess}
			<div class="border-t border-[rgba(240,235,227,0.06)] px-5 py-2 bg-[rgba(61,143,132,0.1)]">
				<p class="text-xs text-[var(--color-steel)]">Display name updated</p>
			</div>
		{/if}
	</section>

	<!-- Account info -->
	<section class="card-raised mb-6 overflow-hidden">
		<div class="px-5 py-4">
			<h3 class="text-sm font-semibold mb-3" style="color: var(--color-display)">Account Info</h3>
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<span class="text-sm text-[var(--color-muted)]">Username</span>
					<span class="text-sm font-medium font-mono" style="color: var(--color-body)">@{data.user.username}</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-sm text-[var(--color-muted)]">Role</span>
					<span class="badge text-[10px] {data.user.isAdmin ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'bg-[var(--color-surface)] text-[var(--color-muted)]'}">
						{data.user.isAdmin ? 'Admin' : 'User'}
					</span>
				</div>
				{#if data.user.createdAt}
					<div class="flex items-center justify-between">
						<span class="text-sm text-[var(--color-muted)]">Joined</span>
						<span class="text-sm" style="color: var(--color-body)">{new Date(data.user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
					</div>
				{/if}
			</div>
		</div>
	</section>

	<!-- Avatar management -->
	{#if data.user.avatar}
		<section class="card-raised mb-6 overflow-hidden">
			<div class="flex items-center justify-between px-5 py-4">
				<div>
					<h3 class="text-sm font-semibold" style="color: var(--color-display)">Avatar</h3>
					<p class="text-xs text-[var(--color-muted)] mt-0.5">Remove your profile picture to use initials</p>
				</div>
				<button class="btn btn-ghost text-xs text-[var(--color-warm)]" onclick={removeAvatar}>Remove</button>
			</div>
		</section>
	{/if}

	<!-- Change password -->
	<section class="card-raised overflow-hidden">
		<div class="px-5 py-4">
			<div class="flex items-center justify-between mb-1">
				<h3 class="text-sm font-semibold" style="color: var(--color-display)">Password</h3>
				{#if !showPasswordForm}
					<button class="btn btn-ghost text-xs" onclick={() => (showPasswordForm = true)}>Change</button>
				{/if}
			</div>
			<p class="text-xs text-[var(--color-muted)]">Change your login password</p>

			{#if passwordSuccess}
				<div class="mt-3 rounded-lg border border-[var(--color-steel)]/30 bg-[rgba(61,143,132,0.1)] px-3 py-2 text-xs text-[var(--color-steel)]">
					Password changed successfully
				</div>
			{/if}

			{#if showPasswordForm}
				<div class="mt-4 space-y-3">
					<div>
						<label for="current-pw" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Current Password</label>
						<input id="current-pw" type="password" bind:value={currentPassword} class="input text-sm" placeholder="Enter current password" autocomplete="current-password" />
					</div>
					<div>
						<label for="new-pw" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">New Password</label>
						<input id="new-pw" type="password" bind:value={newPassword} class="input text-sm" placeholder="At least 6 characters" autocomplete="new-password" />
					</div>
					<div>
						<label for="confirm-pw" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Confirm New Password</label>
						<input id="confirm-pw" type="password" bind:value={confirmPassword} class="input text-sm" placeholder="Repeat new password" autocomplete="new-password" />
						{#if confirmPassword && !passwordsMatch}
							<p class="mt-1 text-xs text-[var(--color-warm)]">Passwords do not match</p>
						{/if}
					</div>

					{#if passwordError}
						<div class="rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-xs text-[var(--color-warm)]">{passwordError}</div>
					{/if}

					<div class="flex gap-2 pt-1">
						<button class="btn btn-primary text-sm" onclick={changePassword} disabled={passwordSaving || !passwordValid}>
							{passwordSaving ? 'Saving...' : 'Update Password'}
						</button>
						<button class="btn btn-ghost text-sm" onclick={() => { showPasswordForm = false; currentPassword = ''; newPassword = ''; confirmPassword = ''; passwordError = null; }}>Cancel</button>
					</div>
				</div>
			{/if}
		</div>
	</section>
{:else}
	<div class="card py-12 text-center">
		<p class="text-sm text-[var(--color-muted)]">Not logged in.</p>
	</div>
{/if}
