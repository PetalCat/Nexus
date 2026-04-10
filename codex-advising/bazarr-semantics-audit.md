# Bazarr Semantics Audit

## Goal

Capture the current Nexus-side assumptions about Bazarr actions and highlight where endpoint/payload semantics should be verified.

This is advisory context, not an implementation script.

## Local Evidence

Relevant files:

- `src/lib/adapters/bazarr.ts`
- `src/routes/api/admin/subtitles/providers/+server.ts`
- `src/routes/api/subtitles/+server.ts`
- `src/routes/api/subtitles/download/+server.ts`
- `src/routes/api/subtitles/sync/+server.ts`
- `src/routes/api/subtitles/translate/+server.ts`

## External Sources

- Bazarr setup guide: https://wiki.bazarr.media/Getting-Started/Setup-Guide/
- Bazarr settings reference: https://wiki.bazarr.media/Additional-Configuration/Settings/
- Bazarr FAQ: https://wiki.bazarr.media/Troubleshooting/FAQ/
- Bazarr Whisper provider: https://wiki.bazarr.media/Additional-Configuration/Whisper-Provider/

## Summary

The local code already expresses a subtitle action model, but some action semantics should be verified before treating the work as complete.

## Current Local Action Model

### Provider reset

Adapter behavior:

- `POST /api/providers`
- body: `{ action: 'reset' }`

Research note:

- this should be confirmed against Bazarr’s expected provider-reset behavior, but the intent is clear

### Subtitle download

Adapter behavior:

- `PATCH /api/movies/subtitles` or `PATCH /api/episodes/subtitles`
- body includes:
  - `id`
  - `language`
  - `hi`
  - `forced`
  - optional `provider`

Research note:

- this is the most concrete and internally consistent action shape in the current local code

### Subtitle sync

Adapter behavior:

- `PATCH /api/subtitles`
- body includes:
  - `action: 'sync'`
  - `language`
  - `path`
  - `id`
  - `mediaType` mapped to `radarr` or `sonarr`

Research note:

- aligns with the idea that Bazarr needs subtitle identity + backing media manager context

### Subtitle translate

Adapter behavior:

- `PATCH /api/subtitles`
- body includes:
  - `action: 'translate'`
  - `language`
  - `path`
  - `id`
  - `mediaType`

### Important Local Mismatch

The translate route documents:

- `Body: { itemId, language, targetLanguage, path, mediaType }`

But the route only reads:

- `itemId`
- `language`
- `path`
- `mediaType`

And the adapter only forwards:

- `language`
- `path`
- `id`
- `mediaType`

Research implication:

- either `targetLanguage` is unnecessary and the docs are wrong
- or the current route/adapter payload is incomplete

This should be treated as an open semantics question.

### Subtitle delete

Adapter behavior:

- `DELETE /api/movies/subtitles` or `DELETE /api/episodes/subtitles`
- body includes:
  - `id`
  - `language`
  - `path`

Research note:

- this appears coherent with the current route contract

### Subtitle upload

Local signal:

- the adapter has an `uploadContent()` path, but there is no clearly surfaced end-to-end route/UI flow for it in the current tree.

## What Bazarr Docs Do And Do Not Clarify

- Bazarr’s public wiki clearly documents subtitle synchronization as a product capability and calls out that synchronization can be CPU/network intensive.
- The public wiki clearly documents Whisper-backed generation and its limitation that Whisper translation is to English.
- The public docs are much thinner on low-level API request bodies for manual translate/upload actions.

## Advisory Takeaway

The Nexus-side route shapes should not be treated as confirmed API truth just because they are internally consistent. Bazarr’s public docs validate the existence of synchronization and Whisper-backed generation, but they do not fully settle the exact payloads Nexus should send for upload or translate. That makes the current local route contracts provisional rather than authoritative.

Adapter behavior exists in `uploadContent()`:

- `POST /api/movies/subtitles` or `POST /api/episodes/subtitles`
- multipart form with:
  - `file`
  - `id`
  - `language`
  - `hi`
  - `forced`

Research implication:

- upload capability exists at adapter level
- but there is no clearly surfaced dedicated subtitle upload route in the current local files reviewed here

## External Signals

Bazarr’s official wiki confirms related capabilities and configuration areas:

- subtitle setup / synchronization options
- Whisper provider setup for AI-assisted generation

References:

- https://wiki.bazarr.media/Getting-Started/Setup-Guide/
- https://wiki.bazarr.media/Additional-Configuration/Whisper-Provider/

## Advisory Questions for Claude

- Is the documented `targetLanguage` field wrong, or is the current translate implementation incomplete?
- Is upload intentionally deferred, or should the issue body say it is still missing from the user-facing flow?
- Which subtitle actions are admin-only versus normal-user actions?

## Best Use of This Audit

Use this file to review issue `#47`, route contracts, and any future player-side subtitle action UI.
