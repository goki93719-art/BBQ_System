import type { AppDatabase, AppPreparedStatement } from "@/db/client";
import { STORE_ID } from "@/db/runtime";
import { businessDayStartUtc } from "@/lib/rules.mjs";

type OrderRow = {
  id: string;
  submitted_at: string;
};

const AUTO_REJECTION_CODE = "DAY_EXPIRED";
const AUTO_REJECTION_REASON = "超过下单当日未确认，系统自动拒绝";
const SYSTEM_ACTOR_ID = "system-order-expiry";
const MAX_ORDERS_PER_RUN = 200;
const ORDERS_PER_BATCH = 20;

export async function rejectExpiredPendingOrders(db: AppDatabase, now = new Date()) {
  const cutoffUtc = businessDayStartUtc(now);
  const candidates = await db.prepare(
    `SELECT id, submitted_at
     FROM orders
     WHERE store_id = ? AND status = 'PENDING_CONFIRM' AND submitted_at < ?
     ORDER BY submitted_at
     LIMIT ?`,
  ).bind(STORE_ID, cutoffUtc, MAX_ORDERS_PER_RUN).all<OrderRow>();
  const processedAt = now.toISOString();
  let rejected = 0;

  for (let index = 0; index < candidates.results.length; index += ORDERS_PER_BATCH) {
    const chunk = candidates.results.slice(index, index + ORDERS_PER_BATCH);
    const statements: AppPreparedStatement[] = [];
    for (const order of chunk) {
      statements.push(
        db.prepare(
          `UPDATE orders
           SET status = 'REJECTED', processed_at = ?, rejection_code = ?, rejection_note = ?
           WHERE id = ? AND store_id = ? AND status = 'PENDING_CONFIRM' AND submitted_at < ?`,
        ).bind(processedAt, AUTO_REJECTION_CODE, AUTO_REJECTION_REASON, order.id, STORE_ID, cutoffUtc),
        db.prepare(
          `INSERT OR IGNORE INTO order_status_history
           SELECT ?, id, 'PENDING_CONFIRM', 'REJECTED', 'SYSTEM', ?, ?, ?
           FROM orders
           WHERE id = ? AND store_id = ? AND status = 'REJECTED'
             AND rejection_code = ? AND processed_at = ?`,
        ).bind(
          crypto.randomUUID(), SYSTEM_ACTOR_ID, AUTO_REJECTION_REASON, processedAt,
          order.id, STORE_ID, AUTO_REJECTION_CODE, processedAt,
        ),
        db.prepare(
          `INSERT OR IGNORE INTO audit_logs
           SELECT ?, store_id, 'SYSTEM', ?, 'ORDER_AUTO_REJECT', 'ORDER', id, ?, ?, ?, ?, ?
           FROM orders
           WHERE id = ? AND store_id = ? AND status = 'REJECTED'
             AND rejection_code = ? AND processed_at = ?`,
        ).bind(
          crypto.randomUUID(), SYSTEM_ACTOR_ID,
          JSON.stringify({ status: "PENDING_CONFIRM" }),
          JSON.stringify({ status: "REJECTED", reason_code: AUTO_REJECTION_CODE }),
          AUTO_REJECTION_REASON, `order:${order.id}:REJECTED`, processedAt,
          order.id, STORE_ID, AUTO_REJECTION_CODE, processedAt,
        ),
      );
    }
    const results = await db.batch(statements);
    for (let resultIndex = 0; resultIndex < results.length; resultIndex += 3) {
      rejected += Number(results[resultIndex]?.meta.changes ?? 0);
    }
  }

  return {
    cutoff_utc: cutoffUtc,
    examined: candidates.results.length,
    rejected,
    more_remaining: candidates.results.length === MAX_ORDERS_PER_RUN,
  };
}
