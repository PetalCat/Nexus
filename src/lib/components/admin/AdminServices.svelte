<script lang="ts">
	let { data }: { data: any } = $props();

	// ── ping state ────────────────────────────────────────────────────────────

	let pingResults: Record<string, { loading: boolean; ok?: boolean; latency?: number; error?: string }> = $state({});

	async function testService(serviceId: string) {
		pingResults[serviceId] = { loading: true };
		try {
			const res = await fetch(`/api/services/ping?id=${serviceId}`, { signal: AbortSignal.timeout(10000) });
			const json = await res.json();
			pingResults[serviceId] = { loading: false, ok: json.online, latency: json.latency, error: json.error };
		} catch (err) {
			pingResults[serviceId] = { loading: false, ok: false, error: 'Timeout' };
		}
	}

	// ── helpers ───────────────────────────────────────────────────────────────

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

	// ── derived ───────────────────────────────────────────────────────────────

	const proxy = $derived(data.proxyStats);
	const proxyHitRate = $derived(
		proxy && (proxy.cacheHits + proxy.cacheMisses) > 0
			? Math.round((proxy.cacheHits / (proxy.cacheHits + proxy.cacheMisses)) * 100)
			: 0
	);
</script>

<!-- ── Service Health ─────────────────────────────────────────────────── -->
<section class="mb-8">
	<h2 class="mb-4 text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Service Health</h2>

	{#if data.health.length === 0}
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
			{#if data.queue.length > 0}
				<span class="ml-1 normal-case font-normal text-[var(--color-muted)]">· {data.queue.length}</span>
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

	{#if data.queue.length === 0}
		<div class="rounded-2xl py-8 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
			<p class="text-sm text-[var(--color-muted)]">Nothing downloading</p>
		</div>
	{:else}
		<div class="flex flex-col divide-y" style="border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; overflow: hidden; divide-color: rgba(255,255,255,0.06)">
			{#each data.queue as item (item.id)}
				<div class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]">
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

	{#if data.requests.length === 0}
		<div class="rounded-2xl py-8 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
			<p class="text-sm text-[var(--color-muted)]">No recent requests</p>
		</div>
	{:else}
		<div class="flex flex-col divide-y" style="border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; overflow: hidden; divide-color: rgba(255,255,255,0.06)">
			{#each data.requests as req (req.id)}
				<div class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]">
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
							<span>·</span>
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
										<span>·</span>
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
					<div class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]">
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
									<span>·</span>
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
