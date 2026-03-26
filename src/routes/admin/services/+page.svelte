<script lang="ts">
	import type { PageData } from './$types';
	import AdminServices from '$lib/components/admin/AdminServices.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Services — Admin — Nexus</title></svelte:head>
<AdminServices {data} />
