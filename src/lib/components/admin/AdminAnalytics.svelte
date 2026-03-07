<script lang="ts">
	// ── State ──────────────────────────────────────────────────────────────────
	let selectedPeriod = $state<'day' | 'week' | 'month' | 'year' | 'alltime'>('month');
	let stats = $state<any>(null);
	let timeline = $state<any[]>([]);
	let userStats = $state<any[]>([]);
	let loading = $state(true);

	// ── Helpers ────────────────────────────────────────────────────────────────

	function formatMs(ms: number): string {
		const hours = Math.floor(ms / 3600000);
		const mins = Math.floor((ms % 3600000) / 60000);
		if (hours > 0) return `${hours}h ${mins}m`;
		if (mins > 0) return `${mins}m`;
		return '0m';
	}

	function timeAgo(ts: number): string {
		const diff = Date.now() - ts;
		const m = Math.floor(diff / 60_000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	}

	function currentPeriodString(period: string): string {
		const now = new Date();
		const y = now.getFullYear();
		const mo = String(now.getMonth() + 1).padStart(2, '0');
		const d = String(now.getDate()).padStart(2, '0');
		switch (period) {
			case 'day':
				return `day:${y}-${mo}-${d}`;
			case 'week': {
				const dayOfWeek = now.getDay();
				const monday = new Date(y, now.getMonth(), now.getDate() - ((dayOfWeek + 6) % 7));
				const jan1 = new Date(y, 0, 1);
				const weekNum = Math.ceil(
					((monday.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7
				);
				return `week:${y}-W${String(weekNum).padStart(2, '0')}`;
			}
			case 'month':
				return `month:${y}-${mo}`;
			case 'year':
				return `year:${y}`;
			default:
				return 'alltime';
		}
	}

	// ── Derived ────────────────────────────────────────────────────────────────

	const avgSessionMs = $derived(
		stats && stats.totalSessions > 0
			? Math.round(stats.totalPlayTimeMs / stats.totalSessions)
			: 0
	);

	const timelineMax = $derived(
		timeline.length > 0 ? Math.max(...timeline.map((d: any) => d.playTimeMs), 1) : 1
	);

	const sortedUsers = $derived(
		[...userStats].sort((a: any, b: any) => (b.totalPlayTimeMs ?? 0) - (a.totalPlayTimeMs ?? 0))
	);

	// ── Fetch logic ────────────────────────────────────────────────────────────

	async function fetchData() {
		loading = true;
		try {
			const periodStr = currentPeriodString(selectedPeriod);
			const [statsRes, timelineRes, usersRes] = await Promise.all([
				fetch(`/api/admin/stats?period=${encodeURIComponent(periodStr)}`),
				fetch('/api/admin/stats/timeline?days=30'),
				fetch('/api/admin/stats/users')
			]);
			if (statsRes.ok) stats = await statsRes.json();
			if (timelineRes.ok) timeline = await timelineRes.json();
			if (usersRes.ok) userStats = await usersRes.json();
		} catch {
			// silently handle fetch errors
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// Track selectedPeriod to re-run when it changes
		const _period = selectedPeriod;
		fetchData();
	});

	// ── Period config ──────────────────────────────────────────────────────────

	const periods: { key: typeof selectedPeriod; label: string }[] = [
		{ key: 'day', label: 'Day' },
		{ key: 'week', label: 'Week' },
		{ key: 'month', label: 'Month' },
		{ key: 'year', label: 'Year' },
		{ key: 'alltime', label: 'All Time' }
	];
</script>

<div class="flex flex-col gap-6">
	<!-- ── Period selector ─────────────────────────────────────────────────── -->
	<div class="flex gap-1 rounded-xl p-1" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
		{#each periods as p (p.key)}
			<button
				class="flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all"
				style={selectedPeriod === p.key
					? 'background: var(--color-accent); color: white;'
					: 'color: var(--color-muted);'}
				onclick={() => (selectedPeriod = p.key)}
			>
				{p.label}
			</button>
		{/each}
	</div>

	{#if loading}
		<!-- ── Loading skeleton ────────────────────────────────────────────── -->
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
			{#each Array(5) as _, i (i)}
				<div class="animate-pulse rounded-2xl p-4" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
					<div class="mb-2 h-7 w-16 rounded bg-white/5"></div>
					<div class="h-3 w-20 rounded bg-white/5"></div>
				</div>
			{/each}
		</div>
		<div class="animate-pulse rounded-2xl p-6" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
			<div class="h-40 rounded bg-white/5"></div>
		</div>
		<div class="animate-pulse rounded-2xl p-6" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
			<div class="h-32 rounded bg-white/5"></div>
		</div>
	{:else}
		<!-- ── Summary stat cards ──────────────────────────────────────────── -->
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
			<!-- Total Play Time -->
			<div class="relative overflow-hidden rounded-2xl p-4" style="background: rgba(52,211,153,0.06); border: 1px solid rgba(52,211,153,0.15)">
				<div class="mb-1 text-2xl font-bold tabular-nums" style="color: #34d399">
					{stats ? formatMs(stats.totalPlayTimeMs) : '0m'}
				</div>
				<div class="text-xs font-medium text-[var(--color-muted)]">Total Play Time</div>
			</div>

			<!-- Sessions -->
			<div class="relative overflow-hidden rounded-2xl p-4" style="background: rgba(96,165,250,0.06); border: 1px solid rgba(96,165,250,0.15)">
				<div class="mb-1 text-2xl font-bold tabular-nums" style="color: #60a5fa">
					{stats?.totalSessions?.toLocaleString() ?? 0}
				</div>
				<div class="text-xs font-medium text-[var(--color-muted)]">Sessions</div>
			</div>

			<!-- Unique Items -->
			<div class="relative overflow-hidden rounded-2xl p-4" style="background: rgba(124,108,248,0.06); border: 1px solid rgba(124,108,248,0.15)">
				<div class="mb-1 text-2xl font-bold tabular-nums" style="color: var(--color-accent)">
					{stats?.totalItems?.toLocaleString() ?? 0}
				</div>
				<div class="text-xs font-medium text-[var(--color-muted)]">Unique Items</div>
			</div>

			<!-- Active Users -->
			<div class="relative overflow-hidden rounded-2xl p-4" style="background: rgba(45,212,191,0.06); border: 1px solid rgba(45,212,191,0.15)">
				<div class="mb-1 text-2xl font-bold tabular-nums" style="color: var(--color-steel)">
					{stats?.activeUsers ?? 0}
				</div>
				<div class="text-xs font-medium text-[var(--color-muted)]">Active Users</div>
			</div>

			<!-- Avg Session -->
			<div class="relative overflow-hidden rounded-2xl p-4" style="background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.15)">
				<div class="mb-1 text-2xl font-bold tabular-nums" style="color: #f59e0b">
					{formatMs(avgSessionMs)}
				</div>
				<div class="text-xs font-medium text-[var(--color-muted)]">Avg Session</div>
			</div>
		</div>

		<!-- ── Play Time Timeline ──────────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
				Play Time Timeline
			</h2>
			{#if timeline.length > 0}
				<div
					class="rounded-2xl p-5"
					style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)"
				>
					<div class="flex h-40 items-end gap-[2px]">
						{#each timeline as day (day.date)}
							{@const pct = (day.playTimeMs / timelineMax) * 100}
							<div
								class="flex-1 min-w-0 rounded-t transition-all hover:opacity-80"
								style="height: {Math.max(pct, 2)}%; background: var(--color-accent)"
								title="{day.date}: {formatMs(day.playTimeMs)} / {day.sessions} sessions"
							></div>
						{/each}
					</div>
					<!-- Date labels -->
					<div class="mt-2 flex justify-between text-[10px] text-[var(--color-muted)]">
						<span>{timeline[0]?.date ?? ''}</span>
						{#if timeline.length > 2}
							<span>{timeline[Math.floor(timeline.length / 2)]?.date ?? ''}</span>
						{/if}
						<span>{timeline[timeline.length - 1]?.date ?? ''}</span>
					</div>
				</div>
			{:else}
				<div
					class="flex items-center justify-center rounded-2xl py-12 text-center"
					style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)"
				>
					<p class="text-sm text-[var(--color-muted)]">No timeline data available</p>
				</div>
			{/if}
		</section>

		<!-- ── Activity Heatmap ────────────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
				Activity Heatmap
			</h2>
			{#if stats?.hourlyDistribution && stats?.weekdayDistribution}
				{@const maxVal = Math.max(...stats.hourlyDistribution, ...stats.weekdayDistribution, 1)}
				<div
					class="rounded-2xl p-5"
					style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)"
				>
					<!-- Weekday row -->
					<div class="mb-3">
						<p class="mb-2 text-[10px] font-medium text-[var(--color-muted)]">By Day of Week</p>
						<div class="flex gap-1">
							{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as dayLabel, i (dayLabel)}
								{@const intensity = stats.weekdayDistribution[i]
									? Math.max(0.1, stats.weekdayDistribution[i] / maxVal)
									: 0.05}
								<div class="flex flex-1 flex-col items-center gap-1">
									<div
										class="h-6 w-full rounded"
										style="background: rgba(124,108,248,{intensity})"
										title="{dayLabel}: {stats.weekdayDistribution[i] ?? 0}"
									></div>
									<span class="text-[9px] text-[var(--color-muted)]">{dayLabel}</span>
								</div>
							{/each}
						</div>
					</div>
					<!-- Hourly row -->
					<div>
						<p class="mb-2 text-[10px] font-medium text-[var(--color-muted)]">By Hour</p>
						<div class="flex gap-[2px]">
							{#each Array(24) as _, h (h)}
								{@const intensity = stats.hourlyDistribution[h]
									? Math.max(0.1, stats.hourlyDistribution[h] / maxVal)
									: 0.05}
								<div
									class="h-6 flex-1 rounded-sm"
									style="background: rgba(124,108,248,{intensity})"
									title="{h}:00 - {stats.hourlyDistribution[h] ?? 0}"
								></div>
							{/each}
						</div>
						<div class="mt-1 flex justify-between text-[9px] text-[var(--color-muted)]">
							<span>12am</span>
							<span>6am</span>
							<span>12pm</span>
							<span>6pm</span>
							<span>11pm</span>
						</div>
					</div>
				</div>
			{:else}
				<div
					class="flex items-center justify-center rounded-2xl py-12 text-center"
					style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)"
				>
					<p class="text-sm text-[var(--color-muted)]">Heatmap requires per-user stats data</p>
				</div>
			{/if}
		</section>

		<!-- ── Top Content (Genres) ────────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
				Top Genres
			</h2>
			{#if stats?.topGenres && stats.topGenres.length > 0}
				{@const maxGenre = Math.max(...stats.topGenres.map((g: any) => g.playTimeMs ?? g.count ?? 1))}
				<div
					class="flex flex-col gap-2 rounded-2xl p-5"
					style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)"
				>
					{#each stats.topGenres as genre, i (genre.name ?? i)}
						{@const val = genre.playTimeMs ?? genre.count ?? 0}
						{@const pct = (val / maxGenre) * 100}
						<div class="flex items-center gap-3">
							<span class="w-5 text-right text-xs tabular-nums text-[var(--color-muted)]">{i + 1}</span>
							<div class="min-w-0 flex-1">
								<div class="mb-1 flex items-center justify-between">
									<span class="truncate text-xs font-medium">{genre.name}</span>
									<span class="flex-shrink-0 text-[10px] tabular-nums text-[var(--color-muted)]">
										{genre.playTimeMs ? formatMs(genre.playTimeMs) : genre.count}
									</span>
								</div>
								<div class="h-1.5 w-full overflow-hidden rounded-full" style="background: rgba(255,255,255,0.06)">
									<div
										class="h-full rounded-full"
										style="width: {pct}%; background: var(--color-accent)"
									></div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div
					class="flex items-center justify-center rounded-2xl py-12 text-center"
					style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)"
				>
					<p class="text-sm text-[var(--color-muted)]">No genre data available</p>
				</div>
			{/if}
		</section>

		<!-- ── Device & Client Breakdown ───────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
				Devices & Clients
			</h2>
			{#if stats?.topDevices && stats.topDevices.length > 0}
				{@const maxDevice = Math.max(...stats.topDevices.map((d: any) => d.playTimeMs ?? d.count ?? 1))}
				<div class="grid gap-4 sm:grid-cols-2">
					<!-- Devices -->
					<div
						class="flex flex-col gap-2 rounded-2xl p-5"
						style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)"
					>
						<p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Devices</p>
						{#each stats.topDevices as device (device.name)}
							{@const val = device.playTimeMs ?? device.count ?? 0}
							{@const pct = (val / maxDevice) * 100}
							<div>
								<div class="mb-1 flex items-center justify-between">
									<span class="flex items-center gap-1.5 truncate text-xs font-medium">
										<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2">
											<rect x="1" y="1.5" width="8" height="5.5" rx="1" />
											<path d="M3 8.5h4" stroke-linecap="round" />
										</svg>
										{device.name}
									</span>
									<span class="flex-shrink-0 text-[10px] tabular-nums text-[var(--color-muted)]">
										{device.playTimeMs ? formatMs(device.playTimeMs) : device.count}
									</span>
								</div>
								<div class="h-1 w-full overflow-hidden rounded-full" style="background: rgba(255,255,255,0.06)">
									<div
										class="h-full rounded-full"
										style="width: {pct}%; background: var(--color-steel)"
									></div>
								</div>
							</div>
						{/each}
					</div>

					<!-- Clients (if available in topDevices as separate entries) -->
					<div
						class="flex flex-col gap-2 rounded-2xl p-5"
						style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)"
					>
						<p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Usage Share</p>
						{#each stats.topDevices as device (device.name)}
							{@const val = device.sessions ?? device.count ?? 0}
							{@const total = stats.topDevices.reduce((s: number, d: any) => s + (d.sessions ?? d.count ?? 0), 0)}
							{@const pct = total > 0 ? (val / total) * 100 : 0}
							<div class="flex items-center gap-2">
								<span class="truncate text-xs text-[var(--color-muted)]">{device.name}</span>
								<span class="ml-auto flex-shrink-0 text-[10px] font-bold tabular-nums" style="color: var(--color-accent)">
									{Math.round(pct)}%
								</span>
							</div>
						{/each}
					</div>
				</div>
			{:else}
				<div
					class="flex items-center justify-center rounded-2xl py-12 text-center"
					style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)"
				>
					<p class="text-sm text-[var(--color-muted)]">No device data available</p>
				</div>
			{/if}
		</section>

		<!-- ── Per-User Summary Table ──────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
				User Activity
			</h2>
			{#if sortedUsers.length > 0}
				<div
					class="overflow-hidden rounded-2xl"
					style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)"
				>
					<table class="w-full text-left text-xs">
						<thead>
							<tr style="border-bottom: 1px solid rgba(255,255,255,0.07)">
								<th class="px-4 py-3 font-semibold text-[var(--color-muted)]">User</th>
								<th class="px-4 py-3 font-semibold text-[var(--color-muted)]">Play Time</th>
								<th class="hidden px-4 py-3 font-semibold text-[var(--color-muted)] sm:table-cell">Sessions</th>
								<th class="hidden px-4 py-3 text-right font-semibold text-[var(--color-muted)] md:table-cell">Last Active</th>
							</tr>
						</thead>
						<tbody>
							{#each sortedUsers as user (user.userId)}
								<tr class="transition-colors hover:bg-white/[0.02]" style="border-bottom: 1px solid rgba(255,255,255,0.04)">
									<td class="px-4 py-3">
										<div class="flex items-center gap-2">
											<div
												class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase"
												style="background: rgba(124,108,248,0.15); color: var(--color-accent)"
											>
												{(user.displayName ?? user.username ?? '?').charAt(0)}
											</div>
											<span class="truncate font-medium">{user.displayName ?? user.username ?? 'Unknown'}</span>
										</div>
									</td>
									<td class="px-4 py-3 tabular-nums">{formatMs(user.totalPlayTimeMs ?? 0)}</td>
									<td class="hidden px-4 py-3 tabular-nums sm:table-cell">{user.totalSessions ?? 0}</td>
									<td class="hidden px-4 py-3 text-right text-[var(--color-muted)] md:table-cell">
										{user.lastActive ? timeAgo(user.lastActive) : 'Never'}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<div
					class="flex items-center justify-center rounded-2xl py-12 text-center"
					style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)"
				>
					<p class="text-sm text-[var(--color-muted)]">No user activity data</p>
				</div>
			{/if}
		</section>
	{/if}
</div>
