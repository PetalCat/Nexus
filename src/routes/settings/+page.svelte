<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	// ── Tab state ──────────────────────────────────────────────
	let activeTab = $state<'services' | 'users' | 'accounts' | 'notifications'>('services');

	// ── Services tab state ─────────────────────────────────────
	let showAddForm = $state(false);
	let selectedType = $state('');
	let testResult = $state<{ online: boolean; latency?: number; error?: string } | null>(null);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let testing = $state(false);
	let deleteConfirm = $state<string | null>(null);

	let form = $state({
		id: '',
		name: '',
		type: '',
		url: '',
		apiKey: '',
		username: '',
		password: '',
		enabled: true
	});

	let idManuallyEdited = $state(false);

	// ── Users tab state ────────────────────────────────────────
	let inviteMaxUses = $state(1);
	let inviteExpiry = $state(0); // 0 = never
	let creatingInvite = $state(false);
	let newInviteCode = $state<string | null>(null);
	let deleteUserConfirm = $state<string | null>(null);
	let deleteInviteConfirm = $state<string | null>(null);
	let migrateLoading = $state(false);
	let migratePreview = $state<Array<{ serviceId: string; serviceName: string; externalId: string; username: string; isAdmin: boolean }> | null>(null);
	let migrateResult = $state<{ imported: number; results: Array<{ username: string; status: string }> } | null>(null);

	// ── Provision state ──────────────────────────────────────
	let provisionUserId = $state<string | null>(null);
	let provisioning = $state(false);
	let provisionResult = $state<Array<{ serviceId: string; serviceName: string; serviceType: string; status: string; externalUsername?: string; error?: string }> | null>(null);
	let provisionError = $state<string | null>(null);

	// ── Registration & password reset state ────────────────────
	let savingSettings = $state(false);
	let resetPasswordUserId = $state<string | null>(null);
	let resetPasswordValue = $state('');
	let resetPasswordLoading = $state(false);
	let resetPasswordError = $state<string | null>(null);
	let approveLoading = $state<string | null>(null);

	// ── Notification preferences state ─────────────────────────
	let notifPrefs = $state<Record<string, boolean>>({});
	let notifTypes = $state<Record<string, { label: string; description: string }>>({});
	let notifPrefsLoading = $state(false);
	let notifPrefsLoaded = $state(false);
	let notifPrefSaving = $state<string | null>(null);

	async function loadNotifPrefs() {
		if (notifPrefsLoaded) return;
		notifPrefsLoading = true;
		try {
			const res = await fetch('/api/notifications/preferences');
			const json = await res.json();
			notifPrefs = json.preferences ?? {};
			notifTypes = json.types ?? {};
			notifPrefsLoaded = true;
		} catch { /* silent */ }
		finally { notifPrefsLoading = false; }
	}

	async function toggleNotifPref(type: string) {
		const newVal = !notifPrefs[type];
		notifPrefs[type] = newVal;
		notifPrefSaving = type;
		try {
			await fetch('/api/notifications/preferences', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ preferences: { [type]: newVal } })
			});
		} catch {
			notifPrefs[type] = !newVal; // revert
		}
		finally { notifPrefSaving = null; }
	}

	$effect(() => {
		if (activeTab === 'notifications') loadNotifPrefs();
	});

	// ── Account linking state ──────────────────────────────────
	let linkServiceId = $state('');
	let linkUsername = $state('');
	let linkPassword = $state('');
	let linking = $state(false);
	let linkError = $state<string | null>(null);
	let linkSuccess = $state<string | null>(null);

	// ── Post-add-service link prompt ───────────────────────────
	let pendingLinkServiceId = $state<string | null>(null);
	let pendingLinkServiceName = $state('');
	let pendingLinkUsername = $state('');
	let pendingLinkPassword = $state('');
	let pendingLinking = $state(false);
	let pendingLinkError = $state<string | null>(null);

	function slugify(s: string) {
		return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}
	function onNameInput() { if (!idManuallyEdited) form.id = slugify(form.name); }
	function onIdInput() { idManuallyEdited = true; }

	let localHealth = $state<Array<{serviceId:string;name:string;type:string;online:boolean;latency?:number;error?:string}>>([...data.health]);
	const healthMap = $derived(Object.fromEntries(localHealth.map((h: any) => [h.serviceId, h])));
	const credMap = $derived(Object.fromEntries((data as any).myCredentials?.map((c: any) => [c.serviceId, c]) ?? []));
	const unlinkableServices = $derived(((data as any).linkableServices ?? []).filter((s: any) => !credMap[s.id]));
	// True if user has at least one Jellyfin account linked (enables Overseerr auto-link)
	const hasJellyfinLinked = $derived(
		data.services.some((s) => s.type === 'jellyfin' && credMap[s.id])
	);

	const serviceColors: Record<string, string> = {
		jellyfin: '#00a4dc', calibre: '#7b68ee', romm: '#e84393', overseerr: '#f59e0b',
		radarr: '#fbbf24', sonarr: '#00d4aa', lidarr: '#1db954', prowlarr: '#ef4444',
		streamystats: '#b088f9'
	};

	function selectType(t: string) {
		selectedType = t;
		form.type = t;
		const adapter = data.available.find((a) => a.id === t);
		if (adapter) form.url = `http://localhost:${adapter.defaultPort}`;
	}

	function resetForm() {
		form = { id: '', name: '', type: '', url: '', apiKey: '', username: '', password: '', enabled: true };
		selectedType = '';
		testResult = null;
		saveError = null;
		idManuallyEdited = false;
		showAddForm = false;
	}

	async function testConnection() {
		if (!form.url || !form.type) return;
		testing = true; testResult = null;
		try {
			const res = await fetch('/api/services/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
			testResult = await res.json();
		} catch (e) { testResult = { online: false, error: String(e) }; }
		finally { testing = false; }
	}

	async function saveService() {
		if (!form.id || !form.name || !form.type || !form.url) return;
		saving = true; saveError = null;
		try {
			const res = await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
			if (!res.ok) { const body = await res.json().catch(() => ({})); saveError = body.error ?? `Server error ${res.status}`; return; }

			// Check if this is a user-linkable service — if so, prompt admin to link their account
			const adapter = data.available.find((a) => a.id === form.type);
			const isLinkable = adapter && (adapter as any).userLinkable !== false &&
				['jellyfin', 'calibre', 'overseerr', 'romm'].includes(form.type);
			const savedId = form.id;
			const savedName = form.name;

			await invalidateAll();
			resetForm();

			if (isLinkable) {
				pendingLinkServiceId = savedId;
				pendingLinkServiceName = savedName;
				pendingLinkUsername = '';
				pendingLinkPassword = '';
				pendingLinkError = null;
			}
		} catch (e) { saveError = String(e); }
		finally { saving = false; }
	}

	async function deleteService(id: string) {
		await fetch(`/api/services?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
		await invalidateAll(); deleteConfirm = null;
	}

	// ── Invite functions ───────────────────────────────────────
	async function createInvite() {
		creatingInvite = true; newInviteCode = null;
		try {
			const res = await fetch('/api/admin/invites', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ maxUses: inviteMaxUses, expiresInHours: inviteExpiry || null })
			});
			const data = await res.json();
			newInviteCode = data.code;
			await invalidateAll();
		} catch (e) { console.error(e); }
		finally { creatingInvite = false; }
	}

	async function deleteInvite(code: string) {
		await fetch(`/api/admin/invites?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
		await invalidateAll(); deleteInviteConfirm = null;
	}

	async function deleteUser(id: string) {
		await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
		await invalidateAll(); deleteUserConfirm = null;
	}

	// ── Migration functions ────────────────────────────────────
	async function previewMigration() {
		migrateLoading = true; migratePreview = null; migrateResult = null;
		try {
			const res = await fetch('/api/admin/migrate/jellyfin');
			migratePreview = await res.json();
		} catch (e) { console.error(e); }
		finally { migrateLoading = false; }
	}

	async function executeMigration() {
		migrateLoading = true; migrateResult = null;
		try {
			const res = await fetch('/api/admin/migrate/jellyfin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
			migrateResult = await res.json();
			migratePreview = null;
			await invalidateAll();
		} catch (e) { console.error(e); }
		finally { migrateLoading = false; }
	}

	// ── Settings & admin functions ─────────────────────────────
	async function toggleSetting(key: string, value: boolean) {
		savingSettings = true;
		try {
			await fetch('/api/admin/settings', {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ [key]: value ? 'true' : 'false' })
			});
			await invalidateAll();
		} catch (e) { console.error(e); }
		finally { savingSettings = false; }
	}

	async function adminResetPassword(userId: string) {
		if (!resetPasswordValue || resetPasswordValue.length < 6) {
			resetPasswordError = 'Password must be at least 6 characters';
			return;
		}
		resetPasswordLoading = true; resetPasswordError = null;
		try {
			const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ newPassword: resetPasswordValue })
			});
			if (!res.ok) { const b = await res.json().catch(() => ({})); resetPasswordError = b.error ?? 'Failed'; return; }
			resetPasswordUserId = null; resetPasswordValue = '';
			await invalidateAll();
		} catch (e) { resetPasswordError = String(e); }
		finally { resetPasswordLoading = false; }
	}

	async function toggleForceReset(userId: string, force: boolean) {
		await fetch(`/api/admin/users/${userId}/force-reset`, {
			method: 'PUT', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ force })
		});
		await invalidateAll();
	}

	async function approveUser(userId: string) {
		approveLoading = userId;
		try {
			await fetch(`/api/admin/users/${userId}/approve`, { method: 'PUT' });
			await invalidateAll();
		} catch (e) { console.error(e); }
		finally { approveLoading = null; }
	}

	async function denyUser(userId: string) {
		approveLoading = userId;
		try {
			await fetch(`/api/admin/users/${userId}/deny`, { method: 'DELETE' });
			await invalidateAll();
		} catch (e) { console.error(e); }
		finally { approveLoading = null; }
	}

	// ── Provision functions ───────────────────────────────────
	async function provisionUser(userId: string) {
		provisioning = true; provisionError = null; provisionResult = null;
		provisionUserId = userId;
		try {
			const res = await fetch('/api/admin/provision', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			const body = await res.json();
			if (!res.ok) { provisionError = body.error ?? 'Provisioning failed'; return; }
			provisionResult = body.results;
			await invalidateAll();
		} catch (e) { provisionError = String(e); }
		finally { provisioning = false; }
	}

	// ── Account linking functions ──────────────────────────────
	async function linkAccount() {
		if (!linkServiceId || !linkUsername || !linkPassword) return;
		linking = true; linkError = null; linkSuccess = null;
		try {
			const res = await fetch('/api/user/credentials', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId: linkServiceId, username: linkUsername, password: linkPassword })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) { linkError = body.error ?? 'Failed to link account'; return; }
			linkSuccess = `Linked as ${body.externalUsername}`;
			linkServiceId = ''; linkUsername = ''; linkPassword = '';
			await invalidateAll();
		} catch (e) { linkError = String(e); }
		finally { linking = false; }
	}

	async function autoLinkAccount(serviceId: string) {
		linking = true; linkError = null; linkSuccess = null;
		try {
			const res = await fetch('/api/user/credentials', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId, autoLink: true })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) { linkError = body.error ?? 'Auto-link failed'; return; }
			linkSuccess = `Auto-linked as ${body.externalUsername}`;
			await invalidateAll();
		} catch (e) { linkError = String(e); }
		finally { linking = false; }
	}

	async function unlinkAccount(serviceId: string) {
		await fetch(`/api/user/credentials?serviceId=${encodeURIComponent(serviceId)}`, { method: 'DELETE' });
		await invalidateAll();
	}

	async function linkPendingAccount() {
		if (!pendingLinkServiceId || !pendingLinkUsername || !pendingLinkPassword) return;
		pendingLinking = true; pendingLinkError = null;
		try {
			const res = await fetch('/api/user/credentials', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId: pendingLinkServiceId, username: pendingLinkUsername, password: pendingLinkPassword })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				pendingLinkError = body.error ?? 'Failed to link account';
				return;
			}
			pendingLinkServiceId = null;
			await invalidateAll();
		} catch (e) { pendingLinkError = String(e); }
		finally { pendingLinking = false; }
	}

	function dismissPendingLink() {
		pendingLinkServiceId = null;
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
	}

	// ── Per-service action state ────────────────────────────────
	let editingId = $state<string | null>(null);
	let editForm = $state({ id: '', name: '', type: '', url: '', apiKey: '', username: '', password: '', enabled: true as boolean });
	let editSaving = $state(false);
	let editError = $state<string | null>(null);
	let editTestResult = $state<{ online: boolean; latency?: number; error?: string } | null>(null);
	let serviceTestResults = $state<Record<string, { online: boolean; latency?: number; error?: string } | null>>({});
	let testingId = $state<string | null>(null);

	function startEdit(service: (typeof data.services)[0]) {
		editingId = service.id;
		editForm = { id: service.id, name: service.name, type: service.type, url: service.url, apiKey: service.apiKey ?? '', username: (service as any).username ?? '', password: (service as any).password ?? '', enabled: (service as any).enabled ?? true };
		editTestResult = null;
		editError = null;
	}

	function cancelEdit() {
		editingId = null;
		editTestResult = null;
		editError = null;
	}

	async function testEditConnection() {
		editTestResult = null;
		try {
			const res = await fetch('/api/services/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm) });
			editTestResult = await res.json();
		} catch (e) { editTestResult = { online: false, error: String(e) }; }
	}

	async function saveEdit() {
		editSaving = true; editError = null;
		try {
			// Preserve existing apiKey/password if blank (avoid accidentally clearing them)
			const payload = { ...editForm };
			const orig = data.services.find((s) => s.id === editForm.id);
			if (!payload.apiKey) {
				payload.apiKey = (orig as any)?.apiKey ?? '';
			}
			if (!payload.password) {
				payload.password = (orig as any)?.password ?? '';
			}
			const res = await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
			if (!res.ok) { const body = await res.json().catch(() => ({})); editError = body.error ?? `Error ${res.status}`; return; }
			editingId = null;
			await invalidateAll();
		} catch (e) { editError = String(e); }
		finally { editSaving = false; }
	}

	async function testService(id: string) {
		testingId = id;
		serviceTestResults[id] = null;
		try {
			const res = await fetch(`/api/services/ping?id=${encodeURIComponent(id)}`);
			serviceTestResults[id] = await res.json();
		} catch (e) {
			serviceTestResults[id] = { online: false, error: String(e) };
		} finally {
			testingId = null;
		}
	}

	async function toggleEnabled(service: (typeof data.services)[0]) {
		try {
			await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...service, enabled: !(service as any).enabled }) });
			await invalidateAll();
		} catch {}
	}

	// Sync localHealth when page data refreshes (after add/delete/invalidateAll)
	$effect(() => { localHealth = [...data.health]; });

	// Poll health every 30s — detects services going down or coming back up
	$effect(() => {
		const poll = setInterval(async () => {
			try {
				const res = await fetch('/api/services?health=true');
				if (res.ok) { const body = await res.json(); if (Array.isArray(body.health)) localHealth = body.health; }
			} catch {}
		}, 30_000);
		return () => clearInterval(poll);
	});
