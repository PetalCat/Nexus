# UI String Audit Deep Pass

## Goal

Expand the earlier UI string audit with more local examples and advisory categorization.

This file is for review context, not a requirement to genericize every label.

## Category A: likely operationally necessary direct naming

These are places where the user may genuinely need to know which integration is involved.

Examples:

- `src/routes/videos/+page.svelte`
  - "Add an Invidious instance in settings to browse videos."
- `src/routes/videos/history/+page.svelte`
  - "No Invidious account linked"
- `src/routes/videos/playlists/+page.svelte`
  - "Link your Invidious account in settings to manage playlists."
- `src/routes/live/+page.svelte`
  - "Connect a Jellyfin server with Live TV configured ..."
- `src/routes/settings/accounts/+page.svelte`
  - service/account-specific setup text

Research view:

- these may remain brand-specific if the integration is truly user-selected and explicit

## Category B: direct naming that may become stale as parity broadens

Examples:

- `src/routes/requests/+page.svelte`
  - direct Overseerr empty-state/account text
- `src/routes/discover/+page.svelte`
  - "Connect a service like Overseerr ..."
- `src/routes/search/+page.svelte`
  - "Found via Overseerr ..."
- `src/routes/movies/+page.svelte`
  - comments/sections describing rows as streamed from Overseerr
- `src/routes/shows/+page.svelte`
  - same pattern

Research view:

- these are the highest-value places to review if Seerr parity is meant to feel real in the UI

## Category C: likely unnecessary brand-led framing

Examples:

- `src/app.css`
  - "Premium cinematic feel (Apple TV / Netflix)"

Research view:

- this is not a big product risk, but it is easy cleanup and reinforces the desired tone

## Category D: internal comments and technical strings

Examples:

- many comments in route/server files
- adapter-specific comments
- API endpoint comments

Research view:

- lower priority unless they are copied into generated docs or user-facing help

## Additional Local Findings

Cross-service setup/account wording currently leans heavily on Jellyfin as the primary source-of-truth account in some flows:

- `src/routes/settings/accounts/+page.svelte`
- `src/routes/login/+page.server.ts`
- `src/routes/settings/+layout.server.ts`
- `src/routes/api/user/credentials/+server.ts`

This may be correct architecturally, but it means the product language can accidentally imply that Jellyfin is the product center rather than one major integration.

## Advisory Questions for Claude

- Which strings are really about a specific integration?
- Which strings are actually describing a capability role:
  - request service
  - video service
  - primary media server
  - subtitle service
- Which strings should remain explicit because the user is troubleshooting a concrete integration?

## Best Use of This Audit

Use it when reviewing:

- README and future website copy
- settings/accounts copy
- request/discovery/search empty states
- Seerr-related UI wording
