<script lang="ts">
	import { goto } from '$app/navigation';

	interface Props {
		compact?: boolean;
	}
	let { compact = false }: Props = $props();

	let query = $state('');
	let inputEl: HTMLInputElement | undefined = $state();

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (query.trim().length >= 2) {
			goto(`/search?q=${encodeURIComponent(query.trim())}`);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			query = '';
			inputEl?.blur();
		}
	}
</script>

<form onsubmit={submit} class="relative {compact ? 'w-48' : 'w-full max-w-xl'}">
	<div class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]">
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
			<circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.5" />
			<path d="M9.5 9.5L12.5 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
		</svg>
	</div>
	<input
		bind:this={inputEl}
		bind:value={query}
		type="search"
		placeholder={compact ? 'Search...' : 'Search movies, shows, books, games...'}
		class="input pl-9 pr-4 {compact ? 'h-8 text-sm' : 'h-10'}"
		onkeydown={handleKeydown}
	/>
	{#if query.length > 0}
		<button
			type="button"
			onclick={() => (query = '')}
			class="btn-icon absolute right-2 top-1/2 -translate-y-1/2 rounded p-1"
		>
			<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
				<path
					d="M1 1L11 11M11 1L1 11"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	{/if}
</form>
