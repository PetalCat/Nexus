# Public Copy Audit

## Goal

Identify the highest-value public or semi-public strings that should be reviewed for neutral language, non-affiliation clarity, and reduced brand-led marketing tone.

## Highest-Priority Targets

### `README.md`

Current patterns to review:

- "Browse and stream via Jellyfin"
- "YouTube alternative frontend via Invidious"
- "Overseerr integration for media requests"
- supported-services table naming

Reason:

- This is the most obvious public-facing text in the repo.

### `src/app.css`

Current pattern to review:

- design comment mentioning "Apple TV / Netflix"

Reason:

- low severity, but unnecessary outside-brand framing even in style comments may encourage similar copy elsewhere.

### `src/routes/discover/+page.svelte`

Current pattern:

- prompts users to connect "a service like Overseerr"

Question:

- should discovery be framed as "connect a compatible request/discovery service" instead?

### `src/routes/requests/+page.svelte`

Current patterns:

- multiple direct references to connecting Overseerr

Question:

- are these operationally necessary, or should the UI speak more generically where multiple compatible services may exist?

### `src/routes/videos/+page.svelte`

Current patterns:

- direct Invidious naming in empty states and help text

Question:

- is this an acceptable direct integration label, or should it be abstracted in user-facing empty states?

### `src/routes/settings/accounts/+page.svelte`

Current patterns:

- multiple Jellyfin-specific labels and prompts

Question:

- are these hard requirements, or are some strings really about "primary media server" rather than the brand name?

## Lower-Priority but Worth Tracking

- `src/routes/movies/+page.svelte`
- `src/routes/shows/+page.svelte`
- `src/routes/search/+page.svelte`
- `src/lib/components/CommandPalette.svelte`

These contain direct service naming that may or may not be acceptable depending on whether the user is selecting/configuring an integration versus reading product copy.

## Suggested Review Heuristic

For every user-visible string that names a service, ask:

1. Is the service name operationally necessary?
2. Is the string marketing copy or compatibility/setup copy?
3. Would the string still be clear if generalized?
4. Does the string accidentally imply exclusivity or official support?

## Recommended Ordering

1. README
2. website/public copy
3. setup/onboarding
4. empty states and help text
5. settings/account UI
