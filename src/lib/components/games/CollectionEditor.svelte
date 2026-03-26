<script lang="ts">
	import { X, Search, Plus, Trash2, FolderOpen } from 'lucide-svelte';
	import type { UnifiedMedia } from '$lib/adapters/types';

	interface Collection {
		id?: number;
		name: string;
		description?: string;
		romIds: number[];
	}

	let {
		open = false,
		collection = null,
		allGames = [],
		onclose,
		onsave
	}: {
		open?: boolean;
		collection?: Collection | null;
		allGames?: UnifiedMedia[];
		onclose?: () => void;
		onsave?: (data: { id?: number; name: string; description: string; romIds: number[] }) => void;
	} = $props();

	let name = $state('');
	let description = $state('');
	let selectedRomIds = $state<Set<number>>(new Set());
	let searchQuery = $state('');
	let saving = $state(false);

	$effect(() => {
		if (open) {
			name = collection?.name ?? '';
			description = collection?.description ?? '';
			selectedRomIds = new Set(collection?.romIds ?? []);
			searchQuery = '';
			saving = false;
		}
	});

	const selectedGames = $derived(
		allGames.filter((g) => selectedRomIds.has(Number(g.sourceId)))
	);

	const searchResults = $derived.by(() => {
		if (!searchQuery.trim()) return [];
		const q = searchQuery.toLowerCase();
		return allGames
			.filter((g) => g.title.toLowerCase().includes(q) && !selectedRomIds.has(Number(g.sourceId)))
			.slice(0, 8);
	});

	function addGame(game: UnifiedMedia) {
		selectedRomIds = new Set([...selectedRomIds, Number(game.sourceId)]);
		searchQuery = '';
	}

	function removeGame(romId: number) {
		const next = new Set(selectedRomIds);
		next.delete(romId);
		selectedRomIds = next;
	}

	async function handleSave() {
		const trimmedName = name.trim();
		if (!trimmedName) return;
		saving = true;
		onsave?.({
			id: collection?.id,
			name: trimmedName,
			description: description.trim(),
			romIds: [...selectedRomIds]
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose?.();
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-nexus-void/70 backdrop-blur-sm animate-fade-in"
		onclick={(e: MouseEvent) => { if (e.target === e.currentTarget) onclose?.(); }}
		onkeydown={handleKeydown}
	>
		<div class="w-full max-w-lg rounded-2xl border border-cream/[0.06] bg-nexus-raised p-6 shadow-2xl animate-fade-in-up max-h-[85vh] flex flex-col">
			<!-- Header -->
			<div class="mb-5 flex items-center justify-between">
				<div class="flex items-center gap-2.5">
					<FolderOpen size={18} class="text-accent" />
					<h3 class="font-display text-lg font-bold text-cream">
						{collection ? 'Edit Collection' : 'New Collection'}
					</h3>
				</div>
				<button
					class="rounded-lg p-1.5 text-faint transition-colors hover:bg-cream/[0.04] hover:text-cream"
					onclick={() => onclose?.()}
				>
					<X size={16} />
				</button>
			</div>

			<div class="flex-1 overflow-y-auto space-y-4">
				<!-- Name -->
				<input
					bind:value={name}
					type="text"
					placeholder="Collection name..."
					class="w-full rounded-xl border border-cream/[0.08] bg-nexus-base px-4 py-3 text-sm text-cream placeholder:text-faint outline-none transition-all focus:border-accent/30 focus:ring-1 focus:ring-accent/20"
					maxlength={100}
				/>

				<!-- Description -->
				<textarea
					bind:value={description}
					placeholder="Description (optional)..."
					rows="2"
					class="w-full rounded-xl border border-cream/[0.08] bg-nexus-base px-4 py-3 text-sm text-cream placeholder:text-faint outline-none transition-all focus:border-accent/30 focus:ring-1 focus:ring-accent/20 resize-none"
					maxlength={500}
				></textarea>

				<!-- Game search -->
				<div>
					<label for="collection-search-games" class="mb-1.5 block text-xs font-medium text-faint">Add Games</label>
					<div class="relative">
						<Search size={14} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
						<input
							id="collection-search-games"
							bind:value={searchQuery}
							type="text"
							placeholder="Search games to add..."
							class="w-full rounded-xl border border-cream/[0.06] bg-cream/[0.03] px-3 py-2 pl-8 text-xs text-cream placeholder:text-faint/60 outline-none transition-all focus:border-accent/30 focus:ring-1 focus:ring-accent/20"
						/>
					</div>

					<!-- Search results dropdown -->
					{#if searchResults.length > 0}
						<div class="mt-1 rounded-xl border border-cream/[0.06] bg-nexus-base overflow-hidden">
							{#each searchResults as game (game.id)}
								<button
									class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cream/80 transition-colors hover:bg-cream/[0.04]"
									onclick={() => addGame(game)}
								>
									{#if game.poster}
										<img src={game.poster} alt="" class="h-8 w-6 rounded object-cover flex-shrink-0" />
									{/if}
									<span class="flex-1 truncate">{game.title}</span>
									{#if game.metadata?.platform}
										<span class="text-[10px] text-faint">{game.metadata.platform}</span>
									{/if}
									<Plus size={14} class="text-accent flex-shrink-0" />
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Selected games -->
				{#if selectedGames.length > 0}
					<div>
						<span class="mb-1.5 block text-xs font-medium text-faint">
							Games in Collection ({selectedGames.length})
						</span>
						<div class="space-y-1">
							{#each selectedGames as game (game.id)}
								<div class="flex items-center gap-2 rounded-lg bg-cream/[0.03] px-3 py-1.5">
									{#if game.poster}
										<img src={game.poster} alt="" class="h-8 w-6 rounded object-cover flex-shrink-0" />
									{/if}
									<span class="flex-1 truncate text-xs text-cream/80">{game.title}</span>
									{#if game.metadata?.platform}
										<span class="text-[10px] text-faint">{game.metadata.platform}</span>
									{/if}
									<button
										class="rounded p-1 text-faint transition-colors hover:bg-red-500/10 hover:text-red-400"
										onclick={() => removeGame(Number(game.sourceId))}
										title="Remove from collection"
									>
										<Trash2 size={12} />
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="mt-5 flex items-center justify-end gap-3 pt-3 border-t border-cream/[0.06]">
				<button
					type="button"
					class="rounded-full px-5 py-2 text-sm font-medium text-cream/60 transition-all hover:bg-cream/[0.04] hover:text-cream"
					onclick={() => onclose?.()}
				>
					Cancel
				</button>
				<button
					disabled={!name.trim() || saving}
					class="rounded-full bg-accent px-6 py-2 text-sm font-semibold text-nexus-void transition-all hover:bg-accent-light disabled:opacity-40 disabled:cursor-not-allowed"
					onclick={handleSave}
				>
					{saving ? 'Saving...' : (collection ? 'Save' : 'Create')}
				</button>
			</div>
		</div>
	</div>
{/if}
