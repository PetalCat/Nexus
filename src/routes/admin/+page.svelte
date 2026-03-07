<script lang="ts">
	import type { PageData } from './$types';
	import type { JellyfinSession } from './+page.server';

	let { data }: { data: PageData } = $props();

	// ── helpers ───────────────────────────────────────────────────────────────

	function ticksToSeconds(ticks?: number) {
		return ticks ? Math.floor(ticks / 10_000_000) : 0;
	}

	function progress(session: JellyfinSession) {
		const pos = ticksToSeconds(session.PlayState?.PositionTicks);
		const dur = ticksToSeconds(session.NowPlayingItem?.RunTimeTicks);
		if (!pos || !dur) return 0;
		return Math.min(1, pos / dur);
	}

	function formatRuntime(ticks?: number) {
		const s = ticksToSeconds(ticks);
		if (!s) return null;
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	function itemTitle(session: JellyfinSession) {
		const item = session.NowPlayingItem;
		if (!item) return '—';
		if (item.Type === 'Episode' && item.SeriesName) {
			const ep =
				item.SeasonNumber != null && item.IndexNumber != null
					? ` S${String(item.SeasonNumber).padStart(2, '0')}E${String(item.IndexNumber).padStart(2, '0')}`
					: '';
			return `${item.SeriesName}${ep}`;
		}
		return item.Name;
	}

	function itemBackdrop(session: JellyfinSession) {
		const item = session.NowPlayingItem;
		if (!item) return null;
		const baseUrl = session._serviceUrl ?? '';
		// Episode: prefer series backdrop
		if (item.Type === 'Episode' && item.ParentBackdropItemId && item.ParentBackdropImageTags?.[0]) {
			return `${baseUrl}/Items/${item.ParentBackdropItemId}/Images/Backdrop?tag=${item.ParentBackdropImageTags[0]}`;
		}
		if (item.BackdropImageTags?.[0]) {
			return `${baseUrl}/Items/${item.Id}/Images/Backdrop?tag=${item.BackdropImageTags[0]}`;
		}
		if (item.ImageTags?.Primary) {
			return `${baseUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}`;
		}
		return null;
	}

	function queueStatusColor(status: string | undefined) {
		switch (status) {
			case 'downloading': return 'var(--color-accent)';
			case 'available': return '#34d399';
			case 'missing': return '#f87171';
			case 'requested': return '#f59e0b';
			default: return '#64748b';
		}
	}

	function methodColor(method?: string) {
		if (method === 'Transcode') return '#f59e0b';
		if (method === 'DirectStream') return '#60a5fa';
		return '#34d399'; // DirectPlay = green
	}

	function methodLabel(method?: string) {
		if (method === 'Transcode') return 'Transcode';
		if (method === 'DirectStream') return 'Stream';
		return 'Direct';
	}

	// ── derived stats ─────────────────────────────────────────────────────────

	const activeSessions = $derived(data.sessions.length);
	const pendingCount = $derived(data.requests.filter((r) => r.status === 'pending').length);
	const onlineCount = $derived(data.health.filter((h) => h.online).length);
	const totalServices = $derived(data.health.length);

	// Status chip colors
	const statusColor: Record<string, string> = {
		pending: '#f59e0b',
		approved: '#60a5fa',
		available: '#34d399',
		declined: '#f87171'
	};

	function timeAgo(dateStr?: string) {
		if (!dateStr) return '';
		const diff = Date.now() - new Date(dateStr).getTime();
		const m = Math.floor(diff / 60_000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	}
</script>

<svelte:head>
	<title>Admin — Nexus</title>
</svelte:head>

<div class="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
	<!-- ── Page header ─────────────────────────────────────────────────────── -->
	<div class="mb-8 flex items-center gap-3">
		<div class="flex h-9 w-9 items-center justify-center rounded-xl" style="background: rgba(124,108,248,0.15); border: 1px solid rgba(124,108,248,0.25)">
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--color-accent)" stroke-width="1.5">
				<rect x="1" y="1" width="6" height="6" rx="1.5" />
				<rect x="9" y="1" width="6" height="6" rx="1.5" />
				<rect x="1" y="9" width="6" height="6" rx="1.5" />
				<rect x="9" y="9" width="6" height="6" rx="1.5" />
			</svg>
		</div>
		<div>
			<h1 class="text-display text-lg font-bold tracking-tight">Admin Dashboard</h1>
			<p class="text-xs text-[var(--color-muted)]">Server intelligence &amp; activity</p>
		</div>
		<!-- Refresh hint -->
		<a href="/admin" class="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06)">
			<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
				<path d="M10.5 2A5 5 0 1 0 11 6.5" />
				<path d="M10.5 2V5H7.5" />
			</svg>
			Refresh
		</a>
	</div>

	<!-- ── Stat cards ──────────────────────────────────────────────────────── -->
	<div class="mb-8 grid grid-cols-3 gap-3 sm:gap-4">
		<!-- Active streams -->
		<div class="relative overflow-hidden rounded-2xl p-4 sm:p-5" style="background: rgba(52,211,153,0.06); border: 1px solid rgba(52,211,153,0.15)">
			<div class="mb-2 text-2xl font-bold tabular-nums sm:text-3xl" style="color: #34d399">{activeSessions}</div>
			<div class="text-xs font-medium text-[var(--color-muted)]">Active Streams</div>
			{#if activeSessions > 0}
				<div class="absolute right-3 top-3 h-2 w-2 animate-pulse rounded-full bg-[#34d399]"></div>
			{/if}
		</div>

		<!-- Pending requests -->
		<div class="relative overflow-hidden rounded-2xl p-4 sm:p-5" style="background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.15)">
			<div class="mb-2 text-2xl font-bold tabular-nums sm:text-3xl" style="color: #f59e0b">{pendingCount}</div>
			<div class="text-xs font-medium text-[var(--color-muted)]">Pending Requests</div>
		</div>

		<!-- Services online -->
		<div class="relative overflow-hidden rounded-2xl p-4 sm:p-5" style="background: rgba(96,165,250,0.06); border: 1px solid rgba(96,165,250,0.15)">
			<div class="mb-2 text-2xl font-bold tabular-nums sm:text-3xl" style="color: #60a5fa">{onlineCount}<span class="text-base font-medium opacity-50">/{totalServices}</span></div>
			<div class="text-xs font-medium text-[var(--color-muted)]">Services Online</div>
		</div>
	</div>

	<!-- ── Main grid ───────────────────────────────────────────────────────── -->
	<div class="grid gap-6 lg:grid-cols-[1fr_380px]">

		<!-- ─── Live Streams ─────────────────────────────────────────────── -->
		<section>
			<div class="mb-4 flex items-center gap-2">
				<h2 class="text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Live Now</h2>
				{#if activeSessions > 0}
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34d399]"></span>
				{/if}
			</div>

			{#if data.sessions.length === 0}
				<div class="flex flex-col items-center justify-center rounded-2xl py-16 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
					<svg class="mb-3 opacity-20" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
						<rect x="2" y="4" width="20" height="14" rx="2" />
						<path d="M8 20h8M12 18v2" stroke-linecap="round" />
						<circle cx="12" cy="11" r="2" />
					</svg>
					<p class="text-sm text-[var(--color-muted)]">No active streams</p>
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each data.sessions as session (session.Id)}
						{@const img = itemBackdrop(session)}
						{@const pct = progress(session)}
						<div class="group relative overflow-hidden rounded-2xl" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
							<!-- Backdrop strip -->
							{#if img}
								<div class="absolute inset-0 opacity-10 transition-opacity group-hover:opacity-[0.15]">
									<img src={img} alt="" class="h-full w-full object-cover" />
									<div class="absolute inset-0" style="background: linear-gradient(to right, rgba(13,11,10,0.9) 0%, rgba(13,11,10,0.5) 60%, transparent 100%)"></div>
								</div>
							{/if}

							<div class="relative flex gap-4 p-4">
								<!-- Poster thumbnail -->
								{#if img}
									<div class="hidden h-16 w-28 flex-shrink-0 overflow-hidden rounded-lg sm:block" style="background: rgba(255,255,255,0.05)">
										<img src={img} alt="" class="h-full w-full object-cover" />
									</div>
								{/if}

								<div class="min-w-0 flex-1">
									<div class="flex items-start justify-between gap-2">
										<div class="min-w-0">
											<p class="truncate text-sm font-semibold">{itemTitle(session)}</p>
											{#if session.NowPlayingItem?.Type === 'Episode' && session.NowPlayingItem?.Name}
												<p class="mt-0.5 truncate text-xs text-[var(--color-muted)]">{session.NowPlayingItem.Name}</p>
											{/if}
										</div>
										<!-- Play method badge -->
										<span class="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tabular-nums"
											style="background: {methodColor(session.PlayState?.PlayMethod)}22; color: {methodColor(session.PlayState?.PlayMethod)}; border: 1px solid {methodColor(session.PlayState?.PlayMethod)}44">
											{methodLabel(session.PlayState?.PlayMethod)}
										</span>
									</div>

									<!-- Who / where -->
									<div class="mt-1.5 flex items-center gap-3 text-xs text-[var(--color-muted)]">
										<span class="flex items-center gap-1">
											<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="5" cy="3.5" r="2"/><path d="M1.5 9c0-1.93 1.57-3.5 3.5-3.5S8.5 7.07 8.5 9"/></svg>
											{session.UserName ?? 'Unknown'}
										</span>
										<span>·</span>
										<span>{session.Client ?? 'Unknown'}</span>
										{#if session.DeviceName}
											<span>·</span>
											<span class="truncate">{session.DeviceName}</span>
										{/if}
										{#if session.PlayState?.IsPaused}
											<span class="ml-auto text-[#f59e0b]">Paused</span>
										{/if}
									</div>

									<!-- Progress bar -->
									{#if pct > 0}
										<div class="mt-2 flex items-center gap-2">
											<div class="h-0.5 flex-1 overflow-hidden rounded-full" style="background: rgba(255,255,255,0.08)">
												<div class="h-full rounded-full transition-all" style="width: {pct * 100}%; background: {session.PlayState?.IsPaused ? '#f59e0b' : '#34d399'}"></div>
											</div>
											<span class="text-[10px] tabular-nums text-[var(--color-muted)]">{Math.round(pct * 100)}%</span>
											{#if session.NowPlayingItem?.RunTimeTicks}
												<span class="text-[10px] tabular-nums text-[var(--color-muted)]">{formatRuntime(session.NowPlayingItem.RunTimeTicks)}</span>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- ─── Right column: Queue + Requests + Health ──────────────────── -->
		<div class="flex flex-col gap-6">

			<!-- Download Queue -->
			<section>
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
						Download Queue
						{#if data.queue.length > 0}
							<span class="ml-1 normal-case font-normal text-[var(--color-muted)]">· {data.queue.length}</span>
						{/if}
					</h2>
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

			<!-- Request Queue -->
			<section>
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Request Queue</h2>
					<a href="/requests" class="text-xs text-[var(--color-accent)] hover:underline">View all →</a>
				</div>

				{#if data.requests.length === 0}
					<div class="rounded-2xl py-8 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
						<p class="text-sm text-[var(--color-muted)]">No recent requests</p>
					</div>
				{:else}
					<div class="flex flex-col divide-y" style="border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; overflow: hidden; divide-color: rgba(255,255,255,0.06)">
						{#each data.requests.slice(0, 10) as req (req.id)}
							<div class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]">
								<!-- Poster -->
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

								<!-- Status chip -->
								<span class="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
									style="background: {statusColor[req.status] ?? '#ffffff'}18; color: {statusColor[req.status] ?? '#ffffff99'}; border: 1px solid {statusColor[req.status] ?? '#ffffff'}33">
									{req.status}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<!-- Service Health -->
			<section>
				<h2 class="mb-4 text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">Service Health</h2>

				{#if data.health.length === 0}
					<div class="rounded-2xl py-8 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
						<p class="text-sm text-[var(--color-muted)]">No services configured</p>
					</div>
				{:else}
					<div class="flex flex-col gap-2">
						{#each data.health as svc (svc.serviceId)}
							<div class="flex items-center gap-3 rounded-xl px-4 py-3" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06)">
								<!-- Status dot -->
								<div class="h-2 w-2 flex-shrink-0 rounded-full {svc.online ? 'bg-[#34d399]' : 'bg-[#f87171]'}"
									style="{svc.online ? 'box-shadow: 0 0 6px #34d39988' : ''}">
								</div>

								<div class="min-w-0 flex-1">
									<p class="truncate text-xs font-medium">{svc.name}</p>
									<p class="text-[10px] capitalize text-[var(--color-muted)]">{svc.type}</p>
								</div>

								{#if svc.online && svc.latency != null}
									<span class="text-[10px] tabular-nums text-[var(--color-muted)]">{svc.latency}ms</span>
								{:else if !svc.online && svc.error}
									<span class="max-w-[100px] truncate text-[10px] text-[#f87171]">{svc.error}</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</section>

		</div>
	</div>
</div>
