# Bazarr Subtitle Capability Research

## Summary

Issue `#47` is broad and should be broken into concrete capability buckets.

This issue should not stay as one vague “subtitle intelligence” umbrella without a capability/status matrix.

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
- Bazarr Whisper provider: https://wiki.bazarr.media/Additional-Configuration/Whisper-Provider/

## Capabilities Visible in Local Repo

- Provider status/admin tooling
- Provider reset
- Subtitle download
- Subtitle delete
- Subtitle sync
- Subtitle translate
- `uploadContent()` hook exists in the Bazarr adapter

## Current Capability Matrix

### Implemented or actively wired in local work

- provider status lookup
- provider reset
- subtitle download action
- subtitle delete action
- subtitle sync action
- subtitle translate action

### Present in adapter but not clearly surfaced end-to-end

- upload flow via `uploadContent()`

### Still broad/unclear at issue level

- AI generation
- preferred-language automation
- scoring/upgrades
- complete player UX integration

## Likely Remaining Gaps

- Upload flow is not clearly surfaced through a dedicated subtitle route/UI flow yet
- Translate semantics need verification
- Player wiring is still incomplete
- AI generation / Whisper integration is not yet represented as a finished Nexus flow

## Specific Local Concern

The current translate route documents `targetLanguage`, but that value should be verified end-to-end against what the adapter actually forwards and what Bazarr expects. This is a likely source of mismatch between issue text and real implementation.

## Suggested Issue Breakdown

1. Admin/provider health tools
2. Manual subtitle actions from Nexus
3. Upload/manual correction flow
4. AI generation / Whisper-backed generation
5. Preferred-language automation
6. Scoring/upgrades

## External Signal

Bazarr’s official wiki confirms relevant subtitle-oriented capabilities such as:

- general subtitle setup and synchronization-related settings
- Whisper provider setup for AI-assisted subtitle generation

References:

- https://wiki.bazarr.media/Getting-Started/Setup-Guide/
- https://wiki.bazarr.media/Additional-Configuration/Whisper-Provider/

That supports keeping AI-generation language in scope, but the issue must distinguish:

- documented Bazarr capability
- adapter-level Nexus support
- user-visible Nexus workflow support

## Advisory Takeaway

Issue `#47` should read like a capability/status issue, not a moonshot idea. The outside docs are strong enough to justify Bazarr-side capabilities such as synchronization and Whisper-backed generation being in scope, but the current Nexus code only supports part of that surface today.

## Recommended Next Research for Claude

- verify Bazarr endpoint requirements for translate/upload semantics
- map each planned player action to an explicit route/UI entry point
- rewrite `#47` with done / in-progress / remaining sections
