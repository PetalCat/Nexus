<script lang="ts">
	let {
		label,
		value,
		subtitle,
		icon
	}: {
		label: string;
		value: string | number;
		subtitle?: string;
		icon?: string;
	} = $props();
</script>

<div class="stat-card">
	{#if icon}
		<span class="stat-icon">{icon}</span>
	{/if}
	<span class="stat-value">{value}</span>
	<span class="stat-label">{label}</span>
	{#if subtitle}
		<span class="stat-subtitle">{subtitle}</span>
	{/if}
</div>

<style>
	.stat-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 1rem 1.5rem;
		border-radius: 1rem;
		background: var(--color-surface);
		border: 1px solid rgba(240,235,227,0.06);
		min-width: 100px;
	}
	.stat-icon {
		font-size: 1.25rem;
		margin-bottom: 0.25rem;
	}
	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-cream);
		line-height: 1;
	}
	.stat-label {
		font-size: 0.625rem;
		font-weight: 500;
		color: var(--color-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-top: 0.15rem;
	}
	.stat-subtitle {
		font-size: 0.625rem;
		color: var(--color-muted);
		opacity: 0.7;
	}
</style>
