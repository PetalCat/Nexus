<script lang="ts">
	import type { PageData } from './$types';
	import BookReader from '$lib/components/books/BookReader.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Reading: {data.book.title} — Nexus</title>
</svelte:head>

<div class="fixed inset-0 z-50 bg-[var(--color-void)]">
	<BookReader
		epubUrl={data.epubUrl}
		book={data.book}
		serviceId={data.serviceId}
		savedPosition={data.savedPosition}
		initialProgress={data.progress}
		bookmarks={data.bookmarks}
		highlights={data.highlights}
	/>
</div>
