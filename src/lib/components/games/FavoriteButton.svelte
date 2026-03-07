<script lang="ts">
	import { Heart } from 'lucide-svelte';

	interface Props {
		active: boolean;
		size?: 'sm' | 'md';
		onclick?: (e: MouseEvent) => void;
	}

	let { active, size = 'md', onclick }: Props = $props();

	const iconSize = $derived(size === 'sm' ? 14 : 18);
</script>

<button
	{onclick}
	class="transition-all duration-300 active:scale-90
		{active ? 'text-warm animate-reveal' : 'text-faint hover:text-warm/60'}"
	aria-label={active ? 'Remove from favorites' : 'Add to favorites'}
	aria-pressed={active}
>
	<Heart
		size={iconSize}
		strokeWidth={1.5}
		class={active ? 'fill-warm' : ''}
	/>
</button>
