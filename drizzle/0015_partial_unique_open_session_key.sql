-- Replace the dropped global-UNIQUE on session_key (migration 0013) with
-- a PARTIAL unique index that only applies to OPEN sessions (ended_at IS NULL).
--
-- 0013 removed the global constraint so repeat plays could reuse stable keys
-- like `reader:svc:bookId:userId` across successive sessions. Correct, but it
-- opened a race: two concurrent progress heartbeats for the same player both
-- miss `findOpenSessionByKey` (because the open row didn't exist yet) and
-- INSERT separate open rows with the same key. Later reads update whichever
-- SQLite returns first, splitting duration/progress across duplicates.
--
-- Partial index restores "one open row per session_key at a time" without
-- blocking closed rows from sharing the key — the narrow invariant the code
-- actually relies on.
--
-- Codex round 7 P2 followup.

CREATE UNIQUE INDEX IF NOT EXISTS `idx_play_sessions_session_key_open`
  ON `play_sessions` (`session_key`)
  WHERE `session_key` IS NOT NULL AND `ended_at` IS NULL;
