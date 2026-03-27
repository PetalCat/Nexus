<script lang="ts">
	import type { PageData } from './$types';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import {
		Lock, Users, Globe, Pencil, Check, X,
		ArrowLeft, FolderOpen, Plus
	} from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	let collection = $derived(data.collection);
	let activity = $derived(data.activity);

	// Editing states
	let editingName = $state(false);
	let editingDesc = $state(false);
	let editName = $state('');
	let editDesc = $state('');

	const isOwner = $derived(collection.userRole === 'owner');
	const isEditor = $derived(collection.userRole === 'editor' || isOwner);

	const VisibilityIcon = $derived.by(() => {
		if (collection.visibility === 'friends') return Users;
		if (collection.visibility === 'public') return Globe;
		return Lock;
	});

	const visibilityLabel = $derived.by(() => {
		if (collection.visibility === 'friends') return 'Friends';
		if (collection.visibility === 'public') return 'Public';
		return 'Private';
	});

	async function saveField(field: 'name' | 'description' | 'visibility', value: string) {
		const res = await fetch(`/api/collections/${collection.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ [field]: value })
		});
		if (res.ok) {
			if (field === 'name') { collection.name = value; editingName = false; }
			if (field === 'description') { collection.description = value; editingDesc = false; }
			if (field === 'visibility') collection.visibility = value;
		}
	}

	function cycleVisibility() {
		if (!isOwner) return;
		const cycle = ['private', 'friends', 'public'];
		const idx = cycle.indexOf(collection.visibility);
		const next = cycle[(idx + 1) % cycle.length];
		saveField('visibility', next);
	}

	async function removeItem(itemId: string) {
		const res = await fetch(`/api/collections/${collection.id}/items/${itemId}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			collection.items = collection.items.filter((i) => i.id !== itemId);
		}
	}

	function formatActivityTime(ts: number): string {
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 7) return `${days}d ago`;
		return new Date(ts).toLocaleDateString();
	}

	function formatAction(action: string): string {
		const map: Record<string, string> = {
			add_item: 'added',
			remove_item: 'removed',
			join: 'joined',
			leave: 'left',
			update: 'updated'
		};
		return map[action] ?? action;
	}

	function startEditName() {
		editName = collection.name;
		editingName = true;
	}

	function startEditDesc() {
		editDesc = collection.description ?? '';
		editingDesc = true;
	}
</script>

<svelte:head>
	<title>{collection.name} — Nexus</title>
</svelte:head>

