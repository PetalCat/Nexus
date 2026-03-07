<script lang="ts">
	interface Achievement {
		title: string;
		description?: string;
		badge_url?: string;
		points?: number;
	}

	interface Props {
		achievements: Achievement[];
		completionPercentage?: number;
	}

	let { achievements, completionPercentage }: Props = $props();

	const total = $derived(achievements.length);
	const unlocked = $derived(
		completionPercentage != null ? Math.round((completionPercentage / 100) * total) : 0
	);
	const totalPoints = $derived(achievements.reduce((sum, a) => sum + (a.points ?? 0), 0));
	const earnedPoints = $derived(
		completionPercentage != null ? Math.round((completionPercentage / 100) * totalPoints) : 0
	);
	const pct = $derived(completionPercentage ?? 0);

	const circumference = 2 * Math.PI * 42;
	const strokeOffset = $derived(circumference - (pct / 100) * circumference);
</script>

<div class="ap">
	<div class="ap__ring-wrap">
		<svg viewBox="0 0 100 100" class="ap__ring">
			<circle
				cx="50" cy="50" r="42"
				fill="none"
				stroke="var(--color-raised)"
				stroke-width="6"
			/>
			<circle
				cx="50" cy="50" r="42"
				fill="none"
				stroke="var(--color-accent)"
				stroke-width="6"
				stroke-linecap="round"
				stroke-dasharray={circumference}
				stroke-dashoffset={strokeOffset}
				transform="rotate(-90 50 50)"
				class="ap__ring-fill"
			/>
		</svg>
		<span class="ap__pct">{pct}%</span>
	</div>

	<div class="ap__stats">
		<span class="ap__stat-main">{unlocked} <span class="ap__stat-dim">of {total} unlocked</span></span>
		{#if totalPoints > 0}
			<span class="ap__stat-pts">{earnedPoints} <span class="ap__stat-dim">/ {totalPoints} pts</span></span>
		{/if}
	</div>
</div>

<style>
	.ap {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		padding: 1rem 1.25rem;
		background: var(--color-raised);
		border-radius: var(--radius-card);
		border: 1px solid rgba(240, 235, 227, 0.04);
	}

	.ap__ring-wrap {
		position: relative;
		width: 5rem;
		height: 5rem;
		flex-shrink: 0;
	}

	.ap__ring {
		width: 100%;
		height: 100%;
	}

	.ap__ring-fill {
		transition: stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.ap__pct {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-size: 1.1rem;
		font-weight: 800;
		color: var(--color-accent);
	}

	.ap__stats {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.ap__stat-main {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-cream);
	}

	.ap__stat-pts {
		font-size: 0.8rem;
		font-weight: 600;
		color: #f59e0b;
	}

	.ap__stat-dim {
		font-weight: 400;
		color: var(--color-muted);
	}
</style>
