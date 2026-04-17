<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let goalTarget = $state(12);
	let settingGoal = $state(false);

	const maxMinutes = $derived(Math.max(...data.monthlyData.map(m => m.minutes), 1));

	const currentYearGoal = $derived(
		data.goals.find(g => g.period === 'yearly' && g.year === new Date().getFullYear())
	);

	const goalProgress = $derived(
		currentYearGoal?.targetBooks ? Math.min(data.booksFinished / currentYearGoal.targetBooks, 1) : 0
	);

	function formatNumber(n: number) {
		return n.toLocaleString();
	}

	function formatDuration(minutes: number) {
		if (minutes < 60) return `${minutes}m`;
		const hrs = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
	}

	function formatSessionDuration(seconds: number | null) {
		if (!seconds) return '--';
		if (seconds < 60) return `${seconds}s`;
		const mins = Math.floor(seconds / 60);
		if (mins < 60) return `${mins}m`;
		const hrs = Math.floor(mins / 60);
		return `${hrs}h ${mins % 60}m`;
	}

	function formatSessionDate(ts: number) {
		return new Date(ts).toLocaleDateString('en', { month: 'short', day: 'numeric' });
	}

	async function setGoal() {
		settingGoal = true;
		await fetch('/api/books/goals', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				targetBooks: goalTarget,
				period: 'yearly',
				year: new Date().getFullYear()
			})
		});
		window.location.reload();
	}

	// SVG ring params
	const ringRadius = 54;
	const ringCircumference = 2 * Math.PI * ringRadius;
	const ringOffset = $derived(ringCircumference * (1 - goalProgress));
</script>

<svelte:head>
	<title>Reading Stats - Nexus</title>
</svelte:head>

