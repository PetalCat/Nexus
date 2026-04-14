# Nexus Settings + Accounts UX Rework — Design

**Date:** 2026-04-14
**Scope:** Page-by-page design for `/settings/*`, `/admin/*`, `/welcome`, and the inline account-linking affordances that replace the current dead-end *"Link your account in settings"* messaging on consumer-facing pages. Includes shared Svelte components (AccountLinkModal, SignInCard, StaleCredentialBanner) that serve all user-linkable services uniformly.
**Status:** Proposed, pending Parker approval.
**Depends on:** [`2026-04-14-service-account-umbrella-design.md`](./2026-04-14-service-account-umbrella-design.md) (approved), [`2026-04-14-adapter-contract-design.md`](./2026-04-14-adapter-contract-design.md) (approved)
**Tracking:** ProjectOS Nexus #2 — *Pluggable adapter architecture*.

## Problem

Consolidates and addresses the UX bugs surfaced in the braindump (`docs/superpowers/braindumps/2026-04-14-service-account-model-braindump.md` § *"What's buggy RIGHT NOW in the current UI"*) plus the three problem statements from the umbrella spec that this UX layer is responsible for solving:

1. **The accounts page is only reachable by typing `/settings/accounts`.** No nav link, no inline prompt from consumer pages, no first-run education. Users (including Parker as the developer) don't know how to sign into user-level services.
2. **Admin credentials vs user credentials are visually indistinguishable.** The accounts page mixes them on the same cards with no visual cue about scope. Users can't tell when they're managing "the admin's Jellyfin" vs "my Jellyfin."
3. **No stale-credential surface.** A linked credential whose session died silently fails across the app. The accounts page still shows it as *"Linked as parker"* and nothing on the consumer pages indicates the credential needs attention.
4. **The link modal is bespoke and fragile.** Copy is generic (*"Sign in to X"*), errors are raw adapter strings, inputs have no validation, state management has edge cases where `linking: boolean` gets stuck.
5. **Derived services give dead-end messages.** When Overseerr needs Jellyfin to auto-link, users see *"Requires Jellyfin. Set it up first."* with no inline path to actually set up Jellyfin.
6. **First-run onboarding for non-admin users does not exist.** Setup wizard runs only for the first user (admin); everyone else is dropped on the home page with no education about what Nexus is or why they should connect accounts.
7. **No visual distinction between user-scoped and admin-scoped settings.** `/settings/accounts` mixes *"Nexus's admin key for Radarr"* and *"my personal Jellyfin token"* in the same list.
8. **No re-triggerable onboarding.** Once dismissed, there's no path back to the welcome flow for users who want to redo it.

This spec lays out the page-by-page rework that fixes all of these, scoped to the UI layer. Everything below the line (adapter contract, schema, shared registry) is defined in the other specs; this spec consumes those layers without redefining them.

## Page map and routing

```
/ (home)
  └─ inline SignInCard / StaleCredentialBanner when relevant

/setup                           [admin-only; existing, unchanged in this pass]
  └─ first-run wizard for zero-user Nexus installs

/welcome                         [NEW — non-admin first-run flow]
  └─ three-phase Wizarr-inspired wizard
     ├─ pre-connection steps
     ├─ connection steps
     └─ post-connection steps

/settings                        [NEW — user-level settings landing page]
  └─ index of user-level settings subsections

/settings/accounts               [REWORKED]
  └─ "Linked accounts" — per-user credentials + link/unlink/reconnect

/settings/profile                [existing, unchanged]
/settings/playback               [existing, unchanged]
/settings/notifications          [existing, unchanged]

/admin                           [NEW — admin-only top-level subtree]
  └─ index of admin settings subsections
/admin/services                  [REWORKED — moved from wherever it lives today]
  └─ Service registration, admin credentials, health
/admin/users                     [REWORKED]
  └─ Nexus user management, invites, role promotion

/videos, /books, /music, ...     [CONSUMER PAGES]
  └─ inline SignInCard when the relevant service is unlinked
  └─ inline StaleCredentialBanner when the relevant credential is stale
```

Everything at `/settings/*` is user-scoped. Everything at `/admin/*` is admin-scoped and returns 403 for non-admins. The visual chrome on the two subtrees is deliberately different — different page header style, explicit *"Admin"* label and red accent on admin pages, user-scoped pages carry a friendlier palette.

