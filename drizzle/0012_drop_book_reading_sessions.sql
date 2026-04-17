-- Apr-17 data-model unification follow-up: retire `book_reading_sessions`.
--
-- `play_sessions` is the canonical progress/session store for every media
-- type, books included. Every field the old per-reader-session detail table
-- carried is either already in `play_sessions` (started_at, ended_at,
-- duration, position via CFI, media_id, user_id, service_id) or was never
-- populated by the real writer (`pages_read` was always null, the CFI
-- start/end pair was only a snapshot of `play_sessions.position` at the
-- open/close instant).
--
-- Annotations (notes, highlights, bookmarks) live in their own tables and
-- are untouched by this migration.
--
-- Reserves migration number 0012 — 0011 is the SponsorBlock drop living on
-- `fix/prefs-drift-apr17`, which hasn't been merged yet. When that branch
-- lands, these two migrations sit side-by-side at 0011/0012 without
-- colliding.

DROP TABLE IF EXISTS `book_reading_sessions`;
