<script lang="ts">
	import { page } from '$app/stores';
	import { AlertTriangle, Home, ArrowLeft } from 'lucide-svelte';

	const errorConfig = $derived.by(() => {
		const status = $page.status;
		if (status === 404) {
			return {
				title: 'Page not found',
				message: "The page you're looking for doesn't exist or has been moved."
			};
		}
		if (status === 403) {
			return {
				title: 'Access denied',
				message: "You don't have permission to view this page."
			};
		}
		if (status >= 500) {
			return {
				title: 'Something went wrong',
				message: 'An unexpected server error occurred. Please try again later.'
			};
		}
		return {
			title: 'An error occurred',
			message: $page.error?.message ?? 'Something unexpected happened.'
		};
	});
</script>

<svelte:head>
	<title>Error — Nexus</title>
</svelte:head>

<div class="flex min-h-[60vh] flex-col items-center justify-center px-6 py-20 text-center">
	<div class="text-warm mb-6">
		<AlertTriangle size={48} strokeWidth={1.5} />
	</div>

	<p class="mb-2 font-mono text-5xl font-bold text-cream/20">{$page.status}</p>

	<h1 class="mb-3 text-2xl font-semibold text-cream">{errorConfig.title}</h1>

	<p class="mb-10 max-w-md text-sm leading-relaxed text-muted">
		{errorConfig.message}
	</p>

	<div class="flex items-center gap-3">
		<a
			href="/"
			class="inline-flex items-center gap-2 rounded-xl bg-accent/15 px-5 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25"
		>
			<Home size={16} strokeWidth={1.5} />
			Go Home
		</a>
		<button
			onclick={() => history.back()}
			class="inline-flex items-center gap-2 rounded-xl bg-accent/15 px-5 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/25"
		>
			<ArrowLeft size={16} strokeWidth={1.5} />
			Go Back
		</button>
	</div>
</div>
