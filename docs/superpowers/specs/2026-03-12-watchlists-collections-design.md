# Watchlists & Collections Design

## Goal

Give users a personal watchlist queue and shared named collections, surfacing existing backend infrastructure (collections, favorites, social) through a cohesive UI.

## Architecture

Two layers:

1. **My Watchlist** — a single per-user queue backed by the existing `userFavorites` table. Quick toggle from any media detail page. Viewable with optional per-type filtering.
2. **Named Collections** — backed by existing `collections`, `collectionItems`, `collectionMembers` tables. Support private, friends-visible, and public visibility. Role-based collaboration (owner/editor/viewer) with activity feed.

Music/video-only collections get special playlist UI (album art, track list, Play All / Shuffle).

## Data Model

### Existing Tables (minor changes noted)

- **`userFavorites`** — the watchlist. Fields: id, userId, mediaId, serviceId, mediaType, mediaTitle, mediaPoster, position, createdAt. Note: `removeUserFavorite(userId, favoriteId)` takes the row `id`, not `mediaId`. The watchlist page must pass the row `id` through each card for removal.
- **`collections`** — named collections. Fields: id, name, description, creatorId, visibility (private|friends|public), createdAt, updatedAt. Note: `updateCollection()` currently allows editors to change visibility/name — needs restricting to owner-only for visibility changes.
- **`collectionItems`** — items in a collection. Fields: id, collectionId, mediaId, serviceId, mediaType, mediaTitle, mediaPoster, addedBy, position, createdAt.
- **`collectionMembers`** — collaborators. Fields: collectionId, userId, role (owner|editor|viewer), addedAt. Note: `removeCollectionMember()` currently only allows owner to remove others — need to add self-leave support (member removes themselves).

### New Table

**`collection_activity`** — activity feed for collections.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| collection_id | TEXT NOT NULL | FK to collections |
| user_id | TEXT NOT NULL | who performed the action |
| action | TEXT NOT NULL | `add_item`, `remove_item`, `join`, `leave`, `update` |
| target_title | TEXT | title of added/removed item |
| target_media_id | TEXT | mediaId of affected item |
| created_at | INTEGER NOT NULL | unix ms timestamp |

Index on `(collection_id, created_at DESC)`.

### Music Playlist Detection

A collection renders as a music playlist when ALL items have `mediaType` in `('music', 'album', 'track')`, or as a video playlist when ALL have `mediaType = 'video'`. Derived at render time from `collectionItems` — no schema flag needed. The canonical media types used by the app are: `movie`, `show`, `episode`, `music`, `album`, `track`, `video`, `book`, `game`, `live`.

## Routes

| Route | Description |
|-------|-------------|
| `/library` | Redirects to `/library/watchlist` |
| `/library/watchlist` | Personal watchlist queue |
| `/library/collections` | Owned + joined collections grid |
| `/library/shared` | Items shared directly by friends |
| `/library/collections/[id]` | Collection detail page |

### `/library/watchlist`

- Full-page poster grid of all watchlisted items
- Filter chips: All, Movies, Shows, Music, Books, Games
- Sort: Date Added (default), Title, Year
- Each card has quick-remove X on hover
- Empty state: "Your watchlist is empty — browse and add items"

### `/library/collections`

- Grid of collection cards (2x2 poster collage, title, item count, member count, visibility badge)
- "New Collection" button top-right
- Collections where user is viewer show "shared" indicator
- Sections: "My Collections" (owned), "Joined" (member of)

### `/library/shared`

- List of items shared directly to user by friends (existing `sharedItems` table)
- Shows sender avatar/name, media card, timestamp, seen/unseen status
- Mark as seen on view
- Unseen count shown as badge on nav item

### `/library/collections/[id]`

**Desktop (>=768px):** Sidebar (280px fixed) + poster grid.

Sidebar contains:
- 2x2 poster collage from first 4 items
- Title (editable inline for owner)
- Description (editable inline for owner)
- Visibility badge — clickable to change for owner
- Member avatars + "Invite" button (owner/editors)
- Activity feed (20 per page, scrollable, load-more pagination)

Poster grid:
- Standard MediaCard components
- Drag-to-reorder for owner/editors
- Remove button on hover for owner/editors
- "Add Items" button at end of grid (opens search modal)

**Mobile (<768px):** Hero banner (gradient collage) with title + metadata overlaid. Below: list view with poster thumbnail, title, year/rating, "added by" attribution. Swipe-left to remove (editors), with trash icon button as fallback. Floating "+" FAB to add items. Activity accessible via tab toggle above list.

**Music/video playlist mode:** When all items are music or all video:
- Album art replaces poster cards
- Track/video list replaces grid
- "Play All" / "Shuffle" buttons in header
- Queue ordering as primary interaction

## Media Detail Page Integration

### Watchlist Button

