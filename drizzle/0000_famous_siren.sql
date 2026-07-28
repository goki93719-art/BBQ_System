CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_unique` ON `admin_users` (`username`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`reason` text DEFAULT '' NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_logs_dedupe_key_unique` ON `audit_logs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `audit_store_time_idx` ON `audit_logs` (`store_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_normalized` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` text NOT NULL,
	`resend_after` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`business_type` text NOT NULL,
	`status` text DEFAULT 'ENABLED' NOT NULL,
	`sale_periods_json` text DEFAULT '[]' NOT NULL,
	`sort_order` integer DEFAULT 10 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_store_code_uq` ON `categories` (`store_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_store_name_uq` ON `categories` (`store_id`,`name`);--> statement-breakpoint
CREATE TABLE `consumption_records` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`store_id` text NOT NULL,
	`user_id` text NOT NULL,
	`confirmed_amount_cent` integer NOT NULL,
	`status` text NOT NULL,
	`confirmed_at_utc` text NOT NULL,
	`business_date` text NOT NULL,
	`confirmed_timezone` text NOT NULL,
	`confirmed_utc_offset` text NOT NULL,
	`operator_id` text NOT NULL,
	`voided_at` text,
	`voided_by` text,
	`void_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consumption_records_order_id_unique` ON `consumption_records` (`order_id`);--> statement-breakpoint
CREATE INDEX `consumption_period_idx` ON `consumption_records` (`store_id`,`status`,`business_date`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`category_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`business_type` text NOT NULL,
	`price_cent` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`sold_out` integer DEFAULT false NOT NULL,
	`image_url` text DEFAULT '' NOT NULL,
	`attrs_json` text DEFAULT '{}' NOT NULL,
	`sale_periods_json` text DEFAULT '[]' NOT NULL,
	`sort_order` integer DEFAULT 10 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_store_sku_uq` ON `items` (`store_id`,`sku`);--> statement-breakpoint
CREATE INDEX `items_category_idx` ON `items` (`category_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`item_id` text NOT NULL,
	`sku_snapshot` text NOT NULL,
	`name_snapshot` text NOT NULL,
	`image_snapshot` text NOT NULL,
	`category_id_snapshot` text NOT NULL,
	`category_code_snapshot` text NOT NULL,
	`category_name_snapshot` text NOT NULL,
	`business_type_snapshot` text NOT NULL,
	`attrs_snapshot_json` text NOT NULL,
	`unit_price_cent` integer NOT NULL,
	`quantity` integer NOT NULL,
	`subtotal_cent` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_history_transition_uq` ON `order_status_history` (`order_id`,`to_status`);--> statement-breakpoint
CREATE INDEX `order_history_order_idx` ON `order_status_history` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`order_no` text NOT NULL,
	`user_id` text NOT NULL,
	`client_request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text NOT NULL,
	`total_cent` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`table_no` text DEFAULT '' NOT NULL,
	`submitted_at` text NOT NULL,
	`processed_at` text,
	`confirmed_by` text,
	`rejection_code` text,
	`rejection_note` text,
	`void_reason` text,
	`voided_by` text,
	`voided_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_unique` ON `orders` (`order_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_uq` ON `orders` (`store_id`,`user_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`store_id`,`status`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `quote_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`user_id` text NOT NULL,
	`client_request_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`cart_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_tokens_token_hash_unique` ON `quote_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `quote_request_idx` ON `quote_tokens` (`store_id`,`user_id`,`client_request_id`);--> statement-breakpoint
CREATE TABLE `registration_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`phone_normalized` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_tokens_token_hash_unique` ON `registration_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_subject_idx` ON `sessions` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`address` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`phone_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`nickname` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_normalized_unique` ON `users` (`phone_normalized`);