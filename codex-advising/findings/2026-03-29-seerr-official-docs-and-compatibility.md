# Codex Research Findings

## Question

What do Seerr/Jellyseerr’s official docs and upstream project materials say about API behavior, request/discovery capabilities, auth patterns, and compatibility assumptions relevant to Nexus’s Seerr migration work?

## Local Evidence

Relevant Nexus files:

- `src/lib/adapters/overseerr.ts`
- `src/lib/adapters/registry.ts`
- `src/lib/server/services.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/media/[type]/[id]/+page.server.ts`
- `src/routes/media/[type]/[id]/+page.svelte`
- `src/routes/requests/+page.server.ts`
- `src/routes/requests/+page.svelte`
- `src/routes/search/+page.svelte`

Observed local behavior:

- Nexus is trending toward one shared adapter implementation for `overseerr` and `seerr`
- helper logic such as `isOverseerrType(...)` suggests a compatibility-family approach
- request/discovery/media flows and user-facing wording still contain `overseerr` assumptions in multiple places

## External Sources

- Seerr docs introduction: https://docs.seerr.dev/
- Seerr getting started: https://docs.seerr.dev/getting-started
- Seerr Plex integration overview: https://docs.seerr.dev/using-seerr/plex
- Jellyseerr owner account docs: https://docs.jellyseerr.dev/using-jellyseerr/users/owner
- Jellyseerr watchlist auto-request docs: https://docs.jellyseerr.dev/using-jellyseerr/plex/watchlist-auto-request
- Jellyseerr repository / README: https://github.com/fallenbagel/jellyseerr

## Key Facts

- Seerr describes itself as free and open source software for managing requests for your media library.
- Seerr explicitly documents integration with Jellyfin, Plex, and Emby media servers, plus Sonarr and Radarr.
- Seerr’s public docs show that the product surface includes:
  - login and user access tied to the media server
  - library sync to show what titles already exist
  - movie, show, and mixed-library support
  - request permissions and management UI
- Jellyseerr’s owner-account docs show that media-server authentication state is not incidental; the owner account is used to authenticate with the media server and configure settings.
- Jellyseerr’s watchlist auto-request docs show that permissions, account linkage, and background request behavior are all part of the real product surface, not edge features.
- The Seerr/Jellyseerr docs are far more about product behavior and user flows than about low-level public API contracts.

## Facts Vs Inference

### Sourced facts

- Seerr/Jellyseerr are request/discovery managers with real auth, permission, library-sync, and request-management surfaces.
- User linkage to the media server matters for product behavior.
- Auto-request behavior depends on both permissions and user activation, which means user/account flows are meaningful compatibility territory.

### Inference

- Nexus should not treat Seerr support as merely “adapter registration plus endpoint parity.”
- If Seerr/Jellyseerr’s real surface includes user auth, user import, request permissions, and request-state behavior, then Nexus parity should be evaluated across those flows too.
- The current local `overseerr` wording in UI/search/request flows is likely not just cosmetic; it may reflect incomplete parity assumptions in surrounding logic.

## Relevance To Nexus

This matters because the current local architecture is moving in the right direction, but the outside docs make it clear that Seerr compatibility is a product-surface problem, not just a backend adapter problem. Claude should think about:

- configuration and registration
- user auth/account-linking
- request/discovery/detail flows
- user-facing wording

as one compatibility bundle.

## Advisory Takeaway

Issue `#27` should be treated as a full compatibility pass rather than a narrow adapter migration. The strongest completion standard is not “Seerr adapter exists,” but “Seerr-backed configs behave correctly anywhere Nexus currently assumes an Overseerr-style request/discovery service.”

## Open Questions

- Which remaining Nexus routes still rely on `overseerr`-specific assumptions beyond labeling?
- Should Nexus continue using one internal compatibility family for `overseerr` + `seerr`, or is there enough divergence to justify more explicit branching?
- Which user/account flows in Nexus need to mirror Seerr’s documented permission and linkage behavior more carefully?
