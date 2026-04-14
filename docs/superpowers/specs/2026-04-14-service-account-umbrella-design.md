# Nexus Service + Account Architecture — Umbrella Design

**Date:** 2026-04-14
**Status:** Proposed, pending Parker approval. **This is the only umbrella spec in the initiative — other specs are deferred until this one is resolved.**
**Tracking:** ProjectOS Nexus #2
**Inputs:** `docs/superpowers/braindumps/2026-04-14-service-account-model-braindump.md`, existing adapter contract spec, existing Invidious auth+UX spec.

## Purpose

Establish the shared vocabulary, data model, and user-facing contract for how Nexus thinks about **services** (things Nexus talks to) and **accounts** (who is talking). This document is the home for cross-cutting architectural decisions. The six focused sub-specs (adapter contract revision, plugin loader, auto-linking, multi-parent, settings UX rework, Invidious consumer) all reference this spec as their source of truth for terminology and data model.

Everything concrete here is up for Parker review. Several decisions are deliberately flagged as "resolved inside this spec" rather than deferred because the downstream specs need them settled to move forward.

## Terminology

These terms are used consistently across all specs in this initiative. Where current code uses different words for the same concept, the refactor is implicit — renaming happens as part of each sub-spec's implementation.

**Service**
A registered integration point — one row in the `services` table. Examples: *"the Jellyfin at `10.10.10.5:8096`"*, *"the Invidious at `invidious.example.com`"*. Services are global: there's one Jellyfin service shared by all Nexus users. The admin owns this row.

**Adapter**
The code that knows how to talk to a particular type of service. One adapter per service type (`jellyfin`, `invidious`, `calibre`, `radarr`, etc.). Adapters are stateless — they take a `ServiceConfig` and optional `UserCredential` as inputs on every call. Adapters live in `src/lib/adapters/`.

**Service config**
The runtime snapshot of a service row, passed to adapter methods. Has the service URL and any admin-scoped auth material.

**Credential** *(new umbrella term)*
The auth material used to talk to a service. Credentials come in two flavors:

- **Admin credential** — auth material owned by the Nexus install, used for management operations (list users, create users, reset passwords) and for unauthenticated reads. Stored on the `services` row as `username`/`password` or `api_key`. Nexus admins manage this during setup and rarely change it. Examples: Radarr API key, Jellyfin admin account password, Overseerr admin API key.
- **User credential** — auth material owned by a specific Nexus user, used for their personal interactions with the service. Stored on the `user_service_credentials` row as `access_token`. Examples: Parker's Jellyfin user token, Parker's Invidious SID cookie.

**Not every service has both.** Radarr has only admin credentials (no per-user concept). Invidious has only user credentials (no admin surface). Jellyfin has both. Overseerr has both but uses admin for most API calls and stores only the user's external ID.

**Link** *(as a verb)*
The act of creating a user credential for a particular user × service pair. *"Parker linked Jellyfin"* means Parker authenticated against Jellyfin and Nexus stored a user credential for Parker → Jellyfin. Distinct from the admin registering the Jellyfin service in the first place.

**Unlink**
Delete a user credential. Does not affect the service's admin credential or other users' credentials for the same service.

