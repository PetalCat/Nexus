# Nexus Service + Account Model — Braindump

**Date:** 2026-04-14
**Status:** Thinking out loud. Not a spec. Once the shape is clear we'll split this into focused specs.
**Tracking:** ProjectOS Nexus #2

This document is an unstructured exploration of how Nexus currently models services, admin credentials, user credentials, and derived-service auto-linking — and what's broken, confusing, or missing about that model. The goal is to get the whole problem space on paper without prematurely locking into architecture decisions.

---

## What Nexus thinks a "service" is today

Two database rows, one conceptual entity.

**`services`** is the admin-facing row:
```
id, name, type, url, api_key, username, password, enabled, created_at, updated_at
```

This row represents "this Nexus install talks to a Jellyfin at `http://10.10.10.5:8096` using the admin API key `abc123`." It's shared across all Nexus users. When an admin sets up Nexus, they create these rows in the setup wizard or the services admin page. The `username` and `password` fields are **admin credentials** — Nexus uses them to call admin APIs like `getUsers()`, `resetPassword()`, `createUser()`. Not every service has them (Radarr uses `api_key` only; Invidious uses `url` only).

**`user_service_credentials`** is the per-user row:
```
id, user_id, service_id, access_token, external_user_id, external_username,
linked_at, managed, linked_via
```

One row per Nexus-user × service pair. This is "Parker's personal credential for the Jellyfin at `10.10.10.5:8096`". The `access_token` is whatever the service uses to authenticate that user specifically — Jellyfin token, Invidious SID cookie, Calibre session cookie, etc. `managed` means Nexus created the account on behalf of the user (Jellyfin/Calibre/RomM can do this). `linked_via` records which parent service type triggered an auto-link (e.g. `'jellyfin'` for an Overseerr credential that got auto-linked from a Jellyfin link).

**So a given service has one admin row and N user rows.** Fine conceptually. Broken in practice because nothing in the UI ever tells the user which one they're managing at any given moment.

## The admin/user confusion in practice

Walk through adding a Jellyfin service to Nexus as an admin:

1. Admin opens the setup wizard or services admin page.
2. Wizard asks for URL + username + password. Admin enters the admin account credentials.
3. Nexus stores them in `services.username` / `services.password`.
4. Wizard tests the connection using those creds.
5. Done. Service is registered.

Now Parker (a regular user) logs in for the first time. The setup wizard walked the admin through service registration, but Parker is a different user. Parker has no credential for the Jellyfin yet. What happens?

- **Today:** Parker sees the library page. It probably loads because the admin API key is used for server-level calls (getLibrary, getRecentlyAdded). Parker's personal data (continue watching, favorites, user-scoped library views) doesn't load because there's no `user_service_credentials` row for Parker.
- Parker might not notice this at first. The page "works" — there are videos and shows. But it's serving the admin's library view, not Parker's.
- To fix it, Parker has to find `/settings/accounts`, click "Sign in to Jellyfin", enter *their own* Jellyfin username and password, and then the personal features kick in.

The problem: **Parker has no visual signal that they're seeing admin-scoped data instead of personal data.** The page loads, content appears, everything looks fine. The divergence is invisible.

This happens for every user-level service. And for services where the admin credential is the ONLY way to get any data (Radarr, Sonarr, Prowlarr), there's no user-level credential at all — it's always admin-scoped. But Parker can't tell the difference without reading the adapter source.

## What "admin" even means across services

This is messier than it looks because "admin credential" means different things to different services:

- **Jellyfin** — the admin credential is used to call `/Users` (list users), `/Users/{id}/Password` (reset password), `/Users/New` (create user). Personal data calls (getLibrary for a specific user) use the per-user token.
- **Overseerr** — the admin credential is an API key that sees ALL requests. The per-user credential stores only an `externalUserId` so Overseerr knows whose requests to show. User-scoped data calls still go out with the admin API key, just filtered.
- **Radarr / Sonarr / Lidarr** — there's only the admin API key. Everything is admin-scoped. No concept of per-user anything.
- **Invidious** — there's literally no admin credential. The `services.url` is the instance URL; admin-scoped trending/popular data is fetched unauthenticated. Per-user subscriptions/history require a user-level SID cookie.
- **Calibre-Web** — OPDS Basic auth can be admin OR user depending on whose credentials are supplied. The adapter currently uses per-user creds when present, else falls back to admin. But in OPDS the distinction is minimal (both see the same books).
- **Plex** — the admin credential is an auth token tied to the Plex.tv account. Multi-user Plex libraries are shared via "Plex Home" or "Managed Users" which Nexus doesn't model at all today.
- **RomM** — similar to Jellyfin, admin API key for management, per-user token for personal activity.

