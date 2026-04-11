<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';

	let { data }: { data: any } = $props();

	// ── service type colors & abbreviations (from adapter metadata) ─────
	const adapterMetaMap = $derived(
		Object.fromEntries((data.available ?? []).map((a: any) => [a.id, a]))
	);
	function typeColor(type: string): string {
		return adapterMetaMap[type]?.color ?? '#64748b';
	}
	function typeAbbreviation(type: string): string {
		return adapterMetaMap[type]?.abbreviation ?? type.substring(0, 2).toUpperCase();
	}

	// ── CRUD state ───────────────────────────────────────────────────────
	let showAddForm = $state(false);
	let editingId: string | null = $state(null);
	let deleteConfirmId: string | null = $state(null);
	let saving = $state(false);
	let deleting = $state(false);

	// ── add form ─────────────────────────────────────────────────────────
	let addType = $state('');
	let addName = $state('');
	let addUrl = $state('');
	let addApiKey = $state('');
	let addUsername = $state('');
	let addPassword = $state('');

	// ── edit form ────────────────────────────────────────────────────────
	let editName = $state('');
	let editUrl = $state('');
	let editApiKey = $state('');
	let editUsername = $state('');
	let editPassword = $state('');
	let editEnabled = $state(true);

	// ── test connection state ────────────────────────────────────────────
	let testResult: { loading: boolean; ok?: boolean; latency?: number; error?: string } | null = $state(null);

	// ── auto-link state ─────────────────────────────────────────────────
	let autoLinkServiceId: string | null = $state(null);
	let autoLinkPreview: any[] | null = $state(null);
	let autoLinkLoading = $state(false);
	let autoLinkResults: any[] | null = $state(null);
	let autoLinkNexusUsers: any[] | null = $state(null);
	let manualMappings = $state<Record<string, string>>({}); // externalId → nexusUserId

	function openAddForm() {
		showAddForm = true;
		addType = data.available?.[0]?.id ?? '';
		const chosen = data.available?.find((a: any) => a.id === addType);
		addName = chosen?.displayName ?? '';
		addUrl = chosen ? `http://localhost:${chosen.defaultPort}` : '';
		addApiKey = '';
		addUsername = '';
		addPassword = '';
		testResult = null;
	}

	function onTypeChange() {
		const chosen = data.available?.find((a: any) => a.id === addType);
		if (chosen) {
			addName = chosen.displayName;
			addUrl = `http://localhost:${chosen.defaultPort}`;
		}
	}

	function generateId(type: string): string {
		const suffix = Math.random().toString(36).substring(2, 8);
		return `${type}-${suffix}`;
	}

	function startEdit(svc: any) {
		editingId = svc.id;
		editName = svc.name;
		editUrl = svc.url;
		editApiKey = svc.apiKey ?? '';
		editUsername = svc.username ?? '';
		editPassword = svc.password ?? '';
		editEnabled = svc.enabled ?? true;
		testResult = null;
	}

	function cancelEdit() {
		editingId = null;
		testResult = null;
	}

	function cancelAdd() {
		showAddForm = false;
		testResult = null;
	}

	async function testConnection(config: any) {
		testResult = { loading: true };
		try {
			const res = await fetch('/api/services/ping', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(config),
				signal: AbortSignal.timeout(10000)
			});
			const json = await res.json();
			testResult = { loading: false, ok: json.online, latency: json.latency, error: json.error };
		} catch {
			testResult = { loading: false, ok: false, error: 'Timeout' };
		}
	}

	async function saveNewService() {
		saving = true;
		try {
			const body = {
				id: generateId(addType),
				name: addName,
				type: addType,
				url: addUrl.replace(/\/+$/, ''),
				apiKey: addApiKey || undefined,
				username: addUsername || undefined,
				password: addPassword || undefined,
				enabled: true
			};
			const res = await fetch('/api/services', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				showAddForm = false;
				await invalidateAll();
				// Auto-trigger user discovery if the service supports it
				const adapterInfo = data.available?.find((a: any) => a.id === addType);
				if (adapterInfo?.supportsGetUsers) {
					previewAutoLink(body.id);
				}
			}
		} finally {
			saving = false;
		}
	}

	async function previewAutoLink(serviceId: string) {
		autoLinkServiceId = serviceId;
		autoLinkLoading = true;
		autoLinkPreview = null;
		autoLinkResults = null;
		manualMappings = {};
		try {
			const [previewRes, usersRes] = await Promise.all([
				fetch(`/api/admin/autolink?serviceId=${encodeURIComponent(serviceId)}`),
				fetch('/api/admin/users')
			]);
			const previewData = await previewRes.json();
			autoLinkPreview = Array.isArray(previewData) ? previewData : [];
			const allUsers = await usersRes.json();
			autoLinkNexusUsers = Array.isArray(allUsers) ? allUsers.filter((u: any) => u.status !== 'pending') : [];
		} catch (e) {
			console.error('Auto-link preview failed', e);
			toast.error('Auto-link preview failed');
		} finally {
			autoLinkLoading = false;
		}
	}

	async function executeAutoLink(serviceId: string) {
		autoLinkLoading = true;
		autoLinkResults = null;
		try {
			// Build mappings: auto-matched + manually assigned
			const mappings: Array<{ externalId: string; nexusUserId: string }> = [];
			for (const user of autoLinkPreview ?? []) {
				if (user.status === 'match' && user.nexusUserId) {
					mappings.push({ externalId: user.externalId, nexusUserId: user.nexusUserId });
				}
			}
			for (const [externalId, nexusUserId] of Object.entries(manualMappings)) {
				if (nexusUserId) {
					mappings.push({ externalId, nexusUserId });
				}
			}
			const res = await fetch('/api/admin/autolink', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ serviceId, mappings })
			});
			const d = await res.json();
			autoLinkResults = d.results ?? d;
			const linked = (autoLinkResults ?? []).filter((r: any) => r.status === 'linked').length;
			if (linked > 0) {
				toast.success(`Linked ${linked} user${linked > 1 ? 's' : ''} successfully`);
				// Re-fetch preview so table shows updated statuses
				const refreshRes = await fetch(`/api/admin/autolink?serviceId=${encodeURIComponent(serviceId)}`);
				if (refreshRes.ok) {
					const refreshData = await refreshRes.json();
					autoLinkPreview = Array.isArray(refreshData) ? refreshData : [];
					manualMappings = {};
				}
			}
		} catch (e) {
			console.error('Auto-link execute failed', e);
			toast.error('Auto-link failed');
		} finally {
			autoLinkLoading = false;
		}
	}

	function dismissAutoLink() {
		autoLinkServiceId = null;
		autoLinkPreview = null;
		autoLinkResults = null;
		autoLinkNexusUsers = null;
		manualMappings = {};
	}

	async function saveEditedService(svc: any) {
		saving = true;
		try {
			const body = {
				id: svc.id,
				name: editName,
				type: svc.type,
				url: editUrl.replace(/\/+$/, ''),
				apiKey: editApiKey || undefined,
				username: editUsername || undefined,
				password: editPassword || undefined,
				enabled: editEnabled
			};
			const res = await fetch('/api/services', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				editingId = null;
				await invalidateAll();
			}
		} finally {
			saving = false;
		}
	}

	async function deleteService(id: string) {
		deleting = true;
		try {
			const res = await fetch(`/api/services?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
			if (res.ok) {
				deleteConfirmId = null;
				await invalidateAll();
			}
		} finally {
			deleting = false;
		}
	}

	async function toggleEnabled(svc: any) {
		const body = { ...svc, enabled: !svc.enabled };
		await fetch('/api/services', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		await invalidateAll();
	}

	function getHealthForService(serviceId: string) {
		return data.health?.find((h: any) => h.serviceId === serviceId);
	}

	// ── ping state (for health section) ──────────────────────────────────

	let pingResults: Record<string, { loading: boolean; ok?: boolean; latency?: number; error?: string }> = $state({});

	async function testService(serviceId: string) {
		pingResults[serviceId] = { loading: true };
		try {
			const res = await fetch(`/api/services/ping?id=${serviceId}`, { signal: AbortSignal.timeout(10000) });
			const json = await res.json();
			pingResults[serviceId] = { loading: false, ok: json.online, latency: json.latency, error: json.error };
		} catch {
			pingResults[serviceId] = { loading: false, ok: false, error: 'Timeout' };
		}
	}

	// ── helpers ───────────────────────────────────────────────────────────

	function queueStatusColor(status: string | undefined) {
		switch (status) {
			case 'downloading': return 'var(--color-accent)';
			case 'available': return '#34d399';
			case 'missing': return '#f87171';
			case 'requested': return '#f59e0b';
			default: return '#64748b';
		}
	}

	const statusColor: Record<string, string> = {
		pending: '#f59e0b',
		approved: '#60a5fa',
		available: '#34d399',
		declined: '#f87171'
	};

	function timeAgo(ts: number | string) {
		if (!ts) return '';
		const diff = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime());
		const m = Math.floor(diff / 60_000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
	}

	function formatUptime(secs: number): string {
		if (secs < 60) return `${secs}s`;
		const m = Math.floor(secs / 60);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ${m % 60}m`;
		return `${Math.floor(h / 24)}d ${h % 24}h`;
	}

	// ── derived ───────────────────────────────────────────────────────────

	const proxy = $derived(data.proxyStats);
	const proxyHitRate = $derived(
		proxy && (proxy.cacheHits + proxy.cacheMisses) > 0
			? Math.round((proxy.cacheHits / (proxy.cacheHits + proxy.cacheMisses)) * 100)
			: 0
	);
</script>

<!-- ── Configured Services (CRUD) ─────────────────────────────────────── -->
<section class="mb-8">
	<div class="mb-4 flex items-center justify-between">
		<h2 class="text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
			Configured Services
			{#if data.services?.length > 0}
				<span class="ml-1 normal-case font-normal text-[var(--color-muted)]">&middot; {data.services.length}</span>
			{/if}
		</h2>
		{#if !showAddForm}
			<button
				onclick={openAddForm}
				class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-cream)] transition-colors"
				style="background: var(--color-accent); border: 1px solid rgba(255,255,255,0.1)"
			>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<path d="M6 2v8M2 6h8" />
				</svg>
				Add Service
			</button>
		{/if}
	</div>

	<!-- Add Service Form -->
	{#if showAddForm}
		<div class="mb-4 rounded-2xl p-5" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1)">
			<div class="mb-4 flex items-center justify-between">
				<h3 class="text-sm font-semibold">Add New Service</h3>
				<button onclick={cancelAdd} class="text-xs text-[var(--color-muted)] hover:text-[var(--color-cream)]">Cancel</button>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<!-- Type -->
				<label class="flex flex-col gap-1">
					<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Type</span>
					<select
						bind:value={addType}
						onchange={onTypeChange}
						class="rounded-lg px-3 py-2 text-sm"
						style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)"
					>
						{#each data.available ?? [] as adapter (adapter.id)}
							<option value={adapter.id}>{adapter.displayName}</option>
						{/each}
					</select>
				</label>

				<!-- Name -->
				<label class="flex flex-col gap-1">
					<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Name</span>
					<input
						type="text"
						bind:value={addName}
						placeholder="Service name"
						class="rounded-lg px-3 py-2 text-sm"
						style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)"
					/>
				</label>

				<!-- URL -->
				<label class="flex flex-col gap-1 sm:col-span-2">
					<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">URL</span>
					<input
						type="text"
						bind:value={addUrl}
						placeholder="http://localhost:8096"
						class="rounded-lg px-3 py-2 text-sm font-mono"
						style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)"
					/>
				</label>

				<!-- API Key -->
				<label class="flex flex-col gap-1">
					<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">API Key <span class="normal-case opacity-50">(optional)</span></span>
					<input
						type="password"
						bind:value={addApiKey}
						placeholder="API key"
						class="rounded-lg px-3 py-2 text-sm font-mono"
						style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)"
					/>
					{#if addType === 'jellyfin' || addType === 'plex'}
						<span class="text-[10px] text-[var(--color-muted)] opacity-70">Not needed if you enter your admin username and password below. Nexus will authenticate automatically.</span>
					{/if}
				</label>

				<!-- Username -->
				<label class="flex flex-col gap-1">
					<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">
						{addType === 'jellyfin' || addType === 'plex' ? 'Admin Username' : 'Username'}
						{#if addType !== 'jellyfin' && addType !== 'plex'}
							<span class="normal-case opacity-50">(optional)</span>
						{/if}
					</span>
					<input
						type="text"
						bind:value={addUsername}
						placeholder={addType === 'jellyfin' || addType === 'plex' ? 'Your admin username' : 'Username'}
						class="rounded-lg px-3 py-2 text-sm"
						style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)"
					/>
					{#if addType === 'jellyfin' || addType === 'plex'}
						<span class="text-[10px] text-[var(--color-muted)] opacity-70">Your {addType === 'jellyfin' ? 'Jellyfin' : 'Plex'} admin login. No API key needed.</span>
					{/if}
				</label>

				<!-- Password -->
				<label class="flex flex-col gap-1">
					<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Password <span class="normal-case opacity-50">(optional)</span></span>
					<input
						type="password"
						bind:value={addPassword}
						placeholder="Password"
						class="rounded-lg px-3 py-2 text-sm"
						style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)"
					/>
				</label>
			</div>

			<!-- Test result -->
			{#if testResult}
				<div class="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style="background: {testResult.ok ? 'rgba(52,211,153,0.08)' : testResult.loading ? 'rgba(255,255,255,0.04)' : 'rgba(248,113,113,0.08)'}; border: 1px solid {testResult.ok ? 'rgba(52,211,153,0.15)' : testResult.loading ? 'rgba(255,255,255,0.06)' : 'rgba(248,113,113,0.15)'}">
					{#if testResult.loading}
						<span class="text-[var(--color-muted)]">Testing connection...</span>
					{:else if testResult.ok}
						<span style="color: #34d399">Connected successfully{testResult.latency != null ? ` (${testResult.latency}ms)` : ''}</span>
					{:else}
						<span style="color: #f87171">{testResult.error ?? 'Connection failed'}</span>
					{/if}
				</div>
			{/if}

			<!-- Actions -->
			<div class="mt-4 flex items-center gap-2">
				<button
					onclick={() => testConnection({ id: 'test', name: addName, type: addType, url: addUrl, apiKey: addApiKey || undefined, username: addUsername || undefined, password: addPassword || undefined, enabled: true })}
					disabled={testResult?.loading || !addUrl}
					class="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)] disabled:opacity-40"
					style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08)"
				>
					Test Connection
				</button>
				<button
					onclick={saveNewService}
					disabled={saving || !addName || !addUrl || !addType}
					class="rounded-lg px-4 py-1.5 text-xs font-medium text-[var(--color-cream)] transition-colors disabled:opacity-40"
					style="background: var(--color-accent)"
				>
					{saving ? 'Saving...' : 'Save Service'}
				</button>
			</div>
		</div>
	{/if}

	<!-- Service List -->
	{#if !data.services || data.services.length === 0}
		<div class="rounded-2xl py-12 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
			<svg class="mx-auto mb-3 opacity-20" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
				<rect x="2" y="3" width="20" height="18" rx="3" />
				<path d="M7 8h2M7 12h2M7 16h2" stroke-linecap="round" />
			</svg>
			<p class="text-sm text-[var(--color-muted)]">No services configured yet</p>
			{#if !showAddForm}
				<button onclick={openAddForm} class="mt-3 text-xs text-[var(--color-accent)] hover:underline">Add your first service</button>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.services as svc (svc.id)}
				{@const health = getHealthForService(svc.id)}
				{@const isOnline = health?.online ?? false}
				{@const color = typeColor(svc.type)}
				{@const abbrev = typeAbbreviation(svc.type)}

				{#if editingId === svc.id}
					<!-- Edit form -->
					<div class="flex flex-col gap-3 rounded-2xl p-4 sm:col-span-2 lg:col-span-3" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12)">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<div class="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold"
									style="background: {color}22; color: {color}; border: 1px solid {color}33">
									{abbrev}
								</div>
								<span class="text-sm font-medium">Edit {svc.type}</span>
							</div>
							<button onclick={cancelEdit} class="text-xs text-[var(--color-muted)] hover:text-[var(--color-cream)]">Cancel</button>
						</div>

						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label class="flex flex-col gap-1">
								<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Name</span>
								<input type="text" bind:value={editName} class="rounded-lg px-3 py-2 text-sm" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)" />
							</label>
							<label class="flex flex-col gap-1">
								<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">URL</span>
								<input type="text" bind:value={editUrl} class="rounded-lg px-3 py-2 text-sm font-mono" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)" />
							</label>
							<label class="flex flex-col gap-1">
								<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">API Key</span>
								<input type="password" bind:value={editApiKey} placeholder="(unchanged)" class="rounded-lg px-3 py-2 text-sm font-mono" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)" />
							</label>
							<label class="flex flex-col gap-1">
								<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Username</span>
								<input type="text" bind:value={editUsername} placeholder="(optional)" class="rounded-lg px-3 py-2 text-sm" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)" />
							</label>
							<label class="flex flex-col gap-1">
								<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Password</span>
								<input type="password" bind:value={editPassword} placeholder="(optional)" class="rounded-lg px-3 py-2 text-sm" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream)" />
							</label>
							<label class="flex items-center gap-2 self-end py-2">
								<button
									onclick={() => editEnabled = !editEnabled}
									class="relative h-5 w-9 rounded-full transition-colors"
									style="background: {editEnabled ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)'}"
									aria-label={editEnabled ? 'Disable service' : 'Enable service'}
								>
									<span class="absolute top-0.5 h-4 w-4 rounded-full bg-cream transition-all" style="left: {editEnabled ? '18px' : '2px'}"></span>
								</button>
								<span class="text-xs text-[var(--color-muted)]">{editEnabled ? 'Enabled' : 'Disabled'}</span>
							</label>
						</div>

						{#if testResult}
							<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style="background: {testResult.ok ? 'rgba(52,211,153,0.08)' : testResult.loading ? 'rgba(255,255,255,0.04)' : 'rgba(248,113,113,0.08)'}; border: 1px solid {testResult.ok ? 'rgba(52,211,153,0.15)' : testResult.loading ? 'rgba(255,255,255,0.06)' : 'rgba(248,113,113,0.15)'}">
								{#if testResult.loading}
									<span class="text-[var(--color-muted)]">Testing connection...</span>
								{:else if testResult.ok}
									<span style="color: #34d399">Connected{testResult.latency != null ? ` (${testResult.latency}ms)` : ''}</span>
								{:else}
									<span style="color: #f87171">{testResult.error ?? 'Failed'}</span>
								{/if}
							</div>
						{/if}

						<div class="flex items-center gap-2">
							<button
								onclick={() => testConnection({ id: svc.id, name: editName, type: svc.type, url: editUrl, apiKey: editApiKey || undefined, username: editUsername || undefined, password: editPassword || undefined, enabled: editEnabled })}
								disabled={testResult?.loading || !editUrl}
								class="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)] disabled:opacity-40"
								style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08)"
							>
								Test Connection
							</button>
							<button
								onclick={() => saveEditedService(svc)}
								disabled={saving || !editName || !editUrl}
								class="rounded-lg px-4 py-1.5 text-xs font-medium text-[var(--color-cream)] transition-colors disabled:opacity-40"
								style="background: var(--color-accent)"
							>
								{saving ? 'Saving...' : 'Save Changes'}
							</button>
						</div>
					</div>
				{:else}
					<!-- Service card -->
					<div class="flex flex-col gap-3 rounded-2xl p-4 transition-colors" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); {!svc.enabled ? 'opacity: 0.5' : ''}">
						<div class="flex items-start gap-3">
							<!-- Type badge -->
							<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
								style="background: {color}18; color: {color}; border: 1px solid {color}33">
								{abbrev}
							</div>

							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<p class="truncate text-sm font-medium">{svc.name}</p>
									<!-- Health dot -->
									{#if health}
										<div class="h-2 w-2 flex-shrink-0 rounded-full"
											style="background: {isOnline ? '#34d399' : '#f87171'}; box-shadow: 0 0 6px {isOnline ? '#34d39988' : '#f8717188'}">
										</div>
									{/if}
								</div>
								<p class="text-[10px] capitalize text-[var(--color-muted)]">{svc.type}</p>
								<p class="mt-0.5 truncate text-[10px] font-mono text-[var(--color-muted)] opacity-60">{svc.url}</p>
							</div>
						</div>

						<div class="flex items-center justify-between">
							<!-- Enable toggle -->
							<button
								onclick={() => toggleEnabled(svc)}
								class="relative h-5 w-9 rounded-full transition-colors"
								style="background: {svc.enabled ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)'}"
								title={svc.enabled ? 'Disable service' : 'Enable service'}
							>
								<span class="absolute top-0.5 h-4 w-4 rounded-full bg-cream transition-all" style="left: {svc.enabled ? '18px' : '2px'}"></span>
							</button>

							<div class="flex items-center gap-1">
								{#if data.available?.find((a: any) => a.id === svc.type)?.supportsGetUsers}
									<button
										onclick={() => previewAutoLink(svc.id)}
										class="rounded-lg px-2.5 py-1 text-[10px] font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]"
										style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08)"
									>
										Sync Users
									</button>
								{/if}
								<button
									onclick={() => startEdit(svc)}
									class="rounded-lg px-2.5 py-1 text-[10px] font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]"
									style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08)"
								>
									Edit
								</button>

								{#if deleteConfirmId === svc.id}
									<button
										onclick={() => deleteService(svc.id)}
										disabled={deleting}
										class="rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors"
										style="background: rgba(248,113,113,0.12); border: 1px solid rgba(248,113,113,0.25); color: #f87171"
									>
										{deleting ? '...' : 'Confirm'}
									</button>
									<button
										onclick={() => deleteConfirmId = null}
										class="rounded-lg px-2.5 py-1 text-[10px] font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]"
										style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08)"
									>
										No
									</button>
								{:else}
									<button
										onclick={() => deleteConfirmId = svc.id}
										class="rounded-lg px-2.5 py-1 text-[10px] font-medium text-[var(--color-muted)] transition-colors hover:text-[#f87171]"
										style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08)"
									>
										Delete
									</button>
								{/if}
							</div>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</section>