</script>

<svelte:head>
	<title>Settings — Nexus</title>
</svelte:head>

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8 max-w-3xl">
	<div class="mb-4 sm:mb-6">
		<h1 class="text-display text-xl font-bold sm:text-2xl">Settings</h1>
		<p class="mt-1 text-sm text-[var(--color-muted)]">Manage services, users, and your linked accounts.</p>
	</div>

	<!-- Tab bar -->
	<div class="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-[var(--color-surface)] p-1 scrollbar-none sm:mb-6">
		<button class="flex-shrink-0 flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all whitespace-nowrap {activeTab === 'services' ? 'bg-[var(--color-raised)] text-[var(--color-display)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}" onclick={() => (activeTab = 'services')}>
			Services
			{#if data.isAdmin}<span class="ml-1.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-[var(--color-accent)]/20 text-[var(--color-accent)]">Admin</span>{/if}
		</button>
		{#if data.isAdmin}
			<button class="flex-shrink-0 flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all whitespace-nowrap {activeTab === 'users' ? 'bg-[var(--color-raised)] text-[var(--color-display)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}" onclick={() => (activeTab = 'users')}>
				Users & Invites
				<span class="ml-1.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-[var(--color-accent)]/20 text-[var(--color-accent)]">Admin</span>
			</button>
		{/if}
		<button class="flex-shrink-0 flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all whitespace-nowrap {activeTab === 'accounts' ? 'bg-[var(--color-raised)] text-[var(--color-display)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}" onclick={() => (activeTab = 'accounts')}>My Accounts</button>
		<button class="flex-shrink-0 flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all whitespace-nowrap {activeTab === 'notifications' ? 'bg-[var(--color-raised)] text-[var(--color-display)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}" onclick={() => (activeTab = 'notifications')}>Notifications</button>
	</div>

	<!-- ═══════════════════════════ Services Tab ═══════════════════════════ -->
	{#if activeTab === 'services'}
		<section class="mb-8">
			<div class="mb-1 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<h2 class="text-display text-base font-semibold">Connected Services</h2>
					{#if data.isAdmin}<span class="badge text-[10px] bg-[var(--color-accent)]/20 text-[var(--color-accent)]">Admin</span>{/if}
				</div>
				{#if data.isAdmin}
					<button class="btn btn-primary text-sm" onclick={() => (showAddForm = !showAddForm)}>
						{showAddForm ? 'Cancel' : '+ Add Service'}
					</button>
				{/if}
			</div>
			<p class="mb-4 text-xs text-[var(--color-muted)]">
				{#if data.isAdmin}
					Configure the backend services Nexus connects to — Jellyfin, Overseerr, Calibre, etc. These settings affect all users.
				{:else}
					Services your admin has connected to Nexus. Go to <strong>My Accounts</strong> to link your personal credentials.
				{/if}
			</p>

			{#if data.services.length === 0 && !showAddForm}
				<div class="card flex flex-col items-center gap-3 py-14 text-center">
					<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-raised)] text-[var(--color-muted)]">
						<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M5 12H3a9 9 0 0 0 18 0h-2"/><path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/><circle cx="12" cy="12" r="4"/>
						</svg>
					</div>
					<div>
						<p class="font-medium text-sm">No services connected yet</p>
						<p class="mt-0.5 text-sm text-[var(--color-muted)]">Add your first service to get started.</p>
					</div>
					<button class="btn btn-primary text-sm mt-1" onclick={() => (showAddForm = true)}>Add Service</button>
				</div>
			{/if}

			{#if data.services.length > 0}
				<div class="flex flex-col gap-2">
					{#each data.services as service}
						{@const h = healthMap[service.id]}
						{@const color = serviceColors[service.type] ?? 'var(--color-accent)'}
						{@const tr = serviceTestResults[service.id]}
						{@const isEditing = editingId === service.id}
						<div class="card-raised overflow-hidden {!(service as any).enabled ? 'opacity-60' : ''}">
							{#if isEditing}
								<!-- ── Edit form ── -->
								<div class="px-4 pt-4 pb-4">
									<div class="flex items-center gap-2 mb-4">
										<div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold" style="background: {color}18; color: {color}">{service.type.slice(0,2).toUpperCase()}</div>
										<span class="text-sm font-semibold">Edit {service.name}</span>
										<span class="font-mono text-[10px] text-[var(--color-muted)]">{service.id}</span>
									</div>
									<div class="grid gap-3 sm:grid-cols-2">
										<div>
											<label for="ef-name" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Display Name</label>
											<input id="ef-name" bind:value={editForm.name} class="input text-sm" />
										</div>
										<div>
											<label for="ef-url" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">URL</label>
											<input id="ef-url" bind:value={editForm.url} class="input font-mono text-sm" />
										</div>
										<div class="sm:col-span-2">
											<label for="ef-key" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">API Key</label>
											<input id="ef-key" bind:value={editForm.apiKey} class="input font-mono text-sm" type="password" placeholder="Leave blank to keep current" />
										</div>
										{#if editForm.type === 'overseerr'}
											{@const jellyfinServices = data.services.filter(s => s.type === 'jellyfin')}
											{#if jellyfinServices.length > 0}
												<div class="sm:col-span-2">
													<label for="ef-authmode" class="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
														Auth Mode
														<span class="tooltip" data-tip="Controls how users link their Overseerr account. 'Local' uses their Overseerr email + password. 'Jellyfin' delegates login to Jellyfin — users sign in with their Jellyfin credentials.">
															<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="text-[var(--color-muted)] cursor-help"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
														</span>
													</label>
													<select id="ef-authmode" bind:value={editForm.username} class="input text-sm">
														<option value="">Local (email + password)</option>
														{#each jellyfinServices as jf}
															<option value={jf.url}>Jellyfin: {jf.name}</option>
														{/each}
													</select>
												</div>
											{:else}
												<div class="sm:col-span-2 rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-muted)]">
													<strong class="text-[var(--color-body)]">Auth mode:</strong> Add a Jellyfin service first to enable Jellyfin-based auth for Overseerr.
												</div>
											{/if}
										{/if}
										{#if editForm.type === 'romm' || editForm.type === 'calibre' || editForm.type === 'invidious'}
											<div>
												<label for="ef-user" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</label>
												<input id="ef-user" bind:value={editForm.username} class="input text-sm" placeholder="admin" autocomplete="username" />
											</div>
											<div>
												<label for="ef-pass" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</label>
												<input id="ef-pass" bind:value={editForm.password} class="input text-sm" type="password" placeholder="Leave blank to keep current" autocomplete="current-password" />
											</div>
											{#if editForm.type === 'invidious'}
												<div class="sm:col-span-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
													<p class="text-[11px] font-medium text-amber-400">Invidious Config Requirements</p>
													<ul class="mt-1.5 space-y-1 text-[10px] text-[var(--color-muted)]">
														<li><code class="text-[var(--color-cream)]">login_enabled: true</code></li>
														<li><code class="text-[var(--color-cream)]">registration_enabled: true</code></li>
														<li><code class="text-[var(--color-cream)]">captcha_enabled: false</code></li>
													</ul>
													<p class="mt-1.5 text-[10px] text-[var(--color-muted)]">Set these in your Invidious config.yml or INVIDIOUS_CONFIG env var. Nexus auto-creates accounts for users on sign-in.</p>
												</div>
											{:else}
												<p class="sm:col-span-2 text-[10px] text-[var(--color-muted)]">Admin credentials are used to automatically create individual accounts for new users — each user then browses with their own account.</p>
											{/if}
										{/if}
									</div>
									{#if editTestResult}
										<div class="mt-3 rounded-lg border px-3 py-2 text-sm {editTestResult.online ? 'border-[var(--color-steel)]/30 bg-[rgba(61,143,132,0.1)] text-[var(--color-steel)]' : 'border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 text-[var(--color-warm)]'}">
											{editTestResult.online ? `✓ Connected${editTestResult.latency ? ` · ${editTestResult.latency}ms` : ''}` : `✗ ${editTestResult.error ?? 'Failed'}`}
										</div>
									{/if}
									{#if editError}
										<div class="mt-3 rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-sm text-[var(--color-warm)]">✗ {editError}</div>
									{/if}
									<div class="mt-4 flex gap-2 flex-wrap">
										<button class="btn btn-ghost text-sm" onclick={testEditConnection} disabled={editSaving}>Test</button>
										<button class="btn btn-primary text-sm" onclick={saveEdit} disabled={editSaving || !editForm.name || !editForm.url}>{editSaving ? 'Saving…' : 'Save'}</button>
										<button class="btn btn-ghost text-sm" onclick={cancelEdit}>Cancel</button>
									</div>
								</div>
							{:else}
								<!-- ── Normal card view ── -->
								<div class="flex items-center gap-3 px-4 py-3">
									<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold tracking-wide" style="background: {color}18; color: {color}">
										{service.type.slice(0, 2).toUpperCase()}
									</div>
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2 flex-wrap">
											<span class="font-medium text-sm">{service.name}</span>
											<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)]">{service.type}</span>
											{#if !(service as any).enabled}
												<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)]">Disabled</span>
											{/if}
											{#if h}
												<span class="flex h-2 w-2 rounded-full {h.online ? 'bg-[var(--color-steel)]' : 'bg-[var(--color-warm)]'}"></span>
												{#if h.latency}<span class="text-mono text-[10px] text-[var(--color-muted)]">{h.latency}ms</span>{/if}
												{#if !h.online && h.error}<span class="text-[10px] text-[var(--color-warm)] truncate max-w-[100px]" title={h.error}>{h.error}</span>{/if}
											{/if}
										</div>
										<div class="flex items-center gap-2">
											<p class="truncate text-xs text-[var(--color-muted)]">{service.url}</p>
											{#if tr}
												<span class="text-[10px] flex-shrink-0 {tr.online ? 'text-[var(--color-steel)]' : 'text-[var(--color-warm)]'}">
													{tr.online ? `✓${tr.latency ? ` ${tr.latency}ms` : ''}` : `✗ ${(tr.error ?? 'Failed').slice(0, 28)}`}
												</span>
											{/if}
										</div>
									</div>
									<div class="flex items-center gap-0.5 flex-shrink-0">
										<!-- Test -->
										<button class="btn-icon p-2 text-[var(--color-muted)] hover:text-[var(--color-body)]" onclick={() => testService(service.id)} disabled={testingId === service.id} title="Test connection">
											{#if testingId === service.id}
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="animate-spin" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="9" stroke-dasharray="28" stroke-dashoffset="10"/></svg>
											{:else}
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1.5 8.5C4 4.5 7.7 2 12 2s8 2.5 10.5 6.5M5.5 13c1.5-2.2 3.6-3.5 6.5-3.5s5 1.3 6.5 3.5M9 17.5c1-.9 1.9-1.3 3-1.3s2 .4 3 1.3"/><circle cx="12" cy="21" r="1.2" fill="currentColor"/></svg>
											{/if}
										</button>
										<!-- Edit -->
										<button class="btn-icon p-2 text-[var(--color-muted)] hover:text-[var(--color-body)]" onclick={() => startEdit(service)} title="Edit service">
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
										</button>
										<!-- Enable/Disable -->
										<button class="btn-icon p-2 {(service as any).enabled ? 'text-[var(--color-muted)] hover:text-[var(--color-body)]' : 'text-[var(--color-warm)] opacity-70 hover:opacity-100'}" onclick={() => toggleEnabled(service)} title={(service as any).enabled ? 'Disable service' : 'Enable service'}>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 2v6"/><path d="M7.5 4.8a9 9 0 1 0 9 0"/></svg>
										</button>
										<!-- Delete -->
										{#if deleteConfirm === service.id}
											<button class="btn btn-ghost text-xs text-[var(--color-warm)]" onclick={() => deleteService(service.id)}>Confirm</button>
											<button class="btn btn-ghost text-xs" onclick={() => (deleteConfirm = null)}>Cancel</button>
										{:else}
											<button class="btn-icon p-2 text-[var(--color-warm)] opacity-40 hover:opacity-100" onclick={() => (deleteConfirm = service.id)} title="Delete service">
												<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3.5H12M5 3.5V2.5H9V3.5M5.5 6V10.5M8.5 6V10.5M3 3.5L3.5 11.5H10.5L11 3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
											</button>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Link-your-account prompt (appears after adding a user-linkable service) -->
		{#if pendingLinkServiceId}
			<section class="card mb-6 border-[var(--color-accent)]/30 bg-[rgba(212,162,83,0.12)] p-5">
				<div class="flex items-start gap-3 mb-4">
					<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
					</div>
					<div>
						<h3 class="text-sm font-semibold text-[var(--color-display)]">Link your account on {pendingLinkServiceName}</h3>
						<p class="text-xs text-[var(--color-muted)] mt-0.5">Enter your credentials for this service so Nexus can show your personalized content.</p>
					</div>
				</div>
				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<label for="pending-link-user" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</label>
						<input id="pending-link-user" bind:value={pendingLinkUsername} class="input text-sm" placeholder="Your username" />
					</div>
					<div>
						<label for="pending-link-pass" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</label>
						<input id="pending-link-pass" bind:value={pendingLinkPassword} type="password" class="input text-sm" placeholder="Your password" />
					</div>
				</div>
				{#if pendingLinkError}
					<div class="mt-3 rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-sm text-[var(--color-warm)]">{pendingLinkError}</div>
				{/if}
				<div class="mt-4 flex gap-2">
					<button class="btn btn-primary text-sm" onclick={linkPendingAccount} disabled={pendingLinking || !pendingLinkUsername || !pendingLinkPassword}>
						{pendingLinking ? 'Linking...' : 'Link Account'}
					</button>
					<button class="btn btn-ghost text-sm" onclick={dismissPendingLink}>Skip for now</button>
				</div>
			</section>
		{/if}

		{#if showAddForm}
			<section class="card p-6">
				<h2 class="text-display mb-5 text-base font-semibold">Add Service</h2>
				<div class="mb-5">
					<label class="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Service Type</label>
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{#each data.available as adapter}
							{@const color = serviceColors[adapter.id] ?? 'var(--color-accent)'}
							<button onclick={() => selectType(adapter.id)} class="flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-all {form.type === adapter.id ? 'border-[var(--color-accent)] bg-[rgba(212,162,83,0.12)]' : 'border-[rgba(240,235,227,0.06)] hover:border-[var(--color-muted)] hover:bg-[var(--color-surface)]'}">
								<span class="h-2 w-2 rounded-full" style="background: {color}"></span>
								<span class="text-sm font-medium leading-tight">{adapter.displayName}</span>
								<span class="text-[10px] text-[var(--color-muted)] font-mono">:{adapter.defaultPort}</span>
							</button>
						{/each}
					</div>
				</div>

				{#if form.type}
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Display Name</label>
							<input bind:value={form.name} class="input" placeholder="My Jellyfin" oninput={onNameInput} />
						</div>
						<div>
							<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Internal ID</label>
							<input bind:value={form.id} class="input font-mono text-sm" placeholder="jellyfin-home" oninput={onIdInput} />
						</div>
						<div class="sm:col-span-2">
							<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">URL</label>
							<input bind:value={form.url} class="input font-mono text-sm" placeholder="http://localhost:8096" />
						</div>
						<div class="sm:col-span-2">
							<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">API Key</label>
							<input bind:value={form.apiKey} class="input font-mono text-sm" type="password" placeholder="••••••••" />
						</div>
						{#if form.type === 'romm' || form.type === 'calibre' || form.type === 'invidious'}
							<div>
								<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</label>
								<input bind:value={form.username} class="input text-sm" placeholder="admin" autocomplete="username" />
							</div>
							<div>
								<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</label>
								<input bind:value={form.password} class="input text-sm" type="password" placeholder="••••••••" autocomplete="current-password" />
							</div>
							{#if form.type === 'invidious'}
								<div class="sm:col-span-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
									<p class="text-[11px] font-medium text-amber-400">Invidious Config Requirements</p>
									<ul class="mt-1.5 space-y-1 text-[10px] text-[var(--color-muted)]">
										<li><code class="text-[var(--color-cream)]">login_enabled: true</code></li>
										<li><code class="text-[var(--color-cream)]">registration_enabled: true</code></li>
										<li><code class="text-[var(--color-cream)]">captcha_enabled: false</code></li>
									</ul>
									<p class="mt-1.5 text-[10px] text-[var(--color-muted)]">Set these in your Invidious config.yml or INVIDIOUS_CONFIG env var. Nexus auto-creates accounts for users on sign-in.</p>
								</div>
							{:else}
								<p class="sm:col-span-2 text-[10px] text-[var(--color-muted)]">Admin credentials are used to automatically create individual accounts for new users — each user then browses with their own account.</p>
							{/if}
						{/if}
					</div>

					{#if testResult}
						<div class="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm {testResult.online ? 'border-[var(--color-steel)]/30 bg-[rgba(61,143,132,0.1)] text-[var(--color-steel)]' : 'border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 text-[var(--color-warm)]'}">
							{#if testResult.online}✓ Connected {#if testResult.latency}· {testResult.latency}ms{/if}{:else}✗ Failed: {testResult.error ?? 'Unable to connect'}{/if}
						</div>
					{/if}

					{#if saveError}
						<div class="mt-3 flex items-center gap-2 rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-sm text-[var(--color-warm)]">✗ {saveError}</div>
					{/if}

					<div class="mt-5 flex gap-2">
						<button class="btn btn-ghost text-sm" onclick={testConnection} disabled={testing}>{testing ? 'Testing...' : 'Test Connection'}</button>
						<button class="btn btn-primary text-sm" onclick={saveService} disabled={saving || !form.id || !form.name || !form.url}>{saving ? 'Saving...' : 'Save Service'}</button>
						<button class="btn btn-ghost text-sm" onclick={resetForm}>Cancel</button>
					</div>
				{/if}
			</section>
		{/if}
	{/if}

	<!-- ═══════════════════════════ Users & Invites Tab (admin) ═══════════════════════════ -->
	{#if activeTab === 'users' && data.isAdmin}
		<!-- Registration Settings -->
		<section class="mb-8">
			<h2 class="text-display text-base font-semibold mb-4">Registration</h2>
			<div class="card p-4 flex flex-col gap-4">
				<label class="flex items-center justify-between gap-4">
					<div>
						<span class="text-sm font-medium">Open Registration</span>
						<p class="text-xs text-[var(--color-muted)]">Allow anyone to create an account from the login page.</p>
					</div>
					<button
						class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors {data.settings.registration_enabled === 'true' ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-raised)]'}"
						onclick={() => toggleSetting('registration_enabled', data.settings.registration_enabled !== 'true')}
						disabled={savingSettings}
					>
						<span class="pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform {data.settings.registration_enabled === 'true' ? 'translate-x-[22px]' : 'translate-x-0.5'}" />
					</button>
				</label>
				{#if data.settings.registration_enabled === 'true'}
					<label class="flex items-center justify-between gap-4 border-t border-[rgba(240,235,227,0.06)] pt-4">
						<div>
							<span class="text-sm font-medium">Require Approval</span>
							<p class="text-xs text-[var(--color-muted)]">New accounts must be approved by an admin before they can sign in.</p>
						</div>
						<button
							class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors {data.settings.registration_requires_approval === 'true' ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-raised)]'}"
							onclick={() => toggleSetting('registration_requires_approval', data.settings.registration_requires_approval !== 'true')}
							disabled={savingSettings}
						>
							<span class="pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform {data.settings.registration_requires_approval === 'true' ? 'translate-x-[22px]' : 'translate-x-0.5'}" />
						</button>
					</label>
				{/if}
			</div>
		</section>

		<!-- Pending Users -->
		{#if data.pendingUsers.length > 0}
			<section class="mb-8">
				<h2 class="text-display text-base font-semibold mb-4">Pending Approval ({data.pendingUsers.length})</h2>
				<div class="flex flex-col gap-2">
					{#each data.pendingUsers as user}
						<div class="card-raised flex items-center gap-4 px-4 py-3">
							<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 text-xs font-bold">
								{user.displayName.slice(0, 2).toUpperCase()}
							</div>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<span class="font-medium text-sm">{user.displayName}</span>
									<span class="font-mono text-xs text-[var(--color-muted)]">@{user.username}</span>
									<span class="badge text-[10px] bg-amber-500/20 text-amber-400">Pending</span>
								</div>
								<p class="text-xs text-[var(--color-muted)]">Registered {new Date(user.createdAt).toLocaleDateString()}</p>
							</div>
							<div class="flex items-center gap-2 flex-shrink-0">
								<button class="btn btn-primary text-xs" onclick={() => approveUser(user.id)} disabled={approveLoading === user.id}>
									{approveLoading === user.id ? '...' : 'Approve'}
								</button>
								<button class="btn btn-ghost text-xs text-[var(--color-warm)]" onclick={() => denyUser(user.id)} disabled={approveLoading === user.id}>Deny</button>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Users list -->
		<section class="mb-8">
			<h2 class="text-display text-base font-semibold mb-4">Users ({data.users.length})</h2>
			<div class="flex flex-col gap-2">
				{#each data.users as user}
					{@const userCreds = data.allUserCredentials[user.id] ?? []}
					{@const unlinkedProvisionable = data.provisionableServices.filter((s) => s.supportsCreate && !userCreds.some((uc) => uc.serviceId === s.id))}
					<div class="card-raised flex items-center gap-4 px-4 py-3">
						<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] text-xs font-bold">
							{user.displayName.slice(0, 2).toUpperCase()}
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-medium text-sm">{user.displayName}</span>
								<span class="font-mono text-xs text-[var(--color-muted)]">@{user.username}</span>
								{#if user.isAdmin}
									<span class="badge text-[10px] bg-[var(--color-accent)]/20 text-[var(--color-accent)]">Admin</span>
								{/if}
								{#if user.authProvider !== 'local'}
									<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)]">{user.authProvider}</span>
								{/if}
								{#if user.forcePasswordReset}
									<span class="badge text-[10px] bg-amber-500/20 text-amber-400">Must Reset Password</span>
								{/if}
								{#if user.status === 'pending'}
									<span class="badge text-[10px] bg-amber-500/20 text-amber-400">Pending</span>
								{/if}
							</div>
							<div class="mt-0.5 flex items-center gap-1.5 flex-wrap">
								{#if userCreds.length > 0}
									{#each userCreds as uc}
										{@const svcColor = serviceColors[uc.serviceType] ?? 'var(--color-accent)'}
										<span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium" style="background: {svcColor}15; color: {svcColor}" title="{uc.serviceType} — @{uc.externalUsername}">
											<span class="h-1.5 w-1.5 rounded-full" style="background: {svcColor}"></span>
											{uc.serviceType}
										</span>
									{/each}
								{:else}
									<span class="text-[10px] text-[var(--color-muted)]">No linked services</span>
								{/if}
								{#if unlinkedProvisionable.length > 0 && !user.isAdmin}
									<button
										class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-body)] hover:bg-[var(--color-raised)] transition-colors"
										onclick={() => provisionUser(user.id)}
										disabled={provisioning && provisionUserId === user.id}
										title="Create accounts on {unlinkedProvisionable.map(s => s.type).join(', ')}"
									>
										{#if provisioning && provisionUserId === user.id}
											<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="animate-spin" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="9" stroke-dasharray="28" stroke-dashoffset="10"/></svg>
											Provisioning…
										{:else}
											<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
											Provision ({unlinkedProvisionable.length})
										{/if}
									</button>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-1 flex-shrink-0">
							{#if !user.isAdmin}
								<button class="btn-icon p-2 text-[var(--color-muted)] opacity-50 hover:opacity-100" onclick={() => { resetPasswordUserId = resetPasswordUserId === user.id ? null : user.id; resetPasswordValue = ''; resetPasswordError = null; }} title="Reset password">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
								</button>
								<button class="btn-icon p-2 {user.forcePasswordReset ? 'text-amber-400' : 'text-[var(--color-muted)] opacity-50 hover:opacity-100'}" onclick={() => toggleForceReset(user.id, !user.forcePasswordReset)} title="{user.forcePasswordReset ? 'Remove force reset' : 'Force password reset on next login'}">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
								</button>
								{#if deleteUserConfirm === user.id}
									<button class="btn btn-ghost text-xs text-[var(--color-warm)]" onclick={() => deleteUser(user.id)}>Confirm</button>
									<button class="btn btn-ghost text-xs" onclick={() => (deleteUserConfirm = null)}>Cancel</button>
								{:else}
									<button class="btn-icon p-2 text-[var(--color-warm)] opacity-50 hover:opacity-100" onclick={() => (deleteUserConfirm = user.id)} title="Delete user">
										<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3.5H12M5 3.5V2.5H9V3.5M5.5 6V10.5M8.5 6V10.5M3 3.5L3.5 11.5H10.5L11 3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
									</button>
								{/if}
							{/if}
						</div>
					</div>
					{#if provisionUserId === user.id && (provisionResult || provisionError)}
						<div class="border-t border-[rgba(240,235,227,0.06)] px-4 py-2.5 bg-[var(--color-surface)]/50">
							{#if provisionError}
								<div class="text-xs text-[var(--color-warm)]">{provisionError}</div>
							{/if}
							{#if provisionResult}
								<div class="flex flex-col gap-1">
									{#each provisionResult as r}
										{@const svcColor = serviceColors[r.serviceType] ?? 'var(--color-accent)'}
										<div class="flex items-center gap-2 text-xs">
											<span class="h-1.5 w-1.5 rounded-full" style="background: {svcColor}"></span>
											<span class="font-medium">{r.serviceName}</span>
											<span class="{r.status === 'created' ? 'text-[var(--color-steel)]' : r.status === 'linked' ? 'text-[var(--color-muted)]' : r.status === 'error' ? 'text-[var(--color-warm)]' : 'text-[var(--color-muted)]'}">
												{r.status === 'created' ? `✓ Created as @${r.externalUsername}` : r.status === 'linked' ? `Already linked` : r.status === 'skipped' ? 'Skipped' : `✗ ${r.error ?? 'Failed'}`}
											</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
					{#if resetPasswordUserId === user.id}
						<div class="border-t border-[rgba(240,235,227,0.06)] px-4 py-3 flex items-center gap-3">
							<input
								bind:value={resetPasswordValue}
								type="password"
								class="input flex-1 text-sm"
								placeholder="New password (min 6 chars)"
								onkeydown={(e) => { if (e.key === 'Enter') adminResetPassword(user.id); }}
							/>
							<button class="btn btn-primary text-xs" onclick={() => adminResetPassword(user.id)} disabled={resetPasswordLoading}>
								{resetPasswordLoading ? '...' : 'Set Password'}
							</button>
							<button class="btn btn-ghost text-xs" onclick={() => { resetPasswordUserId = null; resetPasswordError = null; }}>Cancel</button>
						</div>
						{#if resetPasswordError}
							<div class="px-4 pb-3 text-xs text-[var(--color-warm)]">{resetPasswordError}</div>
						{/if}
					{/if}
				{/each}
			</div>
		</section>

		<!-- Invite Links -->
		<section class="mb-8">
			<h2 class="text-display text-base font-semibold mb-4">Invite Links</h2>

			<!-- Create invite -->
			<div class="card p-4 mb-4">
				<div class="flex flex-wrap items-end gap-3">
					<div>
						<label class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Max Uses</label>
						<input bind:value={inviteMaxUses} type="number" min="1" max="100" class="input w-24 text-sm" />
					</div>
					<div>
						<label class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Expires In (hours)</label>
						<input bind:value={inviteExpiry} type="number" min="0" class="input w-28 text-sm" placeholder="0 = never" />
					</div>
					<button class="btn btn-primary text-sm" onclick={createInvite} disabled={creatingInvite}>
						{creatingInvite ? 'Creating...' : 'Generate Invite'}
					</button>
				</div>

				{#if newInviteCode}
					<div class="mt-3 flex items-center gap-2 rounded-lg border border-[var(--color-steel)]/30 bg-[rgba(61,143,132,0.1)] px-3 py-2">
						<span class="text-sm text-[var(--color-steel)] flex-1 font-mono truncate">{window.location.origin}/invite?code={newInviteCode}</span>
						<button class="btn btn-ghost text-xs" onclick={() => copyToClipboard(`${window.location.origin}/invite?code=${newInviteCode}`)}>Copy</button>
					</div>
				{/if}
			</div>

			<!-- Existing invites -->
			{#if data.invites.length > 0}
				<div class="flex flex-col gap-2">
					{#each data.invites as invite}
						<div class="card-raised flex items-center gap-4 px-4 py-3">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<span class="font-mono text-sm text-[var(--color-body)]">{invite.code}</span>
									<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)]">{invite.uses}/{invite.maxUses} used</span>
									{#if invite.expiresAt}
										{@const expired = new Date(invite.expiresAt) < new Date()}
										<span class="badge text-[10px] {expired ? 'bg-[var(--color-warm)]/20 text-[var(--color-warm)]' : 'bg-[var(--color-surface)] text-[var(--color-muted)]'}">
											{expired ? 'Expired' : `Expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
										</span>
									{:else}
										<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)]">No expiry</span>
									{/if}
								</div>
							</div>
							<div class="flex items-center gap-1 flex-shrink-0">
								<button class="btn btn-ghost text-xs" onclick={() => copyToClipboard(`${window.location.origin}/invite?code=${invite.code}`)}>Copy Link</button>
								{#if deleteInviteConfirm === invite.code}
									<button class="btn btn-ghost text-xs text-[var(--color-warm)]" onclick={() => deleteInvite(invite.code)}>Confirm</button>
									<button class="btn btn-ghost text-xs" onclick={() => (deleteInviteConfirm = null)}>Cancel</button>
								{:else}
									<button class="btn-icon p-2 text-[var(--color-warm)] opacity-50 hover:opacity-100" onclick={() => (deleteInviteConfirm = invite.code)}>
										<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3.5H12M5 3.5V2.5H9V3.5M5.5 6V10.5M8.5 6V10.5M3 3.5L3.5 11.5H10.5L11 3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-[var(--color-muted)]">No active invite links.</p>
			{/if}
		</section>

		<!-- Jellyfin Migration -->
		<section class="mb-8">
			<h2 class="text-display text-base font-semibold mb-3">Import Jellyfin Users</h2>
			<p class="text-sm text-[var(--color-muted)] mb-4">Import users from Jellyfin — creates Nexus accounts and automatically links their Jellyfin credentials.</p>

			<div class="flex gap-2 mb-4">
				<button class="btn btn-ghost text-sm" onclick={previewMigration} disabled={migrateLoading}>
					{migrateLoading ? 'Loading...' : 'Preview Users'}
				</button>
				{#if migratePreview && migratePreview.length > 0}
					<button class="btn btn-primary text-sm" onclick={executeMigration} disabled={migrateLoading}>
						Import {migratePreview.length} Users
					</button>
				{/if}
			</div>

			{#if migratePreview}
				{#if migratePreview.length === 0}
					<p class="text-sm text-[var(--color-muted)]">No Jellyfin users found. Is a Jellyfin service configured?</p>
				{:else}
					<div class="flex flex-col gap-1">
						{#each migratePreview as jfUser}
							<div class="card-raised flex items-center gap-3 px-3 py-2">
								<span class="text-sm font-medium">{jfUser.username}</span>
								<span class="text-xs text-[var(--color-muted)]">{jfUser.serviceName}</span>
								{#if jfUser.isAdmin}<span class="badge text-[10px] bg-[var(--color-accent)]/20 text-[var(--color-accent)]">JF Admin</span>{/if}
							</div>
						{/each}
					</div>
				{/if}
			{/if}

			{#if migrateResult}
				<div class="mt-3 rounded-lg border border-[var(--color-steel)]/30 bg-[rgba(61,143,132,0.1)] p-3">
					<p class="text-sm text-[var(--color-steel)] font-medium mb-2">Imported {migrateResult.imported} users</p>
					<div class="flex flex-col gap-1">
						{#each migrateResult.results as r}
							<div class="flex items-center gap-2 text-xs">
								<span class="font-medium">{r.username}</span>
								<span class="text-[var(--color-muted)]">— {r.status}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{/if}

	<!-- ═══════════════════════════ Linked Accounts Tab ═══════════════════════════ -->
	{#if activeTab === 'accounts'}
		<section class="mb-8">
			<div class="flex items-center gap-2 mb-2">
				<h2 class="text-display text-base font-semibold">My Linked Accounts</h2>
				<span class="badge text-[10px] bg-[var(--color-steel)]/20 text-[var(--color-steel)]">Personal</span>
			</div>
			<p class="text-sm text-[var(--color-muted)] mb-1">These are <strong class="text-[var(--color-body)]">your</strong> credentials — only you can see them. Linking lets Nexus show your personal watch history, reading progress, and request media on your behalf.</p>
			<div class="mb-4 flex items-start gap-2 rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-muted)]">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="mt-0.5 flex-shrink-0 text-[var(--color-muted)]"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
				<span>Your admin has set up these services. Enter <em>your own</em> username/password for each one — not the admin's API key.</span>
			</div>

			{#if data.linkableServices.length === 0}
				<div class="card py-12 text-center">
					<p class="text-sm text-[var(--color-muted)]">No user-linkable services configured yet.</p>
					<p class="text-xs text-[var(--color-muted)] mt-1">Ask your admin to add Jellyfin, Overseerr, or Calibre.</p>
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each data.linkableServices as svc}
						{@const cred = credMap[svc.id]}
						{@const color = serviceColors[svc.type] ?? 'var(--color-accent)'}
						{@const isLinking = linkServiceId === svc.id}
						{@const isAuto = svc.authMode === 'auto-jellyfin'}
						{@const isProvisioned = svc.authMode === 'auto-provisioned'}
						{@const isNeedsReauth = svc.authMode === 'needs-reauth'}
						<!-- auto-jellyfin is "active" when Jellyfin is linked. StreamyStats needs no stored cred; Overseerr needs one. -->
						{@const autoConnected = isAuto && (svc.type === 'streamystats' ? hasJellyfinLinked : (hasJellyfinLinked && !!cred))}
						{@const autoWaiting = isAuto && hasJellyfinLinked && !cred && svc.type !== 'streamystats'}
						<div class="card-raised overflow-hidden">
							<!-- Service row -->
							<div class="flex items-center gap-3 px-4 py-3">
								<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold" style="background: {color}18; color: {color}">
									{svc.type.slice(0, 2).toUpperCase()}
								</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<span class="font-medium text-sm">{svc.name}</span>
										<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)]">{svc.type}</span>
										{#if isAuto}
											{#if autoConnected}
												<span class="badge text-[10px] bg-[var(--color-steel)]/20 text-[var(--color-steel)]">✓ Auto-connected</span>
											{:else if autoWaiting}
												<span class="badge text-[10px] bg-amber-500/20 text-amber-400">Setting up…</span>
											{:else}
												<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)]">Needs Jellyfin</span>
											{/if}
										{:else if isProvisioned}
											<span class="badge text-[10px] bg-[var(--color-steel)]/20 text-[var(--color-steel)]">✓ Connected</span>
										{:else if isNeedsReauth}
											<span class="badge text-[10px] bg-amber-500/20 text-amber-400">↻ Session expired</span>
										{:else if cred}
											<span class="badge text-[10px] bg-[var(--color-steel)]/20 text-[var(--color-steel)]">✓ Connected</span>
										{/if}
									</div>

									{#if isAuto}
										{#if autoConnected}
											<div class="mt-0.5 flex items-center gap-2 flex-wrap">
												{#if cred?.externalUsername}
													<span class="text-xs text-[var(--color-body)] font-medium">@{cred.externalUsername}</span>
												{/if}
												<span class="text-xs text-[var(--color-muted)]">via Jellyfin — no separate login needed</span>
											</div>
										{:else if autoWaiting}
											<p class="mt-0.5 text-xs text-[var(--color-muted)]">Refresh to retry — Jellyfin is linked but {svc.name} couldn't be reached</p>
										{:else}
											<p class="mt-0.5 text-xs text-[var(--color-muted)]">Link your Jellyfin account above to activate</p>
										{/if}
									{:else if isProvisioned}
										<div class="mt-0.5 flex items-center gap-2 flex-wrap">
											{#if cred?.externalUsername}
												<span class="text-xs text-[var(--color-body)] font-medium">@{cred.externalUsername}</span>
											{/if}
											<span class="text-xs text-[var(--color-muted)]">set up by admin</span>
										</div>
									{:else if isNeedsReauth}
										<p class="mt-0.5 text-xs text-amber-400/80">Refresh your session to activate personalized features like For You recommendations</p>
									{:else if cred}
										<div class="mt-0.5 flex items-center gap-2 flex-wrap">
											<span class="text-xs text-[var(--color-body)] font-medium">@{cred.externalUsername ?? 'unknown'}</span>
											{#if cred.externalUserId}
												<span class="font-mono text-[10px] text-[var(--color-muted)]">id:{cred.externalUserId}</span>
											{/if}
											{#if cred.linkedAt}
												<span class="text-[10px] text-[var(--color-muted)]">connected {new Date(cred.linkedAt).toLocaleDateString()}</span>
											{/if}
										</div>
									{:else}
										<p class="mt-0.5 text-xs text-[var(--color-muted)]">Not connected — click Link to connect your account</p>
									{/if}
								</div>

								<div class="flex-shrink-0">
									{#if isAuto || isProvisioned}
										<!-- Fully automatic — no action needed -->
									{:else if isNeedsReauth}
										<button
											class="btn btn-ghost text-xs {linkServiceId === svc.id ? 'text-[var(--color-accent)]' : 'text-amber-400'}"
											onclick={() => { linkServiceId = linkServiceId === svc.id ? '' : svc.id; linkUsername = (svc as any).prefillUsername ?? ''; linkPassword = ''; linkError = null; linkSuccess = null; }}
										>{linkServiceId === svc.id ? 'Cancel' : 'Refresh'}</button>
									{:else if cred}
										<button class="btn btn-ghost text-xs text-[var(--color-warm)]" onclick={() => unlinkAccount(svc.id)}>Unlink</button>
									{:else}
										<button
											class="btn btn-ghost text-xs {isLinking ? 'text-[var(--color-accent)]' : ''}"
											onclick={() => { linkServiceId = isLinking ? '' : svc.id; linkUsername = ''; linkPassword = ''; linkError = null; linkSuccess = null; }}
										>{isLinking ? 'Cancel' : 'Link'}</button>
									{/if}
								</div>
							</div>

							<!-- Manual link feedback -->
							{#if !isLinking && (linkError || linkSuccess)}
								<div class="border-t border-[rgba(240,235,227,0.06)] px-4 py-2 bg-[var(--color-surface)]/50">
									{#if linkError}<p class="text-xs text-[var(--color-warm)]">✗ {linkError}</p>{/if}
									{#if linkSuccess}<p class="text-xs text-[var(--color-steel)]">✓ {linkSuccess}</p>{/if}
								</div>
							{/if}

							<!-- Inline manual link form -->
							{#if isLinking}
								<div class="border-t border-[rgba(240,235,227,0.06)] px-4 pt-3 pb-4 bg-[var(--color-surface)]/50">
									<div class="grid gap-3 sm:grid-cols-2">
										<div>
											<label for="link-u-{svc.id}" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{svc.authUsernameLabel ?? 'Username'}</label>
											<input id="link-u-{svc.id}" bind:value={linkUsername} class="input text-sm" placeholder={svc.type === 'overseerr' ? 'Your email address' : `Your ${svc.type} username`} autocomplete="username" />
										</div>
										<div>
											<label for="link-p-{svc.id}" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</label>
											<input id="link-p-{svc.id}" bind:value={linkPassword} class="input text-sm" type="password" placeholder="••••••••" autocomplete="current-password" />
										</div>
									</div>
									{#if linkError}
										<div class="mt-2 rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-xs text-[var(--color-warm)]">✗ {linkError}</div>
									{/if}
									{#if linkSuccess}
										<div class="mt-2 rounded-lg border border-[var(--color-steel)]/30 bg-[rgba(61,143,132,0.1)] px-3 py-2 text-xs text-[var(--color-steel)]">✓ {linkSuccess}</div>
									{/if}
									<button class="btn btn-primary text-sm mt-3" onclick={linkAccount} disabled={linking || !linkUsername || !linkPassword}>
										{linking ? 'Linking…' : 'Link Account'}
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	<!-- ═══════════════════════════ Notifications Tab ═══════════════════════════ -->
	{#if activeTab === 'notifications'}
		<section class="mb-8">
			<h2 class="text-display mb-1 text-base font-semibold">Notification Preferences</h2>
			<p class="text-body-muted mb-5 text-xs">Choose which notifications you want to receive.</p>

			{#if notifPrefsLoading}
				<div class="space-y-3">
					{#each { length: 6 } as _, i (i)}
						<div class="flex items-center justify-between rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-4">
							<div class="space-y-1.5">
								<div class="h-4 w-32 rounded bg-[var(--color-raised)] animate-pulse"></div>
								<div class="h-3 w-48 rounded bg-[var(--color-raised)] animate-pulse"></div>
							</div>
							<div class="h-6 w-11 rounded-full bg-[var(--color-raised)] animate-pulse"></div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="space-y-2">
					{#each Object.entries(notifTypes) as [type, meta] (type)}
						<div class="flex items-center justify-between rounded-lg border border-[rgba(240,235,227,0.06)] bg-[var(--color-surface)] p-4">
							<div>
								<p class="text-sm font-medium text-[var(--color-display)]">{meta.label}</p>
								<p class="mt-0.5 text-xs text-[var(--color-muted)]">{meta.description}</p>
							</div>
							<button
								class="relative h-6 w-11 rounded-full transition-colors {notifPrefs[type] ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-raised)]'}"
								onclick={() => toggleNotifPref(type)}
								disabled={notifPrefSaving === type}
								aria-label="Toggle {meta.label}"
							>
								<span
									class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform {notifPrefs[type] ? 'translate-x-[22px]' : 'translate-x-0.5'}"
								></span>
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	/* CSS tooltip for info icons via data-tip attribute */
	.tooltip {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.tooltip::after {
		content: attr(data-tip);
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-raised);
		color: var(--color-body);
		border: 1px solid rgba(240,235,227,0.06);
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 11px;
		font-weight: 400;
		line-height: 1.5;
		white-space: normal;
		width: 220px;
		text-transform: none;
		letter-spacing: 0;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.15s;
		z-index: 50;
		box-shadow: 0 4px 12px rgba(0,0,0,0.3);
	}
	.tooltip:hover::after {
		opacity: 1;
	}
</style>
