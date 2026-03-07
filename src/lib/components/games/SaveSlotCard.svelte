<script lang="ts">
	import { Download, Trash2, Zap, RotateCcw, Check } from 'lucide-svelte';
	import type { SaveState } from '$lib/types/media-ui';

	interface Props {
		save: SaveState;
		selectable?: boolean;
		selected?: boolean;
		ontoggle?: (id: string) => void;
	}

	let { save, selectable = false, selected = false, ontoggle }: Props = $props();

	const timeAgo = $derived(() => {
		const now = new Date();
		const then = new Date(save.timestamp);
		const diffMs = now.getTime() - then.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);
		if (diffDays > 0) return `${diffDays}d ago`;
		if (diffHours > 0) return `${diffHours}h ago`;
		return `${diffMins}m ago`;
	});

	const typeBadge = $derived(
		save.type === 'state'
			? { label: 'STATE', bg: 'bg-warm/20 text-warm-light' }
			: { label: 'SRAM', bg: 'bg-accent/20 text-accent' }
	);

	const slotLabel = $derived(
		save.isQuickSave ? 'Quick Save' : save.isAutoSave ? 'Auto Save' : `Slot ${save.slot}`
	);
</script>

<div
	class="group/save relative flex flex-col overflow-hidden rounded-xl border transition-all duration-300 hover:bg-cream/[0.04]
		{selected ? 'border-warm/40 bg-warm/[0.04]' : 'border-cream/[0.06] bg-cream/[0.02] hover:border-cream/[0.12]'}"
	onclick={() => selectable && ontoggle?.(save.id)}
	role={selectable ? 'checkbox' : undefined}
	aria-checked={selectable ? selected : undefined}
	class:cursor-pointer={selectable}
>
	<!-- Selection checkbox -->
	{#if selectable}
		<div class="absolute right-2 top-2 z-20">
			<div
				class="flex h-5 w-5 items-center justify-center rounded border transition-all duration-200
					{selected
					? 'border-warm bg-warm text-cream'
					: 'border-cream/20 bg-cream/[0.06]'}"
			>
				{#if selected}
					<Check size={12} strokeWidth={3} />
				{/if}
			</div>
		</div>
	{/if}
	<!-- Screenshot / Thumbnail -->
	<div class="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-warm/10 to-nexus-deep">
		{#if save.screenshot}
			<img
				src={save.screenshot}
				alt="{save.label} screenshot"
				class="h-full w-full object-cover transition-transform duration-500 group-hover/save:scale-105"
				loading="lazy"
			/>
			<div
				class="pointer-events-none absolute inset-0 bg-gradient-to-t from-nexus-void/60 to-transparent"
			></div>
		{:else}
			<div class="flex h-full w-full items-center justify-center">
				<div class="flex flex-col items-center gap-1.5 text-faint/30">
					{#if save.isQuickSave}
						<Zap size={24} strokeWidth={1.5} />
					{:else if save.isAutoSave}
						<RotateCcw size={24} strokeWidth={1.5} />
					{:else}
						<div class="font-display text-2xl font-bold">{save.slot}</div>
					{/if}
					<span class="text-[10px] uppercase tracking-widest">No Preview</span>
				</div>
			</div>
		{/if}

		<!-- Quick/Auto badge overlay -->
		{#if save.isQuickSave || save.isAutoSave}
			<div class="absolute left-2 top-2">
				<span class="inline-flex items-center gap-1 rounded bg-nexus-void/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cream/70 backdrop-blur-sm">
					{#if save.isQuickSave}
						<Zap size={9} strokeWidth={2} />
						Quick
					{:else}
						<RotateCcw size={9} strokeWidth={2} />
						Auto
					{/if}
				</span>
			</div>
		{/if}
	</div>

	<!-- Info -->
	<div class="flex flex-1 flex-col gap-2 p-3">
		<!-- Badge row -->
		<div class="flex items-center gap-2">
			<span class="text-[10px] font-semibold uppercase tracking-wider text-muted">{slotLabel}</span>
			<span class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider {typeBadge.bg}">
				{typeBadge.label}
			</span>
		</div>

		<!-- Label -->
		<p class="line-clamp-1 text-sm font-medium text-cream/90">{save.label}</p>

		<!-- Timestamp & size -->
		<div class="flex items-center gap-2 text-[11px] text-faint">
			<span>{timeAgo()}</span>
			<span class="text-cream/10">·</span>
			<span>{save.fileSize}</span>
		</div>

		<!-- Actions -->
		<div class="mt-auto flex items-center gap-1 pt-1">
			<button
				onclick={() => console.log('Download save:', save.id)}
				class="rounded-lg p-1.5 text-faint transition-colors hover:bg-cream/[0.06] hover:text-cream"
				aria-label="Download {save.label}"
			>
				<Download size={14} strokeWidth={1.5} />
			</button>
			<button
				onclick={() => console.log('Delete save:', save.id)}
				class="rounded-lg p-1.5 text-faint transition-colors hover:bg-warm/10 hover:text-warm-light"
				aria-label="Delete {save.label}"
			>
				<Trash2 size={14} strokeWidth={1.5} />
			</button>
		</div>
	</div>
</div>