<!-- ── Auto-Link Panel ──────────────────────────────────────────────── -->
{#if autoLinkServiceId}
	{@const svcName = data.services?.find((s: any) => s.id === autoLinkServiceId)?.name ?? 'Service'}
	<section class="mb-8">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
				User Discovery — {svcName}
			</h2>
			<button onclick={dismissAutoLink} class="text-xs text-[var(--color-muted)] hover:text-[var(--color-cream)]">Dismiss</button>
		</div>

		<div class="rounded-2xl p-5" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
			{#if autoLinkLoading && !autoLinkPreview}
				<p class="text-sm text-[var(--color-muted)]">Discovering users...</p>
			{:else if autoLinkPreview}
				{#if autoLinkPreview.length === 0}
					<p class="text-sm text-[var(--color-muted)]">No users found on this service.</p>
				{:else}
					<p class="mb-3 text-xs text-[var(--color-muted)]">Found {autoLinkPreview.length} users. Matching accounts will be auto-linked to Nexus users.</p>

					<div class="mb-4 flex flex-col divide-y overflow-hidden rounded-xl" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); divide-color: rgba(255,255,255,0.04)">
						{#each autoLinkPreview as user (user.externalId)}
							<div class="flex items-center gap-3 px-3 py-2">
								<div class="h-2 w-2 flex-shrink-0 rounded-full"
									style="background: {user.status === 'already-linked' ? '#34d399' : user.status === 'match' ? '#60a5fa' : manualMappings[user.externalId] ? '#f59e0b' : '#64748b'}">
								</div>
								<span class="text-xs font-medium">{user.externalUsername}</span>
								{#if user.isAdmin}
									<span class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style="background: rgba(124,108,248,0.12); color: var(--color-accent)">Admin</span>
								{/if}
								<div class="ml-auto flex items-center gap-2">
									{#if user.status === 'already-linked'}
										<span class="text-[10px] text-[#34d399]">Linked to @{user.nexusUsername}</span>
									{:else if user.status === 'match'}
										<span class="text-[10px] text-[#60a5fa]">→ @{user.nexusUsername}</span>
									{:else}
										<!-- Admin picker for unmatched users -->
										<select
											class="rounded-lg px-2 py-1 text-[10px]"
											style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: var(--color-cream); max-width: 160px"
											value={manualMappings[user.externalId] ?? ''}
											onchange={(e) => {
												const val = (e.target as HTMLSelectElement).value;
												manualMappings = { ...manualMappings, [user.externalId]: val };
											}}
										>
											<option value="">— skip —</option>
											{#each autoLinkNexusUsers ?? [] as nu (nu.id)}
												<option value={nu.id}>@{nu.username}</option>
											{/each}
										</select>
									{/if}
								</div>
							</div>
						{/each}
					</div>

					{@const matchCount = autoLinkPreview.filter((u: any) => u.status === 'match').length}
					{@const manualCount = Object.values(manualMappings).filter(Boolean).length}
					{@const totalToLink = matchCount + manualCount}
					{#if totalToLink > 0}
						<button
							onclick={() => executeAutoLink(autoLinkServiceId!)}
							disabled={autoLinkLoading}
							class="rounded-lg px-4 py-1.5 text-xs font-medium text-[var(--color-cream)] transition-colors disabled:opacity-40"
							style="background: var(--color-accent)"
						>
							{autoLinkLoading ? 'Linking...' : `Link ${totalToLink} Users`}
						</button>
					{:else}
						<p class="text-xs text-[var(--color-muted)]">All users are already linked. Use the dropdowns above to manually assign unmatched accounts.</p>
					{/if}
				{/if}
			{/if}

			{#if autoLinkResults}
				<div class="mt-4 rounded-xl p-3" style="background: rgba(52,211,153,0.06); border: 1px solid rgba(52,211,153,0.15)">
					<p class="mb-2 text-xs font-medium text-[#34d399]">Auto-Link Complete</p>
					<div class="flex flex-col gap-1">
						{#each autoLinkResults as r (r.externalId)}
							<div class="flex items-center gap-2 text-[10px]">
								{#if r.status === 'linked'}
									<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#34d399" stroke-width="1.5"><circle cx="5" cy="5" r="4" /><path d="M3.5 5l1 1L6.5 4" stroke-linecap="round" /></svg>
								{:else if r.status === 'already-linked'}
									<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#60a5fa" stroke-width="1.5"><circle cx="5" cy="5" r="4" /><path d="M3.5 5l1 1L6.5 4" stroke-linecap="round" /></svg>
								{:else}
									<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#f59e0b" stroke-width="1.5"><circle cx="5" cy="5" r="4" /><path d="M5 3v2.5M5 7v.5" stroke-linecap="round" /></svg>
								{/if}
								<span>{r.externalUsername}</span>
								<span class="text-[var(--color-muted)]">{r.status}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</section>
{/if}

<!-- ── Service Health ─────────────────────────────────────────────────── -->
<section class="mb-8">
	<h2 class="mb-4 text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Service Health</h2>

	{#if !data.health || data.health.length === 0}
		<div class="rounded-2xl py-12 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
			<svg class="mx-auto mb-3 opacity-20" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
				<circle cx="12" cy="12" r="10" />
				<path d="M12 6v6l4 2" stroke-linecap="round" />
			</svg>
			<p class="text-sm text-[var(--color-muted)]">No services configured</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.health as svc (svc.serviceId)}
				{@const ping = pingResults[svc.serviceId]}
				{@const isOnline = ping ? ping.ok : svc.online}
				<div class="flex flex-col gap-3 rounded-2xl p-4" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
					<div class="flex items-start gap-3">
						<!-- Status dot -->
						<div class="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full"
							style="background: {isOnline ? '#34d399' : '#f87171'}; {isOnline ? 'box-shadow: 0 0 8px #34d39988' : 'box-shadow: 0 0 8px #f8717188'}">
						</div>

						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{svc.name}</p>
							<p class="text-[10px] capitalize text-[var(--color-muted)]">{svc.type}</p>
							{#if svc.url}
								<p class="mt-1 truncate text-[10px] font-mono text-[var(--color-muted)] opacity-60">{svc.url}</p>
							{/if}
						</div>
					</div>

					<div class="flex items-center justify-between">
						<!-- Latency or error -->
						{#if ping?.loading}
							<span class="text-[10px] text-[var(--color-muted)]">Testing...</span>
						{:else if ping}
							{#if ping.ok && ping.latency != null}
								<span class="text-[10px] tabular-nums text-[#34d399]">{ping.latency}ms</span>
							{:else if !ping.ok}
								<span class="max-w-[140px] truncate text-[10px] text-[#f87171]">{ping.error ?? 'Offline'}</span>
							{/if}
						{:else if isOnline && svc.latency != null}
							<span class="text-[10px] tabular-nums text-[var(--color-muted)]">{svc.latency}ms</span>
						{:else if !isOnline && svc.error}
							<span class="max-w-[140px] truncate text-[10px] text-[#f87171]">{svc.error}</span>
						{:else}
							<span></span>
						{/if}

						<button
							onclick={() => testService(svc.serviceId)}
							disabled={ping?.loading}
							class="rounded-lg px-2.5 py-1 text-[10px] font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)] disabled:opacity-40"
							style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08)"
						>
							{ping?.loading ? 'Testing...' : 'Test'}
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>

<!-- ── Download Queue (full) ──────────────────────────────────────────── -->
<section class="mb-8">
	<div class="mb-4 flex items-center justify-between">
		<h2 class="text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
			Download Queue
			{#if (data.queue ?? []).length > 0}
				<span class="ml-1 normal-case font-normal text-[var(--color-muted)]">&middot; {(data.queue ?? []).length}</span>
			{/if}
		</h2>
		<a href="/admin" class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06)">
			<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
				<path d="M10.5 2A5 5 0 1 0 11 6.5" />
				<path d="M10.5 2V5H7.5" />
			</svg>
			Refresh
		</a>
	</div>

	{#if (data.queue ?? []).length === 0}
		<div class="rounded-2xl py-8 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
			<p class="text-sm text-[var(--color-muted)]">Nothing downloading</p>
		</div>
	{:else}
		<div class="flex flex-col divide-y" style="border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; overflow: hidden; divide-color: rgba(255,255,255,0.06)">
			{#each data.queue ?? [] as item (item.id)}
				<div class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-cream/[0.02]">
					{#if item.poster}
						<img src={item.poster} alt={item.title} class="h-10 w-7 flex-shrink-0 rounded object-cover" style="background: rgba(255,255,255,0.05)" />
					{:else}
						<div class="flex h-10 w-7 flex-shrink-0 items-center justify-center rounded" style="background: rgba(255,255,255,0.05)">
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" class="opacity-30">
								<path d="M6 2v8M3 7l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</div>
					{/if}

					<div class="min-w-0 flex-1">
						<p class="truncate text-xs font-medium">{item.title}</p>
						<div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
							<span>{item.serviceType}</span>
						</div>
					</div>

					<span class="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
						style="background: {queueStatusColor(item.status)}18; color: {queueStatusColor(item.status)}; border: 1px solid {queueStatusColor(item.status)}33">
						{item.status ?? 'unknown'}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</section>

<!-- ── Request Queue (full) ───────────────────────────────────────────── -->
<section class="mb-8">
	<div class="mb-4 flex items-center justify-between">
		<h2 class="text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Request Queue</h2>
		<a href="/requests" class="text-xs text-[var(--color-accent)] hover:underline">View all &rarr;</a>
	</div>

	{#if (data.requests ?? []).length === 0}
		<div class="rounded-2xl py-8 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
			<p class="text-sm text-[var(--color-muted)]">No recent requests</p>
		</div>
	{:else}
		<div class="flex flex-col divide-y" style="border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; overflow: hidden; divide-color: rgba(255,255,255,0.06)">
			{#each data.requests ?? [] as req (req.id)}
				<div class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-cream/[0.02]">
					{#if req.poster}
						<img src={req.poster} alt={req.title} class="h-10 w-7 flex-shrink-0 rounded object-cover" style="background: rgba(255,255,255,0.05)" />
					{:else}
						<div class="flex h-10 w-7 flex-shrink-0 items-center justify-center rounded" style="background: rgba(255,255,255,0.05)">
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" class="opacity-30">
								<rect x="1" y="1" width="10" height="10" rx="1.5" />
							</svg>
						</div>
					{/if}

					<div class="min-w-0 flex-1">
						<p class="truncate text-xs font-medium">{req.title}</p>
						<div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
							<span>{req.requestedByName}</span>
							<span>&middot;</span>
							<span>{timeAgo(req.requestedAt)}</span>
						</div>
					</div>

					<span class="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
						style="background: {statusColor[req.status] ?? '#ffffff'}18; color: {statusColor[req.status] ?? '#ffffff99'}; border: 1px solid {statusColor[req.status] ?? '#ffffff'}33">
						{req.status}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</section>

<!-- ── Stream Proxy Stats ─────────────────────────────────────────────── -->
{#if proxy}
	<section class="mb-8">
		<div class="mb-4 flex items-center gap-2">
			<h2 class="text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Stream Proxy</h2>
			<div class="h-2 w-2 rounded-full bg-[#34d399]" style="box-shadow: 0 0 6px #34d39988"></div>
			<span class="text-[10px] text-[var(--color-muted)]">up {formatUptime(proxy.uptime)}</span>
		</div>

		<!-- Proxy stat cards -->
		<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div class="rounded-xl p-3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
				<div class="text-lg font-bold tabular-nums">{proxy.totalRequests.toLocaleString()}</div>
				<div class="text-[10px] text-[var(--color-muted)]">Total Requests</div>
			</div>
			<div class="rounded-xl p-3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
				<div class="text-lg font-bold tabular-nums" style="color: #60a5fa">{proxy.activeConnections}</div>
				<div class="text-[10px] text-[var(--color-muted)]">Active Connections</div>
			</div>
			<div class="rounded-xl p-3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
				<div class="text-lg font-bold tabular-nums">{formatBytes(proxy.bytesServed)}</div>
				<div class="text-[10px] text-[var(--color-muted)]">Bytes Served</div>
			</div>
			<div class="rounded-xl p-3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
				<div class="text-lg font-bold tabular-nums" style="color: {proxyHitRate > 50 ? '#34d399' : '#f59e0b'}">{proxyHitRate}%</div>
				<div class="text-[10px] text-[var(--color-muted)]">Cache Hit Rate</div>
			</div>
		</div>

		<div class="grid gap-4 lg:grid-cols-2">
			<!-- Per-video breakdown -->
			{#if proxy.videos && proxy.videos.length > 0}
				<div class="rounded-2xl" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); overflow: hidden">
					<div class="px-4 py-3" style="border-bottom: 1px solid rgba(255,255,255,0.06)">
						<h3 class="text-xs font-semibold text-[var(--color-muted)]">Videos Served</h3>
					</div>
					<div class="flex flex-col divide-y" style="divide-color: rgba(255,255,255,0.04)">
						{#each proxy.videos.slice(0, 8) as v (v.videoId)}
							<div class="flex items-center gap-3 px-4 py-2.5">
								<div class="min-w-0 flex-1">
									<p class="truncate text-xs font-mono">{v.videoId}</p>
									<div class="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
										<span>{v.requests} req</span>
										<span>&middot;</span>
										<span>{formatBytes(v.bytes)}</span>
									</div>
								</div>
								<div class="flex flex-wrap justify-end gap-1">
									{#each Object.entries(v.itags || {}) as [itag, count]}
										<span class="rounded px-1.5 py-0.5 text-[9px] font-mono tabular-nums" style="background: rgba(124,108,248,0.12); color: var(--color-accent)">
											{itag}x{count}
										</span>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Recent requests -->
			{#if proxy.recent && proxy.recent.length > 0}
				<div class="rounded-2xl" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); overflow: hidden">
					<div class="px-4 py-3" style="border-bottom: 1px solid rgba(255,255,255,0.06)">
						<h3 class="text-xs font-semibold text-[var(--color-muted)]">Recent Requests</h3>
					</div>
					<div class="flex flex-col divide-y" style="divide-color: rgba(255,255,255,0.04)">
						{#each proxy.recent.slice(0, 10) as r, i (i)}
							<div class="flex items-center gap-3 px-4 py-2">
								<div class="h-1.5 w-1.5 flex-shrink-0 rounded-full {r.status < 400 ? 'bg-[#34d399]' : 'bg-[#f87171]'}"></div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="truncate text-xs font-mono">{r.videoId}</span>
										<span class="rounded px-1 py-0.5 text-[9px] font-mono" style="background: rgba(255,255,255,0.06)">itag {r.itag}</span>
									</div>
								</div>
								<div class="flex items-center gap-2 text-[10px] tabular-nums text-[var(--color-muted)]">
									{#if r.cached}
										<span style="color: #34d399">HIT</span>
									{:else}
										<span>MISS</span>
									{/if}
									<span>{r.durationMs}ms</span>
									<span>{formatBytes(r.bytes)}</span>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Error count banner -->
		{#if proxy.errors > 0}
			<div class="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style="background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.15); color: #f87171">
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="5"/><path d="M6 3.5v3M6 8v.5" stroke-linecap="round"/></svg>
				{proxy.errors} errors since startup
			</div>
		{/if}
	</section>
{/if}

<!-- ── Prowlarr Indexers ──────────────────────────────────────────────── -->
{#if data.prowlarr}
	<section class="mb-8">
		<h2 class="mb-4 text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Prowlarr Indexers</h2>

		{#if data.prowlarr.stats}
			<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-xl p-3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
					<div class="text-lg font-bold tabular-nums" style="color: #34d399">{data.prowlarr.stats.indexerCount ?? 0}</div>
					<div class="text-[10px] text-[var(--color-muted)]">Total Indexers</div>
				</div>
				<div class="rounded-xl p-3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
					<div class="text-lg font-bold tabular-nums" style="color: #60a5fa">{data.prowlarr.stats.grabCount ?? 0}</div>
					<div class="text-[10px] text-[var(--color-muted)]">Total Grabs</div>
				</div>
				<div class="rounded-xl p-3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
					<div class="text-lg font-bold tabular-nums">{data.prowlarr.stats.queryCount ?? 0}</div>
					<div class="text-[10px] text-[var(--color-muted)]">Total Queries</div>
				</div>
				<div class="rounded-xl p-3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
					<div class="text-lg font-bold tabular-nums" style="color: {(data.prowlarr.stats.failCount ?? 0) > 0 ? '#f87171' : '#34d399'}">{data.prowlarr.stats.failCount ?? 0}</div>
					<div class="text-[10px] text-[var(--color-muted)]">Failures</div>
				</div>
			</div>
		{/if}

		{#if data.prowlarr.indexers && data.prowlarr.indexers.length > 0}
			<div class="flex flex-col divide-y" style="border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; overflow: hidden; divide-color: rgba(255,255,255,0.06)">
				{#each data.prowlarr.indexers as indexer (indexer.id)}
					<div class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-cream/[0.02]">
						<div class="h-2 w-2 flex-shrink-0 rounded-full"
							style="background: {indexer.enable ? '#34d399' : '#f87171'}; {indexer.enable ? 'box-shadow: 0 0 6px #34d39988' : ''}">
						</div>

						<div class="min-w-0 flex-1">
							<p class="truncate text-xs font-medium">{indexer.name}</p>
							<div class="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
								{#if indexer.protocol}
									<span class="capitalize">{indexer.protocol}</span>
								{/if}
								{#if indexer.privacy}
									<span>&middot;</span>
									<span class="capitalize">{indexer.privacy}</span>
								{/if}
							</div>
						</div>

						<span class="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
							style="background: {indexer.enable ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)'}; color: {indexer.enable ? '#34d399' : '#f87171'}; border: 1px solid {indexer.enable ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}">
							{indexer.enable ? 'Enabled' : 'Disabled'}
						</span>
					</div>
				{/each}
			</div>
		{:else}
			<div class="rounded-2xl py-8 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
				<p class="text-sm text-[var(--color-muted)]">No indexers configured</p>
			</div>
		{/if}
	</section>
{/if}