- Prominent bookmark icon next to the Play button
- Filled state when in watchlist, outline when not
- Single click toggles add/remove
- Tooltip: "Add to Watchlist" / "In Watchlist"
- Animated fill transition

### Add to Collection

- Located in the existing "..." dropdown menu
- "Add to Collection..." menu item opens a modal/popover
- Shows user's collections with checkboxes (item can be in multiple)
- Checked state for collections already containing this item
- "New Collection" option at bottom for inline creation

### Analytics Events

Both actions emit existing event types: `add_to_watchlist`, `remove_from_watchlist`, `add_to_collection`, `remove_from_collection`.

### Friend Activity

Below media detail metadata, show a "Friends" section if any friends:
- Have this item in their watchlist
- Have watched it
- Shared it with user

Extends existing `getMediaFriendActivity()` from `social.ts` — the current function returns `{ watched, watching, shared }` but does NOT query watchlists. A new query against `userFavorites` for friend IDs must be added to include watchlist membership.

## Sharing & Collaboration

### Inviting Members

Owner clicks "Invite" on collection detail. Searches friends by username. Assigns role:
- **Editor** — can add/remove items, reorder
- **Viewer** — read-only access

Adding a member is immediate (uses existing `addCollectionMember()`). A notification of type `collection_invite` is created for the invitee with `href` linking to `/library/collections/[id]`. New notification type must be added to the notifications schema. No accept/reject flow — members are added directly and can leave voluntarily via self-remove.

### Visibility Levels

- **Private** — only creator and invited members can see
- **Friends** — all creator's friends can view (edit requires invite as editor)
- **Public** — anyone on the Nexus instance can view, shareable by link

### Activity Feed

Written to `collection_activity` on every mutation:
- "Parker added Hereditary" (add_item)
- "Echo removed The Thing" (remove_item)
- "Logan joined" (join)
- "Parker updated description" (update)

Displayed in collection detail sidebar (desktop) or activity tab (mobile). 20 entries per page, load-more pagination.

### Homepage Integration

New homepage row: "Updated in Your Collections" — shows collection cards (2x2 poster collage, collection name, latest activity summary) for collections where members recently added items. Queries `collection_activity` filtered to collections the user is a member of, last 7 days. Only surfaces if there's recent activity. Depends on `collection_activity` table — must be built after task #1/#2.

## Nav Sidebar

Add "Library" section with sub-items:
- Watchlist (bookmark icon)
- Collections (grid icon)
- Shared (share icon, with unseen count badge)

## Existing Backend Coverage

Most backend logic already exists in `src/lib/server/social.ts` (1037 lines):

| Feature | Function | Status |
|---------|----------|--------|
| Create collection | `createCollection()` | Exists |
| Get collection | `getCollection()` | Exists |
| List user collections | `getUserCollections()` | Exists |
| Update collection | `updateCollection()` | Exists |
| Delete collection | `deleteCollection()` | Exists |
| Add collection item | `addCollectionItem()` | Exists |
| Remove collection item | `removeCollectionItem()` | Exists |
| Add member | `addCollectionMember()` | Exists |
| Remove member | `removeCollectionMember()` | Exists |
| Get/add/remove favorites | `getUserFavorites()`, `addUserFavorite()`, `removeUserFavorite()` | Exists |
| Reorder favorites | `reorderUserFavorites()` | Exists |
| Share item | `shareItem()` | Exists |
| Get shared items | `getSharedItems()` | Exists |
| Unseen share count | `getUnseenShareCount()` | Exists |
| Friend activity on media | `getMediaFriendActivity()` | Exists |
| Collection activity log | — | **New** |
| Activity feed queries | — | **New** |

API endpoints also exist for collections (`/api/collections/*`), favorites (`/api/user/favorites`), and shared items (`/api/shared`).

## What Needs Building

1. **`collection_activity` table** — schema + migration
2. **Activity logging** — wrap existing `social.ts` collection mutations to also write activity entries
3. **Backend fixes to `social.ts`**:
   - Restrict `updateCollection()` visibility changes to owner-only
   - Add self-leave support to `removeCollectionMember()` (member can remove themselves)
   - Add `reorderCollectionItems()` function (batch position update, similar to `reorderUserFavorites()`)
   - Extend `getMediaFriendActivity()` to include watchlist membership query
4. **`collection_invite` notification type** — add to notifications schema, create on member add
5. **`/library/*` route pages** — watchlist, collections grid, shared items, collection detail
6. **Collection detail page** — responsive sidebar+grid / hero+list layout
7. **Music playlist variant** — detect and render music/video-only collections differently
8. **Watchlist button** — on media detail page, prominent toggle
9. **"Add to Collection" modal** — in media detail dropdown menu
10. **Friend activity section** — on media detail page
11. **Nav sidebar update** — add Library section with sub-items + unseen share count badge
12. **Homepage row** — "Updated in Your Collections" from activity feed (depends on #1/#2)
