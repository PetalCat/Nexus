<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	let showAddForm = $state(false);
	let selectedType = $state('');
	let testResult = $state<{ online: boolean; latency?: number; error?: string } | null>(null);
	let saving = $state(false);
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

	const selectedAdapter = $derived(data.available.find((a) => a.type === form.type || a.id === form.type));
	const healthMap = $derived(
		Object.fromEntries(data.health.map((h) => [h.serviceId, h]))
	);

	function selectType(t: string) {
		selectedType = t;
		form.type = t;
		const adapter = data.available.find((a) => a.id === t);
		if (adapter) {
			form.url = `http://localhost:${adapter.defaultPort}`;
		}
	}

	function resetForm() {
		form = { id: '', name: '', type: '', url: '', apiKey: '', username: '', password: '', enabled: true };
		selectedType = '';
		testResult = null;
		showAddForm = false;
	}

	async function testConnection() {
		if (!form.url || !form.type) return;
		testing = true;
		testResult = null;
		try {
			const res = await fetch('/api/services/ping', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form)
			});
			testResult = await res.json();
		} catch (e) {
			testResult = { online: false, error: String(e) };
		} finally {
			testing = false;
		}
	}

	async function saveService() {
		if (!form.id || !form.name || !form.type || !form.url) return;
		saving = true;
		try {
			await fetch('/api/services', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form)
			});
			await invalidateAll();
			resetForm();
		} finally {
			saving = false;
		}
	}

	async function deleteService(id: string) {
		await fetch(`/api/services?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
		await invalidateAll();
		deleteConfirm = null;
	}
</script>

<svelte:head>
	<title>Settings — Nexus</title>
</svelte:head>

<div class="px-6 py-8">
	<div class="mb-8">
		<h1 class="text-display text-2xl font-bold">Settings</h1>
		<p class="mt-1 text-sm text-[var(--color-subtle)]">Connect and manage your media services.</p>
	</div>

	<!-- Connected services -->
	<section class="mb-8">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-display text-base font-semibold">Connected Services</h2>
			<button class="btn btn-primary text-sm" onclick={() => (showAddForm = !showAddForm)}>
				{showAddForm ? 'Cancel' : '+ Add Service'}
			</button>
		</div>

		{#if data.services.length === 0 && !showAddForm}
			<div class="card flex flex-col items-center gap-3 py-12 text-center">
				<div class="text-4xl opacity-20">⚡</div>
				<p class="text-sm text-[var(--color-subtle)]">No services connected yet.</p>
				<button class="btn btn-primary text-sm" onclick={() => (showAddForm = true)}>Add your first service</button>
			</div>
		{/if}

		{#if data.services.length > 0}
			<div class="flex flex-col gap-2">
				{#each data.services as service}
					{@const h = healthMap[service.id]}
					<div class="card-raised flex items-center gap-4 px-4 py-3">
						<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface)] text-lg">
							🔌
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<span class="font-medium text-sm">{service.name}</span>
								<span class="badge text-[10px] bg-[var(--color-surface)] text-[var(--color-muted)]">{service.type}</span>
								{#if h}
									<span class="flex h-2 w-2 rounded-full {h.online ? 'bg-[var(--color-pulsar)]' : 'bg-[var(--color-nova)]'}"></span>
									{#if h.latency}
										<span class="text-mono text-[10px] text-[var(--color-muted)]">{h.latency}ms</span>
									{/if}
								{/if}
							</div>
							<p class="truncate text-xs text-[var(--color-muted)]">{service.url}</p>
						</div>
						<div class="flex items-center gap-1 flex-shrink-0">
							{#if deleteConfirm === service.id}
								<button class="btn btn-ghost text-xs text-[var(--color-nova)]" onclick={() => deleteService(service.id)}>Confirm delete</button>
								<button class="btn btn-ghost text-xs" onclick={() => (deleteConfirm = null)}>Cancel</button>
							{:else}
								<button class="btn-icon p-2 text-[var(--color-nova)]" onclick={() => (deleteConfirm = service.id)} title="Delete">
									<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
										<path d="M2 3.5H12M5 3.5V2.5H9V3.5M5.5 6V10.5M8.5 6V10.5M3 3.5L3.5 11.5H10.5L11 3.5" stroke-linecap="round" stroke-linejoin="round"/>
									</svg>
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Add service form -->
	{#if showAddForm}
		<section class="card p-6">
			<h2 class="text-display mb-5 text-base font-semibold">Add Service</h2>

			<!-- Step 1: Select type -->
			<div class="mb-5">
				<label class="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Service Type</label>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{#each data.available as adapter}
						<button
							onclick={() => selectType(adapter.id)}
							class="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all
								{form.type === adapter.id
								? 'border-[var(--color-nebula)] bg-[var(--color-nebula-dim)]'
								: 'border-[var(--color-border)] hover:border-[var(--color-muted)]'}"
						>
							<span class="text-sm font-medium">{adapter.displayName}</span>
							<span class="text-[10px] text-[var(--color-muted)]">:{adapter.defaultPort}</span>
						</button>
					{/each}
				</div>
			</div>

			{#if form.type}
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Display Name</label>
						<input bind:value={form.name} class="input" placeholder="My Jellyfin" />
					</div>
					<div>
						<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Internal ID</label>
						<input bind:value={form.id} class="input font-mono text-sm" placeholder="jellyfin-home" />
					</div>
					<div class="sm:col-span-2">
						<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">URL</label>
						<input bind:value={form.url} class="input font-mono text-sm" placeholder="http://localhost:8096" />
					</div>
					<div class="sm:col-span-2">
						<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">API Key</label>
						<input bind:value={form.apiKey} class="input font-mono text-sm" type="password" placeholder="••••••••" />
					</div>
				</div>

				<!-- Test result -->
				{#if testResult}
					<div class="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm
						{testResult.online
						? 'border-[var(--color-pulsar)]/30 bg-[var(--color-pulsar-dim)] text-[var(--color-pulsar)]'
						: 'border-[var(--color-nova)]/30 bg-[var(--color-nova)]/10 text-[var(--color-nova)]'}">
						{#if testResult.online}
							✓ Connected {#if testResult.latency}· {testResult.latency}ms{/if}
						{:else}
							✗ Failed: {testResult.error ?? 'Unable to connect'}
						{/if}
					</div>
				{/if}

				<div class="mt-5 flex gap-2">
					<button class="btn btn-ghost text-sm" onclick={testConnection} disabled={testing}>
						{testing ? 'Testing...' : 'Test Connection'}
					</button>
					<button
						class="btn btn-primary text-sm"
						onclick={saveService}
						disabled={saving || !form.id || !form.name || !form.url}
					>
						{saving ? 'Saving...' : 'Save Service'}
					</button>
					<button class="btn btn-ghost text-sm" onclick={resetForm}>Cancel</button>
				</div>
			{/if}
		</section>
	{/if}
</div>
