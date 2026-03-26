<script lang="ts">
	interface Props {
		y: number;
		visible: boolean;
	}

	let { y, visible }: Props = $props();
</script>

<div
	class="reading-ruler"
	style="top: {y}px; opacity: {visible ? 1 : 0};"
>
	<div class="line"></div>
</div>

<style>
	.reading-ruler {
		position: absolute;
		left: 0;
		right: 0;
		height: 22px;
		background: linear-gradient(
			to bottom,
			transparent,
			rgba(212, 162, 83, 0.06) 30%,
			rgba(212, 162, 83, 0.08) 50%,
			rgba(212, 162, 83, 0.06) 70%,
			transparent
		);
		pointer-events: none;
		transition: top 0.15s ease, opacity 0.2s ease;
	}

	.line {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 1px;
		background: linear-gradient(90deg, transparent, rgba(212, 162, 83, 0.2), transparent);
	}
</style>
