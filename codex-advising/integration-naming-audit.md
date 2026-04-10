# Integration Naming Audit

## Summary

The repo contains many direct third-party names, but most are in internal docs, technical specs, adapter code, and compatibility references.

The main public-facing cleanup target is `README.md`.

## What This Audit Covers

- direct third-party names in README
- likely user-facing route/page strings
- obvious style comments or messaging that reference outside brands

It does not attempt to rename internal adapter code or technical design docs unless they surface publicly.

## Highest-Priority Public Copy Targets

- `README.md`
  - "Browse and stream via Jellyfin"
  - "YouTube alternative frontend via Invidious"
  - "Overseerr integration for media requests"
  - Supported-services table

## Additional User-Facing Targets Worth Reviewing

- `src/app.css`
  - contains design-comment wording: "Premium cinematic feel (Apple TV / Netflix)"
- `src/routes/search/+page.svelte`
  - references request results "Found via Overseerr"
- `src/routes/requests/+page.svelte`
  - prompts users to connect Overseerr directly
- `src/routes/discover/+page.svelte`
  - prompts users to connect a service like Overseerr
- `src/routes/videos/+page.svelte`
  - tells users to add an Invidious instance
- `src/routes/settings/accounts/+page.svelte`
  - contains multiple Jellyfin-specific labels/prompts

These may be acceptable operationally, but they should be reviewed against the desired messaging strategy.

## Lower-Priority Naming Areas

- Internal design specs in `docs/`
- Adapter implementation files in `src/lib/adapters/`
- Technical comments in route/server code

These are less urgent unless the goal is a full terminology pass.

## Local Findings

Public and semi-public files with notable brand mentions include:

- `README.md`
- `src/app.css`
- `src/routes/search/+page.svelte`
- `src/routes/requests/+page.svelte`
- `src/routes/discover/+page.svelte`
- `src/routes/settings/accounts/+page.svelte`
- `src/routes/videos/+page.svelte`
- `src/routes/movies/+page.svelte`
- `src/routes/shows/+page.svelte`

By contrast, the heaviest mention counts overall are in internal docs/specs and adapter code. That means the first cleanup pass should not try to scrub the entire repo.

## Suggested Cleanup Strategy

1. Fix public-facing marketing copy first.
2. Keep explicit service names in compatibility/setup docs where operationally necessary.
3. Leave most technical/internal references alone unless they surface in the public product.
4. For in-app strings, decide whether a direct service name is:
   - operationally required
   - helpful but optional
   - purely stylistic and removable

## Notable Finding

Brand-name density is highest in internal docs and adapter code, not in user-facing marketing pages. This is mostly a messaging cleanup problem, not a need to rename the whole codebase.

## Follow-Up Work for Claude

- review README first
- then audit user-visible route strings in the files listed above
- do not waste time renaming adapter IDs or technical comments unless they leak into public copy
