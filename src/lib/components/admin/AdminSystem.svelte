<script lang="ts">
	// ── State ──────────────────────────────────────────────────────────────────
	let systemData = $state<any>(null);
	let loading = $state(true);
	let cacheClearing = $state<string | null>(null);
	let cacheCleared = $state<string | null>(null);
	let rebuildingStats = $state(false);
	let rebuildResult = $state<any>(null);

	// ── Data loading ──────────────────────────────────────────────────────────
	async function loadData() {
		loading = true;
		try {
			const res = await fetch('/api/admin/system');
			systemData = await res.json();
		} catch (e) {
			console.error('Failed to load system data', e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		loadData();
	});

	// ── Actions ───────────────────────────────────────────────────────────────
	async function clearCache(label: string, body: Record<string, string>) {
		cacheClearing = label;
		cacheCleared = null;
		try {
			await fetch('/api/admin/system/cache/clear', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			cacheCleared = label;
			setTimeout(() => {
				if (cacheCleared === label) cacheCleared = null;
			}, 2000);
		} catch (e) {
			console.error('Failed to clear cache', e);
		} finally {
			cacheClearing = null;
		}
	}

	async function rebuildStats() {
		rebuildingStats = true;
		rebuildResult = null;
		try {
			const res = await fetch('/api/admin/system/stats/rebuild', { method: 'POST' });
			rebuildResult = await res.json();
		} catch (e) {
			console.error('Failed to rebuild stats', e);
		} finally {
			rebuildingStats = false;
		}
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
	}

	function formatTableName(name: string): string {
		return name
			.replace(/_/g, ' ')
			.replace(/\b\w/g, (c) => c.toUpperCase());
	}

	const tableNames: Record<string, string> = {
		users: 'Users',
		media_items: 'Media Items',
		media_events: 'Media Events',
		interaction_events: 'Interaction Events',
		services: 'Services',
		sessions: 'Sessions',
		user_stats_cache: 'Stats Cache',
		activity: 'Activity'
	};
</script>

{#if loading}
	<!-- Loading skeleton -->
	<div class="flex flex-col gap-6">
		{#each Array(4) as _}
			<div class="animate-pulse rounded-2xl p-6" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
				<div class="mb-4 h-4 w-32 rounded bg-white/10"></div>
				<div class="space-y-3">
					<div class="h-10 rounded-lg bg-white/5"></div>
					<div class="h-10 rounded-lg bg-white/5"></div>
				</div>
			</div>
		{/each}
	</div>
{:else if systemData}
	<div class="flex flex-col gap-8">

		<!-- ── 1. Cache Management ──────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Cache Management</h2>
			<div class="rounded-2xl p-5" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
				<div class="flex flex-wrap gap-3">
					<!-- Clear All -->
					<button
						class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50"
						style="background: rgba(248,113,113,0.1); color: #f87171; border: 1px solid rgba(248,113,113,0.2)"
						disabled={cacheClearing !== null}
						onclick={() => clearCache('all', {})}
					>
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
							<path d="M2.5 3.5h9M5.5 3.5V2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4 3.5l.5 8a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1l.5-8" />
						</svg>
						{#if cacheCleared === 'all'}
							Cleared!
						{:else if cacheClearing === 'all'}
							Clearing...
						{:else}
							Clear All Cache
						{/if}
					</button>

					<!-- Clear Dashboard -->
					<button
						class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50"
						style="background: rgba(96,165,250,0.1); color: #60a5fa; border: 1px solid rgba(96,165,250,0.2)"
						disabled={cacheClearing !== null}
						onclick={() => clearCache('dashboard', { prefix: 'admin-' })}
					>
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
							<rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" />
							<rect x="8" y="1.5" width="4.5" height="4.5" rx="1" />
							<rect x="1.5" y="8" width="4.5" height="4.5" rx="1" />
							<rect x="8" y="8" width="4.5" height="4.5" rx="1" />
						</svg>
						{#if cacheCleared === 'dashboard'}
							Cleared!
						{:else if cacheClearing === 'dashboard'}
							Clearing...
						{:else}
							Clear Dashboard Cache
						{/if}
					</button>

					<!-- Clear Health -->
					<button
						class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50"
						style="background: rgba(52,211,153,0.1); color: #34d399; border: 1px solid rgba(52,211,153,0.2)"
						disabled={cacheClearing !== null}
						onclick={() => clearCache('health', { prefix: 'health' })}
					>
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
							<path d="M1 7h3l1.5-3 2 6L10 4h3" />
						</svg>
						{#if cacheCleared === 'health'}
							Cleared!
						{:else if cacheClearing === 'health'}
							Clearing...
						{:else}
							Clear Health Cache
						{/if}
					</button>
				</div>
			</div>
		</section>

		<!-- ── 2. Database Stats ────────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Database</h2>
			<div class="rounded-2xl overflow-hidden" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
				<!-- DB info header -->
				<div class="flex items-center justify-between border-b border-white/5 px-5 py-4">
					<div>
						<p class="text-xs text-[var(--color-muted)]">File</p>
						<p class="mt-0.5 text-sm font-mono">{systemData.db?.path ?? 'Unknown'}</p>
					</div>
					<div class="text-right">
						<p class="text-xs text-[var(--color-muted)]">Size</p>
						<p class="mt-0.5 text-sm font-bold tabular-nums">{formatBytes(systemData.db?.sizeBytes ?? 0)}</p>
					</div>
				</div>

				<!-- Row counts table -->
				{#if systemData.db?.rowCounts}
					<div class="divide-y" style="divide-color: rgba(255,255,255,0.04)">
						{#each Object.entries(systemData.db.rowCounts) as [table, count], i (table)}
							<div class="flex items-center justify-between px-5 py-2.5 {i % 2 === 0 ? 'bg-white/[0.01]' : ''}">
								<span class="text-xs text-[var(--color-muted)]">{tableNames[table] ?? formatTableName(table)}</span>
								<span class="text-xs font-bold tabular-nums">{typeof count === 'number' ? count.toLocaleString() : count}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</section>

		<!-- ── 3. Stats Rebuild ─────────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Stats Engine</h2>
			<div class="rounded-2xl p-5" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
				<p class="mb-4 text-xs text-[var(--color-muted)]">Rebuild pre-computed statistics for all users. This may take a while for large databases.</p>
				<button
					class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50"
					style="background: rgba(124,108,248,0.12); color: var(--color-accent); border: 1px solid rgba(124,108,248,0.25)"
					disabled={rebuildingStats}
					onclick={rebuildStats}
				>
					{#if rebuildingStats}
						<svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" opacity="0.3" /><path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
						Rebuilding...
					{:else}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
							<path d="M11.5 2.5A5.5 5.5 0 1 0 12.5 7.5" />
							<path d="M11.5 2.5V5.5H8.5" />
						</svg>
						Rebuild All Stats
					{/if}
				</button>

				{#if rebuildResult}
					<div class="mt-4 flex items-center gap-2 rounded-xl p-3" style="background: rgba(52,211,153,0.06); border: 1px solid rgba(52,211,153,0.15)">
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#34d399" stroke-width="1.3" stroke-linecap="round"><circle cx="7" cy="7" r="5.5" /><path d="M5 7l1.5 1.5L9 5.5" /></svg>
						<span class="text-xs text-[#34d399]">
							Rebuilt {rebuildResult.rebuilt ?? rebuildResult.count ?? '?'}/{rebuildResult.total ?? '?'} users
						</span>
					</div>
				{/if}

				{#if !rebuildingStats && !rebuildResult}
					<div class="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
						<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="5" cy="5" r="4" /><path d="M5 3v2.5M5 7v.5" stroke-linecap="round" /></svg>
						Large databases may take several minutes
					</div>
				{/if}
			</div>
		</section>

		<!-- ── 4. WebSocket Status ──────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">WebSocket Status</h2>
			<div class="rounded-2xl p-5" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
				<div class="flex items-center gap-4">
					<div class="flex items-center gap-3">
						<div class="text-3xl font-bold tabular-nums" style="color: #34d399">{systemData.ws?.connectedUsers ?? 0}</div>
						<div>
							<p class="text-xs font-medium">Connected Users</p>
							<div class="flex items-center gap-1.5">
								{#if (systemData.ws?.connectedUsers ?? 0) > 0}
									<div class="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34d399]"></div>
								{/if}
								<p class="text-[10px] text-[var(--color-muted)]">Live connections</p>
							</div>
						</div>
					</div>
				</div>

				{#if systemData.ws?.onlineUserIds?.length > 0}
					<div class="mt-4 flex flex-wrap gap-2">
						{#each systemData.ws.onlineUserIds as userId (userId)}
							<span class="rounded-lg px-2.5 py-1 text-[10px] font-mono tabular-nums" style="background: rgba(52,211,153,0.08); color: #34d399; border: 1px solid rgba(52,211,153,0.15)">
								{userId}
							</span>
						{/each}
					</div>
				{:else}
					<div class="mt-4 rounded-xl py-4 text-center" style="background: rgba(255,255,255,0.02)">
						<p class="text-xs text-[var(--color-muted)]">No users connected</p>
					</div>
				{/if}
			</div>
		</section>

		<!-- ── 5. App Settings ──────────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">App Settings</h2>
			<div class="rounded-2xl overflow-hidden" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
				{#if systemData.appSettings && Object.keys(systemData.appSettings).length > 0}
					<div class="divide-y" style="divide-color: rgba(255,255,255,0.04)">
						{#each Object.entries(systemData.appSettings) as [key, value], i (key)}
							<div class="flex items-center justify-between px-5 py-3 {i % 2 === 0 ? 'bg-white/[0.01]' : ''}">
								<span class="text-xs font-mono text-[var(--color-muted)]">{key}</span>
								<span class="text-xs font-medium tabular-nums">{value}</span>
							</div>
						{/each}
					</div>
				{:else}
					<div class="py-8 text-center">
						<p class="text-sm text-[var(--color-muted)]">No settings configured</p>
					</div>
				{/if}
			</div>
		</section>
	</div>
{/if}