**Manual link vs auto-link**
A manual link is a user typing credentials into a sign-in modal. An auto-link is Nexus deriving a credential from a parent service (e.g. finding Parker's Overseerr account by matching his Jellyfin user ID). Auto-linking is a convenience — not a different kind of link in the data model.

**Managed account**
An account on an external service that Nexus *created* on behalf of a user, as opposed to linking to a pre-existing account. Flagged via `user_service_credentials.managed = true`. Matters for cleanup: unlinking a managed account optionally deletes the external account too.

**Parent / derived**
A derived service is one whose user credentials can be obtained from another service's credentials. Overseerr can derive from Jellyfin (by matching user IDs); Streamystats can derive from Jellyfin (by copying the Jellyfin token directly). The "other service" is the parent. Declared by the adapter as `derivedFrom: ['jellyfin', 'plex']`.

**Stale credential**
A credential that stopped working (session/token expired, password changed upstream, service was reinstalled). Tracked via a new `stale_since` column. Surfaced in the UI. Auto-healed via the refresh machinery if the user opted into password storage.

## Current data model — what's there and what's wrong

```
services
  id, name, type, url, api_key?, username?, password?, enabled, created_at, updated_at
```

One row per registered service. `username`/`password`/`api_key` are the admin credential (whichever field the adapter uses).

**Problems:**
- The `username` / `password` / `api_key` fields are labeled generically but mean different things per adapter. For Jellyfin they're an admin Jellyfin account. For Overseerr they're the admin API key. For Invidious they're often empty. For Streamystats the `username` field is repurposed as "Jellyfin URL to proxy through" — completely different semantics.
- No column distinguishes "this is Nexus's admin auth material" from "this is configuration metadata." They're all stored together.
- No column tracks health of the admin credential itself. If an admin API key rotates, Nexus has no way to surface that.

```
user_service_credentials
  id, user_id, service_id, access_token?, external_user_id?, external_username?,
  linked_at, managed, linked_via
```

One row per (user, service) pair. `access_token` is the user's auth material. `external_user_id` / `external_username` are the identity on the remote service. `linked_via` is the *parent service type* (e.g. `'jellyfin'`) if this credential was auto-linked.

**Problems:**
- No `stored_password` — can't auto-refresh when the token dies.
- No `stale_since` — can't distinguish "healthy" from "probably broken but we haven't checked."
- `linked_via` stores a type string, not a service ID. If two Jellyfin services exist, the derived credential has no way to tell which Jellyfin it came from.
- No `parent_service_id` — a derived credential can't point at its specific parent. Blocks multi-parent support.
- `managed: boolean` is overloaded with "Nexus created this account" semantics but the UI uses it as a "show delete affordance" signal too.

## Target data model

**Destructive migrations allowed.** Parker explicitly called out (2026-04-14) that defensive additive-only posturing is wrong for dev — design the schema you actually want and drop legacy fields cleanly. This section describes the target shape, not the diff from today.

### `services` table — target shape

```sql
CREATE TABLE services (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL,
  type                        TEXT NOT NULL,          -- adapter type key
  url                         TEXT NOT NULL,
  enabled                     INTEGER NOT NULL DEFAULT 1,

  -- Admin credential, adapter-specific fields
  admin_url_override          TEXT,                   -- optional alt URL for admin calls
  admin_api_key               TEXT,                   -- encrypted if present
  admin_username              TEXT,
  admin_password              TEXT,                   -- encrypted if present

  -- Admin credential health
  admin_cred_stale_since      TEXT,                   -- ISO timestamp or null
  admin_cred_last_probed_at   TEXT,                   -- ISO timestamp or null

  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
);
```

Changes from today:
- `api_key` / `username` / `password` get renamed to `admin_api_key` / `admin_username` / `admin_password` to explicitly mark them as admin-scoped. No more overloading the bare field names.
- New `admin_url_override` column for adapters that need a second URL (e.g. Streamystats's "Jellyfin URL I'm proxying" that currently hides in the `username` field). Gets rid of that abuse.
- New health-tracking columns `admin_cred_stale_since` and `admin_cred_last_probed_at`.

### `user_service_credentials` table — target shape

```sql
CREATE TABLE user_service_credentials (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id           TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,

  -- Identity on the remote service
  external_user_id     TEXT,
  external_username    TEXT,

  -- Auth material
  access_token         TEXT,                   -- encrypted; SID, JWT, or whatever the adapter uses
  stored_password      TEXT,                   -- encrypted, nullable; enables auto-refresh
  extra_auth           TEXT,                   -- adapter-specific JSON, nullable

  -- Management metadata
  nexus_managed        INTEGER NOT NULL DEFAULT 0,  -- renamed from `managed`; true = Nexus created the account
  auto_linked          INTEGER NOT NULL DEFAULT 0,  -- true = created by auto-link flow, not manual sign-in
  parent_service_id    TEXT REFERENCES services(id) ON DELETE SET NULL,

  -- State tracking
  linked_at            TEXT NOT NULL,
  stale_since          TEXT,                        -- ISO timestamp or null
  last_probed_at       TEXT,                        -- ISO timestamp or null

  UNIQUE(user_id, service_id)
);
```

Changes from today:
- `managed` renamed to `nexus_managed` — clearer semantics, matches the Nexus-owns-it contract.
- `linked_via` **dropped entirely**. Replaced by `parent_service_id` which points at the actual parent service row. If you need to know the parent's *type*, join to `services`.
- New `stored_password` column — encrypted, nullable, enables auto-refresh.
- New `stale_since` and `last_probed_at` — credential health tracking.
- New `auto_linked` flag — distinguishes credentials created by the auto-link flow from credentials the user typed in manually.
- New `extra_auth` JSON column for adapter-specific auth state that doesn't fit `access_token` (e.g. refresh tokens, device IDs, OAuth session state). Nullable; adapters that don't need it ignore it.

### Migration approach

1. Generate a new migration via `pnpm db:generate` that reflects the target schema directly (not a series of additive patches).
2. Migration drops renamed/removed columns; Drizzle handles the DDL.
3. Any existing data that matters gets copied in the migration's data-transform step (e.g. `managed` → `nexus_managed`).
4. Dev DBs can be blown away entirely if the migration is messy — that's the whole point of dev.

**Open migration question:** do we want the migration to be a single comprehensive change, or do we split it by concern (one for the service admin-cred rename, one for user_service_credentials extensions, one for drops)? Prefer comprehensive for dev but fine to split if the review is easier. Flag for the settings UX sub-spec to resolve when it touches this code.

## Credential types and the "tier" question — resolved

The braindump flagged a tension between my original tier naming (server-level / user-standalone / user-derived) and the admin-vs-user dimension. Resolution:

**Tiers stay, but they describe the *user* dimension only.**

```
tier: 'server' | 'user-standalone' | 'user-derived'
```

A *separate* capability flag declares whether the adapter needs admin credentials:

```ts
capabilities: {
  adminAuth?: {
    /** Does this adapter use admin credentials at all? */
    required: boolean;
    /** Which fields on services row does it consume? */
    fields: ('url' | 'apiKey' | 'username' | 'password')[];
    /** Is this adapter capable of health-probing its own admin credential? */
    supportsHealthProbe: boolean;
  };
  userAuth?: AdapterAuthCapabilities;  // from adapter contract spec
}
```

**Cross-matrix:**

| | `capabilities.adminAuth.required` | `capabilities.userAuth.userLinkable` |
|---|---|---|
| Radarr | yes (API key) | no |
| Sonarr | yes (API key) | no |
| Prowlarr | yes (API key) | no |
| Bazarr | yes (API key) | no |
| Jellyfin | optional (only for user management) | yes |
| Overseerr | yes (admin API key) | yes |
| Calibre | optional | yes |
| Invidious | no | yes |
| Kavita | optional | yes |
| Plex | yes (X-Plex-Token) | yes |
| RomM | yes (admin token) | yes |
| Streamystats | derives parent | derives parent |

This is cleaner than forcing the admin-vs-user question into the tier dimension. Tier describes *how user credentials are obtained*. AdminAuth describes *what management material the service requires*. They're orthogonal.

**Adapter contract spec revision required:** split the existing `authCapabilities` into `adminAuth` and `userAuth`, add the cross-matrix, update the method-requirements table accordingly.

## Account linking lifecycle

From first principles, ignoring current code. What does the lifecycle of a user × service pair look like?

### States

A user × service pair is in exactly one of these states at any time:

1. **Unregistered** — admin hasn't added this service to Nexus. Not visible to users.
2. **Registered, unlinked** — service exists in Nexus but the user has no credential for it. (Common starting state for every new user after the admin has set up the service.)
3. **Linked, healthy** — user has a valid credential for the service. Reads and writes work.
4. **Linked, stale** — user has a credential that stopped working. Reads may or may not still work (depends on when the last call was made). Writes throw `AdapterAuthError`.
5. **Linked, broken** — user credential exists but is known-bad (stored password no longer authenticates, service was removed upstream). Permanently broken until manual intervention.

### Transitions

- **Unregistered → Registered:** admin adds the service via the setup wizard or services admin page. Independent of any user.
- **Registered → Linked:** user authenticates against the service via one of:
  - Manual sign-in (sign-in modal with username/password)
  - Auto-link from a parent service (derived adapters only; requires explicit user consent per the auto-link spec)
  - Managed account creation (adapter creates a new account on behalf of the user)
- **Linked, healthy → Linked, stale:** detected by `probeCredential` returning `'expired'`, or by any adapter call throwing `AdapterAuthError('expired')`. `stale_since` column gets populated.
- **Linked, stale → Linked, healthy:** auto-refresh (via `refreshCredential` using stored password) or manual re-auth (user clicks "Reconnect" in the UI). `stale_since` cleared.
- **Linked, stale → Linked, broken:** auto-refresh fails because stored password no longer works. Or user chose not to store a password, and manual reconnect also fails. Credential is flagged as needing user attention.
- **Linked, broken → Registered:** user unlinks, starts fresh.
- **Linked (any) → Registered:** user unlinks explicitly. Deletes the `user_service_credentials` row. For managed accounts, optionally deletes the upstream account too.

### Side effects of state changes

- **Linking any parent service** triggers auto-link evaluation for all derived services that have this type in their `derivedFrom` list. Auto-link prompts the user for consent (per the auto-linking spec, forthcoming), then creates `user_service_credentials` rows with `auto_linked = 1` and `parent_service_id = <the newly-linked service>`.
- **Unlinking a parent service** cascades to derived services by default (with user confirmation). The cascade can be overridden per derived service — unlinking Jellyfin doesn't have to unlink Overseerr if the user explicitly chose a non-Jellyfin path.
- **Unlinking a derived service** does NOT affect the parent.
- **A credential going stale** does NOT cascade to derived services automatically — each derived service has its own credential that may still be healthy. But refresh attempts on a derived service whose parent is stale should fail fast with a clear error.

## Auto-linking — user control

This section is the scaffolding for a future focused spec, not the spec itself.

The braindump confirms auto-linking should be **explicit-consent, user-controllable, multi-parent-aware**. Concrete requirements that flow from that:

1. **Never silent.** Every auto-link prompts the user first. No background cascade.
2. **Per-service granularity.** When parent linking triggers auto-link evaluation, the user sees a dialog listing all candidate derived services and can accept/decline each one individually. Default-checked for services that have a high-confidence match, default-unchecked for ones that don't.
3. **Parent choice.** When a derived service has multiple potential parents linked (e.g. Overseerr with both Jellyfin and Plex), the user picks which parent to use. Not "first one wins."
4. **Change parent later.** A derived service's `parent_service_id` can be reassigned via a "Change parent" action on the accounts page. Triggers re-evaluation of the match against the new parent.
5. **Opt out entirely.** Per-service toggle: "Never auto-link this service from any parent." Remembered across sessions.
6. **Clear failure modes.** When auto-link fails (no match found, match found but credential rejected, parent stale), the UI explains why in plain language and offers a next step ("Sign in manually →").

The actual matching function, consent dialog shape, and failure-message catalog are deferred to the auto-linking sub-spec.

## Multi-parent simultaneously

Also scaffolding for a future focused spec.

**Resolved in this umbrella:** per-service parent choice (Parker decision). A user can be linked to both Jellyfin and Plex. Each derived service picks one or the other at link time. Overseerr can be "linked via Jellyfin" while Streamystats is "linked via Plex." The user chooses; Nexus does not guess.

**Implication for the data model:** `parent_service_id` is a single column, not an array. If a future adapter genuinely needs dual-parent (Overseerr linked to BOTH Jellyfin and Plex at once), we revisit. For now, keep it singular.

**Implication for library dedup:** out of scope. Users who link both get duplicate library rows until a future dedup pass ships. That's acceptable for the first version.

**Implication for derived-service linking UX:** when multiple parents are available, the link flow gets an extra step — "Link Overseerr via: [Jellyfin] [Plex] [Both — not supported, pick one]". Default is whichever parent was linked first.

## Settings information architecture

The page-level plan. Specifics (layouts, components) live in the settings UX sub-spec; this section defines the route structure and what lives where.

```
/settings/                     # NEW: user-level settings landing page
  +page.svelte                 # index listing each user-level settings section

/settings/accounts             # EXISTING: reworked
  +page.svelte                 # the user's linked accounts, health, management

/settings/playback             # EXISTING: unchanged in this pass

/settings/notifications        # EXISTING: unchanged in this pass

/settings/profile              # EXISTING: unchanged in this pass

/admin/                        # NEW: admin-only top-level section (Parker decision)
  services/                    # Manage service rows (add/edit/remove)
  users/                       # Manage Nexus users (promote/demote, invite links)
```

The **`/admin/*` top-level subtree** is new and deliberately separate from `/settings/*` — Parker's call (2026-04-14) for maximum visual distinction between "things that affect only me" and "things that affect everyone on this Nexus install." Today's "services admin page" lives somewhere else and is reachable inconsistently; this consolidates it under `/admin/services/`.

Non-admins can reach `/settings/` and its children. `/admin/*` returns 403 for non-admins.

**Clear visual distinction** between user-level and admin-level settings pages via page chrome (different header style, explicit "Admin" label, red accent). No more ambiguity about which credential a given page is managing.

## Onboarding narratives

Three user classes, three flows. Each needs clarity for the specific thing that user is doing.

### Admin, first-run (Nexus install has zero users)

Current state: `/setup` wizard handles this. Runs when `getUserCount() === 0`. Collects admin account creation + initial service registration.

**Remaining gaps:**
- Wizard doesn't currently prompt for which user-level services the admin wants to auto-configure for all users
- No "default to auto-link on" vs "default to auto-link off" server-wide toggle
- Admin never sees the "regular user" flow so they don't learn where it's broken

**Target:** wizard ends with the admin logged in as both admin AND a regular user, with all their own credentials linked (so they exercise the flow while setting it up).

### Regular user, first-run (registered but hasn't linked any services yet)

Current state: **doesn't exist.** New users log in and land on the home page with no guidance. They may not even realize they should link anything.

**Target:** a first-run flow that runs once (flagged on the user row) showing:
1. *"Welcome to Nexus. Let's connect your accounts."*
2. For each user-level service registered on this Nexus install, show a card with:
   - Service name, description, what linking unlocks
   - Options: **Sign in** (opens link modal) / **Auto-link from [parent]** (if applicable) / **Create managed account** (if supported) / **Skip**
3. Present services in dependency order (parents before children) so auto-link offers are meaningful.
4. End with a summary: *"You linked 3 services. 2 skipped. You can change these anytime under Settings → Accounts."*
5. Mark flow complete; don't run again unless the user resets it.

The first-run flow is a NEW route, probably `/welcome` or `/onboarding`, not shoehorned into `/setup` (which is admin-only). Detailed in the settings UX sub-spec.

### Returning user

Current state: straight to home page.

**Target:** unchanged, except that the home page now shows **inline sign-in affordances** (from the Invidious spec but generalized) when a user-level service is registered but unlinked, and shows **stale-credential banners** when a credential has gone bad. Users don't need to think about account management unless something's broken.

### Existing users at rollout (transition policy)

**Parker decision 2026-04-14:** existing users do NOT see the first-run flow retroactively. They get the new inline sign-in affordances and stale banners when they visit relevant pages, and they can re-trigger the full welcome flow manually via a *"Run onboarding again"* button in `/settings/accounts`. No forced interruption. The welcome flow runs automatically only for users created after the rollout date.

## Managed account ownership and lifecycle

Resolved via brainstorm 2026-04-14. This section is normative.

### Ownership model: "Nexus owns it, user leases it"

When Nexus creates an account on a downstream service on behalf of a user (via `adapter.createUser`), that account is a **managed account**. The ownership contract:

- **Nexus owns the password.** At creation time, Nexus generates a random strong password, stores it encrypted in `user_service_credentials.stored_password`, and **never shows it to the user**. The user can't log in to the downstream service directly with that password because they don't know it.
- **The user leases the account for as long as they're linked.** All interactions with the downstream service flow through Nexus. Nexus rotates the password on its own schedule if needed.
- **Nexus is responsible for cleanup.** When the user unlinks, Nexus deletes the downstream account by default (see unlink semantics below).
- **The `external_user_id` and `external_username` belong to the user.** Their identity on the downstream service is theirs — the account is discoverable by that identity even though the password isn't shared.

This is cleaner than "the password is the user's random string, go change it if you want" because it avoids the split-brain problem where a user changes their Jellyfin password externally and then Nexus can't re-auth.

### Per-credential granularity

The `managed: boolean` flag on `user_service_credentials` stays. Each credential row independently decides whether it's managed or user-owned. This means:

- Parker can have a managed Jellyfin account (Nexus created it) while another Nexus user has a user-owned Jellyfin account (they had one before Nexus existed and linked it manually). Same underlying Jellyfin service.
- The UI shows a distinct badge for managed credentials: *"Managed by Nexus"* vs *"Linked"*.
- Users can't flip the flag arbitrarily — transitioning from managed to owned requires the migration path (below).

### Unlink semantics — confirm then delete by default

Default behavior: unlinking a managed account shows a confirmation modal with destructive framing:

> **Unlink managed account**
>
> This will also **delete the account on Jellyfin** (`jellyfin.parker.dev`). This action cannot be undone.
>
> External username: `parker`
> Linked since: Apr 14, 2026
>
> [ ] Keep the downstream account *(only if migration path was previously taken)*
>
> [**Delete account and unlink**] [Cancel]

The *"Keep the downstream account"* checkbox is **only visible and checkable if the credential has been migrated to owned** (see below). Without migration, the default action is delete-because-Nexus-owns-it.

For non-managed (user-owned) credentials, the unlink flow is simpler:

> **Unlink**
>
> This will remove your Jellyfin credential from Nexus. Your Jellyfin account stays intact.
>
> [Unlink] [Cancel]

### Managed → owned migration path

Parker's ask: *"I also feel like there should optionally be a migration path for managed."* This is a real-world escape hatch for users who want to leave Nexus but keep the accounts it created for them.

The migration concept: convert a managed account to a user-owned account, handing the user the password they need to authenticate directly.

**Proposed flow** (subject to the managed-account sub-spec):

1. User navigates to the managed credential in `/settings/accounts` and clicks **"Convert to my account"** (or similar).
2. A confirmation modal explains: *"You'll take ownership of this account. Nexus will give you the current password, and you should change it on [service] immediately. After conversion, unlinking won't delete the account."*
3. Modal shows a one-time password reveal: the encrypted `stored_password` is decrypted in-session and shown to the user once (copy-to-clipboard, with a scary "dismiss and lose this forever" affordance).
4. User confirms. The credential row's `managed` flag flips to 0. `stored_password` is cleared (since Nexus no longer has control of it and the user should change it on the downstream service anyway). The credential becomes an ordinary user-owned link.
5. From that point forward, unlinking doesn't delete the downstream account (the "Keep the downstream account" checkbox in the unlink flow becomes selectable).

**Open questions deferred to the managed-account sub-spec:**
- Should the downstream password be *rotated to a new random value* at conversion time (and that new value shown to the user), or should Nexus hand over whatever password it currently has stored? Rotating is safer (the old password was never meant to be shown) but requires an API call to the downstream service and may not be possible for all adapters.
- Is the conversion reversible (owned → managed)? Probably not — once Nexus relinquishes control it can't reliably re-take it.
- Does the migration require a fresh probe/health check before proceeding? Probably yes.

**Data-model implication for this umbrella:** no new columns needed. The existing `managed` boolean + `stored_password` columns already support both states (`managed=1 && stored_password!=null` is managed; `managed=0 && stored_password!=null` is user-owned-with-stored-password; `managed=0 && stored_password=null` is user-owned-without-auto-refresh).

### Creation flow disclosure

At creation time (the "Create Managed Account" flow on the link modal), the user sees:

> **Create a new Jellyfin account**
>
> Nexus will create an account on `jellyfin.parker.dev` for you. It'll manage the password automatically so your sessions refresh without you thinking about it.
>
> - You won't need to sign in to Jellyfin directly
> - If you unlink, the account gets deleted
> - You can take ownership of this account later if you want to keep it independently
>
> Username: [parker________]
>
> [**Create account**] [Cancel]

Clear upfront framing of the Nexus-owns-it contract, with an explicit mention of the migration path.

## Cross-references (the other 6 specs this umbrella ties together)

Each of these is a planned follow-up. They do not need to be written before the umbrella is approved. The umbrella just sets up the expectations they'll fulfill.

1. **Adapter contract (revision of `2026-04-14-adapter-contract-design.md`)** — apply the `adminAuth` / `userAuth` split, add `findAutoLinkMatch` method requirement for derived adapters, reference this umbrella for tier semantics.
2. **Plugin loader (new spec)** — how external plugin bundles are discovered, versioned, and loaded. References the adapter contract for the versioned interface.
3. **Auto-linking (new spec)** — the consent dialog, per-service toggles, parent-choice UX, match-function contract, failure-message catalog.
4. **Multi-parent (new spec)** — library dedup approach, derived-service parent-picker UI, conflict resolution. May fold into the auto-linking spec if they're too intertwined to separate cleanly.
5. **Settings UX rework (new spec)** — the page-by-page design for `/settings/*`, the first-run `/welcome` flow, the inline sign-in component library, the admin-scoped distinction.
6. **Invidious consumer (revision of `2026-04-14-invidious-auth-ux-design.md`)** — become the first real implementation of the umbrella + all sub-specs. Acceptance test for the whole initiative.

## Migration strategy

### Order of work

1. **Umbrella approval** (this doc). Everything else blocks on this.
2. **Schema migration** (the six new columns). Standalone, safe, reversible.
3. **Adapter contract revision** (splits admin/user auth capabilities).
4. **Migrate all adapters** to the revised contract. Server-level adapters get trivially empty `userAuth`. User-level adapters get `probeCredential`, `refreshCredential`, `authCapabilities`.
5. **Settings UX rework** (page rewrite of `/settings/*`, new `/settings/admin/*` subtree, new `/welcome` flow). Depends on the shared components from the adapter contract spec.
6. **Auto-linking + multi-parent** (implementation). Depends on migrated adapters.
7. **Invidious consumer** (the real bug that started all this gets fixed last, using the full stack). Acceptance test.
8. **Plugin loader** (can be done in parallel with 5-7 since it's mostly independent).

### Backward compatibility

- **Destructive migrations are fine in dev** (Parker, 2026-04-14). No preserve-legacy-columns-for-compat posturing.
- **Schema migration** generated via `pnpm db:generate` directly produces the target shape. Drops `linked_via`, renames `managed` → `nexus_managed`, renames `api_key/username/password` → `admin_*`, adds all the new columns in one pass.
- **Existing credentials** get migrated via Drizzle's data-transform step where possible (`managed` → `nexus_managed`, etc). If that's lossy or awkward, dev DBs can be wiped — reseed is cheap.
- **Adapter contract change is breaking at the type level.** Adapters that don't implement the new required methods won't compile. That's intentional — every in-tree adapter gets migrated as part of this initiative, and external plugin authors get a version bump to react to.

## Risks and unknowns

- **Schema changes affect every Nexus install.** The migration is additive so no data loss, but the user-facing schema is now a 3rd-party integration point (plugin adapters reference credential shapes). Version the credential DTOs exported from the contract package.
- **Onboarding for existing users.** When this ships, existing Nexus users already have credentials. The `/welcome` flow should NOT run for them automatically — flag it to run only for users created after the rollout, OR offer it as an opt-in "Re-run onboarding" button in settings.
- **Multi-parent UX complexity.** Linking Overseerr with "via Jellyfin" vs "via Plex" might confuse users who don't understand the distinction. Needs user testing, which we don't have. Mitigation: make the default (whichever was linked first) obvious and the "change parent" action reversible.
- **Plugin contract stability.** Once we publish the contract as the plugin interface, breaking it is painful. Need to be conservative about what we add to required methods in v1 — easier to add optional methods later than to remove required ones.
- **First-run flow for admin vs user.** The admin wizard today runs on empty DB. The user welcome flow runs per-user. These are different code paths but should share the same service-linking components. Risk of divergence.

## Decisions baked in (Parker, 2026-04-14)

- **Umbrella spec first, regroup after** — this is the only spec being written right now; sub-specs are deferred.
- **Per-service parent choice** for multi-parent (not global primary, not multi-link)
- **Mix of explicit-per-service and parent-level-bulk** auto-link consent UI (depends on section)
- **Fold UX rework into this initiative** (not a separate ProjectOS issue)
- **Tier naming deferred** → resolved in this spec via the `adminAuth` / `userAuth` capability split
- **First-run onboarding for regular users is new work** (Partial admin-only wizard exists)
- **Migrate everything** (all 13 adapters, not just userLinkable ones)

## Parker decisions (2026-04-14)

1. **First-run route name** — deferred pending Codex industry-standard research (task in flight). Will update once findings return. Leaning toward `/welcome` or `/onboarding` but not committing yet.
2. **Existing users at rollout** — no retroactive welcome flow. Inline affordances only, plus a *"Run onboarding again"* button in settings. Documented in the onboarding narratives section above.
3. **Admin subtree** — `/admin/*` top-level, separate from `/settings/*`. Maximum visual distinction between user-level and admin-level concerns.
4. **`linked_via` drop plan** — drop it. The target data-model section reflects the clean schema (no `linked_via`). Replaced by `parent_service_id`. Also noted: destructive migrations are fine in dev per Parker's 2026-04-14 feedback, so this rename is explicit, not a gradual transition.
5. **Managed account ownership + unlink semantics** — resolved via brainstorm. See dedicated section below. Summary: Nexus owns managed accounts, user leases them; managed-vs-owned is a per-credential flag; unlinking a managed account confirms-then-deletes the downstream account by default; a managed→owned *migration path* is a future concern that the data model needs to support.

## Out of scope for this initiative

- **Library dedup** when a user is linked to multiple media servers. Shows as duplicates in v1.
- **SSO / SAML / OIDC** for Nexus itself (different problem — user auth to *Nexus*, not to downstream services).
- **Sandboxing third-party plugins.** Plugin loader spec will note it as a v2 concern.
- **Non-linear state machines** (e.g. "temporarily paused but not stale"). Credentials are binary healthy/stale for this pass.
- **Bulk operations on credentials** (mass unlink, mass reconnect). Single-credential actions only.

## Future work enabled by this architecture

Not part of this initiative — but worth calling out because the contract + plugin architecture are what make these tractable downstream. Each of the items below would have been harder or impossible without the formal adapter contract this initiative establishes.

### 1. Nexus as a Wizarr replacement

[Wizarr](https://github.com/Wizarrrr/wizarr) is an existing self-hosted tool that does exactly what Nexus's managed-account system will do: invite-based account creation across Plex, Jellyfin, Emby, AudiobookShelf, Komga, Kavita, and RomM. It's the closest existing reference implementation for the problem space.

**Parker's position (2026-04-14):** Nexus should solve the problem Wizarr solves — natively. Don't write a Wizarr adapter that delegates (that makes Nexus dependent on Wizarr being installed for a core flow); instead, draw inspiration from Wizarr's proven patterns and implement them as part of Nexus's managed-account system.

**Specific things to study from Wizarr** (pending the Codex research currently in flight):
- Invitation-link flow with time-limited tokens (replaces the "user just types their credentials" path)
- Library/profile assignment at invite creation time
- Reclaim / recovery flow for users who lose access
- How Wizarr handles "the downstream account's password was changed externally" edge cases

The managed-account sub-spec will incorporate the findings before committing to any UX details that overlap with Wizarr's surface area.

### 2. MCP server exposing Nexus adapters to AI tools

The adapter contract's surface maps nearly 1:1 to an MCP (Model Context Protocol) tool schema. Once the contract is stable, a thin MCP server can expose every registered adapter as tool calls:

- `nexus.search(query)` → `adapter.search` across all `capabilities.search` adapters, merged and ranked
- `nexus.library.list(type, filter)` → routes to the right `adapter.getLibrary`
- `nexus.media.set_watched(id)` → routes to `adapter.setItemStatus`
- `nexus.calendar.upcoming()` → `adapter.getCalendar` union

Effect: Claude, Cursor, ChatGPT-with-tools, or any MCP-speaking agent can drive the user's entire self-hosted media stack via a single well-known endpoint. Users ask *"what new episodes dropped on my subscriptions this week"* and the assistant resolves it through Nexus.

**Cost:** small. The MCP server is ~200 lines of boilerplate wrapping the registry. **Dependency:** contract has to be stable first — otherwise the MCP tool schema breaks with every revision.

### 3. Federated Nexus

With a stable plugin contract, **Nexus itself becomes an adapter** — one Nexus install can expose itself as a service that another Nexus install can consume. The user-auth model is `authCapabilities.userAuth: true`, the media is the union of whatever the remote Nexus aggregates, the admin cred is an API key the remote Nexus issues.

Effect: share your library with friends by registering their Nexus instance as a service in your own. Privacy, scoping, and permission boundaries are handled by the remote Nexus's normal user-cred model — they don't get direct access to your Jellyfin, Plex, or whatever else. Federation is end-to-end an adapter.

Precondition: contract stability + cross-instance auth story (probably OAuth-style device flow). The data model doesn't need to change for this — it just falls out of the architecture.

### 4. Cross-adapter features unlocked by uniform shapes

Several Nexus backlog issues are cross-adapter features that currently can't ship because every adapter has its own shape. The contract fixes this by guaranteeing uniform shapes for common concepts (rating, age tag, play position, download state, notification event).

- **#49 Unified parental controls** — every adapter exposes an age rating / content rating via a standardized field. One Nexus-level control surface instead of per-service settings that don't talk to each other.
- **#47 Subtitle intelligence** — coordinate Bazarr + Jellyfin + Whisper/AI for auto-gen / auto-translate / auto-sync. Requires uniform subtitle state across adapters.
- **#45 Social watch parties (SyncPlay)** — requires cross-adapter session coordination. Jellyfin has SyncPlay natively; Plex doesn't. With the contract, Nexus can broker sessions across both.
- **#44 AI personal DJ / curator** — unified music library view (Lidarr + Plex + Jellyfin + Spotify-like) through the contract's `media: 'music'` capability.
- **#42 Unified calendar** — partially exists today, contract makes it trivial.
- **#48 Nexus Wrapped** — year-in-review across services requires every adapter to expose play history in a standard shape. The contract defines that shape.

**Effect:** ship 6 existing backlog items much faster once the contract lands. None of these are part of THIS initiative, but the contract is the unblocker.

### 5. Pending adapter backlog as first external plugins

The Nexus issue tracker has 13 unimplemented adapters (#27 Seerr, #28 Kapowarr, #29 Tdarr, #31 Kometa, #32 Maintainerr, #33 Recyclarr, #34 Notifiarr, #35 Unpackerr, #36 Autobrr, #37 Wizarr, #38 Trailarr, #39 Posterizarr, #53 Jackett). The plugin architecture lets these ship as external npm packages (`@nexus-adapter/*`) instead of living in the core repo.

**Priority picks for first real external plugins** (Parker, 2026-04-14):
- **#27 Seerr** — Overseerr/Jellyseerr successor. Validates the "adapter gets upgraded, contract stays the same" story since Nexus already has an Overseerr adapter.
- **#34 Notifiarr** — notification fanout. Exercises the event/webhook emission side of the contract, forcing us to define a standard event story.

These two become acceptance tests for the plugin architecture, like Invidious is the acceptance test for the auth-resilience layer.

### 6. Health dashboard across the whole stack

`probeCredential` + admin-credential probes across all adapters provide everything needed for a stack-wide health page:

- Each service: admin-cred healthy / stale, user-cred healthy / stale / broken, last probe timestamp, last success timestamp, rate-limit state
- Per-user: count of stale credentials, reconnect all button
- Admin: service uptime over time, auth failure trends

Effectively a Grafana-lite for the homelab, with zero external dependencies, powered entirely by the contract.

### 7. Per-user adapter instances (multi-tenant-ish)

Today, services are global — one `services` row, shared across all Nexus users. A natural extension of the user-credential model is **user-scoped services**: "my personal Jellyfin" on the same Nexus install as "the family Jellyfin". Each user can register their own service instances alongside the global ones. The contract already supports this — just needs a `services.owner_user_id` nullable column and UI affordances.

Enables: shared Nexus installs where each user connects their own downstream accounts without polluting the global service list.

### 8. Adapter marketplace

Once plugins are external packages, an in-Nexus UI to browse, install, enable, and update adapters from a community registry (either npm search or a dedicated Nexus-adapter index). VS Code extension model. Low-priority feature but huge for ecosystem growth.

---

Nothing in this section is a deliverable. It's scaffolding for *"here's why the contract work is worth doing right."*
