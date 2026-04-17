-- Apr-17 data-model unification, part 2/3: backfill legacy `activity` rows
-- into `play_sessions` so history/insights/resume don't lose data when
-- migration 0008 drops the table.
--
-- Parker's call (locked in 2026-04-17): orphaned rows where the source
-- service has been deleted keep `service_type='unknown'` rather than being
-- skipped. Better a row with a fuzzy service than a vanished watch.
--
-- Rows are skipped when a matching play_sessions row already exists for the
-- same (user_id, service_id, media_id) — the poller may have already
-- registered the session.
--
-- This migration is idempotent iff the `activity` table exists. If a fresh
-- install runs this after 0000 created an empty `activity`, the SELECT returns
-- zero rows and the INSERT is a no-op. That's fine.

INSERT INTO play_sessions (
	id, user_id, service_id, service_type, media_id, media_type,
	progress, position, position_ticks, completed,
	started_at, updated_at, created_at, source, duration_ms
)
SELECT
	lower(hex(randomblob(16))),
	a.user_id,
	a.service_id,
	COALESCE((SELECT type FROM services WHERE id = a.service_id), 'unknown'),
	a.media_id,
	CASE a.type
		WHEN 'read'   THEN 'book'
		WHEN 'listen' THEN 'music'
		WHEN 'play'   THEN 'game'
		ELSE 'movie'
	END,
	a.progress,
	a.position,
	a.position_ticks,
	CASE WHEN a.completed THEN 1 ELSE 0 END,
	CAST(strftime('%s', a.last_activity) AS INTEGER) * 1000,
	CAST(strftime('%s', a.last_activity) AS INTEGER) * 1000,
	CAST(strftime('%s', a.last_activity) AS INTEGER) * 1000,
	'legacy-activity-backfill',
	0
FROM activity a
WHERE a.user_id IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM play_sessions ps
		WHERE ps.user_id = a.user_id
		  AND ps.media_id = a.media_id
		  AND ps.service_id = a.service_id
	);
