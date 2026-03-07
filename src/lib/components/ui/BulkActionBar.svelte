<script lang="ts">
	import { Download, Trash2, XCircle } from 'lucide-svelte';

	interface Props {
		selectedCount: number;
		ondownload?: () => void;
		ondelete?: () => void;
		ondeselectall?: () => void;
	}

	let { selectedCount, ondownload, ondelete, ondeselectall }: Props = $props();
</script>

{#if selectedCount > 0}
	<div
		class="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center px-4 pb-4 animate-[fade-in-up_0.3s_ease-out]"
	>
		<div
			class="flex items-center gap-3 rounded-2xl border border-cream/[0.08] bg-nexus-raised/90 px-4 py-3 shadow-2xl shadow-nexus-void/60 backdrop-blur-xl"
		>
			<!-- Download -->
			<button
				onclick={() => { console.log('Bulk download', selectedCount, 'saves'); ondownload?.(); }}
				class="flex items-center gap-2 rounded-lg bg-warm/20 px-3 py-1.5 text-xs font-medium text-warm-light transition-colors hover:bg-warm/30"
			>
				<Download size={13} strokeWidth={1.5} />
				Download Selected ({selectedCount})
			</button>

			<!-- Delete -->
			<button
				onclick={() => { console.log('Bulk delete', selectedCount, 'saves'); ondelete?.(); }}
				class="flex items-center gap-2 rounded-lg bg-cream/[0.04] px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-warm/10 hover:text-warm-light"
			>
				<Trash2 size={13} strokeWidth={1.5} />
				Delete Selected ({selectedCount})
			</button>

			<!-- Separator -->
			<div class="h-5 w-px bg-cream/[0.08]" aria-hidden="true"></div>

			<!-- Deselect all -->
			<button
				onclick={ondeselectall}
				class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-faint transition-colors hover:text-cream"
			>
				<XCircle size={13} strokeWidth={1.5} />
				Deselect All
			</button>
		</div>
	</div>
{/if}
