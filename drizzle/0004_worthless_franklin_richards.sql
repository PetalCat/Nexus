CREATE UNIQUE INDEX `idx_collection_members_unique` ON `collection_members` (`collection_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_collection_members_user` ON `collection_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_collections_creator` ON `collections` (`creator_id`);--> statement-breakpoint
CREATE INDEX `idx_media_items_source` ON `media_items` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_media_items_type_cached` ON `media_items` (`type`,`cached_at`);--> statement-breakpoint
CREATE INDEX `idx_media_items_service` ON `media_items` (`service_id`);--> statement-breakpoint
CREATE INDEX `idx_ps_media` ON `play_sessions` (`media_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_participants_unique` ON `session_participants` (`session_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stats_rollups_unique` ON `stats_rollups` (`user_id`,`period`,`media_type`);--> statement-breakpoint
CREATE INDEX `idx_user_ratings_media` ON `user_ratings` (`media_id`,`service_id`);--> statement-breakpoint
CREATE INDEX `idx_user_service_creds_ext` ON `user_service_credentials` (`service_id`,`external_user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_service_creds_service` ON `user_service_credentials` (`service_id`);--> statement-breakpoint
CREATE INDEX `idx_watch_sessions_host` ON `watch_sessions` (`host_id`,`status`);