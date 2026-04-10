# Codex Advisory Finding

## Topic

Bazarr subtitle follow-through risks

## Local Evidence

- `src/routes/api/subtitles/translate/+server.ts` documents `targetLanguage`, but the route does not read or forward it.
- `src/lib/adapters/bazarr.ts` sends `action: 'translate'` plus `language`, `path`, `id`, and `mediaType`.
- `src/lib/adapters/bazarr.ts` also exposes an `uploadContent()` capability, but there is no clearly surfaced end-to-end upload route/UI in the current tree.

## External Sources

- Bazarr setup guide: https://wiki.bazarr.media/Getting-Started/Setup-Guide/
- Bazarr settings reference: https://wiki.bazarr.media/Additional-Configuration/Settings/
- Bazarr Whisper provider: https://wiki.bazarr.media/Additional-Configuration/Whisper-Provider/

## Key Risk Areas

### Translate semantics

The route documentation and adapter payload do not currently line up cleanly. Bazarr’s public docs validate that translation and Whisper-backed generation are real capability areas, but the docs are not explicit enough to settle the exact request body Nexus should send. That makes the current `targetLanguage` mismatch a real semantics risk.

### Upload flow

Nexus appears to have adapter-level upload capability without an obvious user-visible flow that exercises it. That creates a likely issue/body mismatch if upload is treated as already delivered.

## Advisory Takeaway

Issue `#47` should treat translate semantics and upload flow as explicit open gaps until the Bazarr contract and Nexus user flow are both verified end to end.

## Relevance To Nexus

This matters because subtitle tooling is already broadening, and small contract mismatches here are easy to ship accidentally if the issue body is treated as proof of completeness.
