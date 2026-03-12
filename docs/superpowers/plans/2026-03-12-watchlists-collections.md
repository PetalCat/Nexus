# Watchlists & Collections Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users a personal watchlist queue and shared named collections with activity feeds, surfacing existing backend infrastructure through `/library/*` routes.

**Architecture:** Reuse existing `userFavorites`, `collections`, `collectionItems`, `collectionMembers` tables. Add `collection_activity` table for feeds. Fix 4 backend gaps in `social.ts`. Build `/library/*` routes with responsive layouts. Add watchlist button + collection modal to media detail pages.

**Tech Stack:** SvelteKit (Svelte 5 runes), SQLite via better-sqlite3/Drizzle, Tailwind CSS v4, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-12-watchlists-collections-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/lib/server/collection-activity.ts` | Activity logging + feed queries for collections |
| `src/routes/library/+layout.svelte` | Library sub-nav (Watchlist / Collections / Shared tabs) |
| `src/routes/library/+layout.server.ts` | Shared data: unseen share count |
| `src/routes/library/+page.server.ts` | Redirect `/library` → `/library/watchlist` |
| `src/routes/library/watchlist/+page.server.ts` | Load user favorites with filter/sort |
| `src/routes/library/watchlist/+page.svelte` | Watchlist poster grid with filter chips |
| `src/routes/library/collections/+page.server.ts` | Load user's owned + joined collections |
| `src/routes/library/collections/+page.svelte` | Collections grid with "New Collection" |
| `src/routes/library/collections/[id]/+page.server.ts` | Load collection detail + items + members + activity |
| `src/routes/library/collections/[id]/+page.svelte` | Responsive sidebar+grid / hero+list layout |
| `src/routes/library/shared/+page.server.ts` | Load shared items for user |
| `src/routes/library/shared/+page.svelte` | Shared items list with seen/unseen |
| `src/lib/components/WatchlistButton.svelte` | Reusable bookmark toggle (filled/outline) |
| `src/lib/components/AddToCollectionModal.svelte` | Modal: user's collections with checkboxes |
| `src/lib/components/CollectionCard.svelte` | 2x2 poster collage card for collections grid |
| `src/routes/api/collections/[id]/reorder/+server.ts` | PUT endpoint for item reorder |
| `src/routes/api/collections/[id]/activity/+server.ts` | GET endpoint for activity feed |
| `src/routes/api/collections/[id]/leave/+server.ts` | POST endpoint for self-leave |

### Modified Files
| File | Changes |
|------|---------|
| `src/lib/db/index.ts` | Add `collection_activity` CREATE TABLE + index |
| `src/lib/server/social.ts` | Fix `updateCollection` visibility, add self-leave, add `reorderCollectionItems`, extend `getMediaFriendActivity` |
| `src/lib/components/NavSidebar.svelte` | Add Library section (Watchlist, Collections, Shared with badge) |
| `src/routes/+layout.svelte` | Add `library` → segment map entry |
| `src/routes/media/[type]/[id]/+page.server.ts` | Load watchlist state + user collections for item |
| `src/routes/media/[type]/[id]/+page.svelte` | Add WatchlistButton + AddToCollectionModal |
| `src/lib/server/homepage-cache.ts` | Add "Updated in Your Collections" row |

---

## Chunk 1: Backend Foundations

### Task 1: Add `collection_activity` table

**Files:**
- Modify: `src/lib/db/index.ts` (after line 310, after collection_members table)

- [ ] **Step 1: Add CREATE TABLE statement to initDb**

In `src/lib/db/index.ts`, after the `collection_members` CREATE TABLE block (around line 310), add:

```sql
CREATE TABLE IF NOT EXISTS collection_activity (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_title TEXT,
  target_media_id TEXT,
  created_at INTEGER NOT NULL
)
```

And the index:

```sql
CREATE INDEX IF NOT EXISTS idx_collection_activity_coll ON collection_activity(collection_id, created_at DESC)
```

Follow the exact pattern used by other tables in `initDb()` — raw `db.run()` calls.

- [ ] **Step 2: Verify the app starts cleanly**

Run: `pnpm dev`
Expected: Server starts without errors, table is created on first request.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/index.ts
git commit -m "feat(library): add collection_activity table schema"
```

---

### Task 2: Backend fixes to `social.ts`

**Files:**
- Modify: `src/lib/server/social.ts`

This task fixes 4 gaps identified in the spec review.

- [ ] **Step 1: Restrict `updateCollection` visibility changes to owner-only**

In `updateCollection()` (around line 820), the current code allows editors to change visibility. Add a check: if `updates.visibility` is set and the caller is not the creator, strip the visibility field from updates.

Find the existing permission check (denies viewers), then add after it:

```typescript
// Only owner can change visibility
if (updates.visibility) {
  const collection = db.select().from(schema.collections)
    .where(eq(schema.collections.id, collectionId)).get();
  if (!collection || collection.creatorId !== userId) {
    delete updates.visibility;
  }
}
```

- [ ] **Step 2: Add self-leave support to `removeCollectionMember`**

The current code (around line 926) has `if (ownerId === targetUserId) return false;` which prevents self-leave. Replace the function logic to support two cases:

1. Owner removing another member (existing behavior)
2. Member removing themselves (new: `ownerId === targetUserId` AND they are NOT the owner role)

```typescript
export function removeCollectionMember(collectionId: string, callerId: string, targetUserId: string): boolean {
  const db = getDb();

  // Self-leave: member removes themselves (but owner cannot leave their own collection)
  if (callerId === targetUserId) {
    const membership = db.select().from(schema.collectionMembers)
      .where(and(
        eq(schema.collectionMembers.collectionId, collectionId),
        eq(schema.collectionMembers.userId, callerId)
      )).get();
    if (!membership || membership.role === 'owner') return false;
    db.delete(schema.collectionMembers)
      .where(and(
        eq(schema.collectionMembers.collectionId, collectionId),
        eq(schema.collectionMembers.userId, callerId)
      )).run();
    return true;
  }

  // Owner removing another member (existing behavior)
  const callerMembership = db.select().from(schema.collectionMembers)
    .where(and(
      eq(schema.collectionMembers.collectionId, collectionId),
      eq(schema.collectionMembers.userId, callerId)
    )).get();
  if (!callerMembership || callerMembership.role !== 'owner') return false;

  db.delete(schema.collectionMembers)
    .where(and(
      eq(schema.collectionMembers.collectionId, collectionId),
      eq(schema.collectionMembers.userId, targetUserId)
    )).run();
  return true;
}
```

- [ ] **Step 3: Add `reorderCollectionItems` function**

Add after the existing `removeCollectionItem` function. Follow the exact pattern of `reorderUserFavorites`:

```typescript
export function reorderCollectionItems(collectionId: string, userId: string, orderedIds: string[]): boolean {
  const db = getDb();
  const membership = db.select().from(schema.collectionMembers)
    .where(and(
      eq(schema.collectionMembers.collectionId, collectionId),
      eq(schema.collectionMembers.userId, userId)
    )).get();
  if (!membership || membership.role === 'viewer') return false;

  for (let i = 0; i < orderedIds.length; i++) {
    db.update(schema.collectionItems)
      .set({ position: i })
      .where(and(
        eq(schema.collectionItems.id, orderedIds[i]),
        eq(schema.collectionItems.collectionId, collectionId)
      )).run();
  }

  db.update(schema.collections)
    .set({ updatedAt: Date.now() })
    .where(eq(schema.collections.id, collectionId)).run();
  return true;
}
```

- [ ] **Step 4: Extend `getMediaFriendActivity` to include watchlist data**

First, ensure `getRawDb` is imported at the top of `social.ts`. The existing import line is `import { getDb, schema } from '../db';` — change it to:

```typescript
import { getDb, getRawDb, schema } from '../db';
```

Then in `getMediaFriendActivity()`, add a query for friends who have this item in their watchlist. The function already uses `raw = getRawDb()`. After the existing `watched` and `shared` queries, add:

```typescript
// Friends who have this in their watchlist
const watchlisted = friendIds.length > 0
  ? raw.prepare(
      `SELECT uf.user_id, uf.created_at, u.username, u.display_name, u.avatar
       FROM user_favorites uf
       JOIN users u ON u.id = uf.user_id
       WHERE uf.media_id = ? AND uf.service_id = ?
         AND uf.user_id IN (${friendIds.map(() => '?').join(',')})`)
    .all(mediaId, serviceId, ...friendIds) as Array<{
      user_id: string; created_at: number;
      username: string; display_name: string | null; avatar: string | null;
    }>
  : [];
```

Add `watchlisted` to the return object alongside `watched`, `watching`, `shared`.

- [ ] **Step 5: Verify app starts and no regressions**

