-- Apr-17 data-model unification: collapse the two-feedback-stores mess.
--
-- `recommendation_feedback` was the thumbs-up/down/dismiss table bound to the
-- (now retired) thumbs UI. The up-thumb went to the canonical ratings table,
-- so before we drop the feedback table we route any down/dismiss rows into
-- `user_hidden_items` where the rest of the hide-based feedback already lives.
--
-- `recommendation_preferences` had its data folded into `user_rec_profiles`
-- in 0009; drop the empty shell here.

INSERT OR IGNORE INTO user_hidden_items (user_id, media_id, service_id, reason, created_at)
SELECT
	user_id,
	media_id,
	'',
	CASE WHEN feedback = 'down' THEN 'not_interested' ELSE 'hide' END,
	created_at
FROM recommendation_feedback
WHERE feedback IN ('down', 'dismiss');
--> statement-breakpoint
DROP TABLE IF EXISTS `recommendation_feedback`;
--> statement-breakpoint
DROP TABLE IF EXISTS `recommendation_preferences`;
