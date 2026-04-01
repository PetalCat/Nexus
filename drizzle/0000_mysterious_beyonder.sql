CREATE TABLE `activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`media_id` text NOT NULL,
	`service_id` text NOT NULL,
	`type` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`position_ticks` integer,
	`position` text,
	`completed` integer DEFAULT false NOT NULL,
	`last_activity` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `book_bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`service_id` text NOT NULL,
	`cfi` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `book_highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`service_id` text NOT NULL,
	`cfi` text NOT NULL,
	`text` text NOT NULL,
	`note` text,
	`color` text DEFAULT 'yellow',
	`chapter` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `book_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`service_id` text NOT NULL,
	`content` text NOT NULL,
	`cfi` text,
	`chapter` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `book_reading_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`service_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`start_cfi` text,
	`end_cfi` text,
	`pages_read` integer,
	`duration_seconds` integer
);
--> statement-breakpoint
CREATE TABLE `collection_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_title` text,
	`target_media_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_items` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`media_id` text NOT NULL,
	`service_id` text NOT NULL,
	`media_type` text NOT NULL,
	`media_title` text NOT NULL,
	`media_poster` text,
	`added_by` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_members` (
	`collection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`creator_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `friendships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`friend_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`friend_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `game_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`rom_id` text NOT NULL,
	`service_id` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `interaction_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`session_token` text,
	`event_type` text NOT NULL,
	`page` text,
	`target` text,
	`target_title` text,
	`referrer` text,
	`search_query` text,
	`position` text,
	`duration_ms` integer,
	`metadata` text,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invite_links` (
	`code` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`service_id` text NOT NULL,
	`service_type` text NOT NULL,
	`action_type` text NOT NULL,
	`media_id` text NOT NULL,
	`media_type` text NOT NULL,
	`media_title` text,
	`metadata` text,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`service_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`sort_title` text,
	`description` text,
	`poster` text,
	`backdrop` text,
	`year` integer,
	`rating` real,
	`genres` text,
	`studios` text,
	`duration` integer,
	`status` text,
	`metadata` text,
	`cached_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `music_liked_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`track_id` text NOT NULL,
	`service_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `music_playlist_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`track_id` text NOT NULL,
	`service_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `music_playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_collaborative` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`notification_type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text,
	`icon` text,
	`href` text,
	`actor_id` text,
	`metadata` text,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `play_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_key` text,
	`user_id` text NOT NULL,
	`service_id` text NOT NULL,
	`service_type` text NOT NULL,
	`media_id` text NOT NULL,
	`media_type` text NOT NULL,
	`media_title` text,
	`media_year` integer,
	`media_genres` text,
	`parent_id` text,
	`parent_title` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_ms` integer DEFAULT 0,
	`media_duration_ms` integer,
	`progress` real,
	`completed` integer DEFAULT 0,
	`device_name` text,
	`client_name` text,
	`metadata` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `play_sessions_session_key_unique` ON `play_sessions` (`session_key`);--> statement-breakpoint
CREATE TABLE `playback_speed_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`scope_value` text,
	`scope_name` text,
	`speed` real DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `playlist_collaborators` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reading_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_books` integer,
	`target_pages` integer,
	`period` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer
);
--> statement-breakpoint
CREATE TABLE `recommendation_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`provider` text NOT NULL,
	`media_type` text NOT NULL,
	`results` text NOT NULL,
	`computed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recommendation_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`media_title` text,
	`feedback` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recommendation_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`media_type_weights` text DEFAULT '{"movie":50,"show":50,"book":50,"game":50,"music":50,"video":50}' NOT NULL,
	`genre_preferences` text DEFAULT '{}' NOT NULL,
	`similarity_threshold` real DEFAULT 0.5 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`media_id` text,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `save_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`service_id` text NOT NULL,
	`entry_id` integer NOT NULL,
	`entry_type` text NOT NULL,
	`label` text,
	`pinned` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`api_key` text,
	`username` text,
	`password` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`type` text DEFAULT 'text' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_participants` (
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`role` text DEFAULT 'participant' NOT NULL,
	`voice_active` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shared_items` (
	`id` text PRIMARY KEY NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`service_id` text NOT NULL,
	`media_type` text NOT NULL,
	`media_title` text NOT NULL,
	`media_poster` text,
	`message` text,
	`seen` integer DEFAULT 0 NOT NULL,
	`seen_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sponsorblock_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`category_settings` text DEFAULT '{"sponsor":"skip","selfpromo":"skip","interaction":"skip","intro":"off","outro":"off","preview":"off","music_offtopic":"off","filler":"off","poi_highlight":"show","chapter":"off"}' NOT NULL,
	`show_on_timeline` integer DEFAULT true NOT NULL,
	`show_skip_notice` integer DEFAULT true NOT NULL,
	`skip_notice_duration` integer DEFAULT 3000 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsorblock_preferences_user_id_unique` ON `sponsorblock_preferences` (`user_id`);--> statement-breakpoint
CREATE TABLE `stats_rollups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`period` text NOT NULL,
	`media_type` text NOT NULL,
	`stats` text NOT NULL,
	`computed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_genre_affinity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`media_type` text NOT NULL,
	`genre` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`play_time_ms` integer,
	`completions` integer,
	`interactions` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_hidden_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`service_id` text,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_presence` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`custom_status` text,
	`ghost_mode` integer DEFAULT 0 NOT NULL,
	`current_activity` text,
	`last_seen` integer
);
--> statement-breakpoint
CREATE TABLE `user_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`service_id` text NOT NULL,
	`media_type` text NOT NULL,
	`rating` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_rec_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`config` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_service_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`service_id` text NOT NULL,
	`access_token` text,
	`external_user_id` text,
	`external_username` text,
	`linked_at` text DEFAULT (datetime('now')) NOT NULL,
	`managed` integer DEFAULT false NOT NULL,
	`linked_via` text,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_watchlist` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`service_id` text NOT NULL,
	`media_type` text NOT NULL,
	`media_title` text NOT NULL,
	`media_poster` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`auth_provider` text DEFAULT 'local' NOT NULL,
	`external_id` text,
	`avatar` text,
	`force_password_reset` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `video_sub_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`channel_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_checked_video_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watch_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`type` text NOT NULL,
	`media_id` text NOT NULL,
	`service_id` text NOT NULL,
	`media_title` text NOT NULL,
	`media_type` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`max_participants` integer DEFAULT 0 NOT NULL,
	`invited_ids` text,
	`created_at` integer NOT NULL,
	`ended_at` integer
);
