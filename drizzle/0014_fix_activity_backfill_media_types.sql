-- Corrective migration for the 0007 activity-backfill.
--
-- 0007 mapped every `activity.type='watch'` row to media_type='movie', which
-- corrupts legacy TV episode and Invidious video watch history. We can't
-- recover precise types from the dropped `activity` table, but we CAN derive
-- a better guess from service_type:
--
--   invidious   → video
--   calibre     → book  (shouldn't appear under type='watch' but covers drift)
--   romm        → game
--   jellyfin/plex/streamystats → stays movie (honest unknown; both services
--       can contain movies OR episodes, and without joining to media metadata
--       we can't tell. User's next playback re-writes the row cleanly.)
--
-- Codex-audit followup (2026-04-17, P2). Only touches rows written by the
-- legacy-activity-backfill source; poller-written or progress-endpoint rows
-- are left alone.

UPDATE play_sessions
SET media_type = 'video'
WHERE source = 'legacy-activity-backfill'
  AND service_type = 'invidious'
  AND media_type = 'movie';
--> statement-breakpoint

UPDATE play_sessions
SET media_type = 'book'
WHERE source = 'legacy-activity-backfill'
  AND service_type = 'calibre'
  AND media_type = 'movie';
--> statement-breakpoint

UPDATE play_sessions
SET media_type = 'game'
WHERE source = 'legacy-activity-backfill'
  AND service_type = 'romm'
  AND media_type = 'movie';
