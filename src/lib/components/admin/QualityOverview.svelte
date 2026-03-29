<script lang="ts">
	import { onMount } from 'svelte';

	interface QualityStats {
		total: number;
		withFile: number;
		missing: number;
		tiers: Record<string, number>;
		breakdown: Record<string, number>;
		byService: Record<string, { total: number; withFile: number; qualities: Record<string, number> }>;
	}

	let stats: QualityStats | null = $state(null);
	let loading = $state(true);
	let error = $state('');
	let expandedServices: Record<string, boolean> = $state({});

	const tierColors: Record<string, string> = {
		'4K': '#4a9eff',
		'1080p': '#22c55e',
		'720p': '#f59e0b',
		SD: '#ef4444',
		Other: '#64748b'
	};

	const tierOrder = ['4K', '1080p', '720p', 'SD', 'Other'];

	async function fetchStats() {
		try {
			const res = await fetch('/api/admin/quality');
			if (!res.ok) throw new Error('Failed to fetch quality stats');
			stats = await res.json();
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}

	function pct(value: number, total: number): string {
		if (!total) return '0';
		return (value / total * 100).toFixed(1);
	}

	function toggleService(name: string) {
		expandedServices[name] = !expandedServices[name];
	}

	onMount(() => {
		fetchStats();
		const interval = setInterval(fetchStats, 300_000);
		return () => clearInterval(interval);
	});
</script>

<section class="mb-8">
	<h2 class="mb-4 text-display text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
		Library Quality
	</h2>

	{#if loading}
		<!-- Skeleton -->
		<div class="rounded-2xl p-5" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
			<div class="mb-4 h-6 w-full animate-pulse rounded-lg" style="background: rgba(255,255,255,0.06)"></div>
			<div class="mb-3 grid grid-cols-3 gap-3">
				{#each Array(3) as _}
					<div class="h-14 animate-pulse rounded-xl" style="background: rgba(255,255,255,0.04)"></div>
				{/each}
			</div>
			<div class="space-y-2">
				{#each Array(5) as _}
					<div class="h-8 animate-pulse rounded-lg" style="background: rgba(255,255,255,0.03)"></div>
				{/each}
			</div>
		</div>
	{:else if error}
		<div class="rounded-2xl p-6 text-center" style="background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.15)">
			<p class="text-sm text-[#ef4444]">{error}</p>
		</div>
	{:else if stats}
		<div class="rounded-2xl p-5" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
			<!-- Stacked bar -->
			{#if stats.withFile > 0}
				<div class="mb-5 flex h-5 overflow-hidden rounded-full" style="background: rgba(255,255,255,0.06)">
					{#each tierOrder as tier}
						{@const count = stats.tiers[tier] ?? 0}
						{#if count > 0}
							<div
								class="flex items-center justify-center text-[9px] font-bold transition-all"
								style="width: {pct(count, stats.withFile)}%; background: {tierColors[tier]}; color: rgba(0,0,0,0.7)"
								title="{tier}: {count} ({pct(count, stats.withFile)}%)"
							>
								{#if count / stats.withFile > 0.08}{tier}{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}

			<!-- Stats row -->
			<div class="mb-5 grid grid-cols-3 gap-3">
				<div class="rounded-xl p-3 text-center" style="background: rgba(255,255,255,0.03)">
					<div class="text-lg font-bold tabular-nums">{stats.total.toLocaleString()}</div>
					<div class="text-[10px] text-[var(--color-muted)]">Total Items</div>
				</div>
				<div class="rounded-xl p-3 text-center" style="background: rgba(34,197,94,0.06)">
					<div class="text-lg font-bold tabular-nums" style="color: #22c55e">{stats.withFile.toLocaleString()}</div>
					<div class="text-[10px] text-[var(--color-muted)]">With Files</div>
				</div>
				<div class="rounded-xl p-3 text-center" style="background: rgba(239,68,68,0.06)">
					<div class="text-lg font-bold tabular-nums" style="color: #ef4444">{stats.missing.toLocaleString()}</div>
					<div class="text-[10px] text-[var(--color-muted)]">Missing</div>
				</div>
			</div>

			<!-- Tier breakdown -->
			<div class="mb-5 space-y-2">
				{#each tierOrder as tier}
					{@const count = stats.tiers[tier] ?? 0}
					{#if count > 0}
						<div class="flex items-center gap-3">
							<div class="flex w-14 items-center gap-1.5">
								<div class="h-2.5 w-2.5 flex-shrink-0 rounded-full" style="background: {tierColors[tier]}"></div>
								<span class="text-xs font-medium">{tier}</span>
							</div>
							<div class="h-1.5 flex-1 overflow-hidden rounded-full" style="background: rgba(255,255,255,0.06)">
								<div
									class="h-full rounded-full transition-all"
									style="width: {pct(count, stats.withFile)}%; background: {tierColors[tier]}"
								></div>
							</div>
							<span class="w-20 text-right text-xs tabular-nums text-[var(--color-muted)]">
								{count.toLocaleString()} <span class="opacity-50">({pct(count, stats.withFile)}%)</span>
							</span>
						</div>
					{/if}
				{/each}
			</div>

			<!-- Per-service breakdown -->
			{#if Object.keys(stats.byService).length > 0}
				<div class="border-t" style="border-color: rgba(255,255,255,0.06)">
					<h3 class="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
						By Service
					</h3>
					<div class="space-y-1">
						{#each Object.entries(stats.byService) as [name, svc]}
							<div>
								<button
									class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
									onclick={() => toggleService(name)}
								>
									<svg
										class="flex-shrink-0 transition-transform"
										class:rotate-90={expandedServices[name]}
										width="10" height="10" viewBox="0 0 10 10" fill="currentColor" opacity="0.4"
									>
										<path d="M3 1.5l5 3.5-5 3.5z"/>
									</svg>
									<span class="flex-1 text-xs font-medium">{name}</span>
									<span class="text-[10px] tabular-nums text-[var(--color-muted)]">
										{svc.withFile}/{svc.total} files
									</span>
								</button>

								{#if expandedServices[name]}
									<div class="ml-5 space-y-1 pb-2 pl-3" style="border-left: 1px solid rgba(255,255,255,0.06)">
										{#each Object.entries(svc.qualities).sort((a, b) => b[1] - a[1]) as [quality, count]}
											<div class="flex items-center justify-between px-2 py-0.5">
												<span class="text-[11px] text-[var(--color-muted)]">{quality}</span>
												<span class="text-[11px] tabular-nums text-[var(--color-muted)]">{count}</span>
											</div>
										{/each}
										{#if Object.keys(svc.qualities).length === 0}
											<div class="px-2 py-0.5 text-[11px] text-[var(--color-muted)] opacity-50">No quality data</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<div class="rounded-2xl py-8 text-center" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06)">
			<p class="text-sm text-[var(--color-muted)]">No *arr services configured</p>
		</div>
	{/if}
</section>
