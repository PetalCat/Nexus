<script lang="ts">
	interface Props {
		achievement: {
			title: string;
			description?: string;
			badge_url?: string;
			points?: number;
		};
		unlocked?: boolean;
	}

	let { achievement, unlocked = true }: Props = $props();
</script>

<div class="ac" class:ac--locked={!unlocked}>
	<div class="ac__badge-wrap">
		{#if achievement.badge_url}
			<img src={achievement.badge_url} alt="" class="ac__badge" loading="lazy" />
		{:else}
			<div class="ac__badge ac__badge--empty">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
					<path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>
				</svg>
			</div>
		{/if}
	</div>

	<div class="ac__info">
		<span class="ac__title">{achievement.title}</span>
		{#if achievement.description}
			<span class="ac__desc">{achievement.description}</span>
		{/if}
	</div>

	{#if achievement.points}
		<span class="ac__points">{achievement.points}</span>
	{/if}
</div>

<style>
	.ac {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-raised);
		border-radius: 10px;
		border: 1px solid rgba(240, 235, 227, 0.04);
		transition: background 0.15s;
	}

	.ac:hover {
		background: var(--color-hover);
	}

	.ac--locked {
		opacity: 0.5;
	}

	.ac--locked .ac__badge {
		filter: grayscale(1);
	}

	.ac__badge-wrap {
		flex-shrink: 0;
		position: relative;
	}

	.ac:not(.ac--locked) .ac__badge-wrap::after {
		content: '';
		position: absolute;
		inset: -2px;
		border-radius: 10px;
		background: radial-gradient(circle, rgba(245, 158, 11, 0.15) 0%, transparent 70%);
		pointer-events: none;
	}

	.ac__badge {
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 8px;
		object-fit: cover;
		border: 1px solid rgba(240, 235, 227, 0.06);
		position: relative;
	}

	.ac__badge--empty {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface);
		color: var(--color-faint);
	}

	.ac__info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.ac__title {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-cream);
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ac__desc {
		font-size: 0.65rem;
		color: var(--color-muted);
		line-height: 1.3;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.ac__points {
		flex-shrink: 0;
		font-size: 0.65rem;
		font-weight: 700;
		color: #f59e0b;
		background: rgba(245, 158, 11, 0.1);
		padding: 0.2rem 0.45rem;
		border-radius: 4px;
	}
</style>
