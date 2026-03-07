<script lang="ts">
	import { LayoutGrid, List } from 'lucide-svelte';
	import type { GameViewMode } from '$lib/types/media-ui';

	interface Props {
		value: GameViewMode;
		onchange?: (value: GameViewMode) => void;
	}

	let { value = $bindable('grid'), onchange }: Props = $props();

	function toggle(mode: GameViewMode) {
		value = mode;
		onchange?.(mode);
	}
</script>

<div class="flex rounded-lg border border-cream/[0.06] bg-cream/[0.02]">
	<button
		onclick={() => toggle('grid')}
		class="rounded-l-lg px-2 py-1.5 transition-all duration-300
			{value === 'grid' ? 'bg-warm/20 text-warm-light' : 'text-faint hover:text-muted'}"
		aria-label="Grid view"
		aria-pressed={value === 'grid'}
	>
		<LayoutGrid size={14} strokeWidth={1.5} />
	</button>
	<button
		onclick={() => toggle('list')}
		class="rounded-r-lg px-2 py-1.5 transition-all duration-300
			{value === 'list' ? 'bg-warm/20 text-warm-light' : 'text-faint hover:text-muted'}"
		aria-label="List view"
		aria-pressed={value === 'list'}
	>
		<List size={14} strokeWidth={1.5} />
	</button>
</div>
