<script lang="ts">
	import type { PageData } from './$types';
	import AdminServices from '$lib/components/admin/AdminServices.svelte';

	let { data }: { data: PageData } = $props();
</script>

<AdminServices {data} />