## Shared components

All three live under `src/lib/components/account-linking/` and are imported by any route that needs them. They're service-agnostic — each accepts a `service: AccountServiceSummary` (a normalized shape computed server-side from `services` + `user_service_credentials` + the adapter's `capabilities`).

### `AccountLinkModal.svelte`

The one modal for all linking flows. Replaces the existing bespoke link modal at `src/routes/settings/accounts/+page.svelte:360-508`. Gets extracted so it can be launched from `/welcome`, `/settings/accounts`, and from inline SignInCards on consumer pages.

**Props:**
```ts
interface AccountLinkModalProps {
  service: AccountServiceSummary;           // normalized service metadata
  mode?: 'signin' | 'register';             // default 'signin'; toggleable if supportsRegistration
  prefillUsername?: string;                 // for reconnect flows
  onSuccess: (result: UserCredentialResult) => void;
  onCancel: () => void;
}

interface AccountServiceSummary {
  id: string;
  name: string;                             // "Jellyfin (10.10.10.5)"
  type: string;                             // adapter type key
  url: string;                              // shown explicitly in the modal
  color: string;
  icon: string;
  capabilities: AdapterCapabilities;        // full capabilities object from the adapter
  isLinked: boolean;
  staleSince?: string | null;
  externalUsername?: string | null;
  nexusManaged?: boolean;
}
```

**Layout** (single modal, two modes via toggle):

```
┌────────────────────────────────────────────────────┐
│ Connect Jellyfin account                         ⓧ │
├────────────────────────────────────────────────────┤
│                                                    │
│  Connecting to: jellyfin.parker.dev                │
│                                                    │
│  Username: [parker_____________________]           │
│  Password: [••••••••••••••••••••••••••] 👁         │
│                                                    │
│  ☑ Save password for auto-reconnect                │
│     Nexus encrypts and stores this password        │
│     locally so your session can refresh            │
│     automatically when Jellyfin expires it.        │
│     Uncheck to require manual reconnect each time. │
│                                                    │
│  First time?  Create a new account →               │
│                                                    │
│              [Cancel]  [Connect]                   │
└────────────────────────────────────────────────────┘
```

**"Create a new account" toggle** (when `capabilities.userAuth.supportsRegistration === true`) reveals a confirm-password field and flips the submit button to *"Create account"*. If the service has `supportsAccountCreation === true`, the copy mentions the managed-account contract: *"Nexus will create this account on [service]. If you unlink later, the account gets deleted by default. You can convert to a personal account at any time."*

If `supportsRegistration === false`, the toggle isn't rendered. If `supportsRegistration === true` but the health probe reveals that the instance has registration disabled, the toggle is visible but disabled with a tooltip: *"This instance doesn't allow new accounts."*

**Error rendering:** errors from `authenticateUser` come back as `AdapterAuthError.kind`. The modal maps each kind to copy via a shared `errorCopy.ts`:

| `AdapterAuthError.kind` | User-facing message |
|---|---|
| `invalid` | *"Username or password doesn't match."* |
| `rate-limited` | *"Too many attempts. Try again in [N] minutes."* (uses `retryAfterMs`) |
| `registration-disabled` | *"This instance doesn't allow new accounts. Ask the admin, or choose another instance."* |
| `unreachable` | *"Can't reach the Jellyfin instance. Is the URL correct?"* |
| `permission-denied` | *"Signed in, but your account doesn't have permission to use this feature."* |
| *(generic Error)* | *"Something went wrong. [error message]"* with the raw message shown for debugging |

**State management:** replaces the current `linking: boolean` mess with a proper finite state machine:

```ts
type ModalState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; error: AdapterAuthError | Error }
  | { kind: 'success'; result: UserCredentialResult };
```

State transitions are explicit; no more stuck `linking: true` on error paths.

### `SignInCard.svelte`

The inline affordance that replaces dead-end *"Link your account in settings to see subscriptions"* messaging on consumer pages. Clicking it opens the `AccountLinkModal` inline — no navigation away from the current page.

