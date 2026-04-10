# UI String Audit

## Goal

Identify user-visible strings that may deserve review for:

- unnecessary direct service naming
- brand-led product framing
- wording that may become stale if integrations broaden

This is an advisory review, not a demand to genericize everything.

## Highest-Value Review Targets

### `README.md`

Why it matters:

- most public-facing text in the repo
- currently leads with multiple direct integration names

### `src/routes/requests/+page.svelte`

Examples:

- "Connect Overseerr in Settings to allow users to request movies and shows."
- "Connect your Overseerr account ..."

Why it matters:

- highly user-visible
- likely to become stale if Seerr parity lands

### `src/routes/discover/+page.svelte`

Example:

- "Connect a service like Overseerr to populate discover results."

Why it matters:

- direct naming in empty-state guidance
- may be better as generic request/discovery-service language depending on product direction

### `src/routes/search/+page.svelte`

Example:

- "Found via Overseerr — request any of these to add them."

Why it matters:

- hardcodes branding directly into search result UX
- may be inaccurate once Seerr parity exists

### `src/routes/videos/+page.svelte`

Examples:

- "Add an Invidious instance in settings to browse videos."
- "Check that your Invidious instance is reachable."

Why it matters:

- may be acceptable as operational integration language
- still worth review if product messaging wants a more generic capability layer

### `src/routes/settings/accounts/+page.svelte`

Examples:

- multiple Jellyfin-specific labels/prompts

Why it matters:

- account setup text strongly shapes how users understand the architecture
- some strings may need to stay brand-specific, others may really refer to a generic “primary media server” role

### `src/app.css`

Example:

- comment: "Premium cinematic feel (Apple TV / Netflix)"

Why it matters:

- low severity
- but it reflects a pattern of using outside brands as shorthand for design direction

## Review Categories

For each string, classify it as:

### Category A: operationally necessary

Examples:

- setup instructions that genuinely require a specific integration name
- compatibility-specific labels

### Category B: acceptable but optional

Examples:

- empty-state text that names one service, but could be generalized later

### Category C: unnecessary brand-led framing

Examples:

- marketing phrases
- style comments
- user-facing copy where the brand adds little clarity

## Advisory Questions for Claude

- Which user-facing names are needed because the user must configure a specific service?
- Which names should become generic because the product is moving toward broader adapter parity?
- Which strings are just marketing shorthand and should be softened?

## Best Use of This Audit

Use it during README/website work, Seerr issue cleanup, and any future wording pass across user-visible empty states or account/setup screens.
