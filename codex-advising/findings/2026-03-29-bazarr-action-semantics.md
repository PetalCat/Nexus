# Codex Research Findings

## Question

What do Bazarr’s official docs or other authoritative sources say about subtitle download, upload, sync, translate, provider reset, and related action semantics?

## Local Evidence

Relevant Nexus files:

- `src/lib/adapters/bazarr.ts`
- `src/routes/api/admin/subtitles/providers/+server.ts`
- `src/routes/api/subtitles/+server.ts`
- `src/routes/api/subtitles/download/+server.ts`
- `src/routes/api/subtitles/sync/+server.ts`
- `src/routes/api/subtitles/translate/+server.ts`

Observed local behavior:

- provider reset is modeled as `POST /api/providers` with `{ action: 'reset' }`
- manual subtitle download is modeled against Bazarr movie/episode subtitle endpoints with `id`, `language`, `hi`, `forced`, and optional `provider`
- subtitle sync is modeled as `PATCH /api/subtitles` with `action: 'sync'`, `language`, `path`, `id`, and `mediaType`
- subtitle translate is modeled as `PATCH /api/subtitles` with `action: 'translate'`, `language`, `path`, `id`, and `mediaType`
- subtitle delete is modeled against Bazarr movie/episode subtitle endpoints
- upload capability exists in `uploadContent()`, but there is no clearly surfaced user-facing upload route in the current Nexus tree
- the translate route documents `targetLanguage`, but the route and adapter do not currently forward it

## External Sources

- Bazarr repository / README: https://github.com/morpheus65535/bazarr
- Bazarr setup guide: https://wiki.bazarr.media/Getting-Started/Setup-Guide/
- Bazarr settings reference: https://wiki.bazarr.media/Additional-Configuration/Settings/
- Bazarr FAQ: https://wiki.bazarr.media/Troubleshooting/FAQ/
- Bazarr Whisper provider: https://wiki.bazarr.media/Additional-Configuration/Whisper-Provider/
- Bazarr webhook docs: https://wiki.bazarr.media/Additional-Configuration/Webhooks/
- Bazarr issue discussing manual subtitle upload endpoints: https://github.com/morpheus65535/bazarr/issues/2072

## Key Facts

- Bazarr publicly describes itself as a companion application for Sonarr and Radarr that manages and downloads subtitles.
- Bazarr’s public docs and README clearly support these product-level capabilities:
  - automatic subtitle management
  - manual search and manual download
  - deletion of external subtitles
  - synchronization-related settings
  - Whisper-backed subtitle generation
- Bazarr’s Whisper provider docs state that Whisper can transcribe many languages but can only translate into English.
- Bazarr’s public docs are much stronger on user-facing capability and configuration than on low-level API request-body contracts.
- Public Bazarr material supports the existence of upload-style flows against movie and episode subtitle endpoints, but that evidence is clearer from upstream project material than from the wiki itself.

## Facts Vs Inference

### Sourced facts

- Synchronization is a documented Bazarr capability and has dedicated settings/docs.
- Whisper-backed generation is documented, with the explicit limitation that translation is to English.
- Bazarr’s public-facing materials clearly support manual subtitle search/download and deletion concepts.
- Manual subtitle upload appears to exist in the product surface, but the exact low-level request shape is not well documented in the public wiki.

### Inference

- Nexus’s current `translate-subtitle` route contract should be treated as provisional, because Bazarr’s public docs do not clearly confirm whether a separate `targetLanguage` field is expected.
- If Nexus intends translation into arbitrary languages, the Whisper docs are a warning sign: Bazarr’s documented Whisper translation path is English-only, so “translate subtitle” may depend on provider or workflow specifics that are not obvious from the current local route contract.
- The local upload adapter method is plausible, but until a user-visible route exists and the upstream contract is verified end to end, upload should not be treated as fully delivered in Nexus.

## Relevance To Nexus

This research matters because subtitle tooling is one of the most semantics-sensitive parts of the current worktree. The local adapter and route contracts look internally coherent, but Bazarr’s public docs do not fully validate every low-level payload decision. That means Claude should treat:

- translate semantics
- upload wiring
- provider reset behavior

as areas requiring confirmation rather than assumptions.

## Advisory Takeaway

The safest high-level position for Nexus is:

- manual download, delete, sync, and provider-management concepts are clearly in scope
- Whisper-backed generation is clearly in scope, with important limitations
- upload is plausible and likely real, but not yet clearly surfaced end to end in Nexus
- translate semantics are the shakiest area, because the local `targetLanguage` docs and current adapter payload do not line up cleanly with what Bazarr publicly documents

## Open Questions

- Does Bazarr’s translate action expect a separate target-language field, or does it infer the destination from `language` or other state?
- Is translation in Bazarr limited by provider/workflow in ways the current Nexus API should expose to users?
- Should Nexus treat upload as a user-facing gap until there is a dedicated route/UI flow, even if adapter support exists?
- Is provider reset behavior sufficiently stable to expose as a simple admin action, or should it be treated as a best-effort helper?