**Props:**
```ts
interface SignInCardProps {
  service: AccountServiceSummary;
  features?: string[];                       // ['subscriptions', 'history', 'playlists']
  variant?: 'inline' | 'hero';               // inline is compact, hero is big empty-state
  onConnected?: (result: UserCredentialResult) => void;
}
```

**Inline layout** (for the top of `/videos/subscriptions`, inside a list, etc.):

```
┌─────────────────────────────────────────────────────────┐
│  [IV]  Connect your Invidious account                    │
│        See subscriptions, history, and playlists         │
│        jellyfin.parker.dev                               │
│                                      [Connect account]  │
└─────────────────────────────────────────────────────────┘
```

**Hero layout** (for empty-state pages when the service is the primary thing the page exists for — `/videos` with no trending available):

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                    [large service icon]                 │
│                                                         │
│          Connect your Invidious account                 │
│                                                         │
│    See your subscriptions, history, and playlists       │
│           from video.parker.dev                         │
│                                                         │
│               [Connect account]                         │
│                                                         │
│          Don't have an account? [Create one →]          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The *"Don't have an account?"* link is only rendered when `capabilities.userAuth.supportsRegistration === true`. It opens the AccountLinkModal in register mode.

### `StaleCredentialBanner.svelte`

Shows when a linked credential's `staleSince` is set. Always at the top of the affected page, with higher visual prominence than the SignInCard. One-click reconnect.

**Props:**
```ts
interface StaleCredentialBannerProps {
  service: AccountServiceSummary;
  context?: string;                          // "Your subscription feed requires" etc.
  onReconnected?: () => void;
}
```

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│ ⚠  Your Invidious session expired                       │
│    video.parker.dev — last worked 2 hours ago          │
│                                      [Reconnect]        │
└─────────────────────────────────────────────────────────┘
```

**Reconnect behavior:**
- If `service.capabilities.userAuth.supportsPasswordStorage === true` AND the credential has a stored password → try silent auto-reconnect via `POST /api/user/credentials/reconnect`. On success, banner disappears. On failure, fall through to the modal.
- Otherwise → open `AccountLinkModal` in signin mode, prefilled with the known username from `externalUsername`.

## Pages

### `/settings/` — new landing page

Lives at `src/routes/settings/+page.svelte`. Today this route either doesn't exist or is a thin index.

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│  Settings                                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌───────────────┐  ┌───────────────┐                   │
│  │  🔗 Accounts   │  │  👤 Profile   │                   │
│  │  Linked       │  │  Your Nexus   │                   │
│  │  services and │  │  account      │                   │
│  │  account mgmt │  │               │                   │
│  │  3 connected  │  │               │                   │
│  └───────────────┘  └───────────────┘                   │
│                                                         │
│  ┌───────────────┐  ┌───────────────┐                   │
│  │  ▶️  Playback  │  │  🔔 Notifs    │                   │
│  │  Video/audio  │  │  Email and    │                   │
│  │  preferences  │  │  push prefs   │                   │
│  └───────────────┘  └───────────────┘                   │
│                                                         │
│  [Run onboarding again]                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Each card links to its respective subsection. Card subtitle shows a status summary (e.g., *"3 connected, 1 needs attention"* for Accounts). The "Run onboarding again" button clears the user's `onboarding_complete` flag and redirects to `/welcome`.

Admins additionally see a fifth card at the bottom: **⚙️ Admin** with red accent, linking to `/admin/`.

### `/settings/accounts` — reworked

The biggest single page in this rework. Today's version (`src/routes/settings/accounts/+page.svelte`, 508 lines) becomes cleanly sectioned.

**Sections:**

1. **Stale credentials** (banner, conditionally rendered at top)
   For each credential with `staleSince`, render a `StaleCredentialBanner` inline. One-click reconnect per credential. Visible above everything else so users see problems before they scroll.

2. **Linked accounts** (user's active credentials)
   - Each credential is a row with:
     - Service icon, name, instance URL
     - External username (*"linked as parker"*)
     - Connection state badge (Connected / Stale / Reconnecting)
     - *"Linked via Jellyfin"* sub-label if `auto_linked && parent_service_id`
     - Badge *"Password stored"* if stored_password is set
     - Badge *"Managed by Nexus"* if `nexus_managed` is true
     - Action menu (⋯): Reconnect, Forget password, Change parent, Convert to my account (managed only), Unlink
   - Rows are clickable to expand for more detail (linked-at date, last-probed-at, last-success-at, permissions).

3. **Available to link** (services the user hasn't linked yet)
   - For each userLinkable service where the user has no credential:
     - Service card with icon, name, URL, what linking unlocks
     - Primary action: **Connect [service] account** (opens AccountLinkModal)
     - Secondary action, if `auto_linked` was previously set OR a parent service is linked: *"Auto-link from Jellyfin"*
     - Secondary action, if `supportsAccountCreation`: *"Create new account"*
   - For services where `parentRequired && !parentLinked`, inline link to `/settings/accounts#parent-service` (anchor-scroll to that row) — replaces today's dead-end "Set it up first" message.

4. **Auto-link preferences** (user toggles)
   Per derived service, a toggle: *"Auto-link from parent services when available"*. Defaults to on. Persistent per user. When off, linking a parent (Jellyfin) never auto-links this service (Overseerr) — user has to manually opt in.

**Visual distinction between admin and user credentials:**
- User credentials live here (`/settings/accounts`). Admin credentials live under `/admin/services`. Completely separate pages. No cross-contamination.
- Each linked-account row has a subtle `👤 Personal` badge. This is redundant given the page context but removes any ambiguity.

**Bugs from braindump this addresses:**
- #1 Type cast `(data as any).accountServices` → replaced with proper `$props<{data: PageData}>()`
- #2 `linking: boolean` state stuck → replaced with `ModalState` finite state machine in AccountLinkModal
- #3 "Retry" button 500s → replaced with single unified Reconnect action that goes through the shared registry layer
- #4 Opaque managed-account errors → mapped through `errorCopy.ts`
- #5 No visual indication admin-scoped vs user-scoped → admin credentials moved to `/admin/services`
- #6 Cascade-unlink confirmation list → modal previews affected rows before confirm
- #7 Stale-detected-but-shows-linked → health probe runs on page load, updates `stale_since`, stale credentials surface at top
- #8 No password show/hide, paste confirmation → modal has show/hide toggle and password-field validation
- #9 Managed-account create no confirmation → creation modal has explicit confirmation copy
- #10 `creatingManaged` locking → doesn't matter for this rework; concurrent managed creates still serialize at the API layer
- #11 No sub-nav → section headers now render as sticky navigation within the page
- #12 Scroll position lost → modals don't reset scroll
- #13 Toast stacking → shared toast system handles dedup
- #14 Unlink confirm on zero-impact → confirmation skipped when no cascade and credential is non-managed
- #15 Any-cast on data → fixed along with #1

### `/welcome` — NEW first-run flow

Lives at `src/routes/welcome/+page.server.ts` + `+page.svelte`. Runs automatically once per non-admin user after they log in, if their user row has `onboarding_complete = false`.

**Guards:**
- Non-admin users only (admins use `/setup`).
- Redirects to home if `onboarding_complete === true`, unless `?force=true` query param (for the "Run onboarding again" button).

**Three phases (Wizarr-inspired):**

**Phase 1 — Welcome**
```
┌─────────────────────────────────────────────────────────┐
│  Welcome to Nexus                                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Nexus gives you one place to browse and play all your  │
│  self-hosted media. It sits on top of your media        │
│  servers and unifies them — Jellyfin, Plex, Calibre,    │
│  Invidious, and more.                                   │
│                                                         │
│  To get started, we'll connect your accounts on each    │
│  service so you see your personal library, not just     │
│  the shared admin view.                                 │
│                                                         │
│  This takes about 2 minutes. You can skip anything      │
│  and come back to it later from Settings → Accounts.    │
│                                                         │
│                              [Get started →]            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Phase 2 — Connection steps**
One card per available service, in dependency order (parents before children). Each card shows:
- Service icon, name, URL
- One-sentence description of what connecting unlocks
- Primary action: *"Connect account"* (opens `AccountLinkModal` inline)
- Secondary: *"Auto-link from Jellyfin"* if applicable
- Tertiary: *"Create new account"* if `supportsAccountCreation`
- Skip: *"Skip for now"*

Cards progress top-to-bottom. Already-linked services show a green checkmark. The user can move on at any time — no forced completion.

Parents before children means Jellyfin shows before Overseerr and Streamystats. When the user links Jellyfin, the auto-linking logic (per the auto-link sub-spec) fires and offers batch consent for derived services, inline within this flow.

**Phase 3 — Summary**
```
┌─────────────────────────────────────────────────────────┐
│  You're all set 🎉                                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  You connected 3 accounts:                              │
│    ✓  Jellyfin                                          │
│    ✓  Overseerr  (auto-linked from Jellyfin)            │
│    ✓  Invidious                                         │
│                                                         │
│  Skipped:                                               │
│    ⊖  Calibre-Web  (can connect later)                  │
│                                                         │
│  You can change any of this anytime from                │
│  Settings → Accounts.                                   │
│                                                         │
│                              [Go to home]               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

On "Go to home", the user's `onboarding_complete` flag is set, and they're redirected to `/`.

### `/admin/` — NEW admin-only top-level subtree

Lives at `src/routes/admin/+page.svelte`. Returns 403 for non-admins (existing `locals.user.isAdmin` guard pattern).

**Layout:** mirrors `/settings/` but with admin-scoped cards and explicit red-accent chrome.

```
┌─────────────────────────────────────────────────────────┐
│  Admin Settings                                     🔒  │
│  Changes here affect everyone on this Nexus instance    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌───────────────┐  ┌───────────────┐                   │
│  │  🔌 Services  │  │  👥 Users     │                   │
│  │  Manage       │  │  Manage Nexus │                   │
│  │  connections  │  │  users and    │                   │
│  │  to downstream│  │  permissions  │                   │
│  │  services     │  │               │                   │
│  │  8 registered │  │  3 users      │                   │
│  └───────────────┘  └───────────────┘                   │
│                                                         │
│  [Back to settings]                                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### `/admin/services` — reworked

The service-registration page that's currently scattered. Single source of truth for "what services does this Nexus install talk to."

**Sections:**

1. **Registered services** — one row per `services` row. Each row shows:
   - Service icon, name, type, URL
   - Enabled toggle
   - Admin credential health (Healthy / Stale / Untested / Error) — driven by `admin_cred_stale_since` + the adapter's `probeAdminCredential`
   - Last-probed timestamp
   - Actions: Edit credentials, Probe now, Disable, Delete
2. **Add a service** — button opens a new-service wizard, powered by the same onboardable adapter list from the setup wizard.
3. **Default auto-link policy** — server-wide toggle: *"Auto-link derived services by default when users link a parent."* Admins can override the user-level toggles with a server default.

**Health probe:** on page load, run `probeAdminCredential` for each enabled service in parallel with a 5s timeout each. Update `admin_cred_stale_since` accordingly. Cache for 60s to avoid probe storms.

**Admin credential editing:** each service row has an "Edit credentials" button that opens a modal showing the adapter's `capabilities.adminAuth.fields` as inputs. Admin types in the new admin API key / username / password / URL override. Tested against the adapter's `probeAdminCredential` before saving.

### `/admin/users` — reworked

Admin user management. Migrated from wherever it lives today.

**Sections:**

1. **Nexus users** — list of rows. Each row:
   - Username, email, role (Admin / User), created-at, last-login
   - Actions: Promote/demote, Reset password, Delete, Impersonate (admin debugging)
2. **Invite links** — manage pending invites. Create new invite, set role, set expiry, revoke.
3. **Pending approvals** — if Nexus has an approval workflow for new registrations, show pending users here.

This page is out of scope for the immediate rework beyond fixing admin-vs-user visual clarity. The detailed user-management UX is a separate concern.

## Consumer-page integration (inline affordances)

Every consumer-facing page (`/videos`, `/books`, `/music`, etc.) that depends on a user credential gets the same two components wired in.

**Pattern:**
```svelte
<!-- /videos/+page.svelte -->
{#if data.invidiousCredential?.staleSince}
  <StaleCredentialBanner
    service={data.invidiousSummary}
    context="Your subscription feed requires Invidious"
    onReconnected={() => invalidate('app:videos')}
  />
{:else if data.invidiousRegistered && !data.invidiousLinked}
  <SignInCard
    service={data.invidiousSummary}
    features={['subscriptions', 'history', 'playlists']}
    variant="hero"
    onConnected={() => invalidate('app:videos')}
  />
{/if}

<!-- rest of page -->
```

**Pages that get this treatment** (this pass):
- `/videos` + `/videos/subscriptions` + `/videos/history` + `/videos/playlists` — Invidious
- `/books` — Calibre-Web (when user-scoped features like read-status need user creds)
- `/music` — Jellyfin / Lidarr (when user-scoped playlists need user creds)
- `/` home page — any registered user-level service that's unlinked, compact inline variant

Search pages and server-level-only pages (Radarr queue, Sonarr queue) are NOT affected — they don't depend on user credentials.

## Data flow — server-load pattern

Each page that renders the account-linking components needs a uniformly-shaped `AccountServiceSummary` from its `+page.server.ts`. A shared helper lives at `src/lib/server/account-services.ts`:

```ts
/** Build AccountServiceSummary for a single service, keyed by current user. */
export function buildAccountServiceSummary(
  service: ServiceConfig,
  userId: string | null
): AccountServiceSummary;

/** Build summaries for every service of a given type the user could link. */
export function buildAccountServiceSummariesForType(
  serviceType: string,
  userId: string | null
): AccountServiceSummary[];

/** Build summaries for every registered service. For the accounts page. */
export function buildAllAccountServiceSummaries(
  userId: string
): AccountServiceSummary[];
```

Each function reads from `services` + `user_service_credentials` + the adapter registry, merges, and returns the normalized shape. The returned summaries never leak the actual `access_token` or `stored_password` — only metadata and state. Client-side code never sees secrets.

## Navigation — three entry points to /settings/accounts

Per Parker's 2026-04-14 "all of the above" decision:

1. **User-menu dropdown** (top-right avatar in the main navbar)
   - Add *"Accounts"* entry, with a red dot badge when any credential is stale.
2. **Sidebar** (if the app has one, or the main navbar on mobile)
   - Settings link with an expandable submenu: Accounts, Profile, Playback, Notifications, (Admin).
3. **`/settings/` landing page**
   - One of the primary cards on the index.

All three routes land at `/settings/accounts`. No duplication — just multiple paths.

## Testing

1. **Component tests** (vitest + testing-library) for:
   - `AccountLinkModal` — all states of the finite state machine, both modes, error mapping
   - `SignInCard` — inline + hero variants, register toggle visibility
   - `StaleCredentialBanner` — auto-reconnect path + fall-through-to-modal path
2. **Page-level tests** (playwright) for:
   - `/welcome` full flow — connect one service, auto-link derived, skip one, see summary
   - `/settings/accounts` — stale credential reconnect, unlink confirmation with cascade preview
   - `/admin/services` — add new service, probe admin credential, edit credentials
3. **Auth-flow tests** (existing e2e + new cases):
   - Non-admin user's first login goes to `/welcome`
   - Admin user's first login goes to `/setup`
   - Returning users with `onboarding_complete=true` go to `/`
   - `/admin/*` returns 403 for non-admins
4. **Visual regression** (optional, if the project has this) for the admin-vs-user chrome distinction

## Out of scope

- **Mobile-specific layouts** — assume desktop first, mobile responsiveness is follow-up.
- **Internationalization** — copy is English only in this pass. i18n is a separate concern.
- **Analytics** — no tracking events added.
- **Animations beyond defaults** — standard Svelte transitions, no custom motion design.
- **Theming customization** — uses existing Nexus theme variables. No new theme tokens.
- **Bulk operations** (mass unlink, mass reconnect) — single-credential actions only.
- **Invite flow for user-level services** — the per-service invite flow (à la Wizarr) is a future concern, not this rework. The managed-account creation flow from this spec is enough for now.

## Parker decisions baked in

- **All three nav entry points** (user menu + sidebar + `/settings/` landing)
- **`/welcome` route name** (post-Codex research)
- **`/admin/*` top-level, separate from `/settings/*`**
- **Terminology locked in** — Connect / Connected / Reconnect / Linked account / Authorize / Enable integration
- **Existing users don't see `/welcome` retroactively** — inline affordances only, with a "Run onboarding again" button in `/settings/`
- **Password-storage disclosure copy** — technical + explicit version

## Open questions

*None for this pass — scope is clear. If implementation surfaces ambiguity in specific flows, open questions get appended here.*
