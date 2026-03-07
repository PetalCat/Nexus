<script lang="ts">
	import { Search, X } from 'lucide-svelte';

	interface Props {
		value: string;
		placeholder?: string;
		onchange?: (value: string) => void;
	}

	let { value = $bindable(''), placeholder = 'Search games...', onchange }: Props = $props();

	let inputEl: HTMLInputElement | undefined = $state();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			value = '';
			onchange?.('');
			inputEl?.blur();
		}
	}

	function clear() {
		value = '';
		onchange?.('');
		inputEl?.focus();
	}
</script>

<div class="relative">
	<Search
		size={14}
		strokeWidth={1.5}
		class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
	/>
	<input
		bind:this={inputEl}
		bind:value
		oninput={() => onchange?.(value)}
		onkeydown={handleKeydown}
		type="text"
		{placeholder}
		class="w-full rounded-xl border border-cream/[0.06] bg-cream/[0.03] px-3 py-1.5 pl-8 text-xs text-cream placeholder:text-faint/60 transition-all duration-300 focus:border-warm/30 focus:outline-none focus:ring-1 focus:ring-warm/30"
	/>
	{#if value}
		<button
			onclick={clear}
			class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint transition-colors hover:text-cream"
			aria-label="Clear search"
		>
			<X size={12} strokeWidth={2} />
		</button>
	{/if}
</div>
