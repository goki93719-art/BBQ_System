PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`selection_snapshot_json` text DEFAULT '{}' NOT NULL,
	`fulfillment_status` text DEFAULT 'AVAILABLE' NOT NULL,
	`unavailable_reason` text,
	`unit_price_cent` integer NOT NULL,
	`quantity` integer NOT NULL,
	`subtotal_cent` integer NOT NULL,
	CONSTRAINT "order_items_fulfillment_check" CHECK("__new_order_items"."fulfillment_status" IN ('AVAILABLE', 'SOLD_OUT')),
	CONSTRAINT "order_items_quantity_check" CHECK("__new_order_items"."quantity" BETWEEN 1 AND 99),
	CONSTRAINT "order_items_money_check" CHECK("__new_order_items"."unit_price_cent" > 0 AND "__new_order_items"."subtotal_cent" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_order_items`("id", "order_id", "item_id", "sku_snapshot", "name_snapshot", "image_snapshot", "category_id_snapshot", "category_code_snapshot", "category_name_snapshot", "business_type_snapshot", "attrs_snapshot_json", "selection_snapshot_json", "fulfillment_status", "unavailable_reason", "unit_price_cent", "quantity", "subtotal_cent") SELECT "id", "order_id", "item_id", "sku_snapshot", "name_snapshot", "image_snapshot", "category_id_snapshot", "category_code_snapshot", "category_name_snapshot", "business_type_snapshot", "attrs_snapshot_json", '{}', 'AVAILABLE', NULL, "unit_price_cent", "quantity", "subtotal_cent" FROM `order_items`;--> statement-breakpoint
DROP TABLE `order_items`;--> statement-breakpoint
ALTER TABLE `__new_order_items` RENAME TO `order_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_item_status_idx` ON `order_items` (`item_id`,`fulfillment_status`);
