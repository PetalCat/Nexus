<script lang="ts">
	import type { PageData } from './$types';
	import { Plus, Lock, Users, Globe, FolderOpen } from 'lucide-svelte';
	import { goto } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	let showCreate = $state(false);
	let newName = $state('');
	let newDescription = $state('');
	let newVisibility = $state('private');
	let creating = $state(false);

	async function createCollection() {
		if (!newName.trim() || creating) return;
		creating = true;
		try {
			const res = await fetch('/api/collections', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || undefined, visibility: newVisibility })
			});
			if (res.ok) {
				const { id } = await res.json();
				showCreate = false;
				newName = '';
				newDescription = '';
				newVisibility = 'private';
				goto(`/library/collections/${id}`);
			}
		} finally {
			creating = false;
		}
	}

	function getVisibilityIcon(v: string) {
		if (v === 'friends') return Users;
		if (v === 'public') return Globe;
		return Lock;
	}

	function getVisibilityLabel(v: string) {
		if (v === 'friends') return 'Friends';
		if (v === 'public') return 'Public';
		return 'Private';
	}
</script>

<svelte:head>
	<title>Collections — Nexus</title>
</svelte:head>

<div class="px-3 sm:px-4 lg:px-6">
	<!-- My Collections -->
	<div class="mb-8">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="font-display text-lg font-semibold text-cream">My Collections</h2>
			<button
				onclick={() => (showCreate = !showCreate)}
				class="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-all hover:bg-accent/20"
			>
				<Plus size={14} strokeWidth={2} />
				New Collection
			</button>
		</div>

		<!-- Create collection form -->
		{#if showCreate}
			<div
				class="mb-6 rounded-xl border border-cream/[0.06] bg-surface/50 p-4"
				style="animation: stagger-reveal 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; opacity: 0;"
			>
				<input
					bind:value={newName}
					class="input mb-3 w-full text-sm"
					placeholder="Collection name..."
					onkeydown={(e) => e.key === 'Enter' && createCollection()}
				/>
				<textarea
					bind:value={newDescription}
					class="input mb-3 w-full resize-none text-sm"
					rows={2}
					placeholder="Description (optional)..."
				></textarea>
				<div class="flex items-center justify-between">
					<div class="flex gap-1.5">
						{#each ['private', 'friends', 'public'] as v (v)}
							{@const VIcon = getVisibilityIcon(v)}
							<button
								onclick={() => (newVisibility = v)}
								class="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all
									{newVisibility === v
									? 'bg-accent/15 text-accent ring-1 ring-accent/20'
									: 'bg-raised text-muted hover:text-cream'}"
							>
								<VIcon size={12} strokeWidth={1.5} />
								{getVisibilityLabel(v)}
							</button>
						{/each}
					</div>
					<div class="flex gap-2">
						<button onclick={() => (showCreate = false)} class="btn-ghost text-xs">Cancel</button>
						<button onclick={createCollection} class="btn btn-primary text-xs" disabled={!newName.trim() || creating}>
							{creating ? 'Creating...' : 'Create'}
						</button>
					</div>
				</div>
			</div>
		{/if}

		{#if data.owned.length === 0 && !showCreate}
			<div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-cream/[0.06] py-12 text-center">
				<FolderOpen size={28} strokeWidth={1.2} class="mb-3 text-faint" />
				<p class="text-sm text-muted">No collections yet</p>
				<p class="mt-1 text-xs text-faint">Create one to start organizing your media.</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.owned as collection, i (collection.id)}
					{@const VIcon = getVisibilityIcon(collection.visibility)}
					<a
						href="/library/collections/{collection.id}"
						class="group nexus-card overflow-hidden rounded-xl border border-cream/[0.04] transition-all duration-300 hover:border-cream/[0.08] hover:shadow-lg"
						style="animation: stagger-reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; animation-delay: {i * 60}ms; opacity: 0;"
					>
						<!-- 2x2 Poster collage -->
						<div class="aspect-[16/9] overflow-hidden bg-deep">
							{#if collection.posters && collection.posters.length > 0}
								<div class="grid h-full w-full {collection.posters.length >= 4 ? 'grid-cols-2 grid-rows-2' : collection.posters.length >= 2 ? 'grid-cols-2' : ''}">
									{#each collection.posters.slice(0, 4) as poster (poster)}
										<img src={poster} alt="" class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
									{/each}
									{#if collection.posters.length < 4}
										{#each { length: Math.max(0, (collection.posters.length >= 2 ? 4 : 1) - collection.posters.length) } as _, j (j)}
											<div class="bg-surface"></div>
										{/each}
									{/if}
								</div>
							{:else}
								<div class="flex h-full w-full items-center justify-center" style="background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-raised) 100%);">
									<FolderOpen size={32} strokeWidth={1} class="text-faint/50" />
								</div>
							{/if}
						</div>

						<!-- Info -->
						<div class="p-3.5">
							<h3 class="font-display text-sm font-semibold text-cream group-hover:text-accent-light transition-colors duration-200">{collection.name}</h3>
							<div class="mt-1.5 flex items-center gap-3 text-[11px] text-faint">
								<span>{collection.itemCount} item{collection.itemCount === 1 ? '' : 's'}</span>
								{#if collection.memberCount > 1}
									<span class="flex items-center gap-0.5">
										<Users size={10} strokeWidth={1.5} />
										{collection.memberCount}
									</span>
								{/if}
								<span class="ml-auto flex items-center gap-0.5">
									<VIcon size={10} strokeWidth={1.5} />
									{getVisibilityLabel(collection.visibility)}
								</span>
							</div>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Joined Collections -->
	{#if data.joined.length > 0}
		<div>
			<h2 class="mb-4 font-display text-lg font-semibold text-cream">Joined</h2>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.joined as collection, i (collection.id)}
					<a
						href="/library/collections/{collection.id}"
						class="group nexus-card overflow-hidden rounded-xl border border-cream/[0.04] transition-all duration-300 hover:border-cream/[0.08] hover:shadow-lg"
						style="animation: stagger-reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; animation-delay: {i * 60}ms; opacity: 0;"
					>
						<div class="aspect-[16/9] overflow-hidden bg-deep">
							{#if collection.posters && collection.posters.length > 0}
								<div class="grid h-full w-full {collection.posters.length >= 4 ? 'grid-cols-2 grid-rows-2' : collection.posters.length >= 2 ? 'grid-cols-2' : ''}">
									{#each collection.posters.slice(0, 4) as poster (poster)}
										<img src={poster} alt="" class="h-full w-full object-cover" />
									{/each}
								</div>
							{:else}
								<div class="flex h-full w-full items-center justify-center bg-surface">
									<FolderOpen size={32} strokeWidth={1} class="text-faint/50" />
								</div>
							{/if}
						</div>
						<div class="p-3.5">
							<div class="flex items-center gap-1.5">
								<span class="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent">Shared</span>
								<h3 class="font-display text-sm font-semibold text-cream">{collection.name}</h3>
							</div>
							<div class="mt-1.5 flex items-center gap-3 text-[11px] text-faint">
								<span>{collection.itemCount} item{collection.itemCount === 1 ? '' : 's'}</span>
								{#if collection.memberCount > 1}
									<span class="flex items-center gap-0.5">
										<Users size={10} strokeWidth={1.5} />
										{collection.memberCount}
									</span>
								{/if}
							</div>
						</div>
					</a>
				{/each}
			</div>
		</div>
	{/if}
</div>