So "admin credential" is not one thing. It's **whatever-credential-the-adapter-uses-when-no-user-credential-is-available** — a fallback, not a category. Nexus treats it as one category by putting `username/password/api_key` on the `services` row, but conceptually it's doing different work across adapters.

**Implication:** the data model should separate "credentials Nexus uses to operate the service" (admin/management) from "credentials that identify a specific end user" (personal). They happen to collide in some cases but they're different concerns.

## The derivedFrom auto-link mess

Current model, based on reading `api/user/credentials/+server.ts:autoLink` and `ServiceAdapter.derivedFrom`:

- Adapter declares `derivedFrom: ['jellyfin', 'plex']` — "this service can be auto-linked from either Jellyfin or Plex."
- Adapter declares `parentRequired: true/false` — "if no parent is linked, can the user still link this service manually?"
- When a user links a parent service (e.g. Jellyfin), Nexus iterates all services and calls `autoLinkJellyfinServices(userId)` which tries to auto-link every service that `derivedFrom` Jellyfin.
- Auto-link logic: call `adapter.getUsers(config)` on the derived service, find a user whose `jellyfinUserId` matches the newly-linked Jellyfin user's external ID, create a `user_service_credentials` row with that match.

This works for the happy path but falls apart in several ways:

1. **No user consent.** Parker links Jellyfin → Nexus silently also links Overseerr → Parker has no idea Overseerr is now connected. Probably fine 90% of the time, confusing when it's not.
2. **Match failures are silent.** If Overseerr's `getUsers` doesn't return a user with a matching `jellyfinUserId` (because the user doesn't exist on Overseerr, or the Jellyfin-auth integration isn't configured), the auto-link silently doesn't happen. Parker doesn't know why Overseerr shows as "unlinked" after linking Jellyfin.
3. **No retry affordance.** If auto-link fails at link-time, there's a weak "retry" button in the accounts page but no explanation of what's failing.
4. **`parentRequired: true` + parent not linked = dead service.** Streamystats is `parentRequired: true` with Jellyfin as parent. If Jellyfin isn't linked, Streamystats is unusable. The UI says "Requires Jellyfin. Set it up first." but there's no inline path to do so.
5. **Multi-parent ambiguity.** Overseerr is `derivedFrom: ['jellyfin', 'plex']`. What happens when Parker is linked to BOTH Jellyfin and Plex? Today: the auto-link code probably picks whichever parent happens to be iterated first. Parker has zero control and zero visibility.
6. **No "which parent am I using" indicator.** Once Overseerr is auto-linked, the user has no way to know whether it's using the Jellyfin match or the Plex match. Changing the parent requires unlinking and starting over.
7. **No per-parent re-auth.** When a parent credential goes stale (the whole Invidious auth-rot story), derived services don't know. They keep trying to use the stale parent credential. Silent failures cascade.

Parker's ask — *"We also need the ability to support plex and jellyfin simultaneously"* — is specifically about #5 and #6. Today the model picks one parent and forgets the other exists.

## What does "in control" mean

When Parker says *"the user needs to be in control"* I read that as three specific things:

1. **Explicit consent before auto-linking.** No silent cascade. Every auto-link prompts the user first: *"You just linked Jellyfin. Nexus can also link these services automatically: Overseerr ✓, Streamystats ✓. [Accept all] [Pick] [Skip]"*. Default-on but interruptible.
2. **Visibility into what's linked where.** The accounts page shows each linked credential with its parent-if-derived ("Overseerr — linked via Jellyfin"). Clicking the row shows the full credential context (external ID, external username, linked-at timestamp, health status, which parent supplied the auth).
3. **Ability to change or break the link deliberately.** If Overseerr is linked via Jellyfin and Parker wants to re-link it via Plex instead, there's a one-click "Change parent" action. If Parker wants a manually-entered credential instead of auto-linking, there's "Unlink auto, sign in manually".

None of this exists today.

## What an "auto-linking spec" looks like

Since this is emerging as its own thing, let me sketch what a formal spec would have to cover:

- **When does auto-linking happen?** On parent link, on Nexus login, on a manual "retry" click, on a cron? Today it's "on parent link" only, with a weak retry.
- **Which services are candidates?** Any adapter with non-empty `derivedFrom` that intersects a newly-linked parent type.
- **What's the matching function?** Currently hardcoded as `user.jellyfinUserId === newlyLinked.externalUserId` for Jellyfin-derived services. Plex-derived would need a different matcher (`plexUserId` or email match). Needs to be per-adapter, probably an adapter method `findAutoLinkMatch(config, parent: LinkedParent)`.
- **What if there are multiple matches?** Impossible for Jellyfin (one Nexus user maps to one Jellyfin user), but for services like Plex Home that model multiple user profiles, a match might surface as a list. Adapter returns a list, UI lets user pick.
- **What if there are zero matches?** Current behavior: silently fail. New behavior: surface a "No matching account found — set up Jellyfin-auth on Overseerr, or sign in manually" toast with actionable links.
- **What if the parent has multiple candidates?** Overseerr `derivedFrom: ['jellyfin', 'plex']`, user has both linked. Per-service choice via a UI picker.
- **What if the parent itself is stale?** Don't attempt auto-link. Show the stale banner on the derived service instead.
- **Can users configure "never auto-link service X"?** Yes — a per-service `autoLinkEnabled: boolean` in user settings. Defaults to true.

All of the above is adapter-framework-level logic, not per-adapter. The adapter exposes a `findAutoLinkMatch` method and the framework handles orchestration, user consent, error reporting, parent-picking.

## Multi-parent simultaneously — the Plex + Jellyfin case

Parker's explicit ask: support both Plex and Jellyfin at once. This is distinct from auto-linking and deserves its own section.

**Today's model:** A user can link both Jellyfin and Plex (nothing prevents it). But every derived service picks ONE parent at auto-link time and stores it in `linked_via`. Once set, the derived service ignores the other parent forever.

**What Parker likely wants:**

- Users link both Jellyfin and Plex explicitly (already possible, just unusual).
- Unified search / library / continue-watching views merge results from both, de-duped.
- Derived services like Overseerr can be *either* "linked via Jellyfin" *or* "linked via Plex" on a per-user basis. User picks when linking. User can change later.
- If Overseerr supports dual registration (it does — users can come in from both Jellyfin and Plex), the adapter exposes this via `authCapabilities.supportsDualParentLink: true` and the UI lets the user pick one or both.

**The messy part:** Some data is genuinely duplicated across parents. If Parker has "The Bear" on both Plex and Jellyfin, the unified library should show it once. The dedup logic lives in the query layer, not the adapter. Requires some kind of canonical-item resolution — probably by TMDB/IMDB ID intersection.

**The messier part:** Requests. When Parker requests a new movie via Overseerr, which library does it get added to? Today Overseerr has its own mapping ("download to library X which is backed by Jellyfin/Plex/both"). Nexus doesn't currently model this — it just defers to Overseerr's native request flow. For multi-parent support, Nexus might need to show the user which Overseerr target library they're requesting into.

**Minimum viable simultaneously:** just let users link both, let derived services choose their parent explicitly, don't try to dedup the library layer yet. That's a week-one deliverable. Library dedup is week-N.

## UI/UX rework — the actual page-by-page changes

Given everything above, here's what the settings pages need to become:

### `/settings/` — new landing page
Currently doesn't exist (or exists but is minimal). Should become the index: *"Accounts", "Playback", "Notifications", "Admin (if admin)"* — each linked to its section. Clear hierarchy.

