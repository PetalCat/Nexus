<script lang="ts">
	import { ArrowUpDown, Check } from 'lucide-svelte';
	import type { Component } from 'svelte';

	interface SortOption {
		value: string;
		label: string;
	}

	interface Props {
		value: string;
		options: SortOption[];
		icon?: Component<any>;
		onchange?: (value: string) => void;
	}

	let { value = $bindable(), options, icon, onchange }: Props = $props();

	const Icon = $derived(icon ?? ArrowUpDown);

	let open = $state(false);
	let containerEl: HTMLDivElement | undefined = $state();

	const currentLabel = $derived(options.find((o) => o.value === value)?.label ?? 'Sort');

	function select(optionValue: string) {
		value = optionValue;
		onchange?.(optionValue);
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}

	function handleClickOutside(e: MouseEvent) {
		if (containerEl && !containerEl.contains(e.target as Node)) {
			open = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="relative" bind:this={containerEl}>
	<button
		onclick={() => (open = !open)}
		class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-300
			{open
			? 'bg-warm/20 text-warm-light'
			: 'bg-cream/[0.04] text-muted hover:bg-cream/[0.08] hover:text-cream/80'}"
		aria-haspopup="listbox"
		aria-expanded={open}
	>
		<Icon size={12} strokeWidth={1.5} />
		{currentLabel}
	</button>

	{#if open}
		<div
			class="absolute right-0 top-full z-50 mt-1.5 min-w-[160px] overflow-hidden rounded-xl border border-cream/[0.06] bg-nexus-raised shadow-xl shadow-nexus-void/50"
			role="listbox"
		>
			{#each options as option}
				<button
					onclick={() => select(option.value)}
					class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors
						{option.value === value
						? 'bg-warm/10 text-warm-light'
						: 'text-muted hover:bg-cream/[0.04] hover:text-cream'}"
					role="option"
					aria-selected={option.value === value}
				>
					<span class="flex-1">{option.label}</span>
					{#if option.value === value}
						<Check size={12} strokeWidth={2} class="text-warm-light" />
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