Run: `pnpm dev`
Expected: Clean start, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/social.ts
git commit -m "fix(library): restrict visibility to owner, add self-leave, reorder items, watchlist friend activity"
```

---

### Task 3: Activity logging module

**Files:**
- Create: `src/lib/server/collection-activity.ts`

- [ ] **Step 1: Create the activity logging module**

Create `src/lib/server/collection-activity.ts` with functions for writing and reading activity:

```typescript
import { getRawDb } from '$lib/db';
import { randomBytes } from 'crypto';

function genId(): string {
  return randomBytes(16).toString('hex');
}

export type ActivityAction = 'add_item' | 'remove_item' | 'join' | 'leave' | 'update';

export interface CollectionActivityEntry {
  id: string;
  collectionId: string;
  userId: string;
  action: ActivityAction;
  targetTitle: string | null;
  targetMediaId: string | null;
  createdAt: number;
  // Joined from users table for display
  username?: string;
  displayName?: string | null;
  avatar?: string | null;
}

/** Log an activity entry for a collection mutation */
export function logCollectionActivity(
  collectionId: string,
  userId: string,
  action: ActivityAction,
  targetTitle?: string,
  targetMediaId?: string
): void {
  const raw = getRawDb();
  raw.prepare(
    `INSERT INTO collection_activity (id, collection_id, user_id, action, target_title, target_media_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(genId(), collectionId, userId, action, targetTitle ?? null, targetMediaId ?? null, Date.now());
}

/** Get activity feed for a collection (paginated) */
export function getCollectionActivity(
  collectionId: string,
  limit = 20,
  offset = 0
): CollectionActivityEntry[] {
  const raw = getRawDb();
  return raw.prepare(
    `SELECT ca.id, ca.collection_id as collectionId, ca.user_id as userId,
            ca.action, ca.target_title as targetTitle, ca.target_media_id as targetMediaId,
            ca.created_at as createdAt,
            u.username, u.display_name as displayName, u.avatar
     FROM collection_activity ca
     JOIN users u ON u.id = ca.user_id
     WHERE ca.collection_id = ?
     ORDER BY ca.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(collectionId, limit, offset) as CollectionActivityEntry[];
}

/** Get recent activity across all collections a user is a member of (for homepage row) */
export function getRecentCollectionActivity(
  userId: string,
  sinceDays = 7,
  limit = 10
): Array<CollectionActivityEntry & { collectionName: string }> {
  const raw = getRawDb();
  const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  return raw.prepare(
    `SELECT ca.id, ca.collection_id as collectionId, ca.user_id as userId,
            ca.action, ca.target_title as targetTitle, ca.target_media_id as targetMediaId,
            ca.created_at as createdAt,
            u.username, u.display_name as displayName, u.avatar,
            c.name as collectionName
     FROM collection_activity ca
     JOIN users u ON u.id = ca.user_id
     JOIN collections c ON c.id = ca.collection_id
     WHERE ca.collection_id IN (
       SELECT collection_id FROM collection_members WHERE user_id = ?
     )
     AND ca.created_at > ?
     AND ca.user_id != ?
     ORDER BY ca.created_at DESC
     LIMIT ?`
  ).all(userId, since, userId, limit) as Array<CollectionActivityEntry & { collectionName: string }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/collection-activity.ts
git commit -m "feat(library): add collection activity logging and feed queries"
```

---

### Task 4: Wire activity logging into existing social.ts mutations

**Files:**
- Modify: `src/lib/server/social.ts`

- [ ] **Step 1: Add activity logging calls to collection mutations**

At the top of `social.ts`, add the import:

```typescript
import { logCollectionActivity } from './collection-activity';
```

Then add `logCollectionActivity()` calls inside each function, AFTER the successful mutation:

1. **`addCollectionItem`** — after the INSERT succeeds (before returning the id):
```typescript
logCollectionActivity(collectionId, userId, 'add_item', item.mediaTitle, item.mediaId);
```

2. **`removeCollectionItem`** — after the DELETE succeeds. You'll need to read the item title before deleting. Before the delete, add:
```typescript
const itemRow = db.select({ title: schema.collectionItems.mediaTitle, mediaId: schema.collectionItems.mediaId })
  .from(schema.collectionItems).where(eq(schema.collectionItems.id, itemId)).get();
```
Then after the delete:
```typescript
if (itemRow) logCollectionActivity(collectionId, userId, 'remove_item', itemRow.title, itemRow.mediaId);
```

3. **`addCollectionMember`** — after the INSERT succeeds:
```typescript
logCollectionActivity(collectionId, targetUserId, 'join');
```

4. **`removeCollectionMember`** — after a successful removal, log the appropriate action:
```typescript
logCollectionActivity(collectionId, targetUserId, 'leave');
```

5. **`updateCollection`** — after the UPDATE succeeds:
```typescript
logCollectionActivity(collectionId, userId, 'update');
```

- [ ] **Step 2: Verify app starts**

Run: `pnpm dev`
Expected: Clean start. Activity entries will be created as collections are used.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/social.ts
git commit -m "feat(library): wire activity logging into collection mutations"
```

---

### Task 5: Collection invite notification

**Files:**
- Modify: `src/lib/server/social.ts`

- [ ] **Step 1: Add notification creation to `addCollectionMember`**

After the successful member INSERT (and the activity log), create a notification for the invitee. Use the Drizzle ORM pattern consistent with the rest of `social.ts`:

```typescript
// Get collection name for the notification
const coll = db.select({ name: schema.collections.name })
  .from(schema.collections).where(eq(schema.collections.id, collectionId)).get();
const collectionName = coll?.name ?? 'a collection';

// Create notification for invitee
db.insert(schema.notifications).values({
  id: genId(),
  userId: targetUserId,
  type: 'collection_invite',
  title: 'Collection Invite',
  message: `You were added to "${collectionName}"`,
  href: `/library/collections/${collectionId}`,
  actorId: ownerId,
  createdAt: Date.now()
}).run();
```

`genId` is already available in `social.ts` — it's the `randomBytes(16).toString('hex')` helper.

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/social.ts
git commit -m "feat(library): send notification on collection invite"
```

---

### Task 6: API endpoints for reorder, activity, and leave

**Files:**
- Create: `src/routes/api/collections/[id]/reorder/+server.ts`
- Create: `src/routes/api/collections/[id]/activity/+server.ts`
- Create: `src/routes/api/collections/[id]/leave/+server.ts`

- [ ] **Step 1: Create reorder endpoint**

Create `src/routes/api/collections/[id]/reorder/+server.ts`:

```typescript
import { error, json } from '@sveltejs/kit';
import { reorderCollectionItems } from '$lib/server/social';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401);
  const { orderedIds } = await request.json();
  if (!Array.isArray(orderedIds)) throw error(400, 'orderedIds must be an array');

  const ok = reorderCollectionItems(params.id, locals.user.id, orderedIds);
  if (!ok) throw error(403, 'Not authorized to reorder');
  return json({ ok: true });
};
```

- [ ] **Step 2: Create activity endpoint**

Create `src/routes/api/collections/[id]/activity/+server.ts`:

```typescript
import { error, json } from '@sveltejs/kit';
import { getCollectionActivity } from '$lib/server/collection-activity';
import { getCollection } from '$lib/server/social';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  if (!locals.user) throw error(401);

  // Access check — getCollection returns null if user can't see it
  const collection = getCollection(params.id, locals.user.id);
  if (!collection) throw error(404);

  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50);
  const offset = parseInt(url.searchParams.get('offset') ?? '0');
  const activity = getCollectionActivity(params.id, limit, offset);
  return json(activity);
};
```

- [ ] **Step 3: Create leave endpoint**

Create `src/routes/api/collections/[id]/leave/+server.ts`:

```typescript
import { error, json } from '@sveltejs/kit';
import { removeCollectionMember } from '$lib/server/social';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401);
  const ok = removeCollectionMember(params.id, locals.user.id, locals.user.id);
  if (!ok) throw error(400, 'Cannot leave (you may be the owner)');
  return json({ ok: true });
};
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/collections/\[id\]/reorder src/routes/api/collections/\[id\]/activity src/routes/api/collections/\[id\]/leave
git commit -m "feat(library): add API endpoints for reorder, activity feed, and self-leave"
```

---

## Chunk 2: Nav + Library Pages

### Task 7: Update nav sidebar with Library section

**Files:**
- Modify: `src/lib/components/NavSidebar.svelte`
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 1: Add library nav items to NavSidebar**

In `NavSidebar.svelte`, import three more icons at the top:

```typescript
import { Bookmark, LayoutGrid, Share2 } from 'lucide-svelte';
```

Add a new `libraryNavItems` array after `secondaryNavItems`:

```typescript
const libraryNavItems: NavItem[] = [
  { id: 'watchlist', label: 'Watchlist', href: '/library/watchlist' },
  { id: 'collections', label: 'Collections', href: '/library/collections' },
  { id: 'shared', label: 'Shared', href: '/library/shared' }
];
```

Add these to the icon map:

```typescript
watchlist: Bookmark,
collections: LayoutGrid,
shared: Share2,
```

Add a new prop for unseen share count:

```typescript
unseenShares?: number;
```

Then in the template, add a new "Your Library" section between the Library and System sections. Follow the exact same markup pattern as the existing Library/System sections. Include a badge on the Shared item when `unseenShares > 0`:

```svelte
<!-- Your Library section label -->
{#if !collapsed || mobileOpen}
  <p class="!mt-5 !mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-faint/50">Your Library</p>
{:else}
  <div class="!my-3 mx-3 h-px bg-cream/[0.04]" aria-hidden="true"></div>
{/if}

{#each libraryNavItems as item}
  {@const Icon = getIcon(item.id)}
  {@const active = item.id === activeId}
  <a
    href={item.href}
    class="group/item relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-[13px] font-medium transition-all duration-300
      {active
      ? 'bg-accent/[0.08] text-cream'
      : 'text-muted hover:bg-cream/[0.03] hover:text-cream'}"
    aria-current={active ? 'page' : undefined}
    onclick={closeMobile}
  >
    {#if active}
      <div
        class="absolute left-0 top-1/2 h-6 w-[2.5px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_8px_rgba(212,162,83,0.4)]"
        aria-hidden="true"
      ></div>
    {/if}
    <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-300
      {active
      ? 'bg-accent/15 text-accent'
      : 'text-muted group-hover/item:bg-cream/[0.04] group-hover/item:text-cream'}"
    >
      <Icon size={17} strokeWidth={active ? 2 : 1.5} />
    </div>
    {#if !collapsed || mobileOpen}
      <span class="truncate">{item.label}</span>
      {#if item.id === 'shared' && unseenShares > 0}
        <span class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent/20 px-1.5 text-[10px] font-bold text-accent">
          {unseenShares}
        </span>
      {/if}
    {/if}
  </a>
{/each}
```

Rename the existing "Library" section label to "Browse" (since it contains Movies, Shows, etc.) and place the new "Your Library" section between Browse and System.

- [ ] **Step 2: Update layout segment map**

In `src/routes/+layout.svelte`, add `library` to the `activeId` derivation map (around line 107):

```typescript
library: 'library',
```

Wait — the library sub-pages use different activeIds (watchlist, collections, shared). Replace the entire `activeId` derivation block (lines 103-122 of `+layout.svelte`) with:

```typescript
const activeId = $derived.by(() => {
  const path = $page.url.pathname;
  if (path === '/') return 'home';
  // Library sub-routes
  if (path.startsWith('/library/watchlist')) return 'watchlist';
  if (path.startsWith('/library/collections')) return 'collections';
  if (path.startsWith('/library/shared')) return 'shared';
  if (path.startsWith('/library')) return 'watchlist';
  const segment = path.split('/')[1];
  const map: Record<string, string> = {
    movies: 'movies',
    shows: 'shows',
    music: 'music',
    books: 'books',
    games: 'games',
    live: 'live',
    videos: 'videos',
    friends: 'friends',
    requests: 'requests',
    activity: 'activity',
    settings: 'settings',
    admin: 'admin'
  };
  return map[segment] ?? 'home';
});
```

Also pass `unseenShares` to the NavSidebar component. In the layout's load function (`src/routes/+layout.server.ts`), add the unseen share count:

Check `src/routes/+layout.server.ts` — it already loads `pendingCount`. Add `unseenShareCount` from `getUnseenShareCount(userId)` alongside it.

- [ ] **Step 3: Pass `unseenShares` through layout**

In `src/routes/+layout.server.ts`, import and call `getUnseenShareCount`:

```typescript
import { getUnseenShareCount } from '$lib/server/social';
```

Add to the returned data:

```typescript
unseenShares: userId ? getUnseenShareCount(userId) : 0
```

In `src/routes/+layout.svelte`, pass it to NavSidebar:

```svelte
<NavSidebar
  {activeId}
  bind:collapsed={sidebarCollapsed}
  bind:mobileOpen
  {pendingRequests}
  unseenShares={data.unseenShares}
  isAdmin={data.isAdmin}
/>
```

- [ ] **Step 4: Verify nav renders correctly**

Run: `pnpm dev`, navigate to any page.
Expected: "Your Library" section appears in sidebar with Watchlist, Collections, Shared items.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/NavSidebar.svelte src/routes/+layout.svelte src/routes/+layout.server.ts
git commit -m "feat(library): add Library section to nav sidebar with unseen badge"
```

---

### Task 8: Library layout and redirect

**Files:**
- Create: `src/routes/library/+layout.svelte`
- Create: `src/routes/library/+layout.server.ts`
- Create: `src/routes/library/+page.server.ts`

- [ ] **Step 1: Create the library redirect**

Create `src/routes/library/+page.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  throw redirect(307, '/library/watchlist');
};
```

- [ ] **Step 2: Create library layout server**

Create `src/routes/library/+layout.server.ts`:

```typescript
import { error } from '@sveltejs/kit';
import { getUnseenShareCount } from '$lib/server/social';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Sign in to access your library');
  return {
    unseenShareCount: getUnseenShareCount(locals.user.id)
  };
};
```

- [ ] **Step 3: Create library layout component**

Create `src/routes/library/+layout.svelte` with tab navigation:

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  import { Bookmark, LayoutGrid, Share2 } from 'lucide-svelte';

  let { data, children } = $props();

  const tabs = [
    { id: 'watchlist', label: 'Watchlist', href: '/library/watchlist', icon: Bookmark },
    { id: 'collections', label: 'Collections', href: '/library/collections', icon: LayoutGrid },
    { id: 'shared', label: 'Shared', href: '/library/shared', icon: Share2 }
  ] as const;

  const activeTab = $derived.by(() => {
    const path = $page.url.pathname;
    if (path.startsWith('/library/collections')) return 'collections';
    if (path.startsWith('/library/shared')) return 'shared';
    return 'watchlist';
  });
</script>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
  <!-- Tab bar -->
  <nav class="mb-6 flex gap-1 border-b border-cream/[0.06]" aria-label="Library sections">
    {#each tabs as tab}
      {@const active = activeTab === tab.id}
      <a
        href={tab.href}
        class="flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors
          {active
          ? 'border-accent text-accent'
          : 'border-transparent text-muted hover:border-cream/10 hover:text-cream'}"
        aria-current={active ? 'page' : undefined}
      >
        <tab.icon size={16} />
        {tab.label}
        {#if tab.id === 'shared' && data.unseenShareCount > 0}
          <span class="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent/20 px-1.5 text-[10px] font-bold text-accent">
            {data.unseenShareCount}
          </span>
        {/if}
      </a>
    {/each}
  </nav>

  {@render children()}
</div>
```

- [ ] **Step 4: Verify redirect works**

Run: `pnpm dev`, navigate to `/library`.
Expected: Redirects to `/library/watchlist`, tab bar renders.

- [ ] **Step 5: Commit**

```bash
git add src/routes/library/
git commit -m "feat(library): add library layout with tab navigation and redirect"
```

---

### Task 9: Watchlist page

**Files:**
- Create: `src/routes/library/watchlist/+page.server.ts`
- Create: `src/routes/library/watchlist/+page.svelte`

- [ ] **Step 1: Create watchlist server load**

Create `src/routes/library/watchlist/+page.server.ts`:

```typescript
import { getUserFavorites } from '$lib/server/social';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const favorites = getUserFavorites(locals.user!.id);
  return { favorites };
};
```

- [ ] **Step 2: Create watchlist page component**

Create `src/routes/library/watchlist/+page.svelte`:

```svelte
<script lang="ts">
  import MediaCard from '$lib/components/MediaCard.svelte';
  import { X } from 'lucide-svelte';

  let { data } = $props();

  const filters = ['All', 'Movies', 'Shows', 'Music', 'Books', 'Games'] as const;
  type Filter = typeof filters[number];

  const filterTypeMap: Record<Filter, string | null> = {
    All: null,
    Movies: 'movie',
    Shows: 'show',
    Music: 'music',
    Books: 'book',
    Games: 'game'
  };

  const sortOptions = [
    { label: 'Date Added', value: 'date' },
    { label: 'Title', value: 'title' }
  ] as const;

  let activeFilter = $state<Filter>('All');
  let sortBy = $state<string>('date');
  let favorites = $state(data.favorites);

  const filtered = $derived.by(() => {
    let items = [...favorites];
    const typeFilter = filterTypeMap[activeFilter];
    if (typeFilter) {
      items = items.filter((f) => f.mediaType === typeFilter);
    }
    if (sortBy === 'title') {
      items.sort((a, b) => a.mediaTitle.localeCompare(b.mediaTitle));
    }
    // 'date' is default order from DB (most recent first), no sort needed
    return items;
  });

  async function removeFavorite(id: string) {
    const res = await fetch(`/api/user/favorites?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      favorites = favorites.filter((f) => f.id !== id);
    }
  }
</script>

<svelte:head>
  <title>Watchlist — Nexus</title>
</svelte:head>

<!-- Filter chips -->
<div class="mb-4 flex flex-wrap items-center gap-2">
  {#each filters as filter}
    <button
      class="rounded-full px-3 py-1.5 text-xs font-medium transition-colors
        {activeFilter === filter
        ? 'bg-accent/20 text-accent'
        : 'bg-cream/[0.04] text-muted hover:bg-cream/[0.08] hover:text-cream'}"
      onclick={() => activeFilter = filter}
    >
      {filter}
    </button>
  {/each}

  <select
    bind:value={sortBy}
    class="ml-auto rounded-lg border border-cream/[0.06] bg-cream/[0.03] px-3 py-1.5 text-xs text-muted"
  >
    {#each sortOptions as opt}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
</div>

<!-- Poster grid -->
{#if filtered.length === 0}
  <div class="flex flex-col items-center justify-center py-20 text-center">
    <p class="text-lg font-medium text-cream/60">Your watchlist is empty</p>
    <p class="mt-1 text-sm text-muted">Browse and add items to keep track of what you want to watch</p>
  </div>
{:else}
  <div class="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-4">
    {#each filtered as fav (fav.id)}
      <div class="group relative">
        <a href="/media/{fav.mediaType}/{fav.mediaId}?service={fav.serviceId}" class="block">
          <div class="relative aspect-[2/3] overflow-hidden rounded-lg bg-cream/[0.04]">
            {#if fav.mediaPoster}
              <img src={fav.mediaPoster} alt={fav.mediaTitle} class="h-full w-full object-cover" loading="lazy" />
            {:else}
              <div class="flex h-full items-center justify-center text-muted">{fav.mediaTitle.charAt(0)}</div>
            {/if}
          </div>
          <p class="mt-1.5 truncate text-xs font-medium text-cream/80">{fav.mediaTitle}</p>
        </a>
        <button
          class="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-cream/60 opacity-0 transition-opacity hover:text-cream group-hover:opacity-100"
          onclick={() => removeFavorite(fav.id)}
          title="Remove from watchlist"
        >
          <X size={12} />
        </button>
      </div>
    {/each}
  </div>
{/if}
```

- [ ] **Step 3: Verify watchlist page**

Run: `pnpm dev`, navigate to `/library/watchlist`.
Expected: Shows favorited items as a poster grid with filter chips. X button removes items.

- [ ] **Step 4: Commit**

```bash
git add src/routes/library/watchlist/
git commit -m "feat(library): add watchlist page with filter chips and quick-remove"
```

---

### Task 10: Collections grid page

**Files:**
- Create: `src/routes/library/collections/+page.server.ts`
- Create: `src/routes/library/collections/+page.svelte`
- Create: `src/lib/components/CollectionCard.svelte`

- [ ] **Step 1: Create collections server load**

Create `src/routes/library/collections/+page.server.ts`:

```typescript
import { getUserCollections } from '$lib/server/social';
import { getRawDb } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const raw = getRawDb();
  const collections = getUserCollections(locals.user!.id);

  // Enrich each collection with first 4 item posters for the collage card
  const collectionsWithPosters = collections.map(c => {
    const items = raw.prepare(
      `SELECT media_poster FROM collection_items WHERE collection_id = ? ORDER BY position LIMIT 4`
    ).all(c.id) as Array<{ media_poster: string | null }>;
    return { ...c, posters: items.map(i => i.media_poster).filter(Boolean) };
  });

  return { collections: collectionsWithPosters, userId: locals.user!.id };
};
```

- [ ] **Step 2: Create CollectionCard component**

Create `src/lib/components/CollectionCard.svelte`:

```svelte
<script lang="ts">
  import { Users, Lock, Globe, UserCheck } from 'lucide-svelte';

  interface Props {
    collection: {
      id: string;
      name: string;
      description?: string | null;
      visibility: string;
      itemCount: number;
      role: string;
      posters: string[]; // up to 4 poster URLs
    };
  }

  let { collection }: Props = $props();

  const VisIcon = $derived(
    collection.visibility === 'public' ? Globe
    : collection.visibility === 'friends' ? UserCheck
    : Lock
  );
</script>

<a
  href="/library/collections/{collection.id}"
  class="group block overflow-hidden rounded-xl bg-cream/[0.03] transition-all hover:bg-cream/[0.06] hover:shadow-lg"
>
  <!-- 2x2 poster collage -->
  <div class="aspect-square overflow-hidden">
    <div class="grid h-full w-full grid-cols-2 grid-rows-2 gap-px bg-cream/[0.06]">
      {#each Array(4) as _, i}
        <div class="overflow-hidden bg-cream/[0.03]">
          {#if collection.posters[i]}
            <img
              src={collection.posters[i]}
              alt=""
              class="h-full w-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
          {:else}
            <div class="h-full w-full bg-cream/[0.02]"></div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- Info -->
  <div class="p-3">
    <div class="flex items-center gap-2">
      <h3 class="truncate text-sm font-semibold text-cream">{collection.name}</h3>
      <VisIcon size={12} class="shrink-0 text-muted" />
    </div>
    <p class="mt-0.5 text-xs text-muted">
      {collection.itemCount} {collection.itemCount === 1 ? 'item' : 'items'}
      {#if collection.role !== 'owner'}
        <span class="text-accent/60">· {collection.role}</span>
      {/if}
    </p>
  </div>
</a>
```

- [ ] **Step 3: Create collections page component**

Create `src/routes/library/collections/+page.svelte`:

```svelte
<script lang="ts">
  import CollectionCard from '$lib/components/CollectionCard.svelte';
  import { Plus } from 'lucide-svelte';
  import { goto } from '$app/navigation';

  let { data } = $props();

  let showNewModal = $state(false);
  let newName = $state('');
  let newVisibility = $state('private');
  let creating = $state(false);

  const owned = $derived(data.collections.filter((c: any) => c.role === 'owner'));
  const joined = $derived(data.collections.filter((c: any) => c.role !== 'owner'));

  async function createCollection() {
    if (!newName.trim()) return;
    creating = true;
    const res = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), visibility: newVisibility })
    });
    if (res.ok) {
      const { id } = await res.json();
      goto(`/library/collections/${id}`);
    }
    creating = false;
  }

  function collectionToCard(c: any) {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      visibility: c.visibility,
      itemCount: c.itemCount ?? 0,
      role: c.role,
      posters: c.items?.slice(0, 4).map((i: any) => i.mediaPoster).filter(Boolean) ?? []
    };
  }
</script>

<svelte:head>
  <title>Collections — Nexus</title>
</svelte:head>

<div class="mb-4 flex items-center justify-between">
  <h2 class="text-lg font-semibold text-cream">My Collections</h2>
  <button
    class="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
    onclick={() => showNewModal = true}
  >
    <Plus size={14} /> New Collection
  </button>
</div>

{#if owned.length === 0 && joined.length === 0}
  <div class="flex flex-col items-center justify-center py-20 text-center">
    <p class="text-lg font-medium text-cream/60">No collections yet</p>
    <p class="mt-1 text-sm text-muted">Create a collection to organize and share media with friends</p>
  </div>
{:else}
  {#if owned.length > 0}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {#each owned as c (c.id)}
        <CollectionCard collection={collectionToCard(c)} />
      {/each}
    </div>
  {/if}

  {#if joined.length > 0}
    <h2 class="mb-3 mt-8 text-lg font-semibold text-cream">Joined</h2>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {#each joined as c (c.id)}
        <CollectionCard collection={collectionToCard(c)} />
      {/each}
    </div>
  {/if}
{/if}

<!-- New Collection Modal -->
{#if showNewModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onclick={(e) => { if (e.target === e.currentTarget) showNewModal = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') showNewModal = false; }}
    role="dialog"
    aria-modal="true"
  >
    <div class="w-full max-w-md rounded-xl border border-cream/[0.06] bg-[#12121a] p-6 shadow-2xl">
      <h3 class="mb-4 text-lg font-semibold text-cream">New Collection</h3>
      <input
        bind:value={newName}
        placeholder="Collection name"
        class="mb-3 w-full rounded-lg border border-cream/[0.06] bg-cream/[0.03] px-3 py-2 text-sm text-cream placeholder:text-muted"
        onkeydown={(e) => { if (e.key === 'Enter') createCollection(); }}
      />
      <select
        bind:value={newVisibility}
        class="mb-4 w-full rounded-lg border border-cream/[0.06] bg-cream/[0.03] px-3 py-2 text-sm text-muted"
      >
        <option value="private">Private</option>
        <option value="friends">Friends</option>
        <option value="public">Public</option>
      </select>
      <div class="flex justify-end gap-2">
        <button
          class="rounded-lg px-4 py-2 text-sm text-muted hover:text-cream"
          onclick={() => showNewModal = false}
        >
          Cancel
        </button>
        <button
          class="rounded-lg bg-accent/20 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/30 disabled:opacity-50"
          disabled={!newName.trim() || creating}
          onclick={createCollection}
        >
          Create
        </button>
      </div>
    </div>
  </div>
{/if}
```

- [ ] **Step 4: Verify collections page**

Run: `pnpm dev`, navigate to `/library/collections`.
Expected: Shows collection cards in a grid with "New Collection" button. Modal creates new collections.

- [ ] **Step 5: Commit**

```bash
git add src/routes/library/collections/+page.server.ts src/routes/library/collections/+page.svelte src/lib/components/CollectionCard.svelte
git commit -m "feat(library): add collections grid page with new collection modal"
```

---

### Task 11: Shared items page

**Files:**
- Create: `src/routes/library/shared/+page.server.ts`
- Create: `src/routes/library/shared/+page.svelte`

- [ ] **Step 1: Create shared items server load**

Create `src/routes/library/shared/+page.server.ts`:

```typescript
import { getSharedItems } from '$lib/server/social';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const shared = getSharedItems(locals.user!.id, { limit: 50 });
  return { shared };
};
```

- [ ] **Step 2: Create shared items page component**

Create `src/routes/library/shared/+page.svelte`:

```svelte
<script lang="ts">
  import { Eye } from 'lucide-svelte';

  let { data } = $props();
  let items = $state(data.shared);

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  async function markSeen(id: string) {
    await fetch(`/api/shared/${id}/seen`, { method: 'POST' });
    items = items.map((i: any) => i.id === id ? { ...i, seen: true } : i);
  }
</script>

<svelte:head>
  <title>Shared — Nexus</title>
</svelte:head>

{#if items.length === 0}
  <div class="flex flex-col items-center justify-center py-20 text-center">
    <p class="text-lg font-medium text-cream/60">Nothing shared yet</p>
    <p class="mt-1 text-sm text-muted">Items shared by your friends will appear here</p>
  </div>
{:else}
  <div class="flex flex-col gap-2">
    {#each items as item (item.id)}
      <div
        class="flex items-center gap-4 rounded-xl p-3 transition-colors
          {item.seen ? 'bg-transparent' : 'bg-accent/[0.03]'}"
      >
        <!-- Sender avatar -->
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
          {item.senderUsername?.charAt(0).toUpperCase() ?? '?'}
        </div>

        <!-- Media poster + info -->
        <a href="/media/{item.mediaType}/{item.mediaId}?service={item.serviceId}" class="flex flex-1 items-center gap-3 min-w-0">
          {#if item.mediaPoster}
            <img src={item.mediaPoster} alt="" class="h-14 w-10 shrink-0 rounded object-cover" loading="lazy" />
          {/if}
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-cream">{item.mediaTitle}</p>
            <p class="text-xs text-muted">
              from {item.senderDisplayName ?? item.senderUsername} · {timeAgo(item.createdAt)}
            </p>
          </div>
        </a>

        <!-- Seen indicator -->
        {#if !item.seen}
          <button
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cream/[0.04] text-muted hover:text-cream"
            onclick={() => markSeen(item.id)}
            title="Mark as seen"
          >
            <Eye size={14} />
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}
```

Note: Check if `/api/shared/[id]/seen` endpoint exists. If not, create it:

Create `src/routes/api/shared/[id]/seen/+server.ts`:

```typescript
import { error, json } from '@sveltejs/kit';
import { markSharedSeen } from '$lib/server/social';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401);
  markSharedSeen(params.id, locals.user.id);
  return json({ ok: true });
};
```

- [ ] **Step 3: Verify shared page**

Run: `pnpm dev`, navigate to `/library/shared`.
Expected: Shows shared items with sender info, unseen highlighting, and mark-seen button.

- [ ] **Step 4: Commit**

```bash
git add src/routes/library/shared/ src/routes/api/shared/
git commit -m "feat(library): add shared items page with seen/unseen status"
```

---

## Chunk 3: Collection Detail Page

### Task 12: Collection detail page — server load

**Files:**
- Create: `src/routes/library/collections/[id]/+page.server.ts`

- [ ] **Step 1: Create collection detail server load**

Create `src/routes/library/collections/[id]/+page.server.ts`:

```typescript
import { error } from '@sveltejs/kit';
import { getCollection } from '$lib/server/social';
import { getCollectionActivity } from '$lib/server/collection-activity';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw error(401);

  const collection = getCollection(params.id, locals.user.id);
  if (!collection) throw error(404, 'Collection not found');

  const activity = getCollectionActivity(params.id, 20);

  return {
    collection,
    activity,
    userId: locals.user.id
  };
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/library/collections/\[id\]/+page.server.ts
git commit -m "feat(library): add collection detail server load"
```

---

### Task 13: Collection detail page — component

**Files:**
- Create: `src/routes/library/collections/[id]/+page.svelte`

This is the most complex component. Desktop: sidebar (280px) + poster grid. Mobile: hero banner + list view.

- [ ] **Step 1: Create the collection detail page**

Create `src/routes/library/collections/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  import { invalidateAll } from '$app/navigation';
  import MediaCard from '$lib/components/MediaCard.svelte';
  import { Lock, Globe, UserCheck, Plus, LogOut, Pencil, Trash2 } from 'lucide-svelte';

  let { data } = $props();

  let collection = $state(data.collection);
  let activity = $state(data.activity);
  let editingTitle = $state(false);
  let editingDesc = $state(false);
  let editTitle = $state(collection.name);
  let editDesc = $state(collection.description ?? '');
  let showAddSearch = $state(false);
  let searchQuery = $state('');
  let searchResults = $state<any[]>([]);
  let searching = $state(false);
  let mobileTab = $state<'items' | 'activity'>('items');

  const isOwner = $derived(collection.userRole === 'owner');
  const isEditor = $derived(collection.userRole === 'editor' || isOwner);
  const items = $derived(collection.items ?? []);

  const visibilityIcon = $derived(
    collection.visibility === 'public' ? Globe
    : collection.visibility === 'friends' ? UserCheck
    : Lock
  );

  const visibilityLabel = $derived(
    collection.visibility === 'public' ? 'Public'
    : collection.visibility === 'friends' ? 'Friends'
    : 'Private'
  );

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function activityText(entry: any): string {
    const name = entry.displayName ?? entry.username;
    switch (entry.action) {
      case 'add_item': return `${name} added ${entry.targetTitle}`;
      case 'remove_item': return `${name} removed ${entry.targetTitle}`;
      case 'join': return `${name} joined`;
      case 'leave': return `${name} left`;
      case 'update': return `${name} updated the collection`;
      default: return `${name} did something`;
    }
  }

  async function saveTitle() {
    if (!editTitle.trim()) return;
    await fetch(`/api/collections/${collection.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editTitle.trim() })
    });
    collection.name = editTitle.trim();
    editingTitle = false;
  }

  async function saveDesc() {
    await fetch(`/api/collections/${collection.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: editDesc.trim() || null })
    });
    collection.description = editDesc.trim() || null;
    editingDesc = false;
  }

  async function removeItem(itemId: string) {
    await fetch(`/api/collections/${collection.id}/items`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId })
    });
    collection.items = collection.items.filter((i: any) => i.id !== itemId);
  }

  async function leaveCollection() {
    const res = await fetch(`/api/collections/${collection.id}/leave`, { method: 'POST' });
    if (res.ok) {
      window.location.href = '/library/collections';
    }
  }

  async function searchMedia() {
    if (!searchQuery.trim()) return;
    searching = true;
    const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&source=library`);
    if (res.ok) {
      const data = await res.json();
      searchResults = data.items ?? [];
    }
    searching = false;
  }

  async function addItemFromSearch(item: any) {
    await fetch(`/api/collections/${collection.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaId: item.sourceId,
        serviceId: item.serviceId,
        mediaType: item.type,
        mediaTitle: item.title,
        mediaPoster: item.poster
      })
    });
    await invalidateAll();
    collection = data.collection;
  }

  function itemToUnifiedMedia(item: any) {
    return {
      sourceId: item.mediaId,
      serviceId: item.serviceId,
      type: item.mediaType,
      title: item.mediaTitle,
      poster: item.mediaPoster
    };
  }
</script>

<svelte:head>
  <title>{collection.name} — Nexus</title>
</svelte:head>

<!-- Desktop layout: sidebar + grid -->
<div class="hidden md:flex md:gap-6">
  <!-- Sidebar -->
  <aside class="w-[280px] shrink-0">
    <!-- Poster collage -->
    <div class="mb-4 aspect-square overflow-hidden rounded-xl">
      <div class="grid h-full grid-cols-2 grid-rows-2 gap-px bg-cream/[0.06]">
        {#each Array(4) as _, i}
          <div class="overflow-hidden bg-cream/[0.03]">
            {#if items[i]?.mediaPoster}
              <img src={items[i].mediaPoster} alt="" class="h-full w-full object-cover" />
            {:else}
              <div class="h-full w-full bg-cream/[0.02]"></div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- Title -->
    {#if editingTitle && isOwner}
      <input
        bind:value={editTitle}
        class="mb-1 w-full rounded border border-cream/10 bg-cream/[0.03] px-2 py-1 text-lg font-bold text-cream"
        onkeydown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') editingTitle = false; }}
        onblur={saveTitle}
      />
    {:else}
      <h1
        class="mb-1 text-xl font-bold text-cream {isOwner ? 'cursor-pointer hover:text-accent' : ''}"
        onclick={() => { if (isOwner) editingTitle = true; }}
      >
        {collection.name}
        {#if isOwner}<Pencil size={12} class="ml-1 inline text-muted" />{/if}
      </h1>
    {/if}

    <!-- Description -->
    {#if editingDesc && isOwner}
      <textarea
        bind:value={editDesc}
        class="mb-2 w-full rounded border border-cream/10 bg-cream/[0.03] px-2 py-1 text-sm text-muted"
        rows="2"
        onkeydown={(e) => { if (e.key === 'Escape') editingDesc = false; }}
        onblur={saveDesc}
      ></textarea>
    {:else if collection.description || isOwner}
      <p
        class="mb-2 text-sm italic text-muted {isOwner ? 'cursor-pointer hover:text-cream' : ''}"
        onclick={() => { if (isOwner) editingDesc = true; }}
      >
        {collection.description ?? 'Add a description...'}
      </p>
    {/if}

    <!-- Metadata -->
    <div class="mb-3 flex items-center gap-2 text-xs text-muted">
      {#if collection.visibility === 'public'}<Globe size={12} />{:else if collection.visibility === 'friends'}<UserCheck size={12} />{:else}<Lock size={12} />{/if}
      <span>{visibilityLabel}</span>
      <span>·</span>
      <span>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
    </div>

    <!-- Members -->
    {#if collection.members?.length > 0}
      <div class="mb-4 flex flex-wrap gap-1.5">
        {#each collection.members as member}
          <div
            class="flex h-7 w-7 items-center justify-center rounded-full bg-accent/20 text-[10px] font-bold text-accent"
            title="{member.displayName ?? member.username} ({member.role})"
          >
            {(member.displayName ?? member.username)?.charAt(0).toUpperCase()}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Actions -->
    {#if !isOwner && collection.userRole}
      <button
        class="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-warm"
        onclick={leaveCollection}
      >
        <LogOut size={12} /> Leave collection
      </button>
    {/if}

    <!-- Activity feed -->
    <div class="border-t border-cream/[0.06] pt-3">
      <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">Activity</h3>
      {#if activity.length === 0}
        <p class="text-xs text-muted/50">No activity yet</p>
      {:else}
        <div class="flex flex-col gap-1.5">
          {#each activity as entry}
            <p class="text-xs text-muted">{activityText(entry)} <span class="text-muted/50">· {timeAgo(entry.createdAt)}</span></p>
          {/each}
        </div>
      {/if}
    </div>
  </aside>

  <!-- Poster grid -->
  <div class="flex-1">
    <div class="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-4">
      {#each items as item (item.id)}
        <div class="group relative">
          <MediaCard item={itemToUnifiedMedia(item)} size="md" />
          {#if isEditor}
            <button
              class="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-cream/60 opacity-0 transition-opacity hover:text-warm group-hover:opacity-100"
              onclick={() => removeItem(item.id)}
              title="Remove"
            >
              <Trash2 size={11} />
            </button>
          {/if}
        </div>
      {/each}

      {#if isEditor}
        <button
          class="flex aspect-[2/3] items-center justify-center rounded-lg border-2 border-dashed border-cream/10 text-muted transition-colors hover:border-accent/30 hover:text-accent"
          onclick={() => showAddSearch = true}
        >
          <Plus size={24} />
        </button>
      {/if}
    </div>
  </div>
</div>

<!-- Mobile layout: hero + list -->
<div class="md:hidden">
  <!-- Hero banner -->
  <div class="relative -mx-4 -mt-6 mb-4 h-48 overflow-hidden">
    <div class="grid h-full grid-cols-4 gap-px">
      {#each Array(4) as _, i}
        <div class="overflow-hidden bg-cream/[0.03]">
          {#if items[i]?.mediaPoster}
            <img src={items[i].mediaPoster} alt="" class="h-full w-full object-cover" />
          {/if}
        </div>
      {/each}
    </div>
    <div class="absolute inset-0 bg-gradient-to-t from-[#0a0a12] via-[#0a0a12]/50 to-transparent"></div>
    <div class="absolute bottom-3 left-4 right-4">
      <h1 class="text-xl font-bold text-cream">{collection.name}</h1>
      <p class="text-xs text-muted">{items.length} items · {visibilityLabel}</p>
    </div>
  </div>

  <!-- Tab toggle -->
  <div class="mb-4 flex gap-1 rounded-lg bg-cream/[0.03] p-1">
    <button
      class="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors {mobileTab === 'items' ? 'bg-accent/15 text-accent' : 'text-muted'}"
      onclick={() => mobileTab = 'items'}
    >Items</button>
    <button
      class="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors {mobileTab === 'activity' ? 'bg-accent/15 text-accent' : 'text-muted'}"
      onclick={() => mobileTab = 'activity'}
    >Activity</button>
  </div>

  {#if mobileTab === 'items'}
    <div class="flex flex-col gap-2">
      {#each items as item (item.id)}
        <a
          href="/media/{item.mediaType}/{item.mediaId}?service={item.serviceId}"
          class="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-cream/[0.03]"
        >
          {#if item.mediaPoster}
            <img src={item.mediaPoster} alt="" class="h-16 w-11 shrink-0 rounded object-cover" />
          {/if}
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-cream">{item.mediaTitle}</p>
            <p class="text-xs text-muted">Added by {item.addedByName ?? 'unknown'}</p>
          </div>
        </a>
      {/each}
    </div>

    {#if isEditor}
      <button
        class="fixed bottom-6 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-accent shadow-lg text-[#0a0a12]"
        onclick={() => showAddSearch = true}
      >
        <Plus size={24} />
      </button>
    {/if}
  {:else}
    <div class="flex flex-col gap-2">
      {#each activity as entry}
        <p class="text-xs text-muted">{activityText(entry)} <span class="text-muted/50">· {timeAgo(entry.createdAt)}</span></p>
      {/each}
      {#if activity.length === 0}
        <p class="text-center text-xs text-muted/50 py-8">No activity yet</p>
      {/if}
    </div>
  {/if}
</div>

<!-- Add Items Search Modal -->
{#if showAddSearch}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20 backdrop-blur-sm"
    onclick={(e) => { if (e.target === e.currentTarget) showAddSearch = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') showAddSearch = false; }}
    role="dialog"
    aria-modal="true"
  >
    <div class="w-full max-w-lg rounded-xl border border-cream/[0.06] bg-[#12121a] p-4 shadow-2xl">
      <input
        bind:value={searchQuery}
        placeholder="Search media to add..."
        class="mb-3 w-full rounded-lg border border-cream/[0.06] bg-cream/[0.03] px-3 py-2 text-sm text-cream placeholder:text-muted"
        onkeydown={(e) => { if (e.key === 'Enter') searchMedia(); }}
      />
      {#if searchResults.length > 0}
        <div class="max-h-80 overflow-y-auto">
          {#each searchResults as result}
            <button
              class="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-cream/[0.04]"
              onclick={() => addItemFromSearch(result)}
            >
              {#if result.poster}
                <img src={result.poster} alt="" class="h-12 w-8 rounded object-cover" />
              {/if}
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-cream">{result.title}</p>
                <p class="text-xs text-muted">{result.type} {result.year ? `· ${result.year}` : ''}</p>
              </div>
              <Plus size={16} class="shrink-0 text-accent" />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
```

**Important notes for the implementer:**
- The `getCollection` function from `social.ts` returns `CollectionDetail` which has `items`, `members`, and `userRole`.
- Check what fields `items` includes — it should have `id`, `mediaId`, `serviceId`, `mediaType`, `mediaTitle`, `mediaPoster`, `addedBy`, `position`.
- The `addedByName` field may not exist on items — you may need to extend `getCollection` to join usernames for each item's `addedBy` field.
- The search API at `/api/search` may not exist as a JSON endpoint — check if `unifiedSearch` is exposed via API. If not, you'll need to create a simple search API endpoint or use the existing search page's server load pattern.
- The DELETE endpoint for collection items at `/api/collections/[id]/items` sends `{ itemId }` in the body — verify the existing endpoint matches this contract. If it uses a URL param (`/api/collections/[id]/items/[itemId]`), adjust accordingly.

- [ ] **Step 2: Verify collection detail page**

Run: `pnpm dev`, create a collection, add items, navigate to it.
Expected: Desktop shows sidebar + grid. Mobile shows hero + list with tab toggle.

- [ ] **Step 3: Commit**

```bash
git add src/routes/library/collections/\[id\]/+page.svelte
git commit -m "feat(library): add responsive collection detail page with activity feed"
```

---

## Chunk 4: Media Detail Integration + Homepage

### Task 14: WatchlistButton component

**Files:**
- Create: `src/lib/components/WatchlistButton.svelte`

- [ ] **Step 1: Create the watchlist button**

Create `src/lib/components/WatchlistButton.svelte`:

```svelte
<script lang="ts">
  import { Bookmark } from 'lucide-svelte';

  interface Props {
    mediaId: string;
    serviceId: string;
    mediaType: string;
    mediaTitle: string;
    mediaPoster?: string;
    isFavorited?: boolean;
    size?: 'sm' | 'md';
  }

  let {
    mediaId,
    serviceId,
    mediaType,
    mediaTitle,
    mediaPoster,
    isFavorited = $bindable(false),
    size = 'md'
  }: Props = $props();

  let loading = $state(false);

  async function toggle() {
    if (loading) return;
    loading = true;

    if (isFavorited) {
      // Need the favorite ID to remove — fetch it first
      const listRes = await fetch(`/api/user/favorites`);
      if (listRes.ok) {
        const favorites = await listRes.json();
        const match = favorites.find((f: any) => f.mediaId === mediaId && f.serviceId === serviceId);
        if (match) {
          await fetch(`/api/user/favorites?id=${match.id}`, { method: 'DELETE' });
          isFavorited = false;
        }
      }
    } else {
      const res = await fetch('/api/user/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId, serviceId, mediaType, mediaTitle, mediaPoster })
      });
      if (res.ok) isFavorited = true;
    }

    loading = false;
  }

  const sizeClass = $derived(size === 'sm' ? 'h-8 w-8' : 'h-10 w-10');
  const iconSize = $derived(size === 'sm' ? 16 : 20);
</script>

<button
  class="flex {sizeClass} items-center justify-center rounded-lg transition-all
    {isFavorited
    ? 'bg-accent/20 text-accent'
    : 'bg-cream/[0.06] text-muted hover:bg-cream/[0.12] hover:text-cream'}
    {loading ? 'animate-pulse' : ''}"
  onclick={toggle}
  title={isFavorited ? 'In Watchlist' : 'Add to Watchlist'}
  disabled={loading}
>
  <Bookmark size={iconSize} fill={isFavorited ? 'currentColor' : 'none'} />
</button>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/WatchlistButton.svelte
git commit -m "feat(library): add WatchlistButton component with toggle"
```

---

### Task 15: AddToCollectionModal component

**Files:**
- Create: `src/lib/components/AddToCollectionModal.svelte`

- [ ] **Step 1: Create the modal**

Create `src/lib/components/AddToCollectionModal.svelte`:

```svelte
<script lang="ts">
  import { Check, Plus } from 'lucide-svelte';

  interface Props {
    open: boolean;
    mediaId: string;
    serviceId: string;
    mediaType: string;
    mediaTitle: string;
    mediaPoster?: string;
    onclose: () => void;
  }

  let { open = $bindable(false), mediaId, serviceId, mediaType, mediaTitle, mediaPoster, onclose }: Props = $props();

  let collections = $state<any[]>([]);
  let loading = $state(true);
  let newName = $state('');
  let creating = $state(false);

  $effect(() => {
    if (open) loadCollections();
  });

  async function loadCollections() {
    loading = true;
    const res = await fetch('/api/collections');
    if (res.ok) {
      const all = await res.json();
      // Check which collections already contain this item
      collections = await Promise.all(
        all.map(async (c: any) => {
          const detailRes = await fetch(`/api/collections/${c.id}`);
          const detail = detailRes.ok ? await detailRes.json() : { items: [] };
          const hasItem = detail.items?.some((i: any) => i.mediaId === mediaId && i.serviceId === serviceId);
          return { ...c, hasItem };
        })
      );
    }
    loading = false;
  }

  async function toggleCollection(collectionId: string, hasItem: boolean) {
    if (hasItem) {
      // Remove from collection — find the item ID first
      const detailRes = await fetch(`/api/collections/${collectionId}`);
      if (detailRes.ok) {
        const detail = await detailRes.json();
        const item = detail.items?.find((i: any) => i.mediaId === mediaId && i.serviceId === serviceId);
        if (item) {
          await fetch(`/api/collections/${collectionId}/items`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId: item.id })
          });
        }
      }
    } else {
      await fetch(`/api/collections/${collectionId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId, serviceId, mediaType, mediaTitle, mediaPoster })
      });
    }
    // Refresh state
    collections = collections.map(c =>
      c.id === collectionId ? { ...c, hasItem: !hasItem } : c
    );
  }

  async function createAndAdd() {
    if (!newName.trim()) return;
    creating = true;
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
      newName = '';
      await loadCollections();
    }
    creating = false;
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onclick={(e) => { if (e.target === e.currentTarget) { open = false; onclose(); } }}
    onkeydown={(e) => { if (e.key === 'Escape') { open = false; onclose(); } }}
    role="dialog"
    aria-modal="true"
  >
    <div class="w-full max-w-sm rounded-xl border border-cream/[0.06] bg-[#12121a] p-4 shadow-2xl">
      <h3 class="mb-3 text-sm font-semibold text-cream">Add to Collection</h3>

      {#if loading}
        <p class="py-4 text-center text-xs text-muted">Loading...</p>
      {:else}
        <div class="mb-3 max-h-60 overflow-y-auto">
          {#each collections as c}
            <button
              class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-cream/[0.04]"
              onclick={() => toggleCollection(c.id, c.hasItem)}
            >
              <div class="flex h-5 w-5 items-center justify-center rounded border {c.hasItem ? 'border-accent bg-accent/20' : 'border-cream/20'}">
                {#if c.hasItem}<Check size={12} class="text-accent" />{/if}
              </div>
              <span class="flex-1 truncate text-sm text-cream">{c.name}</span>
              <span class="text-xs text-muted">{c.itemCount ?? 0}</span>
            </button>
          {/each}
        </div>

        <!-- New collection inline -->
        <div class="flex gap-2 border-t border-cream/[0.06] pt-3">
          <input
            bind:value={newName}
            placeholder="New collection name..."
            class="flex-1 rounded-lg border border-cream/[0.06] bg-cream/[0.03] px-3 py-1.5 text-xs text-cream placeholder:text-muted"
            onkeydown={(e) => { if (e.key === 'Enter') createAndAdd(); }}
          />
          <button
            class="flex items-center gap-1 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-50"
            disabled={!newName.trim() || creating}
            onclick={createAndAdd}
          >
            <Plus size={12} /> Create
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/AddToCollectionModal.svelte
git commit -m "feat(library): add AddToCollectionModal with checkbox toggle and inline create"
```

---

### Task 16: Integrate watchlist button + collection modal into media detail page

**Files:**
- Modify: `src/routes/media/[type]/[id]/+page.server.ts`
- Modify: `src/routes/media/[type]/[id]/+page.svelte`

- [ ] **Step 1: Add watchlist state to server load**

In `src/routes/media/[type]/[id]/+page.server.ts`, the `getUserFavorites` import was already added in Task 17 Step 1. Before the `return` statement (around line 366), add:

```typescript
// ── Watchlist state ─────────────────────────────────────────
let isInWatchlist = false;
if (userId) {
  const favorites = getUserFavorites(userId);
  isInWatchlist = favorites.some(f => f.mediaId === params.id && f.serviceId === serviceId);
}
```

Add `isInWatchlist` to the return object.

- [ ] **Step 2: Add WatchlistButton and AddToCollectionModal to the page**

In `src/routes/media/[type]/[id]/+page.svelte`:

**Imports** — add at top of `<script>` block (around line 13 where other lucide imports are):

```typescript
import WatchlistButton from '$lib/components/WatchlistButton.svelte';
import AddToCollectionModal from '$lib/components/AddToCollectionModal.svelte';
```

**State** — add near other state declarations (around line 233 where `isFavorited` is):

```typescript
let isInWatchlist = $state(data.isInWatchlist);
let showCollectionModal = $state(false);
```

**WatchlistButton + Add to Collection button** — insert BEFORE the Back button at line 785 (`<button class="act-back">`). The action row is at line 739 (`<div class="anim action-row">`):

```svelte
              <WatchlistButton
                mediaId={data.item.sourceId}
                serviceId={data.serviceId}
                mediaType={data.item.type}
                mediaTitle={data.item.title}
                mediaPoster={data.item.poster}
                bind:isFavorited={isInWatchlist}
                size="sm"
              />
              <button
                class="act-back"
                onclick={() => showCollectionModal = true}
                title="Add to Collection"
              >
                <ListVideo size={14} />
                Collection
              </button>
```

**Modal** — add at the very end of the component, before the closing `</style>` tag:

```svelte
<AddToCollectionModal
  bind:open={showCollectionModal}
  mediaId={data.item.sourceId}
  serviceId={data.serviceId}
  mediaType={data.item.type}
  mediaTitle={data.item.title}
  mediaPoster={data.item.poster}
  onclose={() => showCollectionModal = false}
/>
```

- [ ] **Step 3: Verify the integration**

Run: `pnpm dev`, navigate to any media detail page.
Expected: Bookmark icon appears next to Play. Clicking toggles watchlist state. "..." menu has "Add to Collection..." option that opens modal with collection checkboxes.

- [ ] **Step 4: Commit**

```bash
git add src/routes/media/\[type\]/\[id\]/+page.server.ts src/routes/media/\[type\]/\[id\]/+page.svelte
git commit -m "feat(library): integrate watchlist button and collection modal into media detail"
```

---

### Task 17: Friend activity section on media detail

**Files:**
- Modify: `src/routes/media/[type]/[id]/+page.server.ts`
- Modify: `src/routes/media/[type]/[id]/+page.svelte`

- [ ] **Step 1: Load friend activity in server**

In `src/routes/media/[type]/[id]/+page.server.ts`:

**Import** — add at top of file with other imports:

```typescript
import { getUserFavorites, getMediaFriendActivity } from '$lib/server/social';
```

**Load data** — before the `return` statement (around line 366), add:

```typescript
// ── Friend activity ─────────────────────────────────────────
let friendActivity: { watched: any[]; watching: any[]; shared: any[]; watchlisted: any[] } = { watched: [], watching: [], shared: [], watchlisted: [] };
if (userId) {
  try {
    friendActivity = getMediaFriendActivity(userId, params.id, serviceId);
  } catch { /* silent */ }
}
```

Add `friendActivity` to the return object.

- [ ] **Step 2: Display friend activity in the page**

In `src/routes/media/[type]/[id]/+page.svelte`, find an appropriate location below the media metadata (below description, above similar items). Add a friends section:

```svelte
{#if data.friendActivity.watched.length > 0 || data.friendActivity.watchlisted.length > 0 || data.friendActivity.shared.length > 0}
  <section class="mt-6 rounded-xl bg-cream/[0.02] p-4">
    <h3 class="mb-3 text-sm font-semibold text-cream">Friends</h3>
    <div class="flex flex-col gap-2">
      {#each data.friendActivity.watchlisted as f}
        <p class="text-xs text-muted">
          <span class="font-medium text-cream/80">{f.display_name ?? f.username}</span> has this in their watchlist
        </p>
      {/each}
      {#each data.friendActivity.watched as f}
        <p class="text-xs text-muted">
          <span class="font-medium text-cream/80">{f.display_name ?? f.username}</span> watched this
        </p>
      {/each}
      {#each data.friendActivity.shared as f}
        <p class="text-xs text-muted">
          <span class="font-medium text-cream/80">{f.sender_username ?? 'A friend'}</span> shared this with you
        </p>
      {/each}
    </div>
  </section>
{/if}
```

- [ ] **Step 3: Verify**

Run: `pnpm dev`, navigate to an item a friend has interacted with.
Expected: Friends section appears showing watchlist/watched/shared status.

- [ ] **Step 4: Commit**

```bash
git add src/routes/media/\[type\]/\[id\]/+page.server.ts src/routes/media/\[type\]/\[id\]/+page.svelte
git commit -m "feat(library): add friend activity section to media detail page"
```

---

### Task 18: Homepage "Updated in Your Collections" row

**Files:**
- Modify: `src/lib/server/homepage-cache.ts`

- [ ] **Step 1: Add collection activity row to homepage cache**

In `src/lib/server/homepage-cache.ts`, add imports:

```typescript
import { getRecentCollectionActivity } from './collection-activity';
import { getRawDb } from '$lib/db';
```

(`getRawDb` may already be imported — check first and only add if missing.)

In `buildHomepageCache()`, after the existing row building logic (but before `applyRowOrder`), add a new row:

```typescript
// "Updated in Your Collections" row
try {
  const raw = getRawDb();
  const recentActivity = getRecentCollectionActivity(userId, 7, 10);
  if (recentActivity.length > 0) {
    // Group by collection, take unique collections
    const seenCollections = new Set<string>();
    const collectionItems: HomepageItem[] = [];

    for (const entry of recentActivity) {
      if (seenCollections.has(entry.collectionId)) continue;
      seenCollections.add(entry.collectionId);
      if (!entry.targetMediaId) continue;

      // Look up the collection item for poster, mediaType, and serviceId
      const ci = raw.prepare(
        `SELECT media_poster, media_type, service_id FROM collection_items
         WHERE collection_id = ? AND media_id = ? LIMIT 1`
      ).get(entry.collectionId, entry.targetMediaId) as {
        media_poster: string | null; media_type: string; service_id: string;
      } | undefined;

      collectionItems.push({
        id: `col-activity-${entry.id}`,
        sourceId: entry.targetMediaId,
        serviceId: ci?.service_id ?? '',
        serviceType: '',
        title: entry.targetTitle ?? 'Unknown',
        poster: ci?.media_poster ?? undefined,
        mediaType: ci?.media_type ?? 'movie',
        context: `Added to ${entry.collectionName}`,
      });
    }

    if (collectionItems.length >= 1) {
      rows.push({
        id: 'collection-updates',
        title: 'Updated in Your Collections',
        type: 'system',
        items: collectionItems
      });
    }
  }
} catch { /* silent — collection activity is optional */ }
```

Add `'collection-updates'` to the `DEFAULT_ROW_ORDER` array.

**Note:** The items may lack posters since activity entries only store `target_media_id`. The implementer should either:
1. Store `target_poster` in the activity table (requires schema change), OR
2. Look up posters from `collection_items` by `media_id`, OR
3. Accept that these items may show without posters (with fallback icons).

Option 2 is simplest — query `collection_items` for the poster:

```typescript
const raw = getRawDb();
const posterRow = raw.prepare(
  `SELECT media_poster FROM collection_items WHERE media_id = ? LIMIT 1`
).get(entry.targetMediaId) as { media_poster: string | null } | undefined;
```

- [ ] **Step 2: Verify**

Run: `pnpm dev`, add items to a collection from another user, refresh homepage.
Expected: "Updated in Your Collections" row appears with recently-added items.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/homepage-cache.ts
git commit -m "feat(library): add 'Updated in Your Collections' homepage row"
```

---

## Post-Implementation Notes

### Music Playlist Variant (deferred)
The music/video playlist variant for collections (Play All, Shuffle, track list UI) is spec'd but should be built as a follow-up once the core collection detail page is stable. The detection logic (all items `mediaType` in `music/album/track` or all `video`) can be added as a conditional render in the collection detail component.

### Drag-to-Reorder (deferred)
Drag-to-reorder for collection items requires a drag library (e.g., `@neodrag/svelte` or HTML5 drag API). The `reorderCollectionItems` backend function and `/api/collections/[id]/reorder` endpoint are ready. Implement the drag UI as a follow-up.

### Search API
The search API already exists at `src/routes/api/search/+server.ts`. It returns `{ items, total }` and accepts `?q=query&source=library&type=filter`. The add-items modal in the collection detail page uses this endpoint.
