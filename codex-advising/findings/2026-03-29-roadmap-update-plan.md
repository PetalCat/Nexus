# Codex Advisory Finding

## Topic

Roadmap and issue status drift

## Local Evidence

- `git log` includes `155213b feat: add /live TV guide page with grid and EPG views (#52)`
- `git log` includes `8485cdb feat: add getContinueWatching to Calibre, RomM, and Invidious adapters`
- `git log` includes `21d9a67 feat: add getCalendar to Invidious adapter`
- local subtitle files exist under `src/routes/api/subtitles/` and `src/lib/adapters/bazarr.ts`

## Key Mismatches

### `#52` Live TV support

The shipped route surface and commit history suggest this is much closer to done than the tracker language implies.

### `#40` Universal Continue

The feature is no longer idea-only. Multiple adapters and homepage aggregation work are already present.

### `#42` Unified Calendar

Calendar work is materially further along than a vague "in progress" description suggests.

### `#47` Subtitle Intelligence

The roadmap/issue should no longer frame this as wholly unstarted. It is better described as partially implemented with explicit remaining gaps.

## Advisory Takeaway

Roadmap and issue text should be treated as lagging documentation, not authoritative status, until they are checked against recent commits and current route surfaces.

## Relevance To Nexus

If Claude updates roadmap or issue text later, these are the first items worth reconciling because they already have visible shipped surface area.
