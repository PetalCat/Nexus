<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string;
		children: Snippet;
	}

	let { title, subtitle, children }: Props = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-nexus-void px-4 py-12">
	<div class="w-full max-w-md animate-fade-in-up">
		<!-- Logo -->
		<div class="mb-8 text-center">
			<a href="/" class="font-display text-3xl font-bold">
				<span class="font-black italic text-accent">N</span><span class="text-cream/85">exus</span>
			</a>
		</div>

		<!-- Card -->
		<div class="nexus-glass rounded-2xl p-8">
			<h1 class="font-display text-xl font-semibold text-cream">{title}</h1>
			{#if subtitle}
				<p class="mt-1.5 text-sm text-muted">{subtitle}</p>
			{/if}

			<div class="mt-6">
				{@render children()}
			</div>
		</div>
	</div>
</div>
