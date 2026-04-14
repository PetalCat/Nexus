CREATE TABLE `disabled_plugins` (
	`package_name` text PRIMARY KEY NOT NULL,
	`disabled_at` text DEFAULT (datetime('now')) NOT NULL,
	`reason` text
);
--> statement-breakpoint
CREATE TABLE `user_auto_link_prefs` (
	`user_id` text NOT NULL,
	`service_id` text NOT NULL,
	`auto_link_enabled` integer DEFAULT true NOT NULL,
	`preferred_parent_service_id` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preferred_parent_service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_auto_link_prefs_unique` ON `user_auto_link_prefs` (`user_id`,`service_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_service_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`service_id` text NOT NULL,
	`external_user_id` text,
	`external_username` text,
	`access_token` text,
	`stored_password` text,
	`extra_auth` text,
	`managed` integer DEFAULT false NOT NULL,
	`auto_linked` integer DEFAULT false NOT NULL,
	`linked_via` text,
	`parent_service_id` text,
	`linked_at` text DEFAULT (datetime('now')) NOT NULL,
	`stale_since` text,
	`last_probed_at` text,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_user_service_credentials`("id", "user_id", "service_id", "external_user_id", "external_username", "access_token", "managed", "linked_via", "linked_at") SELECT "id", "user_id", "service_id", "external_user_id", "external_username", "access_token", "managed", "linked_via", "linked_at" FROM `user_service_credentials`;--> statement-breakpoint
DROP TABLE `user_service_credentials`;--> statement-breakpoint
ALTER TABLE `__new_user_service_credentials` RENAME TO `user_service_credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_service_creds_unique` ON `user_service_credentials` (`user_id`,`service_id`);--> statement-breakpoint
ALTER TABLE `services` ADD `admin_url_override` text;--> statement-breakpoint
ALTER TABLE `services` ADD `admin_cred_stale_since` text;--> statement-breakpoint
ALTER TABLE `services` ADD `admin_cred_last_probed_at` text;