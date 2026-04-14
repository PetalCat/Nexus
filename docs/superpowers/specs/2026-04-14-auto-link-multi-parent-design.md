# Auto-linking + Multi-parent — Design

**Date:** 2026-04-14
**Scope:** How Nexus derived-tier adapters (Overseerr, Streamystats, future) get auto-linked from a user's linked parent services, with explicit consent, per-service parent choice, and support for simultaneous Plex + Jellyfin. Merged spec because auto-linking and multi-parent are too intertwined to separate cleanly.
**Status:** Proposed, pending Parker approval.
**Depends on:** [`2026-04-14-service-account-umbrella-design.md`](./2026-04-14-service-account-umbrella-design.md) (approved), [`2026-04-14-adapter-contract-design.md`](./2026-04-14-adapter-contract-design.md) (approved), [`2026-04-14-settings-ux-rework-design.md`](./2026-04-14-settings-ux-rework-design.md) (UI consumer)
**Tracking:** ProjectOS Nexus #2 — *Pluggable adapter architecture*.

## Problem

Today's auto-linking (in `src/routes/api/user/credentials/+server.ts:autoLink`) is silent, parent-ambiguous, and has no user consent model. Specific problems enumerated in the umbrella braindump:

1. **Silent cascade** — linking Jellyfin automatically links every derived service that matches, with no user visibility.
2. **First-parent-wins** — Overseerr `derivedFrom: ['jellyfin', 'plex']` picks whichever parent the iteration hits first. User can't choose.
3. **Match failures are silent** — if `getUsers` on Overseerr doesn't return a match for the Jellyfin user, the auto-link silently fails and the user never knows why.
4. **No retry affordance** — the accounts page has a weak "retry" button that doesn't explain what's failing.
5. **No "change parent"** — once Overseerr is auto-linked via Jellyfin, switching to Plex means unlinking and starting over.
6. **Derived services can't coexist with multiple parents** — if Parker is linked to both Jellyfin and Plex, Overseerr picks one and forgets the other exists.
7. **Stale parent cascades** — when a parent credential goes stale, derived services keep trying to use it. No graceful degradation.
8. **No user opt-out** — users can't say "never auto-link Overseerr even if I link Jellyfin."

This spec defines the auto-linking model in detail: when it fires, how consent works, how parent choice surfaces when multiple parents are available, what happens on failure, and how the `findAutoLinkMatch` adapter method from the contract gets orchestrated.

## Architecture

### The auto-link trigger points

Auto-linking runs at exactly these moments:

