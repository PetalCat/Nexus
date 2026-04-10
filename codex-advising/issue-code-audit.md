# Issue-to-Code Audit

## Goal

Compare open GitHub issues against what already exists on `main` and what appears to still be unfinished.

## Strong Mismatches Between Issue State and Code State

### `#52` Live TV support

Evidence:

- `git log` includes:
  - `155213b feat: add /live TV guide page with grid and EPG views (#52)`
- Routes exist:
  - `src/routes/live`
  - `src/routes/api/live`

Conclusion:

- This issue appears implemented enough for a close/final-pass review.

### `#40` Universal Continue

Evidence:

- `git log` includes:
  - `8485cdb feat: add getContinueWatching to Calibre, RomM, and Invidious adapters`

Conclusion:

- This issue is no longer "idea only."
- Body should reflect partial implementation and remaining coverage work.

### `#41` Cross-media franchise pages

Evidence:

- `git log` includes:
  - `46fef23 feat: add /collections browse + detail pages`
  - `299625d feat: add /person page with filmography grouped by department`
- Uncommitted/local file exists:
  - `src/lib/server/franchise.ts`

Conclusion:

- Building blocks exist, but the full cross-media franchise vision still appears unfinished.
- Issue body should distinguish current building blocks from final matching logic.

### `#42` Unified calendar

Evidence:

- `git log` includes:
  - `7449115 feat: add Upcoming Movies and Upcoming Shows rows to homepage`
  - `21d9a67 feat: add getCalendar to Invidious adapter — subscription uploads in unified calendar`
- Routes exist:
  - `src/routes/calendar`
  - `src/routes/api/calendar`

Conclusion:

- This issue is partially shipped and should say so explicitly.

### `#46` Unified quality dashboard

Evidence:

- `git log` includes:
  - `2310ac2 feat: add admin quality stats API endpoint`
  - `0a18fed feat: add quality overview panel to admin dashboard (#46)`

Conclusion:

- Dashboard aggregation has started; issue should focus on next steps, not initial existence.

### `#47` Subtitle intelligence

Evidence:

- Local/uncommitted files:
  - `src/routes/api/admin/subtitles/providers/+server.ts`
  - `src/routes/api/subtitles/+server.ts`
  - `src/routes/api/subtitles/download/+server.ts`
  - `src/routes/api/subtitles/sync/+server.ts`
  - `src/routes/api/subtitles/translate/+server.ts`
  - changes in `src/lib/adapters/bazarr.ts`

Conclusion:

- Active implementation exists, but issue body should be broken into concrete done/in-progress/remaining areas.

### `#27` Seerr

Evidence:

- Local/uncommitted changes in:
  - `src/lib/adapters/overseerr.ts`
  - `src/lib/adapters/registry.ts`
  - `src/lib/server/services.ts`
  - `src/routes/login/+page.server.ts`
  - `src/routes/media/[type]/[id]/+page.server.ts`

Conclusion:

- This is active migration work, not a blank-slate request.

## Routes and Features Already Present in the App

- `/discover`
- `/collections`
- `/person`
- `/calendar`
- `/live`

Related API route groups also exist for discovery, collections, person, calendar, live, admin subtitles, and subtitles.

## Recommended Use

Claude should use this file to avoid re-treating already shipped work as unstarted work when updating issues, roadmap notes, or planning future implementation.
