import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const stores = sqliteTable("stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  currency: text("currency").notNull().default("CNY"),
  address: text("address").notNull().default(""),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  phoneNormalized: text("phone_normalized").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nickname: text("nickname").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: text("created_at").notNull(),
}, (table) => [check("users_status_check", sql`${table.status} IN ('ACTIVE', 'DISABLED')`)]);

export const adminUsers = sqliteTable("admin_users", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("ACTIVE"),
}, (table) => [
  check("admin_role_check", sql`${table.role} IN ('MANAGER', 'OPERATOR')`),
  check("admin_status_check", sql`${table.status} IN ('ACTIVE', 'DISABLED')`),
]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("sessions_subject_idx").on(table.subjectType, table.subjectId),
  check("sessions_subject_type_check", sql`${table.subjectType} IN ('CUSTOMER', 'ADMIN')`),
]);

export const authChallenges = sqliteTable("auth_challenges", {
  id: text("id").primaryKey(),
  phoneNormalized: text("phone_normalized").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: text("expires_at").notNull(),
  resendAfter: text("resend_after").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
});

export const registrationTokens = sqliteTable("registration_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  phoneNormalized: text("phone_normalized").notNull(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  businessType: text("business_type").notNull(),
  status: text("status").notNull().default("ENABLED"),
  salePeriodsJson: text("sale_periods_json").notNull().default("[]"),
  sortOrder: integer("sort_order").notNull().default(10),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("categories_store_code_uq").on(table.storeId, table.code),
  uniqueIndex("categories_store_name_uq").on(table.storeId, table.name),
  check("categories_status_check", sql`${table.status} IN ('ENABLED', 'DISABLED')`),
]);

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  categoryId: text("category_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  businessType: text("business_type").notNull(),
  priceCent: integer("price_cent").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  soldOut: integer("sold_out", { mode: "boolean" }).notNull().default(false),
  imageUrl: text("image_url").notNull().default(""),
  attrsJson: text("attrs_json").notNull().default("{}"),
  salePeriodsJson: text("sale_periods_json").notNull().default("[]"),
  sortOrder: integer("sort_order").notNull().default(10),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("items_store_sku_uq").on(table.storeId, table.sku),
  index("items_category_idx").on(table.categoryId, table.status, table.sortOrder),
  check("items_price_check", sql`${table.priceCent} > 0`),
  check("items_status_check", sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
  check("items_sold_out_check", sql`${table.soldOut} IN (0, 1)`),
]);

export const quoteTokens = sqliteTable("quote_tokens", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  userId: text("user_id").notNull(),
  clientRequestId: text("client_request_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  cartHash: text("cart_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
}, (table) => [index("quote_request_idx").on(table.storeId, table.userId, table.clientRequestId)]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  orderNo: text("order_no").notNull().unique(),
  userId: text("user_id").notNull(),
  clientRequestId: text("client_request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull(),
  totalCent: integer("total_cent").notNull(),
  note: text("note").notNull().default(""),
  tableNo: text("table_no").notNull().default(""),
  submittedAt: text("submitted_at").notNull(),
  processedAt: text("processed_at"),
  confirmedBy: text("confirmed_by"),
  rejectionCode: text("rejection_code"),
  rejectionNote: text("rejection_note"),
  voidReason: text("void_reason"),
  voidedBy: text("voided_by"),
  voidedAt: text("voided_at"),
}, (table) => [
  uniqueIndex("orders_idempotency_uq").on(table.storeId, table.userId, table.clientRequestId),
  index("orders_status_idx").on(table.storeId, table.status, table.submittedAt),
  check("orders_total_check", sql`${table.totalCent} >= 0`),
  check("orders_status_check", sql`${table.status} IN ('PENDING_CONFIRM', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'VOIDED')`),
]);

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  itemId: text("item_id").notNull(),
  skuSnapshot: text("sku_snapshot").notNull(),
  nameSnapshot: text("name_snapshot").notNull(),
  imageSnapshot: text("image_snapshot").notNull(),
  categoryIdSnapshot: text("category_id_snapshot").notNull(),
  categoryCodeSnapshot: text("category_code_snapshot").notNull(),
  categoryNameSnapshot: text("category_name_snapshot").notNull(),
  businessTypeSnapshot: text("business_type_snapshot").notNull(),
  attrsSnapshotJson: text("attrs_snapshot_json").notNull(),
  selectionSnapshotJson: text("selection_snapshot_json").notNull().default("{}"),
  fulfillmentStatus: text("fulfillment_status").notNull().default("AVAILABLE"),
  unavailableReason: text("unavailable_reason"),
  unitPriceCent: integer("unit_price_cent").notNull(),
  quantity: integer("quantity").notNull(),
  subtotalCent: integer("subtotal_cent").notNull(),
}, (table) => [
  index("order_items_order_idx").on(table.orderId),
  index("order_items_item_status_idx").on(table.itemId, table.fulfillmentStatus),
  check("order_items_fulfillment_check", sql`${table.fulfillmentStatus} IN ('AVAILABLE', 'SOLD_OUT')`),
  check("order_items_quantity_check", sql`${table.quantity} BETWEEN 1 AND 99`),
  check("order_items_money_check", sql`${table.unitPriceCent} > 0 AND ${table.subtotalCent} > 0`),
]);

export const consumptionRecords = sqliteTable("consumption_records", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().unique(),
  storeId: text("store_id").notNull(),
  userId: text("user_id").notNull(),
  confirmedAmountCent: integer("confirmed_amount_cent").notNull(),
  status: text("status").notNull(),
  confirmedAtUtc: text("confirmed_at_utc").notNull(),
  businessDate: text("business_date").notNull(),
  confirmedTimezone: text("confirmed_timezone").notNull(),
  confirmedUtcOffset: text("confirmed_utc_offset").notNull(),
  operatorId: text("operator_id").notNull(),
  voidedAt: text("voided_at"),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason"),
}, (table) => [
  index("consumption_period_idx").on(table.storeId, table.status, table.businessDate),
  check("consumption_status_check", sql`${table.status} IN ('CONFIRMED', 'VOIDED')`),
  check("consumption_amount_check", sql`${table.confirmedAmountCent} >= 0`),
]);

export const orderStatusHistory = sqliteTable("order_status_history", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("order_history_transition_uq").on(table.orderId, table.toStatus),
  index("order_history_order_idx").on(table.orderId, table.createdAt),
  check("history_actor_type_check", sql`${table.actorType} IN ('CUSTOMER', 'ADMIN', 'SYSTEM')`),
]);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  reason: text("reason").notNull().default(""),
  dedupeKey: text("dedupe_key").notNull().unique(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("audit_store_time_idx").on(table.storeId, table.createdAt)]);
