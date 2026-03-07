<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { UnifiedMedia } from '$lib/adapters/types';
	import {
		ArrowLeft, Maximize, Minimize, ZoomIn, ZoomOut, ChevronDown
	} from 'lucide-svelte';

	interface Props {
		fileUrl: string;
		book: UnifiedMedia;
		serviceId: string;
		format: string;
		initialProgress?: number;
		availableFormats?: string[];
	}

	let {
		fileUrl,
		book,
		serviceId,
		format,
		initialProgress = 0,
		availableFormats = []
	}: Props = $props();

	let showToolbar = $state(true);
	let isFullscreen = $state(false);
	let showFormatMenu = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	function closeReader() {
		goto(`/media/book/${book.sourceId}?service=${serviceId}`);
	}

	function toggleFullscreen() {
		if (!browser) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			document.documentElement.requestFullscreen();
		}
	}

	function switchFormat(fmt: string) {
		showFormatMenu = false;
		goto(`/books/read/${book.sourceId}?service=${serviceId}&format=${fmt}`, { replaceState: true });
	}

	function resetHideTimer() {
		showToolbar = true;
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => { showToolbar = false; }, 4000);
	}

	function handleKeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				if (showFormatMenu) { showFormatMenu = false; }
				else closeReader();
				break;
			case 'f':
				if (!e.ctrlKey && !e.metaKey) toggleFullscreen();
				break;
		}
	}

	$effect(() => {
		if (!browser) return;
		const handleFs = () => { isFullscreen = !!document.fullscreenElement; };
		document.addEventListener('fullscreenchange', handleFs);
		return () => document.removeEventListener('fullscreenchange', handleFs);
	});

	const formatLabel = $derived(format.toUpperCase());
	const otherFormats = $derived(availableFormats.filter(f => f !== format));
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Top Toolbar -->
<div
	class="fixed inset-x-0 top-0 z-[60] flex items-center gap-3 px-4 py-3 transition-all duration-300"
	class:opacity-0={!showToolbar}
	class:pointer-events-none={!showToolbar}
	class:-translate-y-full={!showToolbar}
	style="background: rgba(13, 11, 10, 0.85); backdrop-filter: blur(20px) saturate(1.3);"
>
	<button onclick={closeReader} class="rounded-lg p-2 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-cream)]/[0.06] hover:text-[var(--color-cream)]" title="Back (Esc)">
		<ArrowLeft size={20} strokeWidth={1.5} />
	</button>

	<div class="min-w-0 flex-1">
		<div class="truncate text-sm font-medium text-[var(--color-cream)]">{book.title}</div>
		<div class="text-xs text-[var(--color-faint)]">Reading as {formatLabel}</div>
	</div>

	<div class="flex items-center gap-1">
		<!-- Format switcher -->
		{#if otherFormats.length > 0}
			<div class="relative">
				<button
					onclick={() => showFormatMenu = !showFormatMenu}
					class="flex items-center gap-1 rounded-lg border border-[var(--color-cream)]/[0.08] px-2.5 py-1.5 text-xs text-[var(--color-muted)] transition-colors hover:bg-[var(--color-cream)]/[0.06] hover:text-[var(--color-cream)]"
				>
					{formatLabel}
					<ChevronDown size={12} />
				</button>
				{#if showFormatMenu}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="absolute right-0 top-full mt-1 min-w-[120px] overflow-hidden rounded-lg border border-[var(--color-cream)]/[0.08] py-1"
						style="background: rgba(13, 11, 10, 0.95); backdrop-filter: blur(20px);"
					>
						{#each availableFormats as fmt}
							<button
								class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors {fmt === format ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/[0.08]' : 'text-[var(--color-muted)] hover:bg-[var(--color-cream)]/[0.04] hover:text-[var(--color-cream)]'}"
								onclick={() => switchFormat(fmt)}
							>
								{fmt.toUpperCase()}
								{#if fmt === 'epub'}<span class="text-[var(--color-faint)]">(reader)</span>{/if}
								{#if fmt === 'pdf'}<span class="text-[var(--color-faint)]">(viewer)</span>{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<button onclick={toggleFullscreen} class="rounded-lg p-2 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-cream)]/[0.06] hover:text-[var(--color-cream)]" title="Fullscreen (F)">
			{#if isFullscreen}
				<Minimize size={18} strokeWidth={1.5} />
			{:else}
				<Maximize size={18} strokeWidth={1.5} />
			{/if}
		</button>
	</div>
</div>

<!-- PDF/Document Viewer -->
<div
	class="h-full w-full pt-0"
	onmousemove={resetHideTimer}
	role="presentation"
>
	{#if format === 'pdf'}
		<iframe
			src={fileUrl}
			class="h-full w-full border-none"
			title="PDF Reader — {book.title}"
			style="background: #525659;"
		></iframe>
	{:else}
		<!-- CBZ, MOBI, etc — show download prompt since browser can't natively render -->
		<div class="flex h-full items-center justify-center">
			<div class="text-center">
				<div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--color-surface)]">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" stroke-width="1.5" stroke-linecap="round">
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
						<polyline points="14 2 14 8 20 8"/>
					</svg>
				</div>
				<p class="mb-2 text-lg font-medium text-[var(--color-cream)]">{formatLabel} format</p>
				<p class="mb-6 text-sm text-[var(--color-muted)]">This format can't be read in-browser. Download to read in your preferred app.</p>
				<a
					href={fileUrl}
					download
					class="inline-flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-6 py-3 text-sm font-medium text-[var(--color-void)] transition-colors hover:bg-[var(--color-accent-light)]"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
						<polyline points="7 10 12 15 17 10"/>
						<line x1="12" y1="15" x2="12" y2="3"/>
					</svg>
					Download {formatLabel}
				</a>
				{#if availableFormats.includes('epub')}
					<p class="mt-4">
						<button
							onclick={() => switchFormat('epub')}
							class="text-sm text-[var(--color-accent)] hover:underline"
						>
							Read as EPUB instead
						</button>
					</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Click outside to close format menu -->
{#if showFormatMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[59]" onclick={() => showFormatMenu = false}></div>
{/if}
