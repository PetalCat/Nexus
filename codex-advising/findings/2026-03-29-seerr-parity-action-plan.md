# Codex Advisory Finding

## Topic

Seerr parity follow-through risks

## Local Evidence

- parity work exists in `src/lib/adapters/overseerr.ts`, `src/lib/adapters/registry.ts`, `src/lib/server/services.ts`, and media/login flows
- many request/search/discovery/UI surfaces still use `overseerr`-specific labels and state names
- helper logic such as `isOverseerrType(...)` suggests the intended architecture is shared rather than split

## External Sources

- Seerr repository / README: https://github.com/fallenbagel/jellyseerr
- Seerr docs: https://docs.seerr.dev/getting-started/

## Key Risk Areas

### User-facing strings

Even if backend compatibility is mostly correct, user-visible wording can still make Seerr support feel incomplete or misleading.

### Variable and state naming

Hardcoded naming like `hasOverseerr` is not inherently a bug, but it often signals assumptions that can leak into filters, empty states, or branching logic.

### Auth and request flows

Seerr/Jellyseerr’s own docs show that authentication, user import, request management, and permissioned features are part of the product surface. That means parity work should be evaluated across those flows, not just adapter registration.

## Advisory Takeaway

Issue `#27` should be treated as a full compatibility pass across:

- configuration and registration
- request/discovery/detail flows
- auth/account-linking flows
- user-facing wording

not just as an adapter-identity rename.

## Relevance To Nexus

This is the main place where "shared adapter exists" can give a false sense of completeness. The architecture is trending the right way, but the UI and surrounding assumptions are where parity is most likely to remain incomplete.
