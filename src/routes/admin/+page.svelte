<script lang="ts">
	import type { PageData } from './$types';
	import AdminOverview from '$lib/components/admin/AdminOverview.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Admin — Nexus</title></svelte:head>
<AdminOverview {data} />
