# User Onboarding & Credential Linking Redesign

**Date:** 2026-03-30
**Status:** Approved

## Problem

The current user onboarding system has five shortcomings:

1. **Different usernames across services** — Auto-link only matches by exact username. Users with "john" on Jellyfin and "john_doe" on Overseerr silently fail.
2. **Password reset surprise** — Provisioning finds an existing Jellyfin user and resets their password without warning.
3. **Services added after users exist** — Provisioning only runs at registration time. Users who registered before a service was added never get linked.
4. **Manual linking UX** — The settings flow for "I already have accounts on these services" is unclear.
5. **No bulk onboarding** — No way to bring existing Jellyfin/Plex users into Nexus without manual registration.

## Design

### 1. Registration Modes

Three ways to create a Nexus account:

**Jellyfin/Plex login:** Registration and login forms include "Sign in with Jellyfin" / "Sign in with Plex" options (one button per connected media server). User enters their existing credentials. Nexus authenticates against the media server API. If no Nexus account exists, one is created automatically with the credential already linked. Nexus password is set to whatever they entered. If a Nexus account already exists with a matching username, the user must authenticate with their Nexus password to prove ownership before the Jellyfin/Plex credential is linked. If they can't prove ownership (wrong password, forgot it, etc.), a new Nexus account is created with a different username — usernames don't have to match across systems.

**Local registration:** Standard username + password form for users without Jellyfin/Plex accounts. Works like today minus auto-provisioning. Users link services manually later.

**Invite link:** Same as today but the invite page also supports the Jellyfin/Plex login option.

**Removed:** The fire-and-forget `provisionUserOnServices()` call. No silent account creation or password resets on external services.

### 2. Admin User Management

Jellyfin/Plex users do not need importing. They authenticate with their media server credentials and Nexus creates their account on the fly.

**Admin controls:**
- Setting: "Allow Jellyfin/Plex authentication" (on/off, per connected media server)
- Existing setting: "New accounts require admin approval" — if on, auto-created accounts land in `pending` status until admin approves

**Admin `/admin/users` page:**
- List all users with linked services and status (active/pending)
- Approve/deny pending users
- "Create User" button for manually adding local-only users (temp password, force reset on first login)
- Delete users

No bulk import UI. Admin tells Jellyfin/Plex users "go to Nexus and log in" and they're in.

### 3. Per-User Service Linking

In `/settings/accounts`, each linkable service shows one of three states:

**Linked** — Green indicator, shows external username (or "Managed by Nexus" badge for managed accounts). "Unlink" option available. Unlinking a managed account deletes it from the external service.

**Not linked** — Two options:
- "Link existing account" — User enters their credentials for that service. Nexus authenticates and stores the credential.
- "Create managed account" — Clearly labeled: "Nexus will create and manage an account on [Service] for you. You won't need to log into [Service] directly — Nexus handles it." Nexus creates the account programmatically, stores credentials, user never sees them.

**Not applicable** — Admin-only API services (Radarr, Sonarr, Lidarr, Prowlarr, Bazarr) that don't have per-user accounts. No linking UI shown.

"Create managed account" only available when the adapter implements `createUser`. If the service doesn't support programmatic user creation, only the manual link option shows.

No auto-provisioning at registration time. Users link services at their own pace from settings. Homepage shows a subtle nudge ("You have unlinked services") if relevant services aren't connected yet.

### 4. Auto-Linking Derived Services

Some services authenticate through another service's credentials rather than their own. Each adapter declares this in its definition:

```typescript
// On the ServiceAdapter interface:
derivedFrom?: string[];     // Parent adapter IDs, order = preference
parentRequired?: boolean;   // true = only works through parent, false = manual fallback available
```

No hardcoding of which services derive from which. The adapter definition is the single source of truth.

**Examples:**
- Overseerr adapter: `derivedFrom: ['jellyfin', 'plex'], parentRequired: false`
- StreamyStats adapter: `derivedFrom: ['jellyfin'], parentRequired: true`

**When a parent credential is linked (triggered on credential upsert, not login):**
- Nexus scans all enabled services for adapters that derive from the newly linked parent type
- For each, attempts auto-link using the parent credential
- Shows "Linked via Jellyfin" or "Linked via Plex" on success

**When auto-link fails:**
- If `parentRequired: true` — show specific error: "Your Jellyfin account wasn't found in [Service]. Ask your admin to add you."
- If `parentRequired: false` — fall back to normal "Link existing account" / "Create managed account" options

**When no parent is linked:**
- If `parentRequired: true` — show "Requires Jellyfin" (or "Requires Jellyfin or Plex") with link to set up the parent first
- If `parentRequired: false` — show normal link/managed options

**When user has both Jellyfin + Plex linked:**
- Derived service uses the first match in its `derivedFrom` preference order
- Once linked through a specific parent, stays linked through that parent

**Unlinking a parent service warns** that derived services linked through it will also be unlinked.

### 5. Removed Behavior

**Deleted:**
- `provisionUserOnServices()` — the fire-and-forget function that silently creates/resets accounts at registration time
- The password-reset-on-match logic in the provisioning flow
- `autoLinkOverseerr()` hardcoded function from the login flow

**Replaced by:**
- Derived auto-link triggered on credential upsert — whenever a Jellyfin/Plex credential is stored, scan for derivable services and link them
- Explicit user-driven linking in `/settings/accounts`
- Admin user creation form for local-only users

### 6. Data Model Changes

**`userServiceCredentials` table — add column:**
- `managed` (INTEGER BOOLEAN DEFAULT 0) — whether Nexus created and owns this credential. Unlinking a managed credential deletes the account on the external service.
- `linkedVia` (TEXT, nullable) — the service type this was derived through (e.g., 'jellyfin'). Null for directly linked credentials.

**`ServiceAdapter` interface — add fields:**
- `derivedFrom?: string[]` — parent adapter IDs for auto-linking, order = preference
- `parentRequired?: boolean` — if true, service only works through a parent (no manual link fallback)

**`appSettings` — add:**
- `auth_jellyfin_enabled` (per service ID) — whether Jellyfin login is allowed for that service
- `auth_plex_enabled` (per service ID) — whether Plex login is allowed for that service

### 7. Route Changes

**Modified routes:**
- `POST /login` — add Jellyfin/Plex authentication path alongside local auth
- `POST /register` — add Jellyfin/Plex registration path
- `POST /invite` — add Jellyfin/Plex option
- `/settings/accounts` — redesigned linking UI with three states and managed account support

**New routes:**
- `POST /api/user/credentials/[serviceId]/managed` — create a managed account on a service
- `POST /api/user/credentials/[serviceId]/link` — link an existing account (authenticate + store)
- `DELETE /api/user/credentials/[serviceId]` — unlink (and delete if managed)

**Modified API:**
- `POST /api/admin/users` — create local user with temp password + force reset

### 8. UI Changes

**Login page:** Add "Sign in with Jellyfin" / "Sign in with Plex" buttons below the username/password form. One button per connected media server that has auth enabled. Clicking opens a form for that service's credentials.

**Register page:** Same Jellyfin/Plex buttons. If a user authenticates against Jellyfin/Plex and no Nexus account exists, one is created. If `registration_requires_approval` is on, account is created in pending state.

**Invite page:** Same Jellyfin/Plex buttons alongside local registration.

**Settings > Accounts:** Redesigned service list. Each service shows its current link state with appropriate actions. Managed accounts show "Managed by Nexus" badge. Derived services show "Linked via [Parent]" or appropriate setup prompt. Unlink warns about derived service cascade.

**Homepage nudge:** If user has unlinked services that would enhance their experience, show a dismissable banner: "Link your accounts to unlock more features" with link to settings.

**Admin > Users:** Table of all users with linked service indicators. Approve/deny buttons for pending users. "Create User" button for local accounts.
