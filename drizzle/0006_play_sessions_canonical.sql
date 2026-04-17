-- Apr-17 data-model unification, part 1/3.
-- Add the columns `play_sessions` needs to be the canonical temporal/progress
-- truth for every media type. Specifically:
--   `position`        — engine-specific resume token (EPUB CFI, PDF page, etc.)
--   `position_ticks`  — Jellyfin-compat 100ns ticks
--
-- Also add the idx_ps_user_updated index used by Continue Watching / History
-- (both of which sort by updated_at DESC).
--
-- This migration is additive and non-destructive. The matching destructive
-- DROP TABLE activity lives in 0008 after the backfill runs in 0007.

ALTER TABLE `play_sessions` ADD COLUMN `position` text;
--> statement-breakpoint
ALTER TABLE `play_sessions` ADD COLUMN `position_ticks` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ps_user_updated` ON `play_sessions` (`user_id`,`updated_at`);
