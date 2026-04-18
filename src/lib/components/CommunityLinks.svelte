<script lang="ts">
	interface Props {
		heading?: string;
		compact?: boolean;
		center?: boolean;
	}

	let { heading, compact = false, center = false }: Props = $props();

	const links = [
		{ label: 'GitHub Issues', href: 'https://github.com/PetalCat/Nexus/issues' },
		{ label: 'Discord', href: 'https://discord.gg/AE5uurHzJM' },
		{ label: 'Reddit', href: 'https://reddit.com/r/nexusarr' },
		{ label: 'Matrix', href: 'https://matrix.to/#/%23nexusmedia:beeper.com' }
	];
</script>

<div class={center ? 'text-center' : ''}>
	{#if heading}
		<p class="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint/70">{heading}</p>
	{/if}

	<div class={`flex flex-wrap gap-x-3 gap-y-1.5 ${center ? 'justify-center' : ''} ${compact ? 'text-[11px]' : 'text-xs'}`}>
		{#each links as link (link.href)}
			<a
				href={link.href}
				target="_blank"
				rel="noopener noreferrer"
				class="text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)]"
			>
				{link.label}
			</a>
		{/each}
	</div>
</div>
