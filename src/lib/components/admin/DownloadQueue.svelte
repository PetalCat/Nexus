<script lang="ts">
	let filter: 'all' | 'active' | 'failed' = $state('all');
	let items: any[] = $state([]);
	let fetchCount = $state(0);
	let actionInFlight: string | null = $state(null);

	const loading = $derived(fetchCount === 0);

	async function fetchQueue(currentFilter: string) {
		try {
			const res = await fetch(`/api/admin/downloads?status=${currentFilter}`);
			if (res.ok) items = await res.json();
		} catch {
			// silently retry on next poll
		} finally {
			fetchCount++;
		}
	}

	$effect(() => {
		const currentFilter = filter;
		fetchQueue(currentFilter);
		const interval = setInterval(() => fetchQueue(currentFilter), 10_000);
		return () => clearInterval(interval);
	});

	async function handleAction(serviceId: string, queueId: string, action: 'retry' | 'remove' | 'blocklist') {
		const key = `${serviceId}:${queueId}:${action}`;
		if (actionInFlight) return;
		actionInFlight = key;
		try {
			const res = await fetch(`/api/admin/downloads/${serviceId}/${queueId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action })
			});
			if (res.ok) {
				await fetchQueue(filter);
			}
		} finally {
			actionInFlight = null;
		}
	}

	function statusLabel(status: string, progress: number) {
		if (status === 'downloading') return `${progress}%`;
		if (status === 'queued') return 'Queued';
		if (status === 'failed') return 'Failed';
		if (status === 'paused') return 'Paused';
		if (status === 'warning') return 'Warning';
		if (status === 'completed') return 'Done';
		return status ?? 'Unknown';
	}

	function statusDotColor(status: string) {
		if (status === 'downloading') return 'var(--color-accent, #d4a253)';
		if (status === 'queued') return '#64748b';
		if (status === 'failed') return '#ef4444';
		if (status === 'paused') return '#f59e0b';
		if (status === 'warning') return '#f59e0b';
		if (status === 'completed') return '#34d399';
		return '#64748b';
	}

	function formatEta(eta: string | undefined) {
		if (!eta) return '--';
		const diff = new Date(eta).getTime() - Date.now();
		if (diff <= 0) return 'soon';
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return '<1m';
		if (mins < 60) return `${mins}m`;
		const hrs = Math.floor(mins / 60);
		const rem = mins % 60;
		return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
	}

	function formatSize(bytes: number | undefined) {
		if (!bytes) return '--';
		if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
		if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
		return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
	}

	const filters: { label: string; value: 'all' | 'active' | 'failed' }[] = [
		{ label: 'All', value: 'all' },
		{ label: 'Active', value: 'active' },
		{ label: 'Failed', value: 'failed' }
	];
</script>

<section class="download-queue">
	<div class="dq-header">
		<h2 class="dq-title">
			Downloads
			{#if items.length > 0}
				<span class="dq-count">{items.length}</span>
			{/if}
		</h2>
		<div class="dq-filters">
			{#each filters as f (f.value)}
				<button
					class="dq-filter-btn"
					class:active={filter === f.value}
					onclick={() => filter = f.value}
				>
					{f.label}
				</button>
			{/each}
		</div>
	</div>

	{#if loading && items.length === 0}
		<div class="dq-empty">
			<p>Loading downloads...</p>
		</div>
	{:else if items.length === 0}
		<div class="dq-empty">
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" class="dq-empty-icon">
				<path d="M12 5v14M5 12l7 7 7-7" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
			<p>No active downloads</p>
		</div>
	{:else}
		<div class="dq-table-wrap">
			<table class="dq-table">
				<thead>
					<tr>
						<th class="col-title">Title</th>
						<th class="col-service">Service</th>
						<th class="col-quality">Quality</th>
						<th class="col-progress">Progress</th>
						<th class="col-eta">ETA</th>
						<th class="col-status">Status</th>
						<th class="col-actions">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each items as item (item.metadata?.queueId ?? item.id)}
						{@const meta = item.metadata ?? {}}
						{@const isFailed = meta.queueStatus === 'failed'}
						{@const progress = meta.downloadProgress ?? 0}
						<tr class:failed={isFailed}>
							<td class="col-title">
								<div class="title-cell">
									<span class="title-text">{item.title ?? 'Unknown'}</span>
									{#if meta.errorMessage}
										<span class="error-msg">{meta.errorMessage}</span>
									{/if}
								</div>
							</td>
							<td class="col-service">
								<span class="service-name">{meta.serviceName ?? '--'}</span>
							</td>
							<td class="col-quality">
								<span class="quality-text">{meta.quality ?? '--'}</span>
							</td>
							<td class="col-progress">
								<div class="progress-cell">
									<div class="progress-track">
										<div
											class="progress-fill"
											class:progress-failed={isFailed}
											style:width="{progress}%"
										></div>
									</div>
									<span class="progress-size">{formatSize(meta.sizeBytes)}</span>
								</div>
							</td>
							<td class="col-eta">
								<span class="eta-text">{formatEta(meta.eta)}</span>
							</td>
							<td class="col-status">
								<div class="status-cell">
									<span class="status-dot" style:background={statusDotColor(meta.queueStatus)}></span>
									<span class="status-text">{statusLabel(meta.queueStatus, progress)}</span>
								</div>
							</td>
							<td class="col-actions">
								<div class="action-btns">
									{#if isFailed}
										<button
											class="action-btn"
											disabled={actionInFlight !== null}
											onclick={() => handleAction(meta.serviceId, meta.queueId, 'retry')}
										>Retry</button>
										<button
											class="action-btn action-btn-danger"
											disabled={actionInFlight !== null}
											onclick={() => handleAction(meta.serviceId, meta.queueId, 'blocklist')}
										>Block</button>
									{:else}
										<button
											class="action-btn"
											disabled={actionInFlight !== null}
											onclick={() => handleAction(meta.serviceId, meta.queueId, 'remove')}
										>Remove</button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.download-queue {
		margin-bottom: 2rem;
	}

	.dq-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.dq-title {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-muted);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.dq-count {
		font-size: 0.65rem;
		font-weight: 500;
		color: var(--color-muted);
		opacity: 0.7;
	}

	.dq-filters {
		display: flex;
		gap: 2px;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 8px;
		padding: 2px;
	}

	.dq-filter-btn {
		padding: 4px 12px;
		font-size: 0.65rem;
		font-weight: 500;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.dq-filter-btn:hover {
		color: var(--color-cream, #f5f0e8);
	}

	.dq-filter-btn.active {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-cream, #f5f0e8);
	}

	.dq-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 1rem;
		text-align: center;
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
	}

	.dq-empty-icon {
		opacity: 0.2;
		margin-bottom: 0.75rem;
	}

	.dq-empty p {
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	.dq-table-wrap {
		border: 1px solid rgba(255, 255, 255, 0.07);
		border-radius: 16px;
		overflow: hidden;
		overflow-x: auto;
	}

	.dq-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
	}

	.dq-table thead th {
		padding: 0.625rem 0.75rem;
		text-align: left;
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-muted);
		background: rgba(255, 255, 255, 0.02);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		white-space: nowrap;
	}

	.dq-table tbody tr {
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		transition: background 0.15s;
	}

	.dq-table tbody tr:last-child {
		border-bottom: none;
	}

	.dq-table tbody tr:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.dq-table tbody tr.failed {
		border-left: 3px solid #ef4444;
	}

	.dq-table tbody td {
		padding: 0.625rem 0.75rem;
		vertical-align: middle;
		white-space: nowrap;
	}

	.col-title {
		min-width: 180px;
		max-width: 280px;
	}

	.title-cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.title-text {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
		max-width: 260px;
	}

	.error-msg {
		font-size: 0.6rem;
		color: #ef4444;
		opacity: 0.85;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
		max-width: 260px;
	}

	.col-service {
		min-width: 80px;
	}

	.service-name {
		color: var(--color-muted);
	}

	.col-quality {
		min-width: 70px;
	}

	.quality-text {
		color: var(--color-muted);
		font-size: 0.65rem;
	}

	.col-progress {
		min-width: 120px;
	}

	.progress-cell {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.progress-track {
		width: 100%;
		height: 4px;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		border-radius: 2px;
		background: var(--color-accent, #d4a253);
		transition: width 0.3s ease;
	}

	.progress-fill.progress-failed {
		background: #ef4444;
	}

	.progress-size {
		font-size: 0.6rem;
		color: var(--color-muted);
		opacity: 0.7;
	}

	.col-eta {
		min-width: 60px;
	}

	.eta-text {
		color: var(--color-muted);
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
	}

	.col-status {
		min-width: 80px;
	}

	.status-cell {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.status-text {
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
	}

	.col-actions {
		min-width: 100px;
		text-align: right;
	}

	.action-btns {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
	}

	.action-btn {
		padding: 3px 10px;
		font-size: 0.6rem;
		font-weight: 500;
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.15);
		background: transparent;
		color: var(--color-cream, #f5f0e8);
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.action-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(255, 255, 255, 0.25);
	}

	.action-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.action-btn-danger {
		border-color: rgba(239, 68, 68, 0.3);
		color: #ef4444;
	}

	.action-btn-danger:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.1);
		border-color: rgba(239, 68, 68, 0.5);
	}
</style>