<div class="px-3 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-8">
	<div class="mb-6">
		<h1 class="font-[var(--font-display)] text-2xl font-bold text-[var(--color-cream)]">Reading Stats</h1>
		<p class="mt-1 text-sm text-[var(--color-muted)]">Your reading journey at a glance.</p>
	</div>

	<!-- Stat cards -->
	<div class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
		<!-- Books Finished -->
		<div class="rounded-2xl bg-[var(--color-raised)] p-5">
			<div class="mb-1 flex items-center gap-2">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/>
				</svg>
				<span class="text-xs text-[var(--color-muted)]">Books Finished</span>
			</div>
			<p class="font-[var(--font-display)] text-3xl font-bold text-[var(--color-cream)]">{formatNumber(data.booksFinished)}</p>
			<p class="text-[10px] text-[var(--color-faint)]">all time</p>
		</div>

		<!-- Pages Read -->
		<div class="rounded-2xl bg-[var(--color-raised)] p-5">
			<div class="mb-1 flex items-center gap-2">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
					<path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>
				</svg>
				<span class="text-xs text-[var(--color-muted)]">Pages Read</span>
			</div>
			<p class="font-[var(--font-display)] text-3xl font-bold text-[var(--color-cream)]">{formatNumber(data.totalPagesRead)}</p>
			<p class="text-[10px] text-[var(--color-faint)]">all time</p>
		</div>

		<!-- Reading Streak -->
		<div class="rounded-2xl bg-[var(--color-raised)] p-5">
			<div class="mb-1 flex items-center gap-2">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10c0 3.5-4 6-5 8-1-2-5-4.5-5-8a5 5 0 0 1 1.5-3.5C9.5 5.5 11 5 12 2z"/>
				</svg>
				<span class="text-xs text-[var(--color-muted)]">Streak</span>
			</div>
			<p class="font-[var(--font-display)] text-3xl font-bold text-[var(--color-cream)]">{data.currentStreak}</p>
			<p class="text-[10px] text-[var(--color-faint)]">day{data.currentStreak !== 1 ? 's' : ''}</p>
		</div>

		<!-- Highlights -->
		<div class="rounded-2xl bg-[var(--color-raised)] p-5">
			<div class="mb-1 flex items-center gap-2">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
				</svg>
				<span class="text-xs text-[var(--color-muted)]">Highlights</span>
			</div>
			<p class="font-[var(--font-display)] text-3xl font-bold text-[var(--color-cream)]">{formatNumber(data.highlightCount)}</p>
			<p class="text-[10px] text-[var(--color-faint)]">{data.sessionCount} session{data.sessionCount !== 1 ? 's' : ''}</p>
		</div>
	</div>

	<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
		<div class="space-y-6">
			<!-- Monthly chart -->
			<section class="rounded-2xl bg-[var(--color-raised)] p-5">
				<h2 class="mb-4 text-sm font-semibold text-[var(--color-cream)]">Reading Activity</h2>
				<p class="mb-4 text-[10px] text-[var(--color-faint)]">Minutes read per month</p>
				<div class="flex items-end gap-1 sm:gap-2" style="height: 160px">
					{#each data.monthlyData as m, i}
						{@const pct = maxMinutes > 0 ? (m.minutes / maxMinutes) * 100 : 0}
						<div class="flex flex-1 flex-col items-center gap-1">
							<span class="text-[9px] font-mono text-[var(--color-faint)] opacity-0 transition-opacity hover:opacity-100">
								{m.minutes > 0 ? formatDuration(m.minutes) : ''}
							</span>
							<div class="relative w-full flex justify-center" style="height: 130px">
								<div
									class="w-full max-w-[32px] rounded-t-md transition-all duration-700 ease-out"
									style="height: {Math.max(pct, m.minutes > 0 ? 3 : 0)}%; background: linear-gradient(to top, var(--color-accent-dim), var(--color-accent)); animation: bar-grow 0.6s ease-out {i * 50}ms both"
								></div>
							</div>
							<span class="text-[9px] text-[var(--color-faint)]">{m.month}</span>
						</div>
					{/each}
				</div>
			</section>

			<!-- Recent sessions -->
			{#if data.recentSessions.length > 0}
				<section class="rounded-2xl bg-[var(--color-raised)] p-5">
					<h2 class="mb-4 text-sm font-semibold text-[var(--color-cream)]">Recent Sessions</h2>
					<div class="space-y-1">
						{#each data.recentSessions as s (s.id)}
							<div class="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-[var(--color-surface)]">
								<div class="min-w-0">
									<p class="truncate text-sm text-[var(--color-cream)]">Book {s.bookId}</p>
									<p class="text-[10px] text-[var(--color-faint)]">{formatSessionDate(s.startedAt)}</p>
								</div>
								<div class="flex items-center gap-3 text-xs text-[var(--color-muted)]">
									<span class="font-mono">{formatSessionDuration(s.durationSeconds)}</span>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		</div>

		<!-- Sidebar: Goal -->
		<div>
			<section class="rounded-2xl bg-[var(--color-raised)] p-5">
				<h2 class="mb-4 text-sm font-semibold text-[var(--color-cream)]">Reading Goal</h2>

				{#if currentYearGoal}
					<!-- Progress ring -->
					<div class="flex flex-col items-center">
						<div class="relative">
							<svg width="140" height="140" viewBox="0 0 140 140">
								<circle
									cx="70" cy="70" r={ringRadius}
									fill="none" stroke="var(--color-surface)" stroke-width="8"
								/>
								<circle
									cx="70" cy="70" r={ringRadius}
									fill="none" stroke="var(--color-accent)" stroke-width="8"
									stroke-linecap="round"
									stroke-dasharray={ringCircumference}
									stroke-dashoffset={ringOffset}
									transform="rotate(-90 70 70)"
									class="transition-all duration-1000 ease-out"
								/>
							</svg>
							<div class="absolute inset-0 flex flex-col items-center justify-center">
								<span class="font-[var(--font-display)] text-2xl font-bold text-[var(--color-cream)]">{data.booksFinished}</span>
								<span class="text-[10px] text-[var(--color-muted)]">of {currentYearGoal.targetBooks}</span>
							</div>
						</div>
						<p class="mt-3 text-xs text-[var(--color-muted)]">
							{Math.round(goalProgress * 100)}% complete · {new Date().getFullYear()}
						</p>
					</div>
				{:else}
					<!-- Set goal form -->
					<div class="flex flex-col items-center gap-4">
						<p class="text-center text-sm text-[var(--color-muted)]">Set a yearly reading goal to track your progress.</p>
						<div class="flex items-center gap-2">
							<button
								onclick={() => goalTarget = Math.max(1, goalTarget - 1)}
								class="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
							>-</button>
							<span class="w-12 text-center font-[var(--font-display)] text-2xl font-bold text-[var(--color-cream)]">{goalTarget}</span>
							<button
								onclick={() => goalTarget++}
								class="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
							>+</button>
						</div>
						<p class="text-xs text-[var(--color-faint)]">books in {new Date().getFullYear()}</p>
						<button
							onclick={setGoal}
							disabled={settingGoal}
							class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-void)] transition-colors hover:bg-[var(--color-accent-light)] disabled:opacity-50"
						>
							{settingGoal ? 'Saving...' : 'Set Goal'}
						</button>
					</div>
				{/if}
			</section>

			<!-- Time spent card -->
			<div class="mt-4 rounded-2xl bg-[var(--color-raised)] p-5">
				<h2 class="mb-2 text-sm font-semibold text-[var(--color-cream)]">Time Spent Reading</h2>
				<p class="font-[var(--font-display)] text-2xl font-bold text-[var(--color-accent)]">{formatDuration(data.totalReadingMinutes)}</p>
				<p class="text-[10px] text-[var(--color-faint)]">total across {data.sessionCount} sessions</p>
			</div>

			<!-- Links -->
			<div class="mt-4 space-y-2">
				<a href="/books/notes" class="flex items-center gap-2 rounded-xl bg-[var(--color-raised)] p-4 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-cream)]">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
					</svg>
					View Notes & Highlights
				</a>
				<a href="/books" class="flex items-center gap-2 rounded-xl bg-[var(--color-raised)] p-4 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-cream)]">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M4 4h8a2 2 0 0 1 2 2v14H4V4z"/><path d="M14 6h4a2 2 0 0 1 2 2v12h-6"/>
					</svg>
					Browse Library
				</a>
			</div>
		</div>
	</div>
</div>

<style>
	@keyframes bar-grow {
		from { height: 0%; }
	}
</style>
