# Seerr Parity Audit

## Goal

Identify where the codebase still assumes `overseerr` specifically, so Seerr support can be evaluated with full context.

This is an advisory audit, not an implementation checklist.

## Summary

Local changes already move some core logic from `overseerr`-only handling toward `overseerr` + `seerr` parity.

However, many routes and UI strings still explicitly assume `overseerr`.

## Confirmed Local Signals

### Parity work already started

Files with active/local parity signals:

- `src/lib/adapters/overseerr.ts`
- `src/lib/adapters/registry.ts`
- `src/lib/server/services.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/media/[type]/[id]/+page.server.ts`
- `src/routes/media/[type]/[id]/+page.svelte`

Examples:

- `isOverseerrType(type)` helper exists
- adapter registry includes a `seerr` registration in local changes
- some media-detail and service-selection logic now checks both `overseerr` and `seerr`

## Areas Still Assuming `overseerr`

### Requests pages

- `src/routes/requests/+page.server.ts`
- `src/routes/requests/+page.svelte`

Observations:

- multiple filters hardcode `c.type === 'overseerr'`
- adapters are fetched with `registry.get('overseerr')`
- UI state names are `hasOverseerr` and `hasLinkedOverseerr`
- empty-state/help text references Overseerr directly

Research implication:

- requests/history flows are a high-risk area for parity gaps

### Movies and shows homepage flows

- `src/routes/movies/+page.server.ts`
- `src/routes/movies/+page.svelte`
- `src/routes/shows/+page.server.ts`
- `src/routes/shows/+page.svelte`

Observations:

- trending/popular rows are described as Overseerr-specific
- `registry.get('overseerr')` is still used

Research implication:

- discovery surfaces may still be functionally tied to Overseerr naming

### Search and command-palette behavior

- `src/routes/search/+page.svelte`
- `src/lib/components/CommandPalette.svelte`

Observations:

- search grouping filters directly on `serviceType === 'overseerr'`
- requestable-item labels explicitly say Overseerr

Research implication:

- even if backend parity works, user-visible grouping and labeling may still bias toward a single brand/type

### Admin and settings flows

- `src/routes/admin/+page.server.ts`
- `src/routes/admin/services/+page.server.ts`
- `src/routes/settings/+layout.server.ts`
- `src/routes/api/user/credentials/+server.ts`
- `src/routes/api/requests/+server.ts`
- `src/routes/api/requests/seasons/+server.ts`

Observations:

- multiple lookups still fetch or filter specifically for `overseerr`
- comments and assumptions often describe only Overseerr

Research implication:

- admin/autolink/request endpoints likely need review for parity assumptions

## Internal Normalization Question

`src/lib/adapters/overseerr.ts` still normalizes many objects with:

- `serviceType: 'overseerr'`

That may be acceptable as an internal normalization choice, but it has consequences:

- user-visible grouping may continue to label Seerr-backed results as Overseerr
- downstream filters that key on `serviceType` may silently flatten both brands into one bucket

This is not automatically wrong, but it should be a conscious design choice.

## Advisory Questions for Claude

- Is the product intent to present Seerr as a distinct service type in the UI, or simply as a compatible variant of the same request/discovery role?
- Which screens should use generic “request/discovery service” wording instead of direct Overseerr naming?
- Where does internal normalization to `'overseerr'` create confusing user-facing copy?

## Best Use of This Audit

Use this file to guide review of issue `#27`, user-visible labels, and parity-sensitive request/discovery flows.
