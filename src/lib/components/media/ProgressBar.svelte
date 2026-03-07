<script lang="ts">
	interface Props {
		value: number;
		glow?: boolean;
		height?: 'thin' | 'normal';
	}

	let { value, glow = false, height = 'thin' }: Props = $props();

	const percent = $derived(Math.min(100, Math.max(0, value * 100)));
	const heightClass = $derived(height === 'thin' ? 'h-[3px]' : 'h-1.5');
</script>

<div
	class="w-full overflow-hidden bg-cream/[0.06] {heightClass}"
	style="border-radius: 0 0 8px 8px;"
	role="progressbar"
	aria-valuenow={percent}
	aria-valuemin={0}
	aria-valuemax={100}
	aria-label="{Math.round(percent)}% complete"
>
	<div
		class="h-full bg-gradient-to-r from-accent-dim via-accent to-accent-light transition-all duration-700 ease-out-expo"
		class:nexus-progress-glow={glow}
		style="width: {percent}%"
	></div>
</div>
