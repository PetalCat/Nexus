<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from '$lib/stores/toast.svelte';

	interface Props {
		romId: string;
		serviceId: string;
		initialContent?: string;
	}

	let { romId, serviceId, initialContent = '' }: Props = $props();

	let content = $state('');
	$effect(() => { content = initialContent; });
	let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let charCount = $derived(content.length);

	function handleInput() {
		saveStatus = 'idle';
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => save(), 500);
	}

	async function save() {
		saveStatus = 'saving';
		try {
			await fetch(`/api/games/${romId}/notes`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content, serviceId })
			});
			saveStatus = 'saved';
		} catch {
			saveStatus = 'idle';
			toast.error('Failed to save note');
		}
	}

	onMount(() => {
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	});
</script>

<div class="gn">
	<div class="gn__header">
		<span class="gn__label">Notes</span>
		<span class="gn__status">
			{#if saveStatus === 'saving'}
				Saving...
			{:else if saveStatus === 'saved'}
				Saved
			{/if}
		</span>
	</div>
	<textarea
		class="gn__textarea"
		bind:value={content}
		oninput={handleInput}
		placeholder="Add your notes about this game..."
		rows="6"
	></textarea>
	<div class="gn__footer">
		<span class="gn__chars">{charCount} characters</span>
	</div>
</div>

<style>
	.gn {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.gn__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.gn__label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.gn__status {
		font-size: 0.68rem;
		color: var(--color-muted);
		min-height: 1em;
	}

	.gn__textarea {
		width: 100%;
		padding: 0.75rem;
		border-radius: var(--radius-card);
		background: var(--color-raised);
		border: 1px solid rgba(240, 235, 227, 0.06);
		color: var(--color-cream);
		font-family: var(--font-body);
		font-size: 0.8rem;
		line-height: 1.6;
		resize: vertical;
		min-height: 8rem;
		transition: border-color 0.15s;
	}

	.gn__textarea::placeholder {
		color: var(--color-faint);
	}

	.gn__textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.gn__footer {
		display: flex;
		justify-content: flex-end;
	}

	.gn__chars {
		font-size: 0.62rem;
		color: var(--color-faint);
	}
</style>
