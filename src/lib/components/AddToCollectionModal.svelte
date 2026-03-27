<script lang="ts">
	import { Plus, Check, X } from 'lucide-svelte';

	interface Props {
		open?: boolean;
		mediaId: string;
		serviceId: string;
		mediaType: string;
		mediaTitle: string;
		mediaPoster?: string;
	}

	let {
		open = $bindable(false),
		mediaId,
		serviceId,
		mediaType,
		mediaTitle,
		mediaPoster
	}: Props = $props();

	interface CollectionEntry {
		id: string;
		name: string;
		itemCount: number;
		visibility: string;
		hasItem: boolean;
	}

	let collections = $state<CollectionEntry[]>([]);
	let loading = $state(false);
	let showCreate = $state(false);
	let newName = $state('');
	let creating = $state(false);

	async function loadCollections() {
		loading = true;
		try {
			const res = await fetch('/api/collections');
			if (res.ok) {
				const data = await res.json();
				collections = await Promise.all(
					data.collections.map(async (c: any) => {
						const detailRes = await fetch(`/api/collections/${c.id}`);
						const detail = detailRes.ok ? await detailRes.json() : null;
						const hasItem =
							detail?.collection?.items?.some(
								(i: any) => i.mediaId === mediaId && i.serviceId === serviceId
							) ?? false;
						return {
							id: c.id,
							name: c.name,
							itemCount: c.itemCount,
							visibility: c.visibility,
							hasItem
						};
					})
				);
			}
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open) loadCollections();
	});

	async function toggleItem(collectionId: string, hasItem: boolean) {
		if (hasItem) {
			const detailRes = await fetch(`/api/collections/${collectionId}`);
			if (detailRes.ok) {
				const detail = await detailRes.json();
				const item = detail.collection?.items?.find(
					(i: any) => i.mediaId === mediaId && i.serviceId === serviceId
				);
				if (item) {
					await fetch(`/api/collections/${collectionId}/items/${item.id}`, { method: 'DELETE' });
				}
			}
		} else {
			await fetch(`/api/collections/${collectionId}/items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaId, serviceId, mediaType, mediaTitle, mediaPoster })
			});
		}
		const entry = collections.find((c) => c.id === collectionId);
		if (entry) {
			entry.hasItem = !hasItem;
			entry.itemCount += hasItem ? -1 : 1;
			collections = [...collections];
		}
	}

	async function createAndAdd() {
		if (!newName.trim() || creating) return;
		creating = true;
		try {
			const res = await fetch('/api/collections', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newName.trim() })
			});
			if (res.ok) {
				const { id } = await res.json();
				await fetch(`/api/collections/${id}/items`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ mediaId, serviceId, mediaType, mediaTitle, mediaPoster })
				});
				collections = [
					...collections,
					{
						id,
						name: newName.trim(),
						itemCount: 1,
						visibility: 'private',
						hasItem: true
					}
				];
				newName = '';
				showCreate = false;
			}
		} finally {
			creating = false;
		}
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
		onclick={() => (open = false)}
		onkeydown={(e) => e.key === 'Escape' && (open = false)}
		role="button"
		tabindex="-1"
		aria-label="Close"
	></div>

	<!-- Modal -->
	<div
		class="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-cream/[0.06] bg-base p-4"
		style="box-shadow: 0 24px 80px rgba(0,0,0,0.6); animation: stagger-reveal 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; opacity: 0;"
		role="dialog"
		aria-label="Add to Collection"
	>
		<div class="mb-3 flex items-center justify-between">
			<h3 class="font-display text-sm font-semibold text-cream">Add to Collection</h3>
			<button onclick={() => (open = false)} class="text-faint hover:text-muted">
				<X size={16} strokeWidth={1.5} />
			</button>
		</div>

		{#if loading}
			<div class="flex items-center justify-center py-8">
				<div
					class="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
				></div>
			</div>
		{:else}
			<div class="flex max-h-64 flex-col gap-1 overflow-y-auto scrollbar-none">
				{#each collections as col (col.id)}
					<button
						onclick={() => toggleItem(col.id, col.hasItem)}
						class="flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-all hover:bg-cream/[0.04]"
					>
						<div
							class="flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all
								{col.hasItem
								? 'border-accent bg-accent/20 text-accent'
								: 'border-cream/[0.1] text-transparent'}"
						>
							{#if col.hasItem}<Check size={12} strokeWidth={2.5} />{/if}
						</div>
						<div class="flex-1 truncate">
							<span class="text-sm text-cream">{col.name}</span>
							<span class="ml-1.5 text-[10px] text-faint">{col.itemCount}</span>
						</div>
					</button>
				{/each}
			</div>

			<!-- Create new -->
			{#if showCreate}
				<div class="mt-2 flex gap-2 border-t border-cream/[0.04] pt-2">
					<input
						bind:value={newName}
						class="input flex-1 text-xs"
						placeholder="Collection name..."
						onkeydown={(e) => e.key === 'Enter' && createAndAdd()}
					/>
					<button
						onclick={createAndAdd}
						class="btn btn-primary text-xs"
						disabled={!newName.trim() || creating}>Add</button
					>
				</div>
			{:else}
				<button
					onclick={() => (showCreate = true)}
					class="mt-2 flex w-full items-center gap-2 border-t border-cream/[0.04] px-3 py-2 pt-3 text-xs text-faint transition-colors hover:text-muted"
				>
					<Plus size={14} strokeWidth={1.5} />
					New Collection
				</button>
			{/if}
		{/if}
	</div>
{/if}
