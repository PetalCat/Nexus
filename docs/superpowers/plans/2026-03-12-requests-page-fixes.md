# Requests Page — Status Fix + Unified Admin View — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix inaccurate request statuses and merge the admin/user request views into one unified tab.

**Architecture:** Two independent changes — (1) backend status logic fix in the Overseerr adapter's `normalizeRequest()` to check `media.status`, (2) frontend restructure merging "My Requests" and "Pending" tabs into a unified admin view with compact cards. The type change (`'partial'`) bridges both.

**Tech Stack:** SvelteKit, TypeScript, Overseerr REST API

**Spec:** `docs/superpowers/specs/2026-03-12-requests-page-fixes-design.md`

---

## Chunk 1: Status Accuracy Fix (Backend)

### Task 1: Add `'partial'` to `NexusRequest.status` type

**Files:**
- Modify: `src/lib/adapters/types.ts:91`

- [ ] **Step 1: Update the status union type**

In `src/lib/adapters/types.ts`, line 91, change:

```ts
status: 'pending' | 'approved' | 'declined' | 'available';
```

to:

```ts
status: 'pending' | 'approved' | 'declined' | 'available' | 'partial';
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: TypeScript will report non-exhaustive switch errors in `+page.svelte` for `statusLabel()`. That's expected — we'll fix those in Task 3. No errors in `types.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/lib/adapters/types.ts
git commit -m "feat: add 'partial' to NexusRequest status union"
```

---

### Task 2: Fix `normalizeRequest()` to check `media.status`

**Files:**
- Modify: `src/lib/adapters/overseerr.ts:94-116` (normalizeRequest)
- Modify: `src/lib/adapters/overseerr.ts:196-203` (mapRequestStatus)

- [ ] **Step 1: Update `mapRequestStatus()` — remove dead `case 4`**

In `src/lib/adapters/overseerr.ts`, replace the `mapRequestStatus` function (lines 196-203):

```ts
function mapRequestStatus(s?: number): NexusRequest['status'] {
	switch (s) {
		case 2: return 'approved';
		case 3: return 'declined';
		case 4: return 'available';
		default: return 'pending';
	}
}
```

with:

```ts
/** Map Overseerr request status (1=pending, 2=approved, 3=declined).
 *  Availability is determined from media.status, not request status. */
function mapRequestStatus(s?: number): NexusRequest['status'] {
	switch (s) {
		case 2: return 'approved';
		case 3: return 'declined';
		default: return 'pending';
	}
}
```

- [ ] **Step 2: Update `normalizeRequest()` — check `media.status` for availability**

In `src/lib/adapters/overseerr.ts`, in the `normalizeRequest` function, find line 104:

```ts
	status: mapRequestStatus(req.status),
```

Replace with:

```ts
	status: resolveRequestStatus(req),