<div class="px-3 sm:px-4 lg:px-6">
	<!-- Back link -->
	<a
		href="/library/collections"
		class="mb-4 inline-flex items-center gap-1.5 text-xs text-faint transition-colors hover:text-muted"
	>
		<ArrowLeft size={14} strokeWidth={1.5} />
		Collections
	</a>

	<div class="flex flex-col gap-6 md:flex-row">
		<!-- Sidebar -->
		<div class="w-full shrink-0 md:w-[280px]">
			<div class="sticky top-20 flex flex-col gap-4">
				<!-- Poster collage -->
				<div class="aspect-square overflow-hidden rounded-xl" style="box-shadow: 0 8px 32px rgba(0,0,0,0.4);">
					{#if collection.items.length > 0}
						<div class="grid h-full w-full {collection.items.length >= 4 ? 'grid-cols-2 grid-rows-2' : collection.items.length >= 2 ? 'grid-cols-2' : ''}">
							{#each collection.items.slice(0, 4) as item (item.id)}
								{#if item.mediaPoster}
									<img src={item.mediaPoster} alt={item.mediaTitle} class="h-full w-full object-cover" />
								{:else}
									<div class="flex h-full w-full items-center justify-center bg-surface text-faint">
										<FolderOpen size={24} />
									</div>
								{/if}
							{/each}
							{#if collection.items.length < 4 && collection.items.length >= 2}
								{#each { length: 4 - Math.min(collection.items.length, 4) } as _, j (j)}
									<div class="bg-surface"></div>
								{/each}
							{/if}
						</div>
					{:else}
						<div class="flex h-full w-full items-center justify-center bg-surface" style="background: linear-gradient(135deg, var(--color-surface), var(--color-raised));">
							<FolderOpen size={40} strokeWidth={1} class="text-faint/40" />
						</div>
					{/if}
				</div>

				<!-- Title -->
				{#if editingName && isOwner}
					<div class="flex items-center gap-2">
						<input
							bind:value={editName}
							class="input flex-1 text-sm"
							onkeydown={(e) => { if (e.key === 'Enter') saveField('name', editName); if (e.key === 'Escape') editingName = false; }}
						/>
						<button onclick={() => saveField('name', editName)} class="text-accent"><Check size={16} /></button>
						<button onclick={() => (editingName = false)} class="text-faint"><X size={16} /></button>
					</div>
				{:else}
					<div class="group flex items-start gap-2">
						<h2 class="font-display text-xl font-bold text-cream">{collection.name}</h2>
						{#if isOwner}
							<button onclick={startEditName} class="mt-1 text-faint opacity-0 transition-opacity group-hover:opacity-100">
								<Pencil size={13} strokeWidth={1.5} />
							</button>
						{/if}
					</div>
				{/if}

				<!-- Description -->
				{#if editingDesc && isOwner}
					<div class="flex flex-col gap-2">
						<textarea bind:value={editDesc} class="input w-full resize-none text-xs" rows={3}></textarea>
						<div class="flex gap-2">
							<button onclick={() => saveField('description', editDesc)} class="btn btn-primary text-xs">Save</button>
							<button onclick={() => (editingDesc = false)} class="btn-ghost text-xs">Cancel</button>
						</div>
					</div>
				{:else if collection.description}
					<div class="group flex items-start gap-2">
						<p class="text-xs leading-relaxed text-muted">{collection.description}</p>
						{#if isOwner}
							<button onclick={startEditDesc} class="mt-0.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100">
								<Pencil size={11} strokeWidth={1.5} />
							</button>
						{/if}
					</div>
				{:else if isOwner}
					<button onclick={startEditDesc} class="text-xs text-faint hover:text-muted">
						+ Add description
					</button>
				{/if}

				<!-- Metadata row -->
				<div class="flex flex-wrap items-center gap-2">
					<button
						onclick={cycleVisibility}
						class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all
							{isOwner ? 'cursor-pointer hover:bg-cream/[0.06]' : 'cursor-default'}
							bg-surface text-faint"
						disabled={!isOwner}
					>
						<VisibilityIcon size={10} strokeWidth={1.5} />
						{visibilityLabel}
					</button>

					<span class="text-[10px] text-faint">{collection.items.length} item{collection.items.length === 1 ? '' : 's'}</span>
				</div>

				<!-- Members -->
				<div class="border-t border-cream/[0.04] pt-3">
					<div class="mb-2 flex items-center justify-between">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-faint/60">Members</span>
					</div>
					<div class="flex flex-col gap-1.5">
						{#each collection.members as member (member.userId)}
							<div class="flex items-center gap-2 text-xs">
								<div class="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-[9px] font-semibold text-accent">
									{(member.displayName ?? member.username ?? '?').charAt(0).toUpperCase()}
								</div>
								<span class="flex-1 truncate text-muted">{member.displayName ?? member.username}</span>
								<span class="rounded bg-surface px-1.5 py-0.5 text-[9px] text-faint">{member.role}</span>
							</div>
						{/each}
					</div>
				</div>

				<!-- Activity feed -->
				{#if activity.length > 0}
					<div class="border-t border-cream/[0.04] pt-3">
						<span class="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-faint/60">Activity</span>
						<div class="flex max-h-64 flex-col gap-2 overflow-y-auto scrollbar-none">
							{#each activity as entry (entry.id)}
								<div class="text-[11px] text-faint">
									<span class="font-medium text-muted">{entry.displayName ?? entry.username}</span>
									{formatAction(entry.action)}
									{#if entry.targetTitle}
										<span class="italic text-muted">{entry.targetTitle}</span>
									{/if}
									<span class="ml-1 text-faint/60">{formatActivityTime(entry.createdAt)}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Main content — poster grid -->
		<div class="flex-1">
			{#if collection.items.length === 0}
				<div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-cream/[0.06] py-16 text-center">
					<Plus size={28} strokeWidth={1.2} class="mb-3 text-faint" />
					<p class="text-sm text-muted">No items yet</p>
					<p class="mt-1 text-xs text-faint">Add items from any media detail page.</p>
				</div>
			{:else}
				<div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4">
					{#each collection.items as item, i (item.id)}
						<div
							class="group relative"
							style="animation: stagger-reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; animation-delay: {Math.min(i * 30, 600)}ms; opacity: 0;"
						>
							<MediaCard
								item={{
									id: `${item.mediaId}:${item.serviceId}`,
									sourceId: item.mediaId,
									serviceId: item.serviceId,
									type: item.mediaType as import('$lib/adapters/types').MediaType,
									title: item.mediaTitle,
									poster: item.mediaPoster ?? undefined,
									serviceType: 'jellyfin'
								}}
							/>
							{#if isEditor}
								<button
									onclick={() => removeItem(item.id)}
									class="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-void/80 text-muted opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-warm/80 hover:text-cream group-hover:opacity-100"
									aria-label="Remove from collection"
								>
									<X size={14} strokeWidth={2} />
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
