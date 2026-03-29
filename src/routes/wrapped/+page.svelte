<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const year = $derived(data.year);
	const wrapped = $derived(data.wrapped);
	const isEmpty = $derived(!wrapped || wrapped.totalHours === 0);

	const typeColors: Record<string, string> = {
		movie: '#4a9eff',
		show: '#22c55e',
		music: '#a78bfa',
		book: '#f59e0b',
		game: '#ec4899',
		video: '#06b6d4'
	};

	const typeIcons: Record<string, string> = {
		movie: '\u{1F3AC}',
		show: '\u{1F4FA}',
		music: '\u{1F3B5}',
		book: '\u{1F4DA}',
		game: '\u{1F3AE}',
		video: '\u{1F4F9}'
	};

	const milestoneIcons: Record<string, string> = {
		clock: '\u{23F1}',
		film: '\u{1F3AC}',
		fire: '\u{1F525}',
		star: '\u{2B50}'
	};

	const maxTypeHours = $derived.by(() => {
		if (!wrapped) return 0;
		return Math.max(...Object.values(wrapped.byType).map((t) => t.hours), 1);
	});

	const maxGenreHours = $derived.by(() => {
		if (!wrapped) return 0;
		return wrapped.topGenres[0]?.hours ?? 1;
	});

	const maxMonthHours = $derived.by(() => {
		if (!wrapped) return 0;
		return Math.max(...wrapped.monthlyActivity.map((m) => m.hours), 1);
	});

	const monthLabels = [
		'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
		'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
	];

	const monthlyData = $derived.by(() => {
		if (!wrapped) return [];
		const lookup = new Map(wrapped.monthlyActivity.map((m) => [m.month, m.hours]));
		return monthLabels.map((label, i) => {
			const key = `${year}-${String(i + 1).padStart(2, '0')}`;
			return { label, hours: lookup.get(key) ?? 0 };
		});
	});

	let revealedSections = $state<Set<string>>(new Set());

	function observeSection(node: HTMLElement) {
		const id = node.dataset.section ?? '';
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						revealedSections = new Set([...revealedSections, id]);
						observer.unobserve(entry.target);
					}
				}
			},
			{ threshold: 0.2 }
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			}
		};
	}

	function isRevealed(id: string): boolean {
		return revealedSections.has(id);
	}

	function handleYearChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		goto(`/wrapped?year=${target.value}`);
	}

	const availableYears = $derived.by(() => {
		const current = new Date().getFullYear();
		const years: number[] = [];
		for (let y = current; y >= current - 5; y--) {
			years.push(y);
		}
		return years;
	});
</script>

<svelte:head>
	<title>Nexus Wrapped {year}</title>
</svelte:head>

