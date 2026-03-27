<script lang="ts">
	interface Props {
		booksThisYear: number;
		pagesThisMonth: number;
		currentStreak: number;
	}

	let { booksThisYear, pagesThisMonth, currentStreak }: Props = $props();
</script>

<div class="stats-card">
	<div class="stat">
		<span class="stat-value">{booksThisYear}</span>
		<span class="stat-label">books this year</span>
	</div>
	<div class="separator"></div>
	<div class="stat">
		<span class="stat-value">{pagesThisMonth}</span>
		<span class="stat-label">pages this month</span>
	</div>
	<div class="separator"></div>
	<div class="stat">
		<span class="stat-value">{currentStreak}</span>
		<span class="stat-label">day streak</span>
	</div>
</div>

<style>
	.stats-card {
		display: flex;
		align-items: center;
		gap: 0;
		background: var(--color-surface);
		border: 1px solid rgba(240, 235, 227, 0.06);
		border-radius: 12px;
		padding: 16px 24px;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: 1;
		gap: 2px;
	}

	.stat-value {
		color: var(--color-accent);
		font-weight: 700;
		font-family: var(--font-body);
		font-size: 20px;
		line-height: 1.2;
	}

	.stat-label {
		color: var(--color-muted);
		font-size: 11px;
		line-height: 1.3;
	}

	.separator {
		width: 1px;
		height: 28px;
		background: rgba(240, 235, 227, 0.08);
		flex-shrink: 0;
	}
</style>
