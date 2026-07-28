PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "admin_role_check" CHECK("__new_admin_users"."role" IN ('MANAGER', 'OPERATOR')),
	CONSTRAINT "admin_status_check" CHECK("__new_admin_users"."status" IN ('ACTIVE', 'DISABLED'))
);
--> statement-breakpoint
INSERT INTO `__new_admin_users`("id", "store_id", "username", "password_hash", "display_name", "role", "status") SELECT "id", "store_id", "username", "password_hash", "display_name", "role", "status" FROM `admin_users`;--> statement-breakpoint
DROP TABLE `admin_users`;--> statement-breakpoint
ALTER TABLE `__new_admin_users` RENAME TO `admin_users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_unique` ON `admin_users` (`username`);--> statement-breakpoint
CREATE TABLE `__new_categories` (
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
	`updated_at` text NOT NULL,
	CONSTRAINT "categories_status_check" CHECK("__new_categories"."status" IN ('ENABLED', 'DISABLED'))
);
--> statement-breakpoint
INSERT INTO `__new_categories`("id", "store_id", "name", "code", "business_type", "status", "sale_periods_json", "sort_order", "version", "created_at", "updated_at") SELECT "id", "store_id", "name", "code", "business_type", "status", "sale_periods_json", "sort_order", "version", "created_at", "updated_at" FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_store_code_uq` ON `categories` (`store_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_store_name_uq` ON `categories` (`store_id`,`name`);--> statement-breakpoint
CREATE TABLE `__new_consumption_records` (
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
	`void_reason` text,
	CONSTRAINT "consumption_status_check" CHECK("__new_consumption_records"."status" IN ('CONFIRMED', 'VOIDED')),
	CONSTRAINT "consumption_amount_check" CHECK("__new_consumption_records"."confirmed_amount_cent" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_consumption_records`("id", "order_id", "store_id", "user_id", "confirmed_amount_cent", "status", "confirmed_at_utc", "business_date", "confirmed_timezone", "confirmed_utc_offset", "operator_id", "voided_at", "voided_by", "void_reason") SELECT "id", "order_id", "store_id", "user_id", "confirmed_amount_cent", "status", "confirmed_at_utc", "business_date", "confirmed_timezone", "confirmed_utc_offset", "operator_id", "voided_at", "voided_by", "void_reason" FROM `consumption_records`;--> statement-breakpoint
DROP TABLE `consumption_records`;--> statement-breakpoint
ALTER TABLE `__new_consumption_records` RENAME TO `consumption_records`;--> statement-breakpoint
CREATE UNIQUE INDEX `consumption_records_order_id_unique` ON `consumption_records` (`order_id`);--> statement-breakpoint
CREATE INDEX `consumption_period_idx` ON `consumption_records` (`store_id`,`status`,`business_date`);--> statement-breakpoint
CREATE TABLE `__new_items` (
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
	`updated_at` text NOT NULL,
	CONSTRAINT "items_price_check" CHECK("__new_items"."price_cent" > 0),
	CONSTRAINT "items_status_check" CHECK("__new_items"."status" IN ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "items_sold_out_check" CHECK("__new_items"."sold_out" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_items`("id", "store_id", "category_id", "sku", "name", "description", "business_type", "price_cent", "status", "sold_out", "image_url", "attrs_json", "sale_periods_json", "sort_order", "version", "created_at", "updated_at") SELECT "id", "store_id", "category_id", "sku", "name", "description", "business_type", "price_cent", "status", "sold_out", "image_url", "attrs_json", "sale_periods_json", "sort_order", "version", "created_at", "updated_at" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
CREATE UNIQUE INDEX `items_store_sku_uq` ON `items` (`store_id`,`sku`);--> statement-breakpoint
CREATE INDEX `items_category_idx` ON `items` (`category_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `__new_order_items` (
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
	`subtotal_cent` integer NOT NULL,
	CONSTRAINT "order_items_quantity_check" CHECK("__new_order_items"."quantity" BETWEEN 1 AND 99),
	CONSTRAINT "order_items_money_check" CHECK("__new_order_items"."unit_price_cent" > 0 AND "__new_order_items"."subtotal_cent" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_order_items`("id", "order_id", "item_id", "sku_snapshot", "name_snapshot", "image_snapshot", "category_id_snapshot", "category_code_snapshot", "category_name_snapshot", "business_type_snapshot", "attrs_snapshot_json", "unit_price_cent", "quantity", "subtotal_cent") SELECT "id", "order_id", "item_id", "sku_snapshot", "name_snapshot", "image_snapshot", "category_id_snapshot", "category_code_snapshot", "category_name_snapshot", "business_type_snapshot", "attrs_snapshot_json", "unit_price_cent", "quantity", "subtotal_cent" FROM `order_items`;--> statement-breakpoint
DROP TABLE `order_items`;--> statement-breakpoint
ALTER TABLE `__new_order_items` RENAME TO `order_items`;--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `__new_order_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "history_actor_type_check" CHECK("__new_order_status_history"."actor_type" IN ('CUSTOMER', 'ADMIN', 'SYSTEM'))
);
--> statement-breakpoint
INSERT INTO `__new_order_status_history`("id", "order_id", "from_status", "to_status", "actor_type", "actor_id", "reason", "created_at") SELECT "id", "order_id", "from_status", "to_status", "actor_type", "actor_id", "reason", "created_at" FROM `order_status_history`;--> statement-breakpoint
DROP TABLE `order_status_history`;--> statement-breakpoint
ALTER TABLE `__new_order_status_history` RENAME TO `order_status_history`;--> statement-breakpoint
CREATE UNIQUE INDEX `order_history_transition_uq` ON `order_status_history` (`order_id`,`to_status`);--> statement-breakpoint
CREATE INDEX `order_history_order_idx` ON `order_status_history` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_orders` (
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
	`voided_at` text,
	CONSTRAINT "orders_total_check" CHECK("__new_orders"."total_cent" >= 0),
	CONSTRAINT "orders_status_check" CHECK("__new_orders"."status" IN ('PENDING_CONFIRM', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'VOIDED'))
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "store_id", "order_no", "user_id", "client_request_id", "request_hash", "status", "total_cent", "note", "table_no", "submitted_at", "processed_at", "confirmed_by", "rejection_code", "rejection_note", "void_reason", "voided_by", "voided_at") SELECT "id", "store_id", "order_no", "user_id", "client_request_id", "request_hash", "status", "total_cent", "note", "table_no", "submitted_at", "processed_at", "confirmed_by", "rejection_code", "rejection_note", "void_reason", "voided_by", "voided_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_unique` ON `orders` (`order_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_uq` ON `orders` (`store_id`,`user_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`store_id`,`status`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "sessions_subject_type_check" CHECK("__new_sessions"."subject_type" IN ('CUSTOMER', 'ADMIN'))
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "subject_type", "subject_id", "token_hash", "expires_at", "revoked_at", "created_at") SELECT "id", "subject_type", "subject_id", "token_hash", "expires_at", "revoked_at", "created_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_subject_idx` ON `sessions` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`phone_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`nickname` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "users_status_check" CHECK("__new_users"."status" IN ('ACTIVE', 'DISABLED'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "store_id", "phone_normalized", "password_hash", "nickname", "status", "created_at") SELECT "id", "store_id", "phone_normalized", "password_hash", "nickname", "status", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_normalized_unique` ON `users` (`phone_normalized`);