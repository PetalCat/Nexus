# Better Onboarding UI — Design Spec

GitHub: PetalCat/Nexus#57

## Problem

First-run setup is clunky. After creating an admin account, the user lands on a raw services page with no guidance. There's no wizard, no connection testing, no progress indicator, and no sense of what to do next. New admins have to figure out URLs, API keys, and service types on their own.

## Solution

Three-layer onboarding system:

1. **Setup Wizard** — Linear first-run flow that gets the admin from zero to a working dashboard in under 2 minutes
2. **Homepage Getting Started Checklist** — Persistent, dismissable checklist on the homepage guiding admins through optional services
3. **Contextual Hints** — Empty-state hints on pages where missing services would unlock features

Everything is driven by the adapter registry — no hardcoded service lists. Adding `onboarding` metadata to an adapter automatically surfaces it in the wizard, checklist, and hints.

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Wizard structure | Linear setup → homepage checklist (hybrid) | Low-friction first run, ongoing non-blocking guidance |
| Visual tone | Minimal dark aesthetic, warm guided copy | Cinematic but approachable — matches Nexus's personality |
| Wizard steps | Welcome → Admin Account → Media Server → More Services → Done | Only media server is required; everything else skippable |
| Service discovery | Adapter registry driven, not hardcoded | New adapters get onboarding automatically |
| Checklist dismiss | Auto-complete + snooze (7 days) + permanent dismiss | Rewarding progress, not annoying |
| Wizard routing | Single `/setup` route, client-side step transitions | Clean back-button behavior |
| Service branding | Neutral integration language, no direct consumer brand references | "Privacy-friendly video" not "YouTube" |

---

## Adapter Registry Extension

Add optional `onboarding` metadata to the `ServiceAdapter` interface:

```ts
interface ServiceAdapter {
  // ... existing fields ...
  onboarding?: {
    category: 'media-server' | 'automation' | 'requests' | 'subtitles'
             | 'analytics' | 'video' | 'games' | 'books' | 'indexer';
    description: string;
    priority: number;
    icon?: string;
    requiredFields: ('url' | 'apiKey' | 'username' | 'password')[];
    supportsAutoAuth?: boolean;
  };
}
```

All onboarding UI reads from the registry at runtime:
- Wizard step 3: `registry.all().filter(a => a.onboarding?.category === 'media-server')`
- Wizard step 4: `registry.all().filter(a => a.onboarding && a.onboarding.category !== 'media-server')`, grouped by category, sorted by priority
- Homepage checklist: same query, cross-referenced with `getServiceConfigs()` to show connected state
- Contextual hints: pages declare needed categories, query registry for matches

---

## Setup Wizard

### Trigger

Same as today: `getUserCount() === 0` → server hook redirects to `/setup`.

### Route

Single route `/setup`. Steps are client-side state transitions within one Svelte component. No sub-routes.

### Visual Design

- Full-screen, no sidebar or header (already excluded in layout)
- Centered single-column, max-width ~480px
- Dark background, generous whitespace
- Dot progress indicators (not a bar)
- Warm conversational copy throughout

### Step 1: Welcome

- Heading: "Welcome to Nexus"
- Subtext: "Your media, unified."
- One-liner: "Nexus connects your media services into one interface. This takes about 2 minutes."
- Single "Get Started" button

### Step 2: Create Admin Account

- Fields: username, display name, password, confirm password
- Inline validation (password min 6 chars, must match)
- Copy: "This is your admin account. You'll use it to manage Nexus and connect your services."
- On submit: creates user with `isAdmin: true`, sets session cookie
- No redirect — advances to step 3 client-side

### Step 3: Connect Your Media Server

- Shows cards for each adapter where `onboarding.category === 'media-server'` (currently Jellyfin, Plex)
- Each card: icon, name, description
- Selecting a card expands a form: URL, username, password (for adapters with `supportsAutoAuth`), or URL + API key
- Inline connection test: spinner → green checkmark with discovered libraries, or error with help text
- After successful connection: shows summary ("Found 3 libraries: Movies, TV Shows, Music")
- "Skip for now" link at bottom

### Step 4: Connect More Services

- Grid of service cards from registry, grouped by `onboarding.category`, sorted by `priority`
- Excludes already-connected services and media-server category
- Category headers: "Automation", "Requests", "Subtitles", "Analytics", "Video", "Games", "Books", "Indexers"
- Each card: icon (from `onboarding.icon`), adapter `displayName`, `onboarding.description`, connect button
- Clicking "Connect" expands the form inline with fields from `onboarding.requiredFields`
- Same inline connection test pattern as step 3
- Connected services show green check, collapse
- "Skip — I'll do this later" button always visible, prominently placed

### Step 5: You're All Set

- Summary of what was connected: list of services with icons and status
- If media server was connected: thumbnail strip of recent/discovered content
- Primary button: "Head to your dashboard"
- Secondary text: "Check the Getting Started guide on your homepage for more."
- Redirects to `/`

---

## Homepage Getting Started Checklist

### Who Sees It

Admin users only. Visibility controlled by `appSettings`:
- `onboarding_checklist_status`: `'active'` | `'snoozed'` | `'dismissed'`
- `onboarding_checklist_snoozed_until`: ISO timestamp (for snooze)

### Placement

Below the hero carousel, above content rows. Full-width card matching the app's surface style.

### Structure

- Header: "Getting Started" with progress ("3 of 8 complete")
- Grouped by adapter category, same as wizard step 4
- Each item shows: service icon, name, description, connection status
- Connected items: green check, "Connected" label, collapsed by default
- Unconnected items: dimmed icon, "Set up" link → `/admin/services` with `?highlight={adapterId}` to pre-select the service type

### Auto-Complete

On every homepage load, the server checks `getServiceConfigs()` against the registry. Items where the service type exists in configs are marked complete. No manual checking needed.

### Invite Users & Configure Settings Items

Two non-adapter checklist items that use the same card format:
- "Invite Users" — complete when `inviteLinks` table has at least one row OR `registration_enabled` is true. Links to `/admin/users`.
- "Configure Settings" — always shown as a suggestion, links to `/admin/system`. Can be checked off manually.

### Dismiss Behavior

- "Remind me later" button: sets `onboarding_checklist_status` to `'snoozed'`, `onboarding_checklist_snoozed_until` to now + 7 days
- "Dismiss" button: sets status to `'dismissed'`
- Re-accessible from `/admin/system` settings: "Show Getting Started checklist" toggle
- Auto-collapses to single line when all adapter-based items are complete: "All services connected" with dismiss option

---

## Contextual Hints

### Mechanism

Pages that depend on specific service categories declare their dependencies in `+page.server.ts`:

```ts
return {
  // existing data...
  missingCategories: getMissingCategories(['automation', 'requests'])
};
```

`getMissingCategories(needed: string[])` checks the service configs against the registry and returns an array of `{ category, adapterName, description }` for categories with no connected services.

### Hint Component

A reusable `SetupHint.svelte` component:
- Subtle card style matching the existing unlinked-services nudge
- Icon + message: "{description} — Set up {adapterName}" with link to `/admin/services`
- Dismissable per-page per-session (client-side state, not persisted)

### Where Hints Appear

Not hardcoded per page. Each `+page.server.ts` declares what categories it needs. Examples:
- `/discover`: needs `requests`
- `/calendar`: needs `automation`
- `/music`: needs `automation` (Lidarr)
- `/books`: needs `books`
- `/games`: needs `games`

If no services of that category are connected, the hint shows. The hint text comes from the first matching adapter's `onboarding.description`.

---

## Files To Create / Modify

### New Files
- `src/routes/setup/+page.svelte` — Complete rewrite (wizard with 5 steps)
- `src/routes/setup/+page.server.ts` — Rewrite (handle account creation + service saving)
- `src/lib/components/onboarding/SetupWizard.svelte` — Wizard container with step management
- `src/lib/components/onboarding/ServiceCard.svelte` — Reusable service card with expand/connect/test
- `src/lib/components/onboarding/GettingStartedChecklist.svelte` — Homepage checklist
- `src/lib/components/onboarding/SetupHint.svelte` — Contextual hint for missing services
- `src/lib/server/onboarding.ts` — Server helpers: `getOnboardingStatus()`, `getMissingCategories()`

### Modified Files
- `src/lib/adapters/base.ts` — Add `onboarding` to `ServiceAdapter` interface
- `src/lib/adapters/*.ts` — Add `onboarding` metadata to each adapter
- `src/routes/+page.svelte` — Add `GettingStartedChecklist` component
- `src/routes/+page.server.ts` — Add checklist status to page data
- `src/routes/discover/+page.server.ts` — Add `missingCategories` for `requests`
- `src/routes/calendar/+page.server.ts` — Add `missingCategories` for `automation`
- Other page server files — Add `missingCategories` as relevant
- `src/routes/api/services/+server.ts` — Support `?highlight` param for pre-selection

### Database
- Two new `appSettings` keys: `onboarding_checklist_status`, `onboarding_checklist_snoozed_until`
- No schema migration needed — `appSettings` is already a key-value store