### `/settings/accounts/` — rework
The page exists but:
- Reorganize into sections: **"Your accounts"** (user's own linked services), **"Auto-linked"** (services Nexus auto-linked on behalf of the user — these get extra affordances for changing parent), **"Available to link"** (services you can manually sign in to). Today everything is one flat list.
- Every linked service row shows:
  - Service name + icon + connection state (healthy / stale / unreachable)
  - External username ("linked as parker")
  - "Linked via Jellyfin" (if derived)
  - Badge indicating "password stored" if applicable
  - Actions: Reconnect, Forget password, Change parent (derived only), Unlink
- Every "available to link" row shows:
  - Clear CTA: "Sign in" or "Auto-link from Jellyfin" or "Create account" (whichever are available)
  - For derived services with a linked parent: "Linked via Jellyfin" as default CTA, with "or sign in manually" secondary
  - For derived services without a linked parent: "Sign in to [parent] first" with a link to do that

### `/settings/admin/services/` — admin-only
Distinct from `/settings/accounts/`. This is where admins manage the *`services`* rows — adding, removing, editing service connections. Completely separate from user-level account linking. The current setup wizard half-does this. Non-admins never see this page.

### `/videos`, `/books`, `/music`, etc. — inline sign-in affordances
When a user-level credential is needed and not present, inline banner: *"Sign in to Invidious to see your subscriptions"*. When stale: *"Your Invidious session expired. Reconnect →"*. Already in the Invidious spec but now generalizes to every user-level service.

### First-run onboarding — the moment of most confusion
When a new Nexus user logs in for the first time:
1. Nexus detects which services are registered by the admin.
2. For each userLinkable service, show a step: *"Jellyfin: link your account"* with options [sign in] [create managed account] [skip].
3. For each derivedFrom service, defer the prompt until after the parent is linked, then show: *"Auto-link Overseerr to your Jellyfin account? [Yes] [Sign in manually] [Skip]"*.
4. At the end, a summary: *"You're linked to: Jellyfin ✓, Overseerr ✓ (via Jellyfin), Invidious ✓. Not linked: Calibre-Web (skipped), Plex (no account on this instance)."*.

This flow doesn't exist today. New users just get dropped onto the home page with no explanation.

## What's buggy RIGHT NOW in the current UI

Enumerate as I read the current code + remember previous sessions:

1. `/settings/accounts` uses `(data as any).accountServices ?? []` cast — `$props()` with explicit typing would be cleaner but the real issue is the page exists in a half-typed state
2. `linkModalServiceId` state management has no loading/error state separation — `linking: boolean` gets stuck in edge cases
3. "Retry" button for derived services calls an API that sometimes 500s silently
4. Managed-account creation error messages are opaque (same problem as Invidious auth errors — raw adapter error text dumped into a toast)
5. No visual indication of which credential is admin-scoped vs user-scoped
6. Cascade-unlink confirmation flow exists but doesn't actually list what will cascade-unlink until you're mid-confirm
7. Services added but never pinged show as "linked" based on existence, not health
8. The modal's password field has no strength indicator, no show/hide toggle, no paste confirmation
9. Managed-account "Create" button has no confirmation — one click creates an account on the external service, no undo
10. `creatingManaged` state is stuck on one ID at a time, so concurrent creates aren't possible (probably fine but a minor limitation)
11. The tab/nav inside /settings/accounts doesn't exist — it's one flat page with no sub-navigation
12. Scroll position doesn't restore after a modal close — you lose context if you were mid-page
13. Toast errors can stack up; no dedupe
14. Unlink confirmation dialog appears even for services that have nothing cascading off them — "are you sure?" on zero-impact actions is annoying
15. `/settings/accounts/+page.svelte:20` uses `$derived((data as any).accountServices ?? [])` — any-cast anti-pattern, should be `$props<{data: PageData}>()` properly typed

None of these are blockers individually but together they make the page feel unreliable and undertested.

## The shape of the specs we'll need

If I squint at everything above, I think the right spec structure is roughly:

1. **Account + service architecture umbrella** (the big picture — terminology, data model, credential types, admin vs user distinction). Umbrella references the others.
2. **Adapter contract** (already written — needs revision to incorporate admin-vs-user tier distinction and the auto-link adapter methods).
3. **Plugin loader** (still needed — unchanged from before).
4. **Auto-linking spec** (new — formal rules for when/how, user consent, per-parent choice).
5. **Multi-parent spec** (new — how Jellyfin+Plex simultaneous works, dedup rules).
6. **Settings UX rework** (new — the page-by-page design for /settings/*, the first-run onboarding flow, the inline sign-in affordances).
7. **Invidious consumer** (already written — becomes the acceptance test for the whole initiative).

That's 7 specs. Much more than the original 2. The umbrella exists to keep them coherent; each sub-spec stays focused on its concern.

## What I want to confirm before writing more

1. **Does the tier naming make sense?** "Server-level" / "user-standalone" / "user-derived" was my attempt, but the admin-vs-user dimension is orthogonal to derived-vs-standalone. Maybe the real dimensions are: `{hasAdminCred, hasUserCred} × {standalone, derived}` which is 4+ combinations, not 3 tiers. Need to think this through more before locking the contract spec.

2. **Is the admin-vs-user distinction valuable as first-class in the data model?** Or is it fine to keep both on their current rows (`services.username/password` for admin, `user_service_credentials.access_token` for user) and just make the UI surface the distinction more clearly?

3. **First-run onboarding** — is that something Nexus has now? I'm describing it like it doesn't exist but I should double-check before writing a spec for building it.

4. **Multi-parent support for derived services** — Overseerr is the example but Streamystats is `parentRequired: true` with only Jellyfin. Should the contract model "multi-parent possible" as a capability flag, or is it always allowed when `derivedFrom.length > 1`?

5. **What's the priority order?** If this is a 10-day initiative now, which deliverable gives the biggest win fastest? My gut says: umbrella spec first (clarity), then settings UX rework spec (unblocks everything else), then adapter contract revision, then everything else. But Parker has context I don't.

---

**End of braindump.** Next step: review, pick which sections to formalize into specs, and update the ProjectOS issue with the revised scope.
