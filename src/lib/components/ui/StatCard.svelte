<script lang="ts">
	interface Props {
		label: string;
		value: string | number;
		sublabel?: string;
	}

	let { label, value, sublabel }: Props = $props();
</script>

<div
	class="group rounded-2xl border border-cream/[0.04] bg-nexus-raised/80 px-5 py-5 transition-all duration-500 ease-out-expo hover:border-accent/15 hover:bg-nexus-surface/60 hover:shadow-[0_4px_24px_rgba(212,162,83,0.06)]"
>
	<p class="font-display text-3xl font-black tracking-tight text-cream transition-colors duration-300 group-hover:text-accent">
		{value}
	</p>
	<p class="mt-1.5 font-body text-sm font-medium text-muted">{label}</p>
	{#if sublabel}
		<p class="mt-0.5 text-xs text-faint">{sublabel}</p>
	{/if}
</div>
