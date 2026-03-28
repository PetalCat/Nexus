<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Wanted — Nexus</title>
</svelte:head>

<div class="px-4 py-6 sm:px-6">
	<!-- Wanted Albums -->
	<section class="mb-10">
		<h2 class="section-title">Wanted Albums</h2>

		{#if data.wanted.items.length === 0}
			<div class="empty-state">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10"/>
					<path d="M8 15h8M9 9h.01M15 9h.01"/>
				</svg>
				<p>No wanted albums</p>
			</div>
		{:else}
			<div class="item-list">
				{#each data.wanted.items as item (item.albumTitle + item.artistName)}
					<div class="item-row">
						<div class="item-art-placeholder">
							<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="12" r="10"/>
								<circle cx="12" cy="12" r="3"/>
							</svg>
						</div>
						<div class="item-info">
							<span class="item-title">{item.albumTitle}</span>
							<span class="item-artist">{item.artistName}</span>
						</div>
						<span class="badge badge-missing">Missing</span>
					</div>
				{/each}
			</div>

			{#if data.wanted.total > data.wanted.items.length}
				<p class="total-note">Showing {data.wanted.items.length} of {data.wanted.total} wanted albums</p>
			{/if}
		{/if}
	</section>

	<!-- Download Queue -->
	<section>
		<h2 class="section-title">Download Queue</h2>

		{#if data.queue.length === 0}
			<div class="empty-state">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
					<polyline points="7 10 12 15 17 10"/>
					<line x1="12" y1="15" x2="12" y2="3"/>
				</svg>
				<p>Download queue is empty</p>
			</div>
		{:else}
			<div class="item-list">
				{#each data.queue as item (item.albumTitle + item.artistName)}
					<div class="item-row">
						<div class="item-art-placeholder">
							<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="12" r="10"/>
								<circle cx="12" cy="12" r="3"/>
							</svg>
						</div>
						<div class="item-info">
							<span class="item-title">{item.albumTitle}</span>
							<span class="item-artist">{item.artistName}</span>
						</div>
						<div class="queue-status">
							<span class="badge" class:badge-downloading={item.status === 'downloading'} class:badge-queued={item.status !== 'downloading'}>
								{item.status === 'downloading' ? 'Downloading' : 'Queued'}
							</span>
							{#if item.progress > 0}
								<div class="progress-bar">
									<div class="progress-fill" style="width: {item.progress}%"></div>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.section-title {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 600;
		color: var(--color-cream);
		margin-bottom: 14px;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 40px 20px;
		color: var(--color-muted);
		text-align: center;
		font-size: 14px;
	}

	.item-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.item-row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 12px;
		background: var(--color-raised);
		border-radius: 10px;
		transition: background 0.15s ease;
	}

	.item-row:hover {
		background: var(--color-surface);
	}

	.item-art-placeholder {
		width: 56px;
		height: 56px;
		border-radius: 8px;
		background: var(--color-surface);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--color-muted);
	}

	.item-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.item-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-cream);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-artist {
		font-size: 13px;
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 4px 10px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.badge-missing {
		background: rgba(196, 92, 92, 0.15);
		color: #d87474;
	}

	.badge-downloading {
		background: rgba(61, 143, 132, 0.15);
		color: #56a99d;
	}

	.badge-queued {
		background: var(--color-surface);
		color: var(--color-muted);
	}

	.queue-status {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		flex-shrink: 0;
	}

	.progress-bar {
		width: 80px;
		height: 4px;
		background: var(--color-surface);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: #56a99d;
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.total-note {
		text-align: center;
		font-size: 12px;
		color: var(--color-muted);
		margin-top: 12px;
	}
</style>