```

Then add the `resolveRequestStatus` helper just above `normalizeRequest` (before line 73):

```ts
/** Derive the true request status by checking both request status and media availability.
 *  Media status 5 = fully available, 4 = partially available (some seasons). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveRequestStatus(req: any): NexusRequest['status'] {
	const mediaStatus = req.media?.status;
	if (mediaStatus === 5) return 'available';
	if (mediaStatus === 4) return 'partial';
	return mapRequestStatus(req.status);
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Same switch exhaustiveness warnings in `+page.svelte` as before (will fix in Task 3). No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/adapters/overseerr.ts
git commit -m "fix: check media.status for request availability instead of only request status"
```

---

## Chunk 2: Status Fix (Frontend Helpers)

### Task 3: Update status helpers in `+page.svelte`

**Files:**
- Modify: `src/routes/requests/+page.svelte:313-328` (statusStep, statusLabel)
- Modify: `src/routes/requests/+page.svelte:181-193` (filteredMyRequests, myCounts)

- [ ] **Step 1: Update `statusStep()` to handle `'partial'`**

In `src/routes/requests/+page.svelte`, replace `statusStep` (lines 313-319):

```ts
	function statusStep(status: NexusRequest['status']): number {
		switch (status) {
			case 'available': return 2;
			case 'approved':  return 1;
			default:          return 0;
		}
	}
```

with:

```ts
	function statusStep(status: NexusRequest['status']): number {
		switch (status) {
			case 'available':
			case 'partial':   return 2;
			case 'approved':  return 1;
			default:          return 0;
		}
	}
```

- [ ] **Step 2: Update `statusLabel()` to handle `'partial'`**

Replace `statusLabel` (lines 321-328):

```ts
	function statusLabel(status: NexusRequest['status']): string {
		switch (status) {
			case 'pending':   return 'Awaiting Approval';
			case 'approved':  return 'Processing';
			case 'available': return 'Ready to Watch';
			case 'declined':  return 'Not Approved';
		}
	}
```

with:

```ts
	function statusLabel(status: NexusRequest['status']): string {
		switch (status) {
			case 'pending':   return 'Awaiting Approval';
			case 'approved':  return 'Processing';
			case 'available': return 'In Library';
			case 'partial':   return 'Partially Available';
			case 'declined':  return 'Not Approved';
		}
	}
```

Note: `'available'` label changes from "Ready to Watch" to "In Library".

- [ ] **Step 3: Update `filteredMyRequests` to include `'partial'` in the available filter**

Replace `filteredMyRequests` (lines 181-186):

```ts
	const filteredMyRequests = $derived(data.myRequests.filter((r) => {
		if (myFilter === 'active') return r.status === 'pending' || r.status === 'approved';
		if (myFilter === 'available') return r.status === 'available';
		if (myFilter === 'declined') return r.status === 'declined';
		return true;
	}));
```

with:

```ts
	const filteredMyRequests = $derived(data.myRequests.filter((r) => {
		if (myFilter === 'active') return r.status === 'pending' || r.status === 'approved';
		if (myFilter === 'available') return r.status === 'available' || r.status === 'partial';
		if (myFilter === 'declined') return r.status === 'declined';
		return true;
	}));
```

- [ ] **Step 4: Update `myCounts` to include `'partial'` in the available count**

Replace `myCounts` (lines 188-193):

```ts
	const myCounts = $derived({
		all: data.myRequests.length,
		active: data.myRequests.filter(r => r.status === 'pending' || r.status === 'approved').length,
		available: data.myRequests.filter(r => r.status === 'available').length,
		declined: data.myRequests.filter(r => r.status === 'declined').length,
	});
```

with:

```ts
	const myCounts = $derived({
		all: data.myRequests.length,
		active: data.myRequests.filter(r => r.status === 'pending' || r.status === 'approved').length,
		available: data.myRequests.filter(r => r.status === 'available' || r.status === 'partial').length,
		declined: data.myRequests.filter(r => r.status === 'declined').length,
	});
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: No errors — all switch cases now handled.

- [ ] **Step 6: Smoke test in browser**

Run: `pnpm dev` (if not running), navigate to `http://localhost:5173/requests` → "My Requests" tab.

Verify: Items that were previously stuck on "Processing" now show correct status ("In Library" or "Partially Available"). The status journey dots should fill appropriately.

- [ ] **Step 7: Commit**

```bash
git add src/routes/requests/+page.svelte
git commit -m "fix: update status helpers for 'partial' and correct 'In Library' label"
```

---

## Chunk 3: Unified Admin View (Server)

### Task 4: Replace `adminPending` with `allRequests` in page server

**Files:**
- Modify: `src/routes/requests/+page.server.ts:29-62` (data fetching)
- Modify: `src/routes/requests/+page.server.ts:94-102` (return object)

- [ ] **Step 1: Replace the `adminPending` fetch with `allRequests`**

In `src/routes/requests/+page.server.ts`, replace the `Promise.all` block (lines 29-62):

```ts
	const [myRequests, adminPending] = await Promise.all([
		hasLinkedOverseerr
			? withCache(`requests:user:${userId}`, 30_000, async () => {
					const reqs: NexusRequest[] = [];
					await Promise.allSettled(
						overseerrConfigs.map(async (config) => {
							const adapter = registry.get('overseerr');
							if (!adapter?.getRequests) return;
							const userCred = getUserCredentialForService(userId, config.id) ?? undefined;
							if (userCred) {
								const r = await adapter.getRequests(config, { filter: 'all', take: 100 }, userCred);
								reqs.push(...r);
							}
						})
					);
					return reqs;
				})
			: Promise.resolve([] as NexusRequest[]),

		isAdmin
			? withCache('requests:admin-pending', 30_000, async () => {
					const pending: NexusRequest[] = [];
					await Promise.allSettled(
						overseerrConfigs.map(async (config) => {
							const adapter = registry.get('overseerr');
							if (!adapter?.getRequests) return;
							const p = await adapter.getRequests(config, { filter: 'pending', take: 100 });
							pending.push(...p);
						})
					);
					return pending;
				})
			: Promise.resolve([] as NexusRequest[])
	]);
```

with:

```ts
	const [myRequests, allRequests] = await Promise.all([
		hasLinkedOverseerr
			? withCache(`requests:user:${userId}`, 30_000, async () => {
					const reqs: NexusRequest[] = [];
					await Promise.allSettled(
						overseerrConfigs.map(async (config) => {
							const adapter = registry.get('overseerr');
							if (!adapter?.getRequests) return;
							const userCred = getUserCredentialForService(userId, config.id) ?? undefined;
							if (userCred) {
								const r = await adapter.getRequests(config, { filter: 'all', take: 100 }, userCred);
								reqs.push(...r);
							}
						})
					);
					return reqs;
				})
			: Promise.resolve([] as NexusRequest[]),

		isAdmin
			? withCache('requests:admin-all', 30_000, async () => {
					const all: NexusRequest[] = [];
					await Promise.allSettled(
						overseerrConfigs.map(async (config) => {
							const adapter = registry.get('overseerr');
							if (!adapter?.getRequests) return;
							const r = await adapter.getRequests(config, { filter: 'all', take: 100 });
							all.push(...r);
						})
					);
					return all;
				})
			: Promise.resolve([] as NexusRequest[])
	]);
```

- [ ] **Step 2: Update the return object**

Replace the return block (lines 94-102):

```ts
	return {
		myRequests: myRequests.sort(byDate),
		adminPending: adminPending.sort(byDate),
		// Streamed — page renders immediately, discover fills in
		initialDiscover: fetchDiscover(),
		hasLinkedOverseerr,
		isAdmin,
		hasOverseerr
	};
```

with:

```ts
	return {
		myRequests: myRequests.sort(byDate),
		allRequests: allRequests.sort(byDate),
		initialDiscover: fetchDiscover(),
		hasLinkedOverseerr,
		isAdmin,
		hasOverseerr
	};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Errors in `+page.svelte` referencing `data.adminPending` — that's expected, we fix it in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/routes/requests/+page.server.ts
git commit -m "feat: replace adminPending with allRequests for unified admin view"
```

---

## Chunk 4: Unified Admin View (Frontend)

### Task 5: Restructure tabs and add admin unified view

**Files:**
- Modify: `src/routes/requests/+page.svelte` (multiple sections)

This is the largest task. It modifies the Tab type, tab bar, adds admin filter/card logic, and removes the old Pending tab.

- [ ] **Step 1: Update Tab type and default tab logic**

Replace line 9:

```ts
	type Tab = 'discover' | 'mine' | 'pending';
```

with:

```ts
	type Tab = 'discover' | 'mine' | 'requests';
```

Replace line 10:

```ts
	let activeTab = $state<Tab>('discover');
```

with:

```ts
	let activeTab = $state<Tab>('discover');
```

(No change to default — stays `'discover'`.)

- [ ] **Step 2: Add admin state variables and derived values**

After the existing `myFilter` declaration (line 163), add the admin filter state and derived values:

```ts
	// ── Admin unified filter ─────────────────────────────
	let adminFilter = $state<'all' | 'pending' | 'processing' | 'available' | 'declined'>('all');

	const mySourceIds = $derived(new Set(data.myRequests.map(r => r.sourceId)));

	const filteredAllRequests = $derived(data.allRequests.filter((r) => {
		if (adminFilter === 'pending') return r.status === 'pending';
		if (adminFilter === 'processing') return r.status === 'approved';
		if (adminFilter === 'available') return r.status === 'available' || r.status === 'partial';
		if (adminFilter === 'declined') return r.status === 'declined';
		return true;
	}));

	const adminCounts = $derived({
		all: data.allRequests.length,
		pending: data.allRequests.filter(r => r.status === 'pending').length,
		processing: data.allRequests.filter(r => r.status === 'approved').length,
		available: data.allRequests.filter(r => r.status === 'available' || r.status === 'partial').length,
		declined: data.allRequests.filter(r => r.status === 'declined').length,
	});
```

- [ ] **Step 3: Update the tab bar**

Replace the "My Requests" tab button (lines 371-384) and "Pending" tab button (lines 387-402) with:

```svelte
			<!-- Requests tab (admin: unified) / My Requests (non-admin) -->
			{#if data.isAdmin}
				<button
					onclick={() => activeTab = 'requests'}
					class="flex-shrink-0 relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors
						{activeTab === 'requests' ? 'text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
					Requests
					{#if data.allRequests.length > 0}
						<span class="rounded-full bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-muted)]">{data.allRequests.length}</span>
					{/if}
					{#if adminCounts.pending > 0}
						<span class="rounded-full bg-[#f59e0b] px-1.5 py-0.5 text-[10px] font-bold text-black">{adminCounts.pending}</span>
					{/if}
					{#if activeTab === 'requests'}
						<span class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--color-accent)]"></span>
					{/if}
				</button>
			{:else}
				<button
					onclick={() => activeTab = 'mine'}
					class="flex-shrink-0 relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors
						{activeTab === 'mine' ? 'text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
					My Requests
					{#if data.myRequests.length > 0}
						<span class="rounded-full bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-muted)]">{data.myRequests.length}</span>
					{/if}
					{#if activeTab === 'mine'}
						<span class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--color-accent)]"></span>
					{/if}
				</button>
			{/if}
```

- [ ] **Step 4: Add the unified admin "Requests" tab content**

After the closing `{/if}` of the `<!-- ── MY REQUESTS TAB ── -->` section (line 888), and before the old `<!-- ── PENDING TAB (admin) ── -->` section, add:

```svelte
	<!-- ── ADMIN UNIFIED REQUESTS TAB ── -->
	{#if activeTab === 'requests' && data.isAdmin}
		<div class="px-3 py-5 sm:px-4 lg:px-6">

			<!-- Filter tabs -->
			<div class="mb-4 flex gap-1 overflow-x-auto scrollbar-none">
				{#each [
					{ key: 'all',        label: 'All',        count: adminCounts.all },
					{ key: 'pending',    label: 'Pending',    count: adminCounts.pending },
					{ key: 'processing', label: 'Processing', count: adminCounts.processing },
					{ key: 'available',  label: 'In Library', count: adminCounts.available },
					{ key: 'declined',   label: 'Declined',   count: adminCounts.declined },
				] as tab (tab.key)}
					<button
						onclick={() => (adminFilter = tab.key as typeof adminFilter)}
						class="flex-shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all
							{adminFilter === tab.key ? 'bg-[var(--color-raised)] text-[var(--color-cream)]' : 'text-[var(--color-muted)] hover:text-[var(--color-body)]'}"
					>
						{tab.label}
						{#if tab.count > 0}
							<span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold
								{adminFilter === tab.key ? 'bg-[var(--color-accent)]/30 text-[var(--color-accent)]' : 'bg-[var(--color-surface)] text-[var(--color-muted)]'}
								{tab.key === 'pending' && adminFilter !== 'pending' && tab.count > 0 ? '!bg-[#f59e0b] !text-black !font-bold' : ''}"
							>{tab.count}</span>
						{/if}
					</button>
				{/each}
			</div>

			{#if filteredAllRequests.length === 0}
				<p class="py-10 text-center text-sm text-[var(--color-muted)]">
					{adminFilter === 'all' ? 'No requests yet.' : 'Nothing in this category.'}
				</p>
			{:else}
				<div class="flex flex-col gap-2">
					{#each filteredAllRequests as req (req.id)}
						{@const isOwn = mySourceIds.has(req.sourceId)}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div
							class="group flex items-center gap-3 rounded-xl px-3 py-3 cursor-pointer transition-all hover:ring-1 hover:ring-[rgba(240,235,227,0.06)]"
							style="background:var(--color-raised)"
							onclick={() => openReq(req)}
						>
							<!-- Poster -->
							<div class="flex-shrink-0 overflow-hidden rounded-lg" style="width:40px;height:60px;background:var(--color-surface)">
								{#if req.poster}
									<img src={req.poster} alt={req.title} class="h-full w-full object-cover" loading="lazy" />
								{:else}
									<div class="flex h-full w-full items-center justify-center text-[var(--color-muted)]">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/></svg>
									</div>
								{/if}
							</div>

							<!-- Info -->
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-1.5">
									<h3 class="truncate font-semibold text-sm">{req.title}</h3>
									{#if isOwn}
										<span class="flex-shrink-0 rounded bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[9px] font-bold text-[var(--color-accent)]">YOU</span>
									{/if}
								</div>
								<p class="mt-0.5 text-[11px] text-[var(--color-muted)]">
									{#if req.year}{req.year} · {/if}{typeLabel(req.type)}{#if req.rating} · <span class="text-[var(--color-accent)]">★ {req.rating.toFixed(1)}</span>{/if}
								</p>
								<div class="mt-1.5 flex items-center gap-1.5">
									<span class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold" style="background:var(--color-accent)20;color:var(--color-accent)">
										{req.requestedByName.slice(0, 1).toUpperCase()}
									</span>
									<span class="truncate text-[11px] text-[var(--color-muted)]">{req.requestedByName}</span>
									<span class="flex-shrink-0 text-[10px] text-[var(--color-muted)]">· {relativeTime(req.requestedAt)}</span>
									<!-- Status badge -->
									{#if req.status === 'pending'}
										<span class="flex-shrink-0 rounded-full bg-[#f59e0b]/15 px-2 py-0.5 text-[9px] font-semibold text-[#f59e0b]">Pending</span>
									{:else if req.status === 'approved'}
										<span class="flex-shrink-0 rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[9px] font-semibold text-[var(--color-accent)]">Processing</span>
									{:else if req.status === 'available' || req.status === 'partial'}
										<span class="flex-shrink-0 rounded-full bg-[#00d4aa]/15 px-2 py-0.5 text-[9px] font-semibold text-[#00d4aa]">{req.status === 'partial' ? 'Partial' : 'In Library'}</span>
									{:else if req.status === 'declined'}
										<span class="flex-shrink-0 rounded-full bg-[var(--color-warm)]/15 px-2 py-0.5 text-[9px] font-semibold text-[var(--color-warm)]">Declined</span>
									{/if}
								</div>
							</div>

							<!-- Actions -->
							<div class="flex flex-shrink-0 items-center gap-1.5" onclick={(e) => e.stopPropagation()}>
								{#if req.status === 'pending'}
									<button
										onclick={() => adminAction('approve', req.id)}
										disabled={actioning}
										class="rounded-lg bg-[var(--color-steel)]/15 px-3 py-2 text-xs font-semibold text-[var(--color-steel)] transition hover:bg-[var(--color-steel)]/25 active:scale-95"
										title="Approve"
									>✓</button>
									<button
										onclick={() => adminAction('deny', req.id)}
										disabled={actioning}
										class="rounded-lg bg-[var(--color-warm)]/15 px-3 py-2 text-xs font-semibold text-[var(--color-warm)] transition hover:bg-[var(--color-warm)]/25 active:scale-95"
										title="Deny"
									>✗</button>
								{:else if (req.status === 'available' || req.status === 'partial') && req.mediaUrl}
									<a
										href={req.mediaUrl}
										target="_blank" rel="noopener"
										class="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-black transition hover:bg-white/90 active:scale-95"
									>Watch</a>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			{#if actionResult}
				<div class="mt-4 rounded-xl border px-4 py-2.5 text-sm
					{actionResult.failed === 0
						? 'border-[var(--color-steel)]/30 bg-[rgba(61,143,132,0.1)] text-[var(--color-steel)]'
						: 'border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 text-[var(--color-warm)]'}">
					{actionResult.succeeded} succeeded{actionResult.failed > 0 ? `, ${actionResult.failed} failed` : ''}
				</div>
			{/if}
		</div>
	{/if}
```

- [ ] **Step 5: Remove the old Pending tab**

Delete the entire `<!-- ── PENDING TAB (admin) ── -->` section (lines 890-956 approximately — from `{#if activeTab === 'pending' && data.isAdmin}` to its closing `{/if}`).

- [ ] **Step 5b: Guard "My Requests" content for non-admins only**

The `{#if activeTab === 'mine'}` content block (around lines 731-888) is unreachable for admins since no button sets `activeTab = 'mine'` for them. Wrap it to avoid dead template code:

Change:
```svelte
	{#if activeTab === 'mine'}
```

to:
```svelte
	{#if activeTab === 'mine' && !data.isAdmin}
```

- [ ] **Step 6: Update the "My Requests" tab label in the non-admin filter tabs**

In the "My Requests" tab filter tabs (around line 758), update the "Ready" label to "In Library":

```ts
					{ key: 'available', label: 'Ready',       count: myCounts.available },
```

to:

```ts
					{ key: 'available', label: 'In Library',  count: myCounts.available },
```

- [ ] **Step 7: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: No errors.

- [ ] **Step 8: Smoke test in browser**

Navigate to `http://localhost:5173/requests`:

1. **As admin:** Verify "Requests" tab shows all users' requests with requester names, "YOU" badge on your own, approve/deny buttons on pending items, filter tabs work
2. **Verify no "Pending" tab** exists anymore
3. **Verify status badges** show correct labels (In Library, Processing, Pending, etc.)

- [ ] **Step 9: Update docs/BACKEND.md route table**

In `docs/BACKEND.md` line 1281, change:
```
| `/requests` | Session | — | myRequests, adminPending, discover |
```
to:
```
| `/requests` | Session | — | myRequests, allRequests, discover |
```

- [ ] **Step 10: Commit**

```bash
git add src/routes/requests/+page.svelte docs/BACKEND.md
git commit -m "feat: unified admin requests tab with compact cards and inline actions"
```
