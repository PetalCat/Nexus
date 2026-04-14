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

Additive changes only. No destructive migrations. Existing credentials continue working during rollout.

```sql
-- services table: two new columns for admin-credential health
ALTER TABLE services ADD COLUMN admin_cred_stale_since TEXT;  -- ISO timestamp or null
ALTER TABLE services ADD COLUMN admin_cred_last_probed_at TEXT;  -- ISO timestamp or null

-- user_service_credentials: the four columns identified so far
ALTER TABLE user_service_credentials ADD COLUMN stored_password TEXT;  -- encrypted, nullable
ALTER TABLE user_service_credentials ADD COLUMN stale_since TEXT;  -- ISO timestamp or null
ALTER TABLE user_service_credentials ADD COLUMN parent_service_id TEXT;  -- FK → services.id, nullable
ALTER TABLE user_service_credentials ADD COLUMN auto_linked INTEGER DEFAULT 0 NOT NULL;  -- boolean flag
```

**Notes:**
- `stored_password` uses the existing Nexus credential-encryption layer. Nullable because users can opt out at link time.
- `stale_since` is set when auto-refresh fails OR health probe returns an error. Cleared on successful reconnect.
- `parent_service_id` replaces the functional role of `linked_via` for disambiguation. `linked_via` stays for backward compatibility (no breaking rename) but new code reads `parent_service_id`. When derived from "just a parent type, service not yet resolved," it's null.
- `auto_linked` is true when the credential was created by the auto-linking flow (as opposed to a manual sign-in). Lets the UI show different affordances ("Change parent" for auto-linked, "Reconnect" for manual).

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
/settings/                     # NEW: landing page
  +page.svelte                 # index listing each settings section

/settings/accounts             # EXISTING: reworked
  +page.svelte                 # the user's linked accounts, health, management

/settings/playback             # EXISTING: unchanged in this pass

/settings/notifications        # EXISTING: unchanged in this pass

/settings/profile              # EXISTING: unchanged in this pass

/settings/admin/               # NEW: admin-only section
  services/                    # Manage service rows (add/edit/remove)
  users/                       # Manage Nexus users (promote/demote, invite links)
```

The **admin/** subpath is new. Today's "services admin page" lives somewhere else and is reachable inconsistently; this consolidates it.

Non-admins can reach `/settings/` and the four user-level sections. `/settings/admin/*` returns 403 for non-admins.

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

- **No data migration.** All new columns are nullable. Existing rows continue to work as-is, just without the new features.
- **`linked_via` stays.** The new `parent_service_id` co-exists. Code reads both during the transition, writes only the new one. `linked_via` can be dropped in a later cleanup pass.
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

## Open questions (items that need Parker input before sub-specs can proceed)

1. **First-run `/welcome` route name.** `/welcome` vs `/onboarding` vs `/first-run` vs something else. Minor but shapes the URL.
2. **Existing-user behavior at rollout.** Should they see the `/welcome` flow retroactively (opt-in), or just start getting inline sign-in affordances when they visit pages that need a credential? Prefer inline for existing users — less disruptive. Want confirmation.
3. **Admin subtree.** Is `/settings/admin/*` the right path, or should admin settings live at `/admin/*` (top-level) to reinforce the distinction? Argument for top-level: even more visual separation. Argument for nested: keeps all settings under one section so users only have to remember one location.
4. **Parent-service-id vs linked-via.** Is it okay to keep `linked_via` as a stringly-typed legacy field indefinitely, or should we plan a later drop-it cleanup? Preference is "drop it after the next major version bump."
5. **Managed account delete-on-unlink.** Today, unlinking a managed account optionally deletes the upstream account. Does this stay as an opt-in at unlink time, or become a per-service user preference (*"Auto-delete my Jellyfin account if I unlink"*)?

## Out of scope for this initiative

- **Library dedup** when a user is linked to multiple media servers. Shows as duplicates in v1.
- **SSO / SAML / OIDC** for Nexus itself (different problem — user auth to *Nexus*, not to downstream services).
- **Sandboxing third-party plugins.** Plugin loader spec will note it as a v2 concern.
- **Non-linear state machines** (e.g. "temporarily paused but not stale"). Credentials are binary healthy/stale for this pass.
- **Bulk operations on credentials** (mass unlink, mass reconnect). Single-credential actions only.
