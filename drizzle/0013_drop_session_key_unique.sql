-- Drop the UNIQUE index on play_sessions.session_key.
--
-- `upsertPlaySession` uses stable per-item keys (e.g. `reader:svc:bookId:userId`,
-- `invidious:videoId:userId`) so that heartbeats during an open session can find
-- and update the same row. But when a session ends and a later play of the same
-- item starts, the code inserts a fresh row with the same session_key → the
-- global UNIQUE constraint crashes the INSERT.
--
-- Uniqueness-during-a-session is enforced by `findOpenSessionByKey` filtering
-- on `ended_at IS NULL`. Closed sessions may share session_key across time.
--
-- Codex-audit followup (2026-04-17).

DROP INDEX IF EXISTS `play_sessions_session_key_unique`;
