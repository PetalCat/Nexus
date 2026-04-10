<script lang="ts">
	interface MissingCategory {
		category: string;
		adapterName: string;
		description: string;
	}

	interface Props {
		missing: MissingCategory[];
	}

	let { missing }: Props = $props();

	let dismissed = $state<Set<string>>(new Set());

	function hide(cat: string) {
		dismissed = new Set([...dismissed, cat]);
	}
</script>

{#each missing as m (m.category)}
	{#if !dismissed.has(m.category)}
		<div class="mx-4 mb-4 flex items-center justify-between gap-3 rounded-xl px-4 py-2.5" style="background: rgba(124,108,248,0.06); border: 1px solid rgba(124,108,248,0.12)">
			<p class="text-xs text-[var(--color-muted)]">
				{m.description} —
				<a href="/admin/services" class="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline">
					Connect {m.adapterName}
				</a>
			</p>
			<button
				onclick={() => hide(m.category)}
				class="flex-shrink-0 rounded-md p-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-cream)]"
				aria-label="Dismiss"
			>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
					<path d="M2 2l8 8M10 2l-8 8" />
				</svg>
			</button>
		</div>
	{/if}
{/each}
