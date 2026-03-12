# Requests Page — Status Fix + Unified Admin View

**Date:** 2026-03-12
**Scope:** `src/lib/adapters/overseerr.ts`, `src/lib/adapters/types.ts`, `src/routes/requests/+page.server.ts`, `src/routes/requests/+page.svelte`

## Problem

Two issues with the current `/requests` page:

1. **Inaccurate status display.** Items already in the Jellyfin library still show "Processing" because `normalizeRequest()` only reads the Overseerr *request* status (`req.status`: 2=approved) and ignores the *media* status (`req.media.status`: 5=available). An approved request whose media has fully downloaded stays labeled "Processing" indefinitely. Note: Overseerr request statuses are 1=pending, 2=approved, 3=declined — there is no request status 4 or 5. The existing `case 4: return 'available'` in `mapRequestStatus()` is dead code. Availability is determined solely from `media.status`.

2. **Disconnected admin experience.** Admins see their own requests in a rich "My Requests" tab and a bare-bones "Pending" tab with tiny cards and no metadata. The two views share no visual language and force tab-switching to manage requests while also tracking your own.

## Design

### 1. Status Accuracy Fix

**`overseerr.ts` — `normalizeRequest()`**

After determining request status via `mapRequestStatus(req.status)`, check the media object:

```
const mediaStatus = req.media?.status;
if (mediaStatus === 5) → 'available'     // fully in library
if (mediaStatus === 4) → 'partial'       // some seasons/parts available
else                   → mapRequestStatus(req.status)  // existing logic
```

When `req.media` is undefined (brand-new request not yet picked up by Sonarr/Radarr), `mediaStatus` is `undefined` and falls through to the existing logic.

Also remove the dead `case 4` from `mapRequestStatus()` and add a comment explaining availability comes from `media.status`.

**`types.ts` — `NexusRequest.status`**

Add `'partial'` to the union:
```ts
status: 'pending' | 'approved' | 'declined' | 'available' | 'partial';
```

**`+page.svelte` — status labels and helpers**

| Status      | Label               | Color   |
|-------------|---------------------|---------|
| `pending`   | Awaiting Approval   | amber   |
| `approved`  | Processing          | accent  |
| `available` | In Library          | teal    |
| `partial`   | Partially Available | teal    |
| `declined`  | Not Approved        | warm    |

Update all status-dependent code:
- `statusLabel()`: add `case 'partial': return 'Partially Available'`
- `statusStep()`: `'partial'` returns `2` (same as `'available'` — it is in the library)
- `filteredMyRequests`: the `'available'` filter must also match `'partial'`
- `myCounts.available`: count must include `'partial'` items

The status journey visualization (Requested → Approved → Ready dots) remains for non-admin "My Requests" but is replaced by inline badge in the admin unified view for compactness.

### 2. Unified Admin View

**Server — `+page.server.ts`**

For admins, replace the separate `adminPending` fetch with `allRequests` — fetches ALL requests via admin API key (filter: `'all'`, no `userCred`). Cache key: `'requests:admin-all'`, TTL: 30s. Non-admins continue fetching only their own requests. Remove the old `adminPending` fetch and its cache key `'requests:admin-pending'`.

```
return {
  myRequests,                    // user's own (all users)
  allRequests: isAdmin ? [...] : [],  // everyone's (admin only, no userCred)
  isAdmin,
  ...
};
```

For admins, `myRequests` is still fetched (via user cred) to identify which requests are the admin's own (for the "You" badge). `allRequests` uses the admin API key with no `userCred` to avoid triggering the auto-linked user filter in `getRequests()`.

**Tab structure**

| User type | Tabs                          |
|-----------|-------------------------------|
| Non-admin | Discover \| My Requests       |
| Admin     | Discover \| Requests          |

The separate "Pending" tab is removed. Admins get a single "Requests" tab that replaces both "My Requests" and "Pending."

Update `type Tab = 'discover' | 'mine' | 'requests'` — `'mine'` for non-admins, `'requests'` for admins. Remove `'pending'`.

**Unified "Requests" tab (admin)**

Filter sub-tabs with counts:
- All | Pending | Processing | In Library | Declined

Card layout (compact style):
- Left: poster thumbnail (40×60)
- Center: title (+ "You" badge if own request), year · type · rating, requester avatar (first letter) + name + relative time + status badge
- Right: Approve/Deny buttons on pending items, Watch button on available items

The "You" badge is identified by building a `Set<string>` from `myRequests.map(r => r.sourceId)` and checking if each item in `allRequests` has a matching `sourceId`. This is more reliable than comparing user IDs across different auth contexts.

**Non-admin "My Requests"**

Switches to the same compact card style for visual consistency. No requester name (always you). Keeps the existing status journey dots (Requested → Approved → Ready) since there are fewer cards and the journey visualization adds value for tracking your own requests.

### 3. Filter Logic

Admin filter sub-tabs map to:
- **All**: no filter
- **Pending**: `status === 'pending'`
- **Processing**: `status === 'approved'`
- **In Library**: `status === 'available' || status === 'partial'`
- **Declined**: `status === 'declined'`

Non-admin filter sub-tabs (unchanged from current, but updated for `'partial'`):
- **All**: no filter
- **In Progress**: `status === 'pending' || status === 'approved'`
- **Ready**: `status === 'available' || status === 'partial'`
- **Declined**: `status === 'declined'`

### 4. Data Flow

```
Overseerr API
  ├─ /request?filter=all (admin key, no userCred) → allRequests
  └─ /request?filter=all (user cred) → myRequests
       │
       ▼
  normalizeRequest()
    ├─ req.status → mapRequestStatus() → base status
    └─ req.media.status → override if 5 (available) or 4 (partial)
       │
       ▼
  +page.svelte
    ├─ Admin: unified tab with allRequests, "You" badge via myRequests sourceId Set
    └─ Non-admin: My Requests tab with myRequests only
```

### 5. Files Changed

| File | Change |
|------|--------|
| `src/lib/adapters/types.ts` | Add `'partial'` to `NexusRequest.status` |
| `src/lib/adapters/overseerr.ts` | Check `req.media.status` in `normalizeRequest()`, remove dead `case 4` from `mapRequestStatus()` |
| `src/routes/requests/+page.server.ts` | Replace `adminPending` with `allRequests` fetch for admins, update cache keys |
| `src/routes/requests/+page.svelte` | Unified admin tab, updated `Tab` type, status labels/helpers, compact cards, filter logic for `'partial'` |
