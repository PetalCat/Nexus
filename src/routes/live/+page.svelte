<script lang="ts">
	import type { PageData } from './$types';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import { SvelteMap } from 'svelte/reactivity';

	let { data }: { data: PageData } = $props();

	// View mode: grid (channel cards) or guide (EPG timeline)
	let viewMode = $state<'grid' | 'guide'>('grid');
	let filter = $state('');
	let selectedProgram = $state<{
		title: string;
		description?: string;
		startDate: string;
		endDate: string;
		channelName: string;
	} | null>(null);

	// Guide scroll container ref
	let guideContainer = $state<HTMLDivElement | null>(null);

	interface GuideProgram {
		title: string;
		description?: string;
		startDate: string;
		endDate: string;
		duration: number;
		genre?: string;
		episodeTitle?: string;
		isLive?: boolean;
		isMovie?: boolean;
		isSeries?: boolean;
	}

	const filtered = $derived(
		filter
			? data.channels.filter((c: UnifiedMedia) =>
					c.title.toLowerCase().includes(filter.toLowerCase())
				)
			: data.channels
	);

	const hasGuide = $derived(data.guide != null && Object.keys(data.guide).length > 0);

	// EPG time calculations
	const PIXELS_PER_MINUTE = 4;
	const HOURS_SHOWN = 4;

	// Round down to the nearest 30-minute mark
	function getTimelineStart(): Date {
		const now = new Date();
		const mins = now.getMinutes();
		now.setMinutes(mins < 30 ? 0 : 30, 0, 0);
		return now;
	}

	const timelineStart = $derived(getTimelineStart());
	const timelineEnd = $derived(new Date(timelineStart.getTime() + HOURS_SHOWN * 3_600_000));
	const totalMinutes = $derived(HOURS_SHOWN * 60);

	// Generate 30-minute time slots
	const timeSlots = $derived.by(() => {
		const slots: Date[] = [];
		const start = timelineStart;
		for (let i = 0; i < HOURS_SHOWN * 2; i++) {
			slots.push(new Date(start.getTime() + i * 30 * 60_000));
		}
		return slots;
	});

	// Current time position in pixels from timeline start
	const nowOffset = $derived.by(() => {
		const now = new Date();
		const diffMs = now.getTime() - timelineStart.getTime();
		return Math.max(0, (diffMs / 60_000) * PIXELS_PER_MINUTE);
	});

	// Map channels to their guide programs. Keyed by composite `channel.id`
	// (`${serviceId}:${sourceId}`) so channels from different servers don't
	// collide (HDHomeRun-style integer channel IDs are not globally unique).
	const channelGuide = $derived.by(() => {
		if (!data.guide) return new SvelteMap<string, GuideProgram[]>();
		const map = new SvelteMap<string, GuideProgram[]>();
		for (const channel of data.channels) {
			const programs: GuideProgram[] = data.guide[channel.id] ?? [];
			map.set(channel.id, programs);
		}
		return map;
	});

	function formatTime(dateStr: string): string {
		return new Date(dateStr).toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});
	}

	function formatSlotTime(date: Date): string {
		return date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});
	}

	function getProgramStyle(program: GuideProgram): string {
		const start = new Date(program.startDate);
		const end = new Date(program.endDate);
		// Clamp to timeline bounds
		const clampedStart = Math.max(start.getTime(), timelineStart.getTime());
		const clampedEnd = Math.min(end.getTime(), timelineEnd.getTime());
		const leftMin = (clampedStart - timelineStart.getTime()) / 60_000;
		const widthMin = (clampedEnd - clampedStart) / 60_000;
		if (widthMin <= 0) return 'display:none';
		return `left:${leftMin * PIXELS_PER_MINUTE}px;width:${widthMin * PIXELS_PER_MINUTE}px`;
	}

	function isCurrentlyAiring(program: GuideProgram): boolean {
		const now = Date.now();
		return new Date(program.startDate).getTime() <= now && new Date(program.endDate).getTime() > now;
	}

	function getCurrentProgram(channel: UnifiedMedia): { title: string; startDate?: string; endDate?: string } | null {
		const cp = channel.metadata?.currentProgram as
			| { title: string; startDate?: string; endDate?: string }
			| undefined;
		return cp ?? null;
	}

	function getStreamUrl(channel: UnifiedMedia): string {
		// Use the channel's own serviceId so multi-server setups route to the
		// correct Jellyfin instance.
		if (channel.serviceId && channel.sourceId) {
			return `/api/stream/${channel.serviceId}/${channel.sourceId}/stream`;
		}
		return channel.actionUrl ?? '#';
	}

	function scrollToNow() {
		if (guideContainer) {
			const scrollTarget = Math.max(0, nowOffset - 200);
			guideContainer.scrollTo({ left: scrollTarget, behavior: 'smooth' });
		}
	}

	// Auto-scroll to current time when switching to guide view
	$effect(() => {
		if (viewMode === 'guide' && guideContainer) {
			// Small delay for DOM to settle
			const id = setTimeout(() => scrollToNow(), 100);
			return () => clearTimeout(id);
		}
	});
