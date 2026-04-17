-- Apr-17 data-model unification: fold legacy recommendation_preferences rows
-- into the canonical `user_rec_profiles.config` store (as legacy
-- `mediaTypeWeights` → new `byMediaType` field). Anything already in
-- `user_rec_profiles.config` wins — this migration only backfills users who
-- had a `recommendation_preferences` row but no `user_rec_profiles` default.
--
-- We materialize `config` as a JSON blob stitched together from defaults +
-- the user's media_type_weights. Everything else in RecProfileConfig takes
-- defaults; the user can re-tune post-migration.

INSERT INTO user_rec_profiles (id, user_id, name, is_default, config, created_at, updated_at)
SELECT
	'default:' || rp.user_id,
	rp.user_id,
	'Default',
	1,
	json_object(
		'weights', json_object(
			'contentBased', 0.35,
			'collaborative', 0.25,
			'social', 0.15,
			'trending', 0.15,
			'external', 0.10
		),
		'byMediaType', json(COALESCE(rp.media_type_weights, '{}')),
		'noveltyFactor', 0.3,
		'recencyHalfLifeDays', 30
	),
	COALESCE(rp.updated_at, strftime('%s','now') * 1000),
	COALESCE(rp.updated_at, strftime('%s','now') * 1000)
FROM recommendation_preferences rp
WHERE NOT EXISTS (
	SELECT 1 FROM user_rec_profiles urp
	WHERE urp.user_id = rp.user_id AND urp.is_default = 1
);