<div class="wrapped-page">
	<div class="year-selector">
		<label for="year-select" class="sr-only">Select year</label>
		<select id="year-select" value={year} onchange={handleYearChange}>
			{#each availableYears as y (y)}
				<option value={y}>{y}</option>
			{/each}
		</select>
	</div>

	{#if isEmpty}
		<div class="empty-state">
			<div class="empty-icon">{'\u{1F4CA}'}</div>
			<h1>No activity recorded for {year}</h1>
			<p>Start watching, listening, or reading to see your annual review here.</p>
		</div>
	{:else if wrapped}
		<!-- Hero -->
		<section
			class="section hero-section"
			class:revealed={isRevealed('hero')}
			data-section="hero"
			use:observeSection
		>
			<div class="hero-bg"></div>
			<div class="hero-content">
				<p class="hero-subtitle">Your</p>
				<h1 class="hero-year">{year}</h1>
				<p class="hero-subtitle">in Media</p>
				<div class="hero-hours">
					<span class="hero-number">{wrapped.totalHours.toLocaleString()}</span>
					<span class="hero-label">hours</span>
				</div>
			</div>
		</section>

		<!-- Milestones -->
		<section
			class="section"
			class:revealed={isRevealed('milestones')}
			data-section="milestones"
			use:observeSection
		>
			<h2 class="section-title">At a Glance</h2>
			<div class="milestones-grid">
				{#each wrapped.milestones as milestone (milestone.label)}
					<div class="milestone-card">
						<span class="milestone-icon">{milestoneIcons[milestone.icon] ?? milestone.icon}</span>
						<span class="milestone-value">{milestone.value}</span>
						<span class="milestone-label">{milestone.label}</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- By Type -->
		<section
			class="section"
			class:revealed={isRevealed('bytype')}
			data-section="bytype"
			use:observeSection
		>
			<h2 class="section-title">By Type</h2>
			<div class="stacked-bar">
				{#each Object.entries(wrapped.byType) as [type, info] (type)}
					<div
						class="stacked-segment"
						style="flex: {info.hours}; background: {typeColors[type] ?? '#888'}"
						title="{type}: {info.hours}h"
					></div>
				{/each}
			</div>
			<div class="type-rows">
				{#each Object.entries(wrapped.byType) as [type, info] (type)}
					<div class="type-row">
						<span class="type-icon" style="color: {typeColors[type] ?? '#888'}"
							>{typeIcons[type] ?? '\u{1F4C1}'}</span
						>
						<span class="type-name">{type}</span>
						<div class="type-bar-wrapper">
							<div
								class="type-bar"
								style="width: {(info.hours / maxTypeHours) * 100}%; background: {typeColors[type] ?? '#888'}"
							></div>
						</div>
						<span class="type-hours">{info.hours}h</span>
						<span class="type-count">{info.count} titles</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- Top 10 -->
		{#if wrapped.topItems.length > 0}
			<section
				class="section"
				class:revealed={isRevealed('top10')}
				data-section="top10"
				use:observeSection
			>
				<h2 class="section-title">Top 10</h2>
				<div class="top-grid">
					{#each wrapped.topItems as item, i (item.title)}
						<div class="top-card">
							<span class="top-rank">#{i + 1}</span>
							<div class="top-info">
								<span class="top-title">{item.title}</span>
								<div class="top-meta">
									<span
										class="top-type-badge"
										style="background: {typeColors[item.type] ?? '#888'}"
										>{item.type}</span
									>
									<span class="top-hours">{item.hours}h</span>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Top Genres -->
		{#if wrapped.topGenres.length > 0}
			<section
				class="section"
				class:revealed={isRevealed('genres')}
				data-section="genres"
				use:observeSection
			>
				<h2 class="section-title">Top Genres</h2>
				<div class="genre-list">
					{#each wrapped.topGenres as genre, i (genre.genre)}
						<div class="genre-row">
							<span class="genre-rank">{i + 1}</span>
							<span class="genre-name">{genre.genre}</span>
							<div class="genre-bar-wrapper">
								<div
									class="genre-bar"
									style="width: {(genre.hours / maxGenreHours) * 100}%"
								></div>
							</div>
							<span class="genre-hours">{genre.hours}h</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Monthly Activity -->
		<section
			class="section"
			class:revealed={isRevealed('monthly')}
			data-section="monthly"
			use:observeSection
		>
			<h2 class="section-title">Monthly Activity</h2>
			<div class="monthly-chart">
				{#each monthlyData as month (month.label)}
					<div class="month-col">
						<div class="month-bar-container">
							<div
								class="month-bar"
								style="height: {month.hours > 0 ? Math.max((month.hours / maxMonthHours) * 100, 2) : 0}%"
							></div>
						</div>
						<span class="month-label">{month.label}</span>
						{#if month.hours > 0}
							<span class="month-hours">{month.hours}h</span>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.wrapped-page {
		min-height: 100vh;
		background: #0a0a0f;
		color: #f5f0e8;
		font-family: 'DM Sans', sans-serif;
		position: relative;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}

	/* Year Selector */
	.year-selector {
		position: fixed;
		top: 1rem;
		right: 1.5rem;
		z-index: 100;
	}

	.year-selector select {
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #f5f0e8;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-size: 0.875rem;
		cursor: pointer;
		backdrop-filter: blur(12px);
		min-height: 44px;
		min-width: 44px;
	}

	.year-selector select:focus-visible {
		outline: 2px solid #d4a253;
		outline-offset: 2px;
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 80vh;
		text-align: center;
		padding: 2rem;
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1.5rem;
		opacity: 0.6;
	}

	.empty-state h1 {
		font-family: 'Playfair Display', serif;
		font-size: 2rem;
		margin-bottom: 0.75rem;
		color: #d4a253;
	}

	.empty-state p {
		color: rgba(245, 240, 232, 0.5);
		font-size: 1.125rem;
	}

	/* Sections */
	.section {
		padding: 4rem 2rem;
		max-width: 900px;
		margin: 0 auto;
		opacity: 0;
		transform: translateY(30px);
		transition:
			opacity 0.8s ease,
			transform 0.8s ease;
	}

	.section.revealed {
		opacity: 1;
		transform: translateY(0);
	}

	.section + .section {
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	.section-title {
		font-family: 'Playfair Display', serif;
		font-size: 1.75rem;
		margin-bottom: 2rem;
		color: rgba(245, 240, 232, 0.8);
		letter-spacing: 0.02em;
	}

	/* Hero */
	.hero-section {
		min-height: 90vh;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		overflow: hidden;
		padding: 4rem 2rem;
	}

	.hero-bg {
		position: absolute;
		inset: 0;
		background: radial-gradient(
				ellipse at 30% 50%,
				rgba(212, 162, 83, 0.12) 0%,
				transparent 60%
			),
			radial-gradient(ellipse at 70% 30%, rgba(74, 158, 255, 0.08) 0%, transparent 50%),
			radial-gradient(ellipse at 50% 80%, rgba(167, 139, 250, 0.06) 0%, transparent 50%);
		animation: heroShift 12s ease-in-out infinite alternate;
	}

	@keyframes heroShift {
		0% {
			filter: hue-rotate(0deg);
		}
		100% {
			filter: hue-rotate(15deg);
		}
	}

	.hero-content {
		position: relative;
		text-align: center;
		z-index: 1;
	}

	.hero-subtitle {
		font-family: 'DM Sans', sans-serif;
		font-size: 1.25rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: rgba(245, 240, 232, 0.5);
	}

	.hero-year {
		font-family: 'Playfair Display', serif;
		font-size: clamp(4rem, 12vw, 8rem);
		font-weight: 700;
		color: #d4a253;
		line-height: 1;
		margin: 0.25rem 0;
	}

	.hero-hours {
		margin-top: 3rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
	}

	.hero-number {
		font-family: 'Playfair Display', serif;
		font-size: clamp(3rem, 8vw, 5rem);
		font-weight: 700;
		color: #d4a253;
		line-height: 1;
	}

	.hero-label {
		font-size: 1.125rem;
		text-transform: uppercase;
		letter-spacing: 0.15em;
		color: rgba(245, 240, 232, 0.4);
	}

	/* Milestones */
	.milestones-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}

	.milestone-card {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 12px;
		padding: 1.5rem 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
	}

	.milestone-icon {
		font-size: 1.75rem;
	}

	.milestone-value {
		font-family: 'Playfair Display', serif;
		font-size: 1.75rem;
		font-weight: 700;
		color: #d4a253;
	}

	.milestone-label {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(245, 240, 232, 0.5);
	}

	/* By Type */
	.stacked-bar {
		display: flex;
		height: 32px;
		border-radius: 8px;
		overflow: hidden;
		margin-bottom: 2rem;
		gap: 2px;
	}

	.stacked-segment {
		min-width: 4px;
		transition: flex 0.6s ease;
	}

	.type-rows {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.type-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.type-icon {
		font-size: 1.25rem;
		width: 2rem;
		text-align: center;
		flex-shrink: 0;
	}

	.type-name {
		width: 4rem;
		text-transform: capitalize;
		font-size: 0.875rem;
		flex-shrink: 0;
	}

	.type-bar-wrapper {
		flex: 1;
		height: 8px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		overflow: hidden;
	}

	.type-bar {
		height: 100%;
		border-radius: 4px;
		transition: width 0.8s ease;
	}

	.type-hours {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8rem;
		color: #d4a253;
		width: 3.5rem;
		text-align: right;
		flex-shrink: 0;
	}

	.type-count {
		font-size: 0.75rem;
		color: rgba(245, 240, 232, 0.4);
		width: 5rem;
		flex-shrink: 0;
	}

	/* Top 10 */
	.top-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	.top-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 10px;
	}

	.top-rank {
		font-family: 'Playfair Display', serif;
		font-size: 1.5rem;
		font-weight: 700;
		color: #d4a253;
		width: 2.5rem;
		flex-shrink: 0;
	}

	.top-info {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	.top-title {
		font-size: 0.95rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.top-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.top-type-badge {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		color: #0a0a0f;
		font-weight: 600;
	}

	.top-hours {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: rgba(245, 240, 232, 0.5);
	}

	/* Genres */
	.genre-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.genre-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.genre-rank {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8rem;
		color: rgba(245, 240, 232, 0.35);
		width: 1.5rem;
		text-align: right;
		flex-shrink: 0;
	}

	.genre-name {
		width: 8rem;
		font-size: 0.9rem;
		flex-shrink: 0;
	}

	.genre-bar-wrapper {
		flex: 1;
		height: 8px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		overflow: hidden;
	}

	.genre-bar {
		height: 100%;
		border-radius: 4px;
		background: #d4a253;
		transition: width 0.8s ease;
	}

	.genre-hours {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8rem;
		color: #d4a253;
		width: 3.5rem;
		text-align: right;
		flex-shrink: 0;
	}

	/* Monthly */
	.monthly-chart {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		height: 220px;
		padding-bottom: 2.5rem;
		position: relative;
	}

	.month-col {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 100%;
		position: relative;
	}

	.month-bar-container {
		flex: 1;
		width: 100%;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.month-bar {
		width: 70%;
		max-width: 40px;
		background: linear-gradient(to top, #d4a253, #e8c97a);
		border-radius: 4px 4px 0 0;
		transition: height 0.8s ease;
		min-width: 8px;
	}

	.month-label {
		position: absolute;
		bottom: 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgba(245, 240, 232, 0.4);
	}

	.month-hours {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6rem;
		color: rgba(245, 240, 232, 0.5);
		position: absolute;
		bottom: 1.2rem;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.section {
			padding: 3rem 1.25rem;
		}

		.milestones-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.top-grid {
			grid-template-columns: 1fr;
		}

		.type-count {
			display: none;
		}

		.genre-name {
			width: 5rem;
		}

		.monthly-chart {
			gap: 0.25rem;
		}

		.month-label {
			font-size: 0.6rem;
		}
	}

	@media (max-width: 480px) {
		.milestones-grid {
			grid-template-columns: 1fr 1fr;
			gap: 0.75rem;
		}

		.milestone-value {
			font-size: 1.35rem;
		}

		.type-name {
			width: 3rem;
			font-size: 0.75rem;
		}

		.genre-name {
			width: 4rem;
			font-size: 0.8rem;
		}
	}
</style>
