<script lang="ts">
	// ── State ──────────────────────────────────────────────────────────────────
	let contentData = $state<any>(null);
	let loading = $state(true);

	// ── Helpers ────────────────────────────────────────────────────────────────

	function formatMs(ms: number): string {
		const hours = Math.floor(ms / 3600000);
		const mins = Math.floor((ms % 3600000) / 60000);
		if (hours > 0) return `${hours}h ${mins}m`;
		if (mins > 0) return `${mins}m`;
		return '0m';
	}

	function timeAgo(dateStr: string): string {
		const diff = Date.now() - new Date(dateStr).getTime();
		const m = Math.floor(diff / 60_000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	}

	// ── Type config ────────────────────────────────────────────────────────────

	const typeColors: Record<string, string> = {
		movie: '#60a5fa',
		show: '#34d399',
		book: '#f59e0b',
		game: '#f87171',
		music: 'var(--color-accent)'
	};

	function typeColor(type: string): string {
		return typeColors[type.toLowerCase()] ?? '#94a3b8';
	}

	function playTimeForType(type: string): number {
		if (!contentData?.playTimeByType) return 0;
		const entry = contentData.playTimeByType.find(
			(p: any) => p.type.toLowerCase() === type.toLowerCase()
		);
		return entry?.playTimeMs ?? 0;
	}

	// ── Fetch ──────────────────────────────────────────────────────────────────

	$effect(() => {
		async function load() {
			loading = true;
			try {
				const res = await fetch('/api/admin/content');
				if (res.ok) contentData = await res.json();
			} catch {
				// silently handle
			} finally {
				loading = false;
			}
		}
		load();
	});

	// ── Derived ────────────────────────────────────────────────────────────────

	const maxServiceCount = $derived(
		contentData?.byService
			? Math.max(...contentData.byService.map((s: any) => s.count), 1)
			: 1
	);
</script>

<div class="flex flex-col gap-6">
	{#if loading}
		<!-- ── Loading skeleton ────────────────────────────────────────────── -->
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
			{#each Array(5) as _, i (i)}
				<div class="animate-pulse rounded-2xl p-4" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
					<div class="mb-3 h-8 w-8 rounded-lg bg-white/5"></div>
					<div class="mb-2 h-6 w-12 rounded bg-white/5"></div>
					<div class="h-3 w-16 rounded bg-white/5"></div>
				</div>
			{/each}
		</div>
		<div class="animate-pulse rounded-2xl p-6" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
			<div class="h-40 rounded bg-white/5"></div>
		</div>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
			{#each Array(10) as _, i (i)}
				<div class="animate-pulse rounded-2xl" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
					<div class="aspect-[2/3] rounded-t-2xl bg-white/5"></div>
					<div class="p-3">
						<div class="mb-2 h-3 w-24 rounded bg-white/5"></div>
						<div class="h-2 w-16 rounded bg-white/5"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if contentData}
		<!-- ── Media Type Cards ────────────────────────────────────────────── -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
				Library Overview
			</h2>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				{#each contentData.byType as item (item.type)}
					{@const color = typeColor(item.type)}
					<div
						class="relative overflow-hidden rounded-2xl p-4"
						style="background: {color}0a; border: 1px solid {color}26"
					>
						<!-- Type icon -->
						<div
							class="mb-3 flex h-8 w-8 items-center justify-center rounded-lg"
							style="background: {color}1a"
						>
							{#if item.type.toLowerCase() === 'movie'}
								<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} stroke-width="1.3" stroke-linecap="round">
									<rect x="1" y="2" width="12" height="10" rx="1.5" />
									<path d="M1 5h12M1 9h12M4 2v10M10 2v10" />
								</svg>
							{:else if item.type.toLowerCase() === 'show'}
								<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} stroke-width="1.3" stroke-linecap="round">
									<rect x="1" y="2.5" width="12" height="8" rx="1.5" />
									<path d="M4 12.5h6M7 10.5v2" />
								</svg>
							{:else if item.type.toLowerCase() === 'book'}
								<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
									<path d="M2 1.5h3.5c1 0 1.5.5 1.5 1.5v9.5c0-.75-.5-1-1-1H2z" />
									<path d="M12 1.5H8.5C7.5 1.5 7 2 7 3v9.5c0-.75.5-1 1-1H12z" />
								</svg>
							{:else if item.type.toLowerCase() === 'game'}
								<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
									<path d="M2 4.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" />
									<path d="M5 5v3M3.5 6.5h3" />
									<circle cx="9.5" cy="5.5" r="0.5" fill={color} />
									<circle cx="10.5" cy="7" r="0.5" fill={color} />
								</svg>
							{:else if item.type.toLowerCase() === 'music'}
								<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
									<path d="M5 12V3.5l7-2v8.5" />
									<circle cx="3.5" cy="11.5" r="1.5" />
									<circle cx="10.5" cy="10" r="1.5" />
								</svg>
							{:else}
								<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={color} stroke-width="1.3">
									<rect x="2" y="2" width="10" height="10" rx="2" />
								</svg>
							{/if}
						</div>

						<div class="text-2xl font-bold tabular-nums" style="color: {color}">
							{item.count.toLocaleString()}
						</div>
						<div class="mt-0.5 text-xs font-medium capitalize text-[var(--color-muted)]">
							{item.type}{item.count !== 1 ? 's' : ''}
						</div>
						{#if playTimeForType(item.type) > 0}
							<div class="mt-1 text-[10px] tabular-nums text-[var(--color-muted)]">
								{formatMs(playTimeForType(item.type))} played
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>

		<!-- ── Service Content Breakdown ───────────────────────────────────── -->
		{#if contentData.byService && contentData.byService.length > 0}
			<section>
				<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
					By Service
				</h2>
				<div
					class="flex flex-col gap-2 rounded-2xl p-5"
					style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)"
				>
					{#each contentData.byService as svc (svc.serviceId)}
						{@const pct = (svc.count / maxServiceCount) * 100}
						<div class="flex items-center gap-3">
							<div class="min-w-0 flex-1">
								<div class="mb-1 flex items-center gap-2">
									<span class="truncate text-xs font-medium">{svc.serviceName}</span>
									<span
										class="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase"
										style="background: rgba(255,255,255,0.06); color: var(--color-muted)"
									>
										{svc.serviceType}
									</span>
								</div>
								<div class="h-1.5 w-full overflow-hidden rounded-full" style="background: rgba(255,255,255,0.06)">
									<div
										class="h-full rounded-full transition-all"
										style="width: {pct}%; background: var(--color-accent)"
									></div>
								</div>
							</div>
							<span class="w-12 flex-shrink-0 text-right text-xs font-bold tabular-nums">
								{svc.count.toLocaleString()}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ── Content Gaps ────────────────────────────────────────────────── -->
		{#if contentData.gaps && (contentData.gaps.missingPoster > 0 || contentData.gaps.missingDescription > 0)}
			<section>
				<div
					class="flex items-start gap-3 rounded-2xl p-4"
					style="background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.15)"
				>
					<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style="background: rgba(245,158,11,0.15)">
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round">
							<path d="M7 1.5L1 12.5h12L7 1.5z" />
							<path d="M7 5.5v3" />
							<circle cx="7" cy="10.5" r="0.5" fill="#f59e0b" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-semibold" style="color: #f59e0b">Content Gaps Detected</p>
						<div class="mt-1 flex flex-wrap gap-4 text-xs text-[var(--color-muted)]">
							{#if contentData.gaps.missingPoster > 0}
								<span>
									<strong class="font-bold" style="color: #f59e0b">{contentData.gaps.missingPoster}</strong> missing poster{contentData.gaps.missingPoster !== 1 ? 's' : ''}
								</span>
							{/if}
							{#if contentData.gaps.missingDescription > 0}
								<span>
									<strong class="font-bold" style="color: #f59e0b">{contentData.gaps.missingDescription}</strong> missing description{contentData.gaps.missingDescription !== 1 ? 's' : ''}
								</span>
							{/if}
						</div>
					</div>
				</div>
			</section>
		{/if}

		<!-- ── Recent Additions ────────────────────────────────────────────── -->
		{#if contentData.recent && contentData.recent.length > 0}
			<section>
				<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
					Recent Additions
				</h2>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
					{#each contentData.recent.slice(0, 20) as item (item.id)}
						{@const color = typeColor(item.type)}
						<div
							class="group overflow-hidden rounded-2xl transition-colors"
							style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)"
						>
							<!-- Poster -->
							{#if item.poster}
								<div class="aspect-[2/3] overflow-hidden">
									<img
										src={item.poster}
										alt={item.title}
										class="h-full w-full object-cover transition-transform group-hover:scale-105"
										loading="lazy"
									/>
								</div>
							{:else}
								<div
									class="flex aspect-[2/3] items-center justify-center"
									style="background: rgba(255,255,255,0.03)"
								>
									<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="opacity-15">
										<rect x="3" y="3" width="18" height="18" rx="3" />
										<circle cx="8.5" cy="8.5" r="1.5" />
										<path d="M21 15l-5-5L5 21" />
									</svg>
								</div>
							{/if}

							<!-- Info -->
							<div class="p-3">
								<p class="truncate text-xs font-medium">{item.title}</p>
								<div class="mt-1 flex items-center gap-1.5">
									<span
										class="rounded px-1 py-0.5 text-[9px] font-bold uppercase"
										style="background: {color}1a; color: {color}"
									>
										{item.type}
									</span>
									{#if item.cachedAt}
										<span class="text-[10px] text-[var(--color-muted)]">
											{timeAgo(item.cachedAt)}
										</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{:else}
		<!-- ── No data ────────────────────────────────────────────────────── -->
		<div
			class="flex flex-col items-center justify-center rounded-2xl py-16 text-center"
			style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)"
		>
			<svg class="mb-3 opacity-20" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
				<rect x="3" y="3" width="18" height="18" rx="3" />
				<path d="M3 9h18M9 3v18" />
			</svg>
			<p class="text-sm text-[var(--color-muted)]">Failed to load content data</p>
		</div>
	{/if}
</div>
