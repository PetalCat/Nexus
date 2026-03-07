<script lang="ts">
	import { X, ListMusic } from 'lucide-svelte';

	let {
		open = false,
		oncreate,
		onclose
	}: {
		open?: boolean;
		oncreate?: (name: string) => void;
		onclose?: () => void;
	} = $props();

	let name = $state('');
	let inputRef = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (open) {
			name = '';
			// Focus after transition
			setTimeout(() => inputRef?.focus(), 100);
		}
	});

	function handleSubmit() {
		const trimmed = name.trim();
		if (!trimmed) return;
		oncreate?.(trimmed);
		onclose?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose?.();
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-nexus-void/70 backdrop-blur-sm animate-fade-in"
		onclick={(e: MouseEvent) => { if (e.target === e.currentTarget) onclose?.(); }}
		onkeydown={handleKeydown}
	>
		<div class="w-full max-w-sm rounded-2xl border border-cream/[0.06] bg-nexus-raised p-6 shadow-2xl animate-fade-in-up">
			<div class="mb-5 flex items-center justify-between">
				<div class="flex items-center gap-2.5">
					<ListMusic size={18} class="text-accent" />
					<h3 class="font-display text-lg font-bold text-cream">New Playlist</h3>
				</div>
				<button
					class="rounded-lg p-1.5 text-faint transition-colors hover:bg-cream/[0.04] hover:text-cream"
					onclick={() => onclose?.()}
				>
					<X size={16} />
				</button>
			</div>

			<form onsubmit={(e: SubmitEvent) => { e.preventDefault(); handleSubmit(); }}>
				<input
					bind:this={inputRef}
					bind:value={name}
					type="text"
					placeholder="Playlist name..."
					class="w-full rounded-xl border border-cream/[0.08] bg-nexus-base px-4 py-3 text-sm text-cream placeholder:text-faint outline-none transition-all focus:border-accent/30 focus:ring-1 focus:ring-accent/20"
					maxlength={50}
				/>

				<div class="mt-5 flex items-center justify-end gap-3">
					<button
						type="button"
						class="rounded-full px-5 py-2 text-sm font-medium text-cream/60 transition-all hover:bg-cream/[0.04] hover:text-cream"
						onclick={() => onclose?.()}
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!name.trim()}
						class="rounded-full bg-accent px-6 py-2 text-sm font-semibold text-nexus-void transition-all hover:bg-accent-light disabled:opacity-40 disabled:cursor-not-allowed"
					>
						Create
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
