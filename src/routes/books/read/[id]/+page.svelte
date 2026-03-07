<script lang="ts">
	import type { PageData } from './$types';
	import BookReader from '$lib/components/books/BookReader.svelte';
	import PdfReader from '$lib/components/books/PdfReader.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Reading: {data.book.title} — Nexus</title>
</svelte:head>

<div class="fixed inset-0 z-50 bg-[var(--color-void)]">
	{#if data.format === 'epub'}
		<BookReader
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
		<PdfReader
			fileUrl={data.bookUrl}
			book={data.book}
			serviceId={data.serviceId}
			format={data.format}
			initialProgress={data.progress}
			availableFormats={data.availableFormats}
		/>
	{/if}
</div>