</script>

<svelte:head>
	<title>Live TV — Nexus</title>
</svelte:head>

<div class="live-page">
	<!-- Header -->
	<div class="live-header">
		<div class="header-left">
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<rect x="2" y="7" width="20" height="15" rx="2" />
				<path d="M17 2l-5 5-5-5" />
			</svg>
			<h1>Live TV</h1>
			{#if data.channels.length > 0}
				<span class="channel-count">{data.channels.length}</span>
			{/if}
		</div>
		<div class="header-actions">
			{#if data.channels.length > 0}
				<input
					bind:value={filter}
					class="filter-input"
					placeholder="Filter channels..."
					aria-label="Filter channels"
				/>
				{#if hasGuide}
					<div class="view-toggle" role="radiogroup" aria-label="View mode">
						<button
							class="toggle-btn"
							class:active={viewMode === 'grid'}
							onclick={() => (viewMode = 'grid')}
							role="radio"
							aria-checked={viewMode === 'grid'}
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="3" width="7" height="7" />
								<rect x="14" y="3" width="7" height="7" />
								<rect x="3" y="14" width="7" height="7" />
								<rect x="14" y="14" width="7" height="7" />
							</svg>
							Grid
						</button>
						<button
							class="toggle-btn"
							class:active={viewMode === 'guide'}
							onclick={() => (viewMode = 'guide')}
							role="radio"
							aria-checked={viewMode === 'guide'}
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="8" y1="6" x2="21" y2="6" />
								<line x1="8" y1="12" x2="21" y2="12" />
								<line x1="8" y1="18" x2="21" y2="18" />
								<line x1="3" y1="6" x2="3.01" y2="6" />
								<line x1="3" y1="12" x2="3.01" y2="12" />
								<line x1="3" y1="18" x2="3.01" y2="18" />
							</svg>
							Guide
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	{#if data.channels.length === 0}
		<!-- Empty state -->
		<div class="empty-state">
			<div class="empty-icon-wrap">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<rect x="2" y="7" width="20" height="15" rx="2" />
					<path d="M17 2l-5 5-5-5" />
					<circle cx="12" cy="14" r="3" />
				</svg>
				<span class="ping-dot">
					<span class="ping-ring"></span>
					<span class="ping-core"></span>
				</span>
			</div>
			<p class="empty-title">No live channels found</p>
			<p class="empty-sub">Connect a Jellyfin server with Live TV configured to watch live channels here.</p>
			<a href="/settings/accounts" class="btn btn-primary mt-4 text-sm">Manage Services</a>
		</div>
	{:else if viewMode === 'grid'}
		<!-- Grid View -->
		<div class="channel-grid">
			{#each filtered as channel (channel.id)}
				{@const currentProg = getCurrentProgram(channel)}
				<a
					href={getStreamUrl(channel)}
					class="channel-card"
					aria-label="Watch {channel.title}{currentProg ? ` - ${currentProg.title}` : ''}"
				>
					<div class="card-top">
						{#if channel.poster}
							<img
								src={channel.poster}
								alt=""
								class="channel-logo"
								loading="lazy"
								decoding="async"
							/>
						{:else}
							<div class="channel-number">
								{channel.metadata?.channelNumber ?? '?'}
							</div>
						{/if}
						<span class="live-badge">
							<span class="live-dot"></span>
							LIVE
						</span>
					</div>
					<div class="card-body">
						<p class="channel-name">{channel.title}</p>
						{#if currentProg}
							<p class="now-playing">{currentProg.title}</p>
							{#if currentProg.startDate && currentProg.endDate}
								<p class="program-time">
									{formatTime(currentProg.startDate)} – {formatTime(currentProg.endDate)}
								</p>
							{/if}
						{:else}
							<p class="no-program">No program info</p>
						{/if}
					</div>
				</a>
			{/each}
		</div>
		{#if filtered.length === 0 && filter}
			<p class="no-results">No channels matching "{filter}"</p>
		{/if}
	{:else}
		<!-- Guide View (EPG) -->
		<div class="guide-controls">
			<button class="now-btn" onclick={scrollToNow}>
				<span class="now-dot"></span>
				Jump to Now
			</button>
		</div>
		<div class="guide-wrapper">
			<!-- Fixed channel sidebar -->
			<div class="guide-sidebar">
				<div class="sidebar-header">Channel</div>
				{#each filtered as channel (channel.id)}
					<div class="sidebar-channel">
						{#if channel.poster}
							<img src={channel.poster} alt="" class="sidebar-logo" loading="lazy" decoding="async" />
						{:else}
							<span class="sidebar-number">{channel.metadata?.channelNumber ?? '?'}</span>
						{/if}
						<span class="sidebar-name">{channel.title}</span>
					</div>
				{/each}
			</div>

			<!-- Scrollable timeline -->
			<div class="guide-scroll" bind:this={guideContainer}>
				<!-- Time header -->
				<div class="time-header" style="width:{totalMinutes * PIXELS_PER_MINUTE}px">
					{#each timeSlots as slot (slot.getTime())}
						<div class="time-slot" style="width:{30 * PIXELS_PER_MINUTE}px">
							{formatSlotTime(slot)}
						</div>
					{/each}
					<!-- Current time indicator in header -->
					<div class="now-line" style="left:{nowOffset}px" aria-hidden="true"></div>
				</div>

				<!-- Program rows -->
				<div class="program-rows" style="width:{totalMinutes * PIXELS_PER_MINUTE}px">
					{#each filtered as channel (channel.id)}
						{@const programs = channelGuide.get(channel.id) ?? []}
						<div class="program-row">
							{#each programs as program (program.startDate + program.title)}
								{@const airing = isCurrentlyAiring(program)}
								<button
									class="program-block"
									class:airing
									style={getProgramStyle(program)}
									onclick={() => {
										selectedProgram = {
											title: program.episodeTitle
												? `${program.title}: ${program.episodeTitle}`
												: program.title,
											description: program.description,
											startDate: program.startDate,
											endDate: program.endDate,
											channelName: channel.title
										};
									}}
									title="{program.title} ({formatTime(program.startDate)} - {formatTime(program.endDate)})"
								>
									<span class="program-title">{program.title}</span>
									{#if program.episodeTitle}
										<span class="program-episode">{program.episodeTitle}</span>
									{/if}
								</button>
							{/each}
							{#if programs.length === 0}
								<div class="no-data-row">No guide data</div>
							{/if}
						</div>
					{/each}
					<!-- Current time indicator in rows -->
					<div class="now-line now-line-full" style="left:{nowOffset}px" aria-hidden="true"></div>
				</div>
			</div>
		</div>
		{#if filtered.length === 0 && filter}
			<p class="no-results">No channels matching "{filter}"</p>
		{/if}
	{/if}
</div>

<!-- Program detail modal -->
{#if selectedProgram}
	<div
		class="modal-backdrop"
		onclick={() => (selectedProgram = null)}
		onkeydown={(e) => { if (e.key === 'Escape') selectedProgram = null; }}
		role="button"
		tabindex="-1"
		aria-label="Close program details"
	>
		<div
			class="modal-panel"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
			role="dialog"
			aria-modal="true"
			aria-label="Program details"
			tabindex="-1"
		>
			<div class="modal-header">
				<div>
					<p class="modal-channel">{selectedProgram.channelName}</p>
					<h2 class="modal-title">{selectedProgram.title}</h2>
				</div>
				<button class="modal-close" onclick={() => (selectedProgram = null)} aria-label="Close">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>
			<p class="modal-time">
				{formatTime(selectedProgram.startDate)} – {formatTime(selectedProgram.endDate)}
			</p>
			{#if selectedProgram.description}
				<p class="modal-desc">{selectedProgram.description}</p>
			{:else}
				<p class="modal-desc muted">No description available.</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* ---- Layout ---- */
	.live-page {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	/* ---- Header ---- */
	.live-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--color-cream);
	}

	.header-left h1 {
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.channel-count {
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--color-muted);
		background: var(--color-surface);
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.filter-input {
		background: var(--color-surface);
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 8px;
		padding: 0.45rem 0.75rem;
		color: var(--color-cream);
		font-size: 0.85rem;
		width: 11rem;
		outline: none;
		transition: border-color 0.15s ease;
	}

	.filter-input::placeholder {
		color: var(--color-muted);
	}

	.filter-input:focus {
		border-color: var(--color-accent);
	}

	/* ---- View Toggle ---- */
	.view-toggle {
		display: flex;
		gap: 0.25rem;
		background: var(--color-surface);
		border-radius: 8px;
		padding: 0.2rem;
		border: 1px solid rgba(240, 235, 227, 0.06);
	}

	.toggle-btn {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.75rem;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--color-muted);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		min-height: 44px;
	}

	.toggle-btn:hover {
		color: var(--color-cream);
		background: rgba(240, 235, 227, 0.04);
	}

	.toggle-btn.active {
		background: var(--color-accent);
		color: #0a0a0f;
		font-weight: 600;
	}

	/* ---- Empty State ---- */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 6rem 1rem;
		text-align: center;
	}

	.empty-icon-wrap {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 4rem;
		height: 4rem;
		border-radius: 1rem;
		background: var(--color-surface);
		color: var(--color-muted);
		margin-bottom: 1.25rem;
	}

	.ping-dot {
		position: absolute;
		top: -0.25rem;
		right: -0.25rem;
		width: 0.75rem;
		height: 0.75rem;
	}

	.ping-ring {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: var(--color-warm);
		opacity: 0.75;
		animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
	}

	.ping-core {
		position: relative;
		display: block;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--color-warm);
	}

	@keyframes ping {
		75%, 100% { transform: scale(2); opacity: 0; }
	}

	.empty-title {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-cream);
		margin-bottom: 0.5rem;
	}

	.empty-sub {
		font-size: 0.85rem;
		color: var(--color-muted);
		max-width: 28rem;
	}

	/* ---- Grid View ---- */
	.channel-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	@media (min-width: 640px) {
		.channel-grid {
			grid-template-columns: repeat(3, 1fr);
			gap: 1rem;
		}
	}

	@media (min-width: 1024px) {
		.channel-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.channel-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.875rem;
		background: var(--color-surface);
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 12px;
		text-decoration: none;
		color: inherit;
		transition: all 0.2s ease;
		min-height: 44px;
	}

	.channel-card:hover {
		border-color: rgba(212, 162, 83, 0.3);
		background: var(--color-raised);
		transform: translateY(-1px);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
	}

	.card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.channel-logo {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 8px;
		object-fit: contain;
		background: var(--color-raised);
	}

	.channel-number {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 8px;
		background: var(--color-raised);
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-accent);
	}

	.live-badge {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.6rem;
		font-weight: 600;
		color: var(--color-warm);
		letter-spacing: 0.04em;
	}

	.live-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-warm);
		animation: pulse-dot 2s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.card-body {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.channel-name {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-cream);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.now-playing {
		font-size: 0.78rem;
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.program-time {
		font-size: 0.7rem;
		color: var(--color-muted);
		opacity: 0.7;
	}

	.no-program {
		font-size: 0.78rem;
		color: var(--color-muted);
		opacity: 0.5;
		font-style: italic;
	}

	.no-results {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--color-muted);
		font-size: 0.9rem;
	}

	/* ---- Guide View (EPG) ---- */
	.guide-controls {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.now-btn {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.85rem;
		border-radius: 8px;
		border: 1px solid rgba(196, 92, 92, 0.3);
		background: rgba(196, 92, 92, 0.1);
		color: var(--color-warm-light);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		min-height: 44px;
	}

	.now-btn:hover {
		background: rgba(196, 92, 92, 0.2);
		border-color: rgba(196, 92, 92, 0.5);
	}

	.now-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-warm);
	}

	.guide-wrapper {
		display: flex;
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 12px;
		overflow: hidden;
		background: var(--color-surface);
	}

	/* Fixed sidebar */
	.guide-sidebar {
		flex-shrink: 0;
		width: 10rem;
		border-right: 1px solid rgba(240, 235, 227, 0.06);
		background: var(--color-surface);
		z-index: 2;
	}

	.sidebar-header {
		height: 2.5rem;
		display: flex;
		align-items: center;
		padding: 0 0.75rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border-bottom: 1px solid rgba(240, 235, 227, 0.06);
	}

	.sidebar-channel {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 3.5rem;
		padding: 0 0.75rem;
		border-bottom: 1px solid rgba(240, 235, 227, 0.04);
	}

	.sidebar-logo {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 4px;
		object-fit: contain;
		background: var(--color-raised);
		flex-shrink: 0;
	}

	.sidebar-number {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 4px;
		background: var(--color-raised);
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--color-accent);
		flex-shrink: 0;
	}

	.sidebar-name {
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--color-cream);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Scrollable timeline */
	.guide-scroll {
		flex: 1;
		overflow-x: auto;
		overflow-y: hidden;
	}

	.time-header {
		position: relative;
		display: flex;
		height: 2.5rem;
		border-bottom: 1px solid rgba(240, 235, 227, 0.06);
	}

	.time-slot {
		display: flex;
		align-items: center;
		padding: 0 0.5rem;
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--color-muted);
		border-left: 1px solid rgba(240, 235, 227, 0.04);
		flex-shrink: 0;
	}

	.time-slot:first-child {
		border-left: none;
	}

	.program-rows {
		position: relative;
	}

	.program-row {
		position: relative;
		height: 3.5rem;
		border-bottom: 1px solid rgba(240, 235, 227, 0.04);
	}

	.program-block {
		position: absolute;
		top: 0.25rem;
		height: calc(100% - 0.5rem);
		border-radius: 6px;
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.06);
		padding: 0.35rem 0.5rem;
		cursor: pointer;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		justify-content: center;
		transition: all 0.15s ease;
		text-align: left;
		color: inherit;
		font-family: inherit;
	}

	.program-block:hover {
		background: rgba(240, 235, 227, 0.08);
		border-color: rgba(240, 235, 227, 0.12);
		z-index: 1;
	}

	.program-block.airing {
		background: rgba(212, 162, 83, 0.12);
		border-color: rgba(212, 162, 83, 0.25);
	}

	.program-block.airing:hover {
		background: rgba(212, 162, 83, 0.18);
	}

	.program-title {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-cream);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.program-episode {
		font-size: 0.65rem;
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.no-data-row {
		display: flex;
		align-items: center;
		height: 100%;
		padding: 0 0.75rem;
		font-size: 0.72rem;
		color: var(--color-muted);
		opacity: 0.5;
		font-style: italic;
	}

	/* Now indicator (red vertical line) */
	.now-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--color-warm);
		z-index: 3;
		pointer-events: none;
	}

	.now-line::before {
		content: '';
		position: absolute;
		top: -3px;
		left: -3px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-warm);
	}

	.now-line-full {
		top: 0;
		bottom: 0;
	}

	/* ---- Modal ---- */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}

	.modal-panel {
		background: var(--color-surface);
		border: 1px solid rgba(240, 235, 227, 0.08);
		border-radius: 16px;
		padding: 1.5rem;
		max-width: 28rem;
		width: 100%;
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
	}

	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.modal-channel {
		font-size: 0.72rem;
		font-weight: 500;
		color: var(--color-accent);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 0.25rem;
	}

	.modal-title {
		font-size: 1.15rem;
		font-weight: 600;
		color: var(--color-cream);
		line-height: 1.3;
	}

	.modal-close {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 8px;
		border: none;
		background: var(--color-raised);
		color: var(--color-muted);
		cursor: pointer;
		transition: all 0.15s ease;
		min-width: 44px;
		min-height: 44px;
	}

	.modal-close:hover {
		color: var(--color-cream);
		background: rgba(240, 235, 227, 0.08);
	}

	.modal-time {
		font-size: 0.82rem;
		color: var(--color-muted);
		margin-bottom: 0.75rem;
	}

	.modal-desc {
		font-size: 0.85rem;
		color: var(--color-cream);
		line-height: 1.55;
		opacity: 0.9;
	}

	.modal-desc.muted {
		color: var(--color-muted);
		font-style: italic;
		opacity: 0.6;
	}

	/* ---- Responsive ---- */
	@media (max-width: 640px) {
		.live-page {
			padding: 1rem 0.75rem 3rem;
		}

		.live-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.header-actions {
			width: 100%;
			flex-wrap: wrap;
		}

		.filter-input {
			flex: 1;
			min-width: 0;
			width: auto;
		}

		.guide-sidebar {
			width: 7rem;
		}

		.sidebar-logo,
		.sidebar-number {
			display: none;
		}
	}
</style>
