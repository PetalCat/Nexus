<script lang="ts">
	import { Copy, Check, Disc } from 'lucide-svelte';
	import type { RomMetadata } from '$lib/types/media-ui';

	interface Props {
		metadata: RomMetadata | null;
	}

	let { metadata }: Props = $props();

	let hashCopied = $state(false);

	async function copyHash() {
		if (!metadata) return;
		await navigator.clipboard.writeText(metadata.hash);
		hashCopied = true;
		setTimeout(() => (hashCopied = false), 2000);
	}

	const truncatedHash = $derived(
		metadata ? metadata.hash.slice(0, 16) + '...' : ''
	);
</script>

{#if metadata}
	<div class="flex flex-col gap-6">
		<!-- File info grid -->
		<div class="grid grid-cols-2 gap-6 sm:grid-cols-4">
			<div>
				<span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">File Name</span>
				<p class="mt-1 break-all text-sm text-cream/90">{metadata.fileName}</p>
			</div>
			<div>
				<span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">File Size</span>
				<p class="mt-1 text-sm text-cream/90">{metadata.fileSize}</p>
			</div>
			<div>
				<span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Region</span>
				<p class="mt-1 text-sm text-cream/90">{metadata.region}</p>
			</div>
			<div>
				<span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Format</span>
				<p class="mt-1 text-sm text-cream/90">{metadata.format}</p>
			</div>
		</div>

		<!-- Hash -->
		<div>
			<span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">MD5 Hash</span>
			<div class="mt-1 flex items-center gap-2">
				<code class="text-sm font-mono text-cream/90">{truncatedHash}</code>
				<button
					onclick={copyHash}
					class="rounded p-1 text-faint transition-colors hover:bg-cream/[0.06] hover:text-cream"
					aria-label="Copy hash"
				>
					{#if hashCopied}
						<Check size={12} strokeWidth={2} class="text-warm-light" />
					{:else}
						<Copy size={12} strokeWidth={1.5} />
					{/if}
				</button>
			</div>
		</div>

		<!-- Multi-disc -->
		{#if metadata.discs && metadata.discs.length > 0}
			<div>
				<div class="mb-3 flex items-center gap-2">
					<div
						class="h-[18px] w-[3px] shrink-0 rounded-full bg-gradient-to-b from-warm to-warm-light"
						aria-hidden="true"
					></div>
					<h3 class="font-display text-base font-bold tracking-wide text-cream/90">Discs</h3>
				</div>
				<div class="flex flex-col gap-2">
					{#each metadata.discs as disc}
						<div class="flex items-center gap-3 rounded-lg border border-cream/[0.06] bg-cream/[0.02] px-3 py-2">
							<Disc size={14} strokeWidth={1.5} class="text-faint" />
							<span class="flex-1 text-sm text-cream/90">{disc.label}</span>
							<span class="text-xs text-faint">{disc.fileName}</span>
							<span class="text-xs text-muted">{disc.fileSize}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="flex flex-col items-center justify-center rounded-xl border border-cream/[0.06] bg-cream/[0.02] py-12 text-center">
		<Disc size={32} strokeWidth={1} class="text-faint/30" />
		<p class="mt-3 text-sm text-muted">No ROM metadata</p>
		<p class="mt-1 text-xs text-faint">File information unavailable</p>
	</div>
{/if}
