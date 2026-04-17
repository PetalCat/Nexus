<script lang="ts">
	import type { PageData } from './$types';
	import type { Component } from 'svelte';

	let { data }: { data: PageData } = $props();

	// Lazy-load only the reader component we actually need for this format.
	// BookReader pulls in foliate-js (EPUB engine); PdfReader pulls in
	// pdfjs-dist (~400 KB). Loading both on every `/books/read/[id]`
	// navigation was a large waste on high-RTT links.
	let Reader = $state<Component<any> | null>(null);
	let loadError = $state<string | null>(null);

	async function loadReader(fmt: string) {
		try {
			if (fmt === 'epub') {
				const mod = await import('$lib/components/books/BookReader.svelte');
				Reader = mod.default as Component<any>;
			} else {
				const mod = await import('$lib/components/books/PdfReader.svelte');
				Reader = mod.default as Component<any>;
			}
		} catch (err) {
			console.warn('[books/read] failed to load reader', err);
			loadError = 'Failed to load reader.';
		}
	}

	// Kick off the reader chunk load once per mount. `data.format` is
	// stable for a given route visit, so this fires exactly once.
	$effect(() => {
		void loadReader(data.format);
	});
</script>

<svelte:head>
	<title>Reading: {data.book.title} — Nexus</title>
</svelte:head>

<div class="fixed inset-0 z-50 bg-[var(--color-void)]">
	{#if loadError}
		<div class="flex h-full items-center justify-center text-sm text-muted">{loadError}</div>
	{:else if Reader}
		{#if data.format === 'epub'}
			<Reader
				epubUrl={data.bookUrl}
				book={data.book}
				serviceId={data.serviceId}
				savedPosition={data.savedPosition}
				initialProgress={data.progress}
				bookmarks={data.bookmarks}
				highlights={data.highlights}
				availableFormats={data.availableFormats}
			/>
		{:else}
			<Reader
				fileUrl={data.bookUrl}
				book={data.book}
				serviceId={data.serviceId}
				format={data.format}
				initialProgress={data.progress}
				savedPosition={data.savedPosition}
				availableFormats={data.availableFormats}
				bookmarks={data.bookmarks}
				highlights={data.highlights}
			/>
		{/if}
	{/if}
</div>
