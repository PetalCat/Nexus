# Seerr Migration Research

## Summary

Issue `#27` should be treated as a compatibility/migration pass, not a brand-new adapter effort.

This work appears already underway in the local tree.

## External Sources

- Seerr repository / README: https://github.com/fallenbagel/jellyseerr
- Seerr docs: https://docs.seerr.dev/getting-started/
- Jellyseerr docs example for auto-request behavior: https://docs.jellyseerr.dev/using-jellyseerr/plex/watchlist-auto-request

## What Local Repo State Suggests

- Shared logic already lives in the Overseerr adapter.
- A helper exists for dual-type handling:
  - `isOverseerrType(type)` returns true for `overseerr` and `seerr`
- Local changes show:
  - dual registration in adapter registry
  - search behavior updated to treat both types similarly
  - login autolink adjusted for both types
  - media detail flows updated for both types

## Relevant Local Files

- `src/lib/adapters/overseerr.ts`
- `src/lib/adapters/registry.ts`
- `src/lib/server/services.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/media/[type]/[id]/+page.server.ts`
- `src/routes/media/[type]/[id]/+page.svelte`

## Current Local Direction

The current implementation direction appears to be:

- keep a single adapter implementation
- expose `seerr` as an additional registered adapter ID
- widen logic that previously assumed only `overseerr`
- preserve existing request/discovery behavior while enabling Seerr configs to work through the same paths

## Recommended Issue Framing

- Preserve compatibility with existing Overseerr configs
- Add Seerr as a first-class config type
- Reuse one shared adapter implementation where API behavior overlaps
- Define completion as: Seerr-backed configs work anywhere Overseerr-backed configs currently work

## Open Follow-Up Questions

- Are there any material API differences that require branching beyond naming/config identity?
- Should `serviceType` normalization remain `overseerr` internally or become dynamic in more places?
- What remaining routes/features still assume only `overseerr`?

## Known Risk Areas

- request/history pages that may still hardcode `overseerr`
- search/result labels that mention only Overseerr
- any code that serializes `serviceType: 'overseerr'` into user-facing UI or downstream logic
- account-linking flows that assume exactly one request-service type

## External Signal

The upstream project explicitly describes itself as a media request and discovery manager with authentication, request, and library-integration features. Its public docs also show behavior around watchlist auto-request and permissions. That supports treating Seerr parity as broader than just adapter registration: request flows, auth assumptions, and user-facing labels matter too.

## Recommended Completion Criteria for `#27`

- `seerr` can be configured as a service type
- request/discovery/detail/search flows work for `seerr`
- user auto-link/auth flows work wherever Jellyfin-auth-style linking is expected
- user-facing labels are updated where necessary
- issue body reflects migration strategy and status instead of a one-line note
