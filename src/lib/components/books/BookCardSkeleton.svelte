<div class="skeleton-card">
	<div class="skeleton-cover"></div>
</div>

<style>
	.skeleton-card {
		border-radius: 8px;
		overflow: hidden;
	}
	.skeleton-cover {
		aspect-ratio: 2/3;
		background: var(--color-surface);
		position: relative;
		overflow: hidden;
	}
	.skeleton-cover::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent 0%, rgba(240,235,227,0.04) 50%, transparent 100%);
		animation: shimmer 1.5s infinite;
	}
	@keyframes shimmer {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(100%); }
	}
</style>
