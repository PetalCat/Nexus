<script lang="ts">
	import { getToasts, dismissToast } from '$lib/stores/toast.svelte';
	import { X, CheckCircle, AlertCircle, Info } from 'lucide-svelte';

	const toasts = $derived(getToasts());

	const iconMap = {
		success: CheckCircle,
		error: AlertCircle,
		info: Info
	} as const;
</script>

<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
	{#each toasts as toast (toast.id)}
		{@const Icon = iconMap[toast.type]}
		<div
			class="toast-enter pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-md
				{toast.type === 'success' ? 'border-steel/30 bg-steel/10 text-cream' : ''}
				{toast.type === 'error' ? 'border-warm/30 bg-warm/10 text-cream' : ''}
				{toast.type === 'info' ? 'border-accent/30 bg-accent/10 text-cream' : ''}"
		>
			<span
				class="shrink-0
					{toast.type === 'success' ? 'text-steel-light' : ''}
					{toast.type === 'error' ? 'text-warm-light' : ''}
					{toast.type === 'info' ? 'text-accent-light' : ''}"
			>
				<Icon size={20} />
			</span>

			<span class="flex-1 text-sm leading-snug">{toast.message}</span>

			<button
				onclick={() => dismissToast(toast.id)}
				class="shrink-0 rounded-lg p-1 text-muted transition-colors hover:bg-surface hover:text-cream"
				aria-label="Dismiss"
			>
				<X size={16} />
			</button>
		</div>
	{/each}
</div>

<style>
	@keyframes toast-slide-in {
		from {
			opacity: 0;
			transform: translateY(1rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.toast-enter {
		animation: toast-slide-in 0.3s ease-out forwards;
	}
</style>
