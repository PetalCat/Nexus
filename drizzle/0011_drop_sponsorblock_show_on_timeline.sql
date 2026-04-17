-- Apr-17 preferences drift fix (#34): drop sponsorblock_preferences.show_on_timeline.
--
-- The field was stored by the schema, had NO UI control (removed earlier this
-- cycle per the player-alignment plan), had no reader anywhere in the app, and
-- the settings page was actively writing `false` on every save. Per parker's
-- wire-or-remove discipline: no UI and no consumer → drop the column entirely.
-- See codex-review/27-preferences-consumption-drift.md bug A.

ALTER TABLE `sponsorblock_preferences` DROP COLUMN `show_on_timeline`;