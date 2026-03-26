<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
	// ── State ──────────────────────────────────────────────────────────────────
	let users = $state<any[]>([]);
	let pendingUsers = $state<any[]>([]);
	let invites = $state<any[]>([]);
	let settings = $state<Record<string, string>>({});
	let onlineUserIds = $state<Set<string>>(new Set());
	let loading = $state(true);

	// Action state
	let approveLoading = $state<string | null>(null);
	let deleteUserConfirm = $state<string | null>(null);
	let resetPasswordUserId = $state<string | null>(null);
	let resetPasswordValue = $state('');
	let resetPasswordLoading = $state(false);
	let resetPasswordError = $state<string | null>(null);
	let inviteMaxUses = $state(1);
	let inviteExpiry = $state(0);
	let creatingInvite = $state(false);
	let newInviteCode = $state<string | null>(null);
	let deleteInviteConfirm = $state<string | null>(null);
	let savingSettings = $state(false);
	let migrateLoading = $state(false);
	let migratePreview = $state<any[] | null>(null);
	let migrateResult = $state<any | null>(null);
	let migrateSelected = $state<Set<string>>(new Set());
	let autoLinkLoading = $state(false);
	let autoLinkResult = $state<any[] | null>(null);

	// ── Data loading ──────────────────────────────────────────────────────────
	async function loadData() {
		loading = true;
		try {
			const [usersRes, invitesRes, settingsRes, onlineRes] = await Promise.all([
				fetch('/api/admin/users').then((r) => r.json()),
				fetch('/api/admin/invites').then((r) => r.json()),
				fetch('/api/admin/settings').then((r) => r.json()),
				fetch('/api/admin/users/online').then((r) => r.json())
			]);
			const allUsers = Array.isArray(usersRes) ? usersRes : [];
			pendingUsers = allUsers.filter((u: any) => u.status === 'pending');
			users = allUsers.filter((u: any) => u.status !== 'pending');
			invites = Array.isArray(invitesRes) ? invitesRes : [];
			settings = settingsRes ?? {};
			onlineUserIds = new Set(onlineRes?.userIds ?? []);
		} catch (e) {
			console.error('Failed to load admin users data', e);
			toast.error('Failed to load user data');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		loadData();
	});

	// ── Actions ───────────────────────────────────────────────────────────────
	async function approveUser(userId: string) {
		approveLoading = userId;
		try {
			await fetch(`/api/admin/users/${userId}/approve`, { method: 'PUT' });
			await loadData();
		} catch (e) {
			console.error('Failed to approve user', e);
			toast.error('Failed to approve user');
		} finally {
			approveLoading = null;
		}
	}

	async function denyUser(userId: string) {
		try {
			await fetch(`/api/admin/users/${userId}/deny`, { method: 'DELETE' });
			await loadData();
		} catch (e) {
			console.error('Failed to deny user', e);
			toast.error('Failed to deny user');
		}
	}

	async function deleteUser(id: string) {
		try {
			await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
			await loadData();
		} catch (e) {
			console.error('Failed to delete user', e);
			toast.error('Failed to delete user');
		} finally {
			deleteUserConfirm = null;
		}
	}

	async function adminResetPassword(userId: string) {
		if (!resetPasswordValue.trim()) return;
		resetPasswordLoading = true;
		resetPasswordError = null;
		try {
			const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ newPassword: resetPasswordValue })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				resetPasswordError = body.error ?? `Error ${res.status}`;
				return;
			}
			resetPasswordUserId = null;
			resetPasswordValue = '';
		} catch (e) {
			resetPasswordError = String(e);
		} finally {
			resetPasswordLoading = false;
		}
	}

	async function toggleForceReset(userId: string, force: boolean) {
		try {
			await fetch(`/api/admin/users/${userId}/force-reset`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ force })
			});
			await loadData();
		} catch (e) {
			console.error('Failed to toggle force reset', e);
			toast.error('Failed to update force reset');
		}
	}

	async function createInvite() {
		creatingInvite = true;
		newInviteCode = null;
		try {
			const res = await fetch('/api/admin/invites', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ maxUses: inviteMaxUses, expiresInHours: inviteExpiry || null })
			});
			const data = await res.json();
			newInviteCode = data.code ?? null;
			await loadData();
		} catch (e) {
			console.error('Failed to create invite', e);
			toast.error('Failed to create invite');
		} finally {
			creatingInvite = false;
		}
	}

	async function deleteInvite(code: string) {
		try {
			await fetch(`/api/admin/invites?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
			await loadData();
		} catch (e) {
			console.error('Failed to delete invite', e);
			toast.error('Failed to delete invite');
		} finally {
			deleteInviteConfirm = null;
		}
	}

	async function toggleSetting(key: string, value: boolean) {
		savingSettings = true;
		try {
			await fetch('/api/admin/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ [key]: value ? 'true' : 'false' })
			});
			await loadData();
		} catch (e) {
			console.error('Failed to save setting', e);
			toast.error('Failed to save setting');
		} finally {
			savingSettings = false;
		}
	}

	async function previewMigration() {
		migrateLoading = true;
		migratePreview = null;
		migrateResult = null;
		try {
			const res = await fetch('/api/admin/migrate/jellyfin');
			migratePreview = await res.json();
			migrateSelected = new Set((migratePreview ?? []).map((u: any) => u.externalId));
		} catch (e) {
			console.error('Failed to preview migration', e);
			toast.error('Failed to preview migration');
		} finally {
			migrateLoading = false;
		}
	}

	async function executeMigration() {
		migrateLoading = true;
		try {
			const selectedUsers = migratePreview?.filter((u: any) => migrateSelected.has(u.externalId)) ?? [];
			const res = await fetch('/api/admin/migrate/jellyfin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ users: selectedUsers.map((u: any) => ({ externalId: u.externalId, username: u.username, serviceId: u.serviceId })) })
			});
			migrateResult = await res.json();
			await loadData();
		} catch (e) {
			console.error('Failed to execute migration', e);
			toast.error('Failed to execute migration');
		} finally {
			migrateLoading = false;
		}
	}

	async function autoLinkAfterMigration() {
		autoLinkLoading = true;
		autoLinkResult = null;
		try {
			// Get all Jellyfin service IDs from the preview data
			const serviceIds = [...new Set(migratePreview?.map((u: any) => u.serviceId) ?? [])];
			const allResults: any[] = [];
			for (const serviceId of serviceIds) {
				const res = await fetch('/api/admin/autolink', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ serviceId })
				});
				const data = await res.json();
				if (Array.isArray(data)) allResults.push(...data);
				else if (data.results) allResults.push(...data.results);
			}
			autoLinkResult = allResults;
		} catch (e) {
			console.error('Auto-link failed', e);
			toast.error('Auto-link failed');
		} finally {
			autoLinkLoading = false;
		}
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	function initials(name?: string): string {
		if (!name) return '?';
		return name
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	function timeAgo(dateStr?: string): string {
		if (!dateStr) return '';
		const diff = Date.now() - new Date(dateStr).getTime();
		const m = Math.floor(diff / 60_000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	}

	function formatDate(dateStr?: string | number | null): string {
		if (!dateStr) return '';
		return new Date(dateStr).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	const regEnabled = $derived(settings.registration_enabled === 'true');
	const approvalRequired = $derived(settings.registration_requires_approval === 'true');
</script>

{#if loading}
	<!-- Loading skeleton -->
	<div class="flex flex-col gap-6">
		{#each Array(4) as _}
			<div class="animate-pulse rounded-2xl p-6" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
				<div class="mb-4 h-4 w-32 rounded bg-cream/10"></div>
				<div class="space-y-3">
					<div class="h-10 rounded-lg bg-cream/5"></div>
					<div class="h-10 rounded-lg bg-cream/5"></div>
				</div>
			</div>
		{/each}
	</div>
{:else}
	<div class="flex flex-col gap-8">

		<!-- ── 1. Registration Settings ──────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Registration Settings</h2>
			<div class="rounded-2xl p-5" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
				<div class="flex flex-col gap-4">
					<!-- Open Registration -->
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium">Open Registration</p>
							<p class="mt-0.5 text-xs text-[var(--color-muted)]">Allow new users to register without an invite</p>
						</div>
						<button
							class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors {regEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-raised)]'}"
							onclick={() => toggleSetting('registration_enabled', !regEnabled)}
							disabled={savingSettings}
							aria-label="Toggle open registration"
						>
							<span class="pointer-events-none inline-block h-5 w-5 translate-y-0.5 transform rounded-full bg-cream shadow transition-transform {regEnabled ? 'translate-x-5' : 'translate-x-0.5'}"></span>
						</button>
					</div>

					<!-- Require Approval (only shown if open reg) -->
					{#if regEnabled}
						<div class="flex items-center justify-between border-t border-cream/5 pt-4">
							<div>
								<p class="text-sm font-medium">Require Approval</p>
								<p class="mt-0.5 text-xs text-[var(--color-muted)]">Admin must approve new registrations before access is granted</p>
							</div>
							<button
								class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors {approvalRequired ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-raised)]'}"
								onclick={() => toggleSetting('registration_requires_approval', !approvalRequired)}
								disabled={savingSettings}
								aria-label="Toggle require approval"
							>
								<span class="pointer-events-none inline-block h-5 w-5 translate-y-0.5 transform rounded-full bg-cream shadow transition-transform {approvalRequired ? 'translate-x-5' : 'translate-x-0.5'}"></span>
							</button>
						</div>
					{/if}
				</div>
			</div>
		</section>

		<!-- ── 2. Pending Approvals ──────────────────────────────────────── -->
		{#if pendingUsers.length > 0}
			<section>
				<div class="mb-4 flex items-center gap-2">
					<h2 class="text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Pending Approvals</h2>
					<span class="rounded-full px-2 py-0.5 text-[10px] font-bold" style="background: rgba(245,158,11,0.15); color: #f59e0b">{pendingUsers.length}</span>
				</div>
				<div class="flex flex-col divide-y overflow-hidden rounded-2xl" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); divide-color: rgba(255,255,255,0.06)">
					{#each pendingUsers as user (user.id)}
						<div class="flex items-center gap-3 px-4 py-3">
							<!-- Avatar -->
							<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold" style="background: rgba(245,158,11,0.15); color: #f59e0b">
								{initials(user.displayName || user.username)}
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{user.displayName || user.username}</p>
								<div class="flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
									<span>@{user.username}</span>
									<span>·</span>
									<span>{formatDate(user.createdAt)}</span>
								</div>
							</div>
							<span class="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style="background: rgba(245,158,11,0.12); color: #f59e0b; border: 1px solid rgba(245,158,11,0.25)">Pending</span>
							<div class="flex items-center gap-1.5">
								<button
									class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-cream/5"
									style="background: rgba(52,211,153,0.1); color: #34d399; border: 1px solid rgba(52,211,153,0.2)"
									onclick={() => approveUser(user.id)}
									disabled={approveLoading === user.id}
								>
									{approveLoading === user.id ? 'Approving...' : 'Approve'}
								</button>
								<button
									class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-cream/5"
									style="background: rgba(248,113,113,0.1); color: #f87171; border: 1px solid rgba(248,113,113,0.2)"
									onclick={() => denyUser(user.id)}
								>
									Deny
								</button>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ── 3. User List ─────────────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
				Users
				<span class="ml-1 font-normal normal-case text-[var(--color-muted)]">· {users.length}</span>
			</h2>

			{#if users.length === 0}
				<div class="rounded-2xl py-12 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
					<p class="text-sm text-[var(--color-muted)]">No users found</p>
				</div>
			{:else}
				<div class="flex flex-col divide-y overflow-hidden rounded-2xl" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); divide-color: rgba(255,255,255,0.06)">
					{#each users as user (user.id)}
						{@const isOnline = onlineUserIds.has(user.id)}
						<div class="px-4 py-3 transition-colors hover:bg-cream/[0.02]">
							<div class="flex items-center gap-3">
								<!-- Avatar with online indicator -->
								<div class="relative flex-shrink-0">
									<div class="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold" style="background: rgba(124,108,248,0.15); color: var(--color-accent)">
										{initials(user.displayName || user.username)}
									</div>
									{#if isOnline}
										<div class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 bg-[#34d399]" style="border-color: rgba(13,11,10,1); box-shadow: 0 0 6px #34d39988; animation: pulse 2s infinite"></div>
									{/if}
								</div>

								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<p class="truncate text-sm font-medium">{user.displayName || user.username}</p>
										{#if user.isAdmin}
											<span class="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase" style="background: rgba(124,108,248,0.15); color: var(--color-accent); border: 1px solid rgba(124,108,248,0.25)">Admin</span>
										{/if}
										{#if user.authProvider && user.authProvider !== 'local'}
											<span class="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase" style="background: rgba(96,165,250,0.12); color: #60a5fa; border: 1px solid rgba(96,165,250,0.2)">{user.authProvider}</span>
										{/if}
										{#if user.forcePasswordReset}
											<span class="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase" style="background: rgba(245,158,11,0.12); color: #f59e0b; border: 1px solid rgba(245,158,11,0.2)">Reset Required</span>
										{/if}
									</div>
									<p class="mt-0.5 text-[11px] text-[var(--color-muted)]">@{user.username}</p>
								</div>

								<!-- Actions (non-admin only) -->
								{#if !user.isAdmin}
									<div class="flex items-center gap-1.5">
										<!-- Reset password toggle -->
										<button
											class="rounded-lg p-1.5 text-[var(--color-muted)] transition-colors hover:bg-cream/5 hover:text-[var(--color-cream)]"
											title="Reset password"
											onclick={() => { resetPasswordUserId = resetPasswordUserId === user.id ? null : user.id; resetPasswordValue = ''; resetPasswordError = null; }}
										>
											<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
												<rect x="3" y="6" width="8" height="6" rx="1.5" />
												<path d="M5 6V4a2 2 0 0 1 4 0v2" />
											</svg>
										</button>
										<!-- Toggle force reset -->
										<button
											class="rounded-lg p-1.5 transition-colors hover:bg-cream/5 {user.forcePasswordReset ? 'text-[#f59e0b]' : 'text-[var(--color-muted)] hover:text-[var(--color-cream)]'}"
											title="{user.forcePasswordReset ? 'Remove force reset' : 'Force password reset on login'}"
											onclick={() => toggleForceReset(user.id, !user.forcePasswordReset)}
										>
											<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
												<path d="M7 1v3M7 10v3M1 7h3M10 7h3" />
												<circle cx="7" cy="7" r="2" />
											</svg>
										</button>
										<!-- Delete -->
										{#if deleteUserConfirm === user.id}
											<button
												class="rounded-lg px-2 py-1 text-[10px] font-bold transition-colors"
												style="background: rgba(248,113,113,0.15); color: #f87171; border: 1px solid rgba(248,113,113,0.25)"
												onclick={() => deleteUser(user.id)}
											>
												Confirm
											</button>
											<button
												class="rounded-lg px-2 py-1 text-[10px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]"
												onclick={() => { deleteUserConfirm = null; }}
											>
												Cancel
											</button>
										{:else}
											<button
												class="rounded-lg p-1.5 text-[var(--color-muted)] transition-colors hover:bg-cream/5 hover:text-[#f87171]"
												title="Delete user"
												onclick={() => { deleteUserConfirm = user.id; }}
											>
												<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
													<path d="M2.5 3.5h9M5.5 3.5V2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4 3.5l.5 8a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1l.5-8" />
												</svg>
											</button>
										{/if}
									</div>
								{/if}
							</div>

							<!-- Inline password reset form -->
							{#if resetPasswordUserId === user.id}
								<div class="mt-3 flex items-center gap-2 rounded-xl p-3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
									<input
										type="password"
										placeholder="New password"
										class="flex-1 rounded-lg border border-cream/10 bg-cream/5 px-3 py-1.5 text-xs text-[var(--color-cream)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
										bind:value={resetPasswordValue}
									/>
									<button
										class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
										style="background: rgba(124,108,248,0.15); color: var(--color-accent); border: 1px solid rgba(124,108,248,0.25)"
										disabled={resetPasswordLoading || !resetPasswordValue.trim()}
										onclick={() => adminResetPassword(user.id)}
									>
										{resetPasswordLoading ? 'Resetting...' : 'Reset'}
									</button>
									<button
										class="rounded-lg p-1.5 text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]"
										onclick={() => { resetPasswordUserId = null; resetPasswordValue = ''; resetPasswordError = null; }}
										aria-label="Cancel password reset"
									>
										<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
											<path d="M2 2l8 8M10 2l-8 8" />
										</svg>
									</button>
								</div>
								{#if resetPasswordError}
									<p class="mt-1.5 text-xs text-[#f87171]">{resetPasswordError}</p>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- ── 4. Invite Links ──────────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Invite Links</h2>

			<!-- Create invite form -->
			<div class="mb-4 rounded-2xl p-5" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
				<div class="flex flex-wrap items-end gap-3">
					<div>
						<label for="invite-max-uses" class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">Max Uses</label>
						<input
							id="invite-max-uses"
							type="number"
							min="1"
							max="100"
							class="w-20 rounded-lg border border-cream/10 bg-cream/5 px-3 py-1.5 text-xs tabular-nums text-[var(--color-cream)] focus:border-[var(--color-accent)] focus:outline-none"
							bind:value={inviteMaxUses}
						/>
					</div>
					<div>
						<label for="invite-expiry" class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">Expires in (hours)</label>
						<input
							id="invite-expiry"
							type="number"
							min="0"
							placeholder="0 = never"
							class="w-28 rounded-lg border border-cream/10 bg-cream/5 px-3 py-1.5 text-xs tabular-nums text-[var(--color-cream)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
							bind:value={inviteExpiry}
						/>
					</div>
					<button
						class="rounded-lg px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
						style="background: rgba(124,108,248,0.15); color: var(--color-accent); border: 1px solid rgba(124,108,248,0.25)"
						disabled={creatingInvite}
						onclick={createInvite}
					>
						{#if creatingInvite}
							<span class="flex items-center gap-1.5">
								<svg class="h-3 w-3 animate-spin" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.5" opacity="0.3" /><path d="M11 6a5 5 0 0 0-5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
								Generating...
							</span>
						{:else}
							Generate Invite
						{/if}
					</button>
				</div>

				<!-- New invite code display -->
				{#if newInviteCode}
					{@const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/invite?code=${newInviteCode}`}
					<div class="mt-4 flex items-center gap-2 rounded-xl p-3" style="background: rgba(52,211,153,0.06); border: 1px solid rgba(52,211,153,0.15)">
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#34d399" stroke-width="1.3" stroke-linecap="round"><circle cx="7" cy="7" r="5.5" /><path d="M5 7l1.5 1.5L9 5.5" /></svg>
						<code class="flex-1 truncate text-xs text-[#34d399]">{inviteUrl}</code>
						<button
							class="rounded-lg px-2 py-1 text-[10px] font-medium text-[#34d399] transition-colors hover:bg-cream/5"
							onclick={() => copyToClipboard(inviteUrl)}
						>
							Copy
						</button>
					</div>
				{/if}
			</div>

			<!-- Existing invites -->
			{#if invites.length > 0}
				<div class="flex flex-col divide-y overflow-hidden rounded-2xl" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); divide-color: rgba(255,255,255,0.06)">
					{#each invites as invite (invite.code)}
						{@const inviteLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/invite?code=${invite.code}`}
						{@const isExpired = invite.expiresAt && new Date(invite.expiresAt) < new Date()}
						<div class="flex items-center gap-3 px-4 py-3">
							<div class="min-w-0 flex-1">
								<code class="text-xs font-mono text-[var(--color-cream)]">{invite.code}</code>
								<div class="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
									<span>{invite.uses ?? 0}/{invite.maxUses ?? '?'} uses</span>
									{#if invite.expiresAt}
										<span>·</span>
										{#if isExpired}
											<span class="text-[#f87171]">Expired</span>
										{:else}
											<span>Expires {formatDate(invite.expiresAt)}</span>
										{/if}
									{:else}
										<span>·</span>
										<span>No expiry</span>
									{/if}
								</div>
							</div>
							<button
								class="rounded-lg p-1.5 text-[var(--color-muted)] transition-colors hover:bg-cream/5 hover:text-[var(--color-cream)]"
								title="Copy link"
								onclick={() => copyToClipboard(inviteLink)}
							>
								<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
									<rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
									<path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" />
								</svg>
							</button>
							{#if deleteInviteConfirm === invite.code}
								<button
									class="rounded-lg px-2 py-1 text-[10px] font-bold"
									style="background: rgba(248,113,113,0.15); color: #f87171; border: 1px solid rgba(248,113,113,0.25)"
									onclick={() => deleteInvite(invite.code)}
								>Confirm</button>
								<button
									class="rounded-lg px-2 py-1 text-[10px] text-[var(--color-muted)]"
									onclick={() => { deleteInviteConfirm = null; }}
								>Cancel</button>
							{:else}
								<button
									class="rounded-lg p-1.5 text-[var(--color-muted)] transition-colors hover:bg-cream/5 hover:text-[#f87171]"
									title="Delete invite"
									onclick={() => { deleteInviteConfirm = invite.code; }}
								>
									<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
										<path d="M2.5 3.5h9M5.5 3.5V2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4 3.5l.5 8a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1l.5-8" />
									</svg>
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="rounded-2xl py-8 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
					<p class="text-sm text-[var(--color-muted)]">No active invites</p>
				</div>
			{/if}
		</section>

		<!-- ── 5. Jellyfin Migration ────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Jellyfin Migration</h2>
			<div class="rounded-2xl p-5" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
				<p class="mb-4 text-xs text-[var(--color-muted)]">Import users from your Jellyfin server into Nexus. Preview first to see which users will be imported.</p>

				<div class="flex items-center gap-3">
					<button
						class="rounded-lg px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
						style="background: rgba(0,164,220,0.12); color: #00a4dc; border: 1px solid rgba(0,164,220,0.25)"
						disabled={migrateLoading}
						onclick={previewMigration}
					>
						{migrateLoading && !migratePreview ? 'Loading...' : 'Preview Users'}
					</button>
					{#if migratePreview && migratePreview.length > 0}
						<button
							class="rounded-lg px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
							style="background: rgba(52,211,153,0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.25)"
							disabled={migrateLoading || migrateSelected.size === 0}
							onclick={executeMigration}
						>
							{migrateLoading ? 'Importing...' : `Import ${migrateSelected.size} Users`}
						</button>
					{/if}
				</div>

				<!-- Preview list -->
				{#if migratePreview}
					{#if migratePreview.length === 0}
						<div class="mt-4 rounded-xl p-3 text-center text-xs text-[var(--color-muted)]" style="background: rgba(255,255,255,0.03)">
							No new Jellyfin users to import
						</div>
					{:else}
						<div class="mt-3 flex items-center gap-2">
							<button class="text-[10px] text-[var(--color-accent)] hover:underline"
								onclick={() => { migrateSelected = new Set((migratePreview ?? []).map((u: any) => u.externalId)); }}>
								Select All
							</button>
							<button class="text-[10px] text-[var(--color-muted)] hover:underline"
								onclick={() => { migrateSelected = new Set(); }}>
								Deselect All
							</button>
						</div>
						<div class="mt-2 flex flex-col divide-y overflow-hidden rounded-xl" style="background: rgba(0,164,220,0.04); border: 1px solid rgba(0,164,220,0.12); divide-color: rgba(0,164,220,0.08)">
							{#each migratePreview as jfUser (jfUser.externalId || jfUser.username)}
								<div class="flex items-center gap-3 px-3 py-2">
									<input
										type="checkbox"
										checked={migrateSelected.has(jfUser.externalId)}
										onchange={() => {
											if (migrateSelected.has(jfUser.externalId)) {
												migrateSelected.delete(jfUser.externalId);
												migrateSelected = new Set(migrateSelected);
											} else {
												migrateSelected.add(jfUser.externalId);
												migrateSelected = new Set(migrateSelected);
											}
										}}
										class="h-3.5 w-3.5 rounded accent-[var(--color-accent)]"
									/>
									<div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold" style="background: rgba(0,164,220,0.15); color: #00a4dc">
										{initials(jfUser.username)}
									</div>
									<span class="text-xs font-medium">{jfUser.username}</span>
									{#if jfUser.isAdmin}
										<span class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style="background: rgba(124,108,248,0.12); color: var(--color-accent)">Admin</span>
									{/if}
									<span class="ml-auto text-[10px] text-[var(--color-muted)]">{jfUser.serviceName}</span>
								</div>
							{/each}
						</div>
					{/if}
				{/if}

				<!-- Migration result -->
				{#if migrateResult}
					<div class="mt-4 rounded-xl p-3" style="background: rgba(52,211,153,0.06); border: 1px solid rgba(52,211,153,0.15)">
						<p class="mb-2 text-xs font-medium text-[#34d399]">Imported {migrateResult.imported ?? 0} users</p>
						{#if migrateResult.results}
							<div class="flex flex-col gap-1">
								{#each migrateResult.results as r (r.username)}
									<div class="flex items-center gap-2 text-[10px]">
										{#if r.status === 'created' || r.status === 'success'}
											<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#34d399" stroke-width="1.5"><circle cx="5" cy="5" r="4" /><path d="M3.5 5l1 1L6.5 4" stroke-linecap="round" /></svg>
										{:else}
											<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#f59e0b" stroke-width="1.5"><circle cx="5" cy="5" r="4" /><path d="M5 3v2.5M5 7v.5" stroke-linecap="round" /></svg>
										{/if}
										<span>{r.username}</span>
										<span class="text-[var(--color-muted)]">{r.status}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
					<div class="mt-3 flex items-center gap-2">
						<button
							class="rounded-lg px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
							style="background: rgba(124,108,248,0.12); color: var(--color-accent); border: 1px solid rgba(124,108,248,0.25)"
							disabled={autoLinkLoading}
							onclick={autoLinkAfterMigration}
						>
							{autoLinkLoading ? 'Linking...' : 'Auto-Link Credentials'}
						</button>
						<span class="text-[10px] text-[var(--color-muted)]">Reset &amp; link Jellyfin accounts for imported users</span>
					</div>
					{#if autoLinkResult}
						<div class="mt-3 rounded-xl p-3" style="background: rgba(124,108,248,0.06); border: 1px solid rgba(124,108,248,0.15)">
							<p class="mb-2 text-xs font-medium" style="color: var(--color-accent)">Auto-Link Results</p>
							<div class="flex flex-col gap-1">
								{#each autoLinkResult as r}
									<div class="flex items-center gap-2 text-[10px]">
										{#if r.status === 'linked'}
											<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#34d399" stroke-width="1.5"><circle cx="5" cy="5" r="4" /><path d="M3.5 5l1 1L6.5 4" stroke-linecap="round" /></svg>
										{:else if r.status === 'already-linked'}
											<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#60a5fa" stroke-width="1.5"><circle cx="5" cy="5" r="4" /><path d="M3.5 5l1 1L6.5 4" stroke-linecap="round" /></svg>
										{:else}
											<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#f59e0b" stroke-width="1.5"><circle cx="5" cy="5" r="4" /><path d="M5 3v2.5M5 7v.5" stroke-linecap="round" /></svg>
										{/if}
										<span>{r.externalUsername}</span>
										<span class="text-[var(--color-muted)]">→ {r.nexusUsername ?? '—'}</span>
										<span class="text-[var(--color-muted)]">{r.status}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
			</div>
		</section>
	</div>
{/if}

<style>
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}
</style>