1. **After a user links a parent service.** Specifically: any time `upsertUserCredential` creates or updates a `user_service_credentials` row for a service whose adapter has `userAuth.userLinkable && !userAuth.derivedFrom`. The new credential triggers a scan for dependent derived adapters.
2. **When a user clicks "Retry auto-link" on a specific derived service** in `/settings/accounts` (replacing today's weak retry button with an explicit, user-initiated action).
3. **When a user clicks "Change parent" on an already-linked derived service** to re-evaluate against a different parent.

**Not at:** Nexus login, session refresh, scheduled cron, or any background job. Auto-linking is strictly user-initiated; there are no implicit passes.

### The consent model

Auto-linking never happens silently. There are exactly three consent UI modes, picked based on context:

#### Mode 1 — Batch consent dialog (triggered on parent link)

When the user just linked a parent service and Nexus finds N candidate derived services that could be auto-linked, it shows a modal inline within the page the user is on:

```
┌─────────────────────────────────────────────────────────┐
│  You connected Jellyfin                                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Nexus can auto-connect these services using your       │
│  Jellyfin account:                                      │
│                                                         │
│  ☑ Overseerr                                            │
│     Request management. Found parker@example.com        │
│                                                         │
│  ☑ Streamystats                                         │
│     Viewing analytics. Uses your Jellyfin token.        │
│                                                         │
│  ☐ Tautulli                                             │
│     Playback statistics. No matching account found.     │
│     [Sign in manually →]                                │
│                                                         │
│                          [Skip all]  [Connect selected]│
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Behavior:**
- Each candidate checked by default IF `findAutoLinkMatch` returns a non-null result. Unchecked if no match found (with an inline "Sign in manually" fallback link).
- User can uncheck, skip all, or cancel.
- On confirm, each checked service's `findAutoLinkMatch` result is committed to `user_service_credentials` with `auto_linked = 1` and `parent_service_id = <the service row id>`.
- Dialog is dismissible without affecting the parent link that just happened.

#### Mode 2 — Inline per-service consent (triggered from `/welcome` or `/settings/accounts`)

When the user is browsing the list of available services and clicks *"Auto-link from Jellyfin"* on a specific derived service, no modal — the action runs inline with a toast on success and an error banner on failure. This is the lightweight path for users who already decided.

#### Mode 3 — Parent picker (when multiple parents could derive)

When a derived service has multiple linked parents available (Overseerr with both Jellyfin and Plex linked), linking it — whether via Mode 1 or Mode 2 — opens a parent picker first:

```
┌─────────────────────────────────────────────────────────┐
│  Connect Overseerr from a parent service                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Which account should Nexus use to connect Overseerr?   │
│                                                         │
│  ○ Jellyfin                                             │
│     Found: parker@example.com                           │
│                                                         │
│  ○ Plex                                                 │
│     Found: parker-plex                                  │
│                                                         │
│  ○ Neither — sign in manually                           │
│                                                         │
│                          [Cancel]  [Connect]            │
└─────────────────────────────────────────────────────────┘
```

Each option runs `findAutoLinkMatch` against that parent and shows the discovered external username (*"Found: parker@example.com"*) if a match exists. If a parent has no match, its radio option is disabled with an inline explanation.

**Once the user picks a parent, the credential is stored with that parent's `service_id` in `parent_service_id`.** The choice is remembered and used for future refreshes, probes, and reconnects.

### The `findAutoLinkMatch` orchestration

Per the adapter contract spec, each derived adapter implements `findAutoLinkMatch(config, parent: LinkedParentContext)`. The shared registry orchestrates:

```ts
// src/lib/adapters/registry/auto-link.ts

interface AutoLinkCandidate {
  serviceId: string;
  serviceName: string;
  adapter: NexusAdapter;
  parentServiceId: string;
  parentContext: LinkedParentContext;
  matchResult: UserCredentialResult | null;  // null = no match found
  matchError?: AdapterAuthError | Error;
}

/**
 * After a user links a parent service, find all derived candidates and
 * evaluate findAutoLinkMatch against each. Returns a list the UI can
 * render for consent. Does NOT commit any credentials — that's the
 * UI's job after the user confirms.
 */
export async function enumerateAutoLinkCandidates(
  userId: string,
  justLinkedServiceId: string
): Promise<AutoLinkCandidate[]>;

/**
 * Commit one or more auto-link candidates. Called after the user
 * confirms the consent dialog. Stores credentials, sets auto_linked=1
 * and parent_service_id, invalidates caches.
 */
export async function commitAutoLinkCandidates(
  userId: string,
  candidates: AutoLinkCandidate[]
): Promise<void>;

/**
 * Enumerate all candidates for a specific derived service, across every
 * currently-linked parent. Used by the parent-picker UI in Mode 3.
 */
export async function enumerateParentsForService(
  userId: string,
  serviceId: string
): Promise<AutoLinkCandidate[]>;
```

**Parallelism:** candidate enumeration runs all `findAutoLinkMatch` calls in parallel with a 10s per-call timeout. Failures don't block other candidates — each gets reported independently.

**Side effects:** candidate enumeration is read-only. It never writes to the DB. Only `commitAutoLinkCandidates` writes.

### Per-user auto-link preferences

Each Nexus user has a set of preferences stored in a new table `user_auto_link_prefs`:

```sql
CREATE TABLE user_auto_link_prefs (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id    TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  auto_link_enabled  INTEGER NOT NULL DEFAULT 1,   -- user wants auto-link to run for this service
  preferred_parent_service_id  TEXT REFERENCES services(id) ON DELETE SET NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, service_id)
);
```

- `auto_link_enabled` — when false, the consent dialog skips this service in its candidate list. Default 1.
- `preferred_parent_service_id` — when set, the parent picker defaults to this parent and only asks if the preferred parent isn't available. Default null (no preference, always ask).

Preferences are managed via `/settings/accounts` → each derived service row has an "Auto-link preferences" expander with a toggle and a parent selector. The first time a user picks a parent in Mode 3, they're offered to save it as the default: *"[ ] Always use Jellyfin for Overseerr"*.

### Multi-parent simultaneous support

Per the umbrella decision: **per-service parent choice**. Each derived credential has exactly one `parent_service_id` at a time. Not an array. Never two.

**Implications:**
- A user linked to both Jellyfin and Plex can have Overseerr linked via either (but not both at once).
- Switching parents on an existing credential uses the "Change parent" action: re-runs `findAutoLinkMatch` against the new parent, overwrites the credential if it succeeds, reports the error if it fails.
- Other users on the same Nexus install might have Overseerr linked via a different parent. Each user's `user_service_credentials.parent_service_id` is independent.

**What's explicitly NOT supported in this pass:**
- A single derived credential linking to BOTH Jellyfin and Plex at once. No dual-parent records.
- Automatic "linked via both" inference. The user always picks one.
- Federation / cross-user parent sharing.

### Cascade rules

When a parent credential is unlinked, derived credentials linked to it need handling. Rules:

1. **Default cascade = unlink derived credentials that depend on the parent.** Confirmation dialog shows the cascade impact:
   ```
   Unlinking Jellyfin will also unlink:
     - Overseerr  (linked via Jellyfin)
     - Streamystats  (linked via Jellyfin, required parent)

   [Cancel]  [Unlink all]
   ```
2. **Override: "keep derived credentials"** — checkbox in the unlink dialog. When checked, derived credentials are kept but marked stale (since their parent is gone). User can re-parent them later.
3. **Exception: `parentRequired === true` derived adapters** — Streamystats can't function without Jellyfin. The "keep" option is disabled for these; they cascade-unlink unconditionally.
4. **Changing a parent credential (not unlinking)** — e.g., the user re-auths Jellyfin after the token expired — does NOT cascade. Derived credentials continue using the now-refreshed parent.

### Stale parent handling

When a parent credential's `staleSince` is set:

1. **Derived credentials are NOT automatically marked stale.** They might still work (e.g., Streamystats cached the token separately).
2. **On next use of a derived credential, if the adapter throws `AdapterAuthError('expired')` AND the parent is stale:** the shared registry surfaces a different error kind, `parent-stale`, which the UI renders as: *"Your Overseerr session expired because its parent (Jellyfin) also needs to reconnect. [Reconnect Jellyfin →]"*.
3. **Reconnecting the parent** does not automatically re-link derived services — but the "Reconnect" button in the stale banner on the derived service's context becomes operational again.

### Failure-message catalog

Every auto-link failure mode has explicit copy:

| Scenario | Message |
|---|---|
| `findAutoLinkMatch` returns null (no match found) | *"No matching [service] account found for your [parent] user. [Sign in manually →]"* |
| `findAutoLinkMatch` throws `AdapterAuthError('unreachable')` | *"Can't reach [service]. Check that it's running and reachable."* |
| `findAutoLinkMatch` throws `AdapterAuthError('invalid')` | *"The [service] admin credentials look invalid. Ask your admin to check [service] config."* |
| Parent credential is stale when auto-link is attempted | *"Can't auto-link [service] because your [parent] session expired. [Reconnect parent →]"* |
| Match succeeds but `probeCredential` on the new credential fails | *"Auto-linked [service], but the credential isn't working. [Try again] or [Sign in manually →]"* |
| Multiple parents available but none yield a match | *"Neither of your linked parent services has a matching [service] account. [Sign in manually →]"* |
| `parentRequired === true` and no parent linked | *"[service] requires [parents]. [Connect Jellyfin →]"* |

Errors are rendered inline in the consent dialog (Mode 1), as toasts (Mode 2), or in the parent picker (Mode 3). Never silent.

## Data flow — worked examples

### Example 1 — Happy path: new user links Jellyfin for the first time

1. User types Jellyfin credentials in the Welcome flow (`/welcome` Mode 1 from settings UX spec). `authenticateUser` succeeds, `user_service_credentials` row inserted for Jellyfin.
2. Shared registry's post-link hook calls `enumerateAutoLinkCandidates(userId, jellyfinServiceId)`.
3. Registry iterates all registered adapters, finds `overseerrAdapter` and `streamystatsAdapter` with `jellyfin` in their `userAuth.derivedFrom`.
4. For each, calls `findAutoLinkMatch(config, parentContext)` in parallel.
   - Overseerr: calls its admin API, finds user `parker@example.com` matching `jellyfinUserId === parent.parentExternalUserId`. Returns match.
   - Streamystats: copies the Jellyfin access token, validates against its API. Returns match.
5. Returns `[{ overseerr, match: {...} }, { streamystats, match: {...} }]`.
6. Welcome flow renders the Mode 1 batch consent dialog with both pre-checked.
7. User clicks Connect. `commitAutoLinkCandidates` writes two credential rows with `auto_linked = 1`, `parent_service_id = <jellyfin id>`.
8. Welcome flow advances to phase 3 (summary) showing all three services connected.

### Example 2 — Parent picker: user with both Jellyfin and Plex links Overseerr

1. User is in `/settings/accounts`, sees Overseerr in "Available to link", clicks *"Auto-link from parent"*.
2. UI calls `enumerateParentsForService(userId, overseerrServiceId)`.
3. Registry returns `[{ parent: 'jellyfin', match: parker@example.com }, { parent: 'plex', match: parker-plex }]`.
4. UI opens the Mode 3 parent picker modal. Both options enabled, no default.
5. User picks Jellyfin. Modal closes, credential is committed with `parent_service_id = <jellyfin id>`. Toast: *"Connected Overseerr via Jellyfin"*.
6. Overseerr row moves from "Available to link" to "Linked accounts" with a *"Linked via Jellyfin"* sub-label.
7. Under Overseerr's expander, the auto-link preferences show: *"Preferred parent: Jellyfin"* (set automatically because the user made an explicit choice).

### Example 3 — Match failure: Jellyfin linked, Overseerr has no matching user

1. User links Jellyfin.
2. Registry enumerates candidates. For Overseerr, `findAutoLinkMatch` calls Overseerr's admin API, gets a user list, looks for one with `jellyfinUserId === parent.parentExternalUserId`, finds nothing.
3. Returns `matchResult: null` with no error.
4. Mode 1 consent dialog renders Overseerr with an unchecked box and the inline message: *"No matching account found. Ask your admin to enable Jellyfin sign-in on Overseerr, or sign in manually."*
5. User clicks *"Sign in manually"*, which opens `AccountLinkModal` for Overseerr pre-populated with no prefill. User enters their Overseerr password.
6. If successful, Overseerr gets linked directly (not derived). `auto_linked = 0`, `parent_service_id = null`.

### Example 4 — Cascade on parent unlink

1. User is in `/settings/accounts`, clicks Unlink on Jellyfin.
2. UI shows confirmation modal with cascade preview:
   ```
   Unlinking Jellyfin will also unlink:
     - Overseerr  (linked via Jellyfin)
     - Streamystats  (linked via Jellyfin, required parent)

   ☐ Keep Overseerr linked (you can re-parent it later)

   [Cancel]  [Unlink all]
   ```
3. The "Keep Overseerr" option is enabled because Overseerr has `parentRequired: false`. Streamystats has `parentRequired: true` so it always cascades.
4. User leaves the checkbox unchecked, confirms. Three credentials deleted.
5. All three rows move from "Linked accounts" to "Available to link" in `/settings/accounts`.

## Testing

1. **Registry tests** (vitest):
   - `enumerateAutoLinkCandidates` with mock adapters returning various match results (match, no-match, error)
   - Parallel execution with one slow adapter (timeout after 10s)
   - `commitAutoLinkCandidates` writes correct DB rows
   - `enumerateParentsForService` across multiple parents
2. **Consent-flow tests** (playwright):
   - Full happy path from Example 1
   - Parent picker with multiple parents (Example 2)
   - Match failure fallback (Example 3)
   - Cascade unlink confirmation (Example 4)
3. **Preferences tests**:
   - `auto_link_enabled = 0` skips a service in the candidate list
   - `preferred_parent_service_id` auto-selects in the parent picker when available
4. **Failure-message tests**:
   - Each row of the failure catalog renders the correct copy given the right error state

## Out of scope

- **Auto-linking on session refresh or cron** — strictly user-initiated.
- **Dual-parent derived credentials** — one parent at a time per credential.
- **Cross-user parent sharing** — each user's parent choice is independent.
- **Match algorithms beyond `findAutoLinkMatch`** — each adapter defines its own. No global fuzzy matching.
- **Migration of existing auto-linked credentials** — existing rows get `auto_linked = 1` in the schema migration and their current `linked_via` gets translated to `parent_service_id` best-effort. Rows that can't be migrated keep working but lose the UI affordances.
- **Auto-link policy for admins** — admins might want to set "always auto-link derived services for every user on this install by default." This is mentioned in the settings UX spec as an `/admin/services` toggle but the enforcement details are deferred to implementation.

## Parker decisions baked in

- **Explicit consent, never silent** — Mode 1 / Mode 2 / Mode 3 all require the user to confirm
- **Per-service parent choice** — one parent per derived credential, user picks when ambiguous
- **Multi-parent simultaneous via per-service choice** — Parker's 2026-04-14 call
- **Parker-level mix of per-service and batch consent** — Mode 1 is batch (for the just-linked-parent moment), Mode 2 is inline per-service (for settings browsing), Mode 3 is the parent picker
- **No silent cascade on parent unlink** — confirmation dialog with explicit cascade preview
- **Failure messages are actionable** — every failure mode has specific next-step copy

## Open questions

*None — scope is clear, decisions resolved in the umbrella. If implementation surfaces issues, append here.*
