import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationsUrl = new URL("../drizzle/", import.meta.url);

function database() {
  const db = new DatabaseSync(":memory:");
  for (const filename of readdirSync(migrationsUrl).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(filename, migrationsUrl), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  db.exec(`
    INSERT INTO stores VALUES ('s1','炭火里','Asia/Shanghai','CNY','');
    INSERT INTO users VALUES ('u1','s1','13800138000','hash','顾客','ACTIVE','2026-07-28T00:00:00Z');
  `);
  return db;
}

test("generated migrations enforce critical status and money constraints", () => {
  const db = database();
  assert.throws(
    () => db.prepare("INSERT INTO categories VALUES ('bad','s1','坏品类','BAD','FOOD','UNKNOWN','[]',1,1,'now','now')").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO items VALUES ('bad','s1','cat','BAD','坏商品','','FOOD',0,'ACTIVE',0,'','{}','[]',1,1,'now','now')").run(),
    /CHECK constraint failed/,
  );
});

function insertOrder(db, id, requestId, status = "PENDING_CONFIRM", amount = 1800) {
  db.prepare(`
    INSERT INTO orders (
      id, store_id, order_no, user_id, client_request_id, request_hash,
      status, total_cent, note, table_no, submitted_at
    ) VALUES (?, 's1', ?, 'u1', ?, ?, ?, ?, '', '', '2026-07-28T00:00:00Z')
  `).run(id, `NO-${id}`, requestId, `hash-${id}`, status, amount);
}

test("idempotency is unique in store + user scope", () => {
  const db = database();
  insertOrder(db, "o1", "request-001");
  assert.throws(() => insertOrder(db, "o2", "request-001"), /UNIQUE constraint failed/);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM orders").get().count, 1);
});

test("conditional state update makes the first competing transition win", () => {
  const db = database();
  insertOrder(db, "o1", "request-001");
  const confirm = db.prepare("UPDATE orders SET status='CONFIRMED', confirmed_by='a1' WHERE id='o1' AND status='PENDING_CONFIRM'").run();
  const cancel = db.prepare("UPDATE orders SET status='CANCELLED' WHERE id='o1' AND status='PENDING_CONFIRM'").run();
  assert.equal(confirm.changes, 1);
  assert.equal(cancel.changes, 0);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id='o1'").get().status, "CONFIRMED");
});

test("confirmation transaction rolls back order state when ledger insertion fails", () => {
  const db = database();
  insertOrder(db, "o1", "request-001");
  db.prepare(`
    INSERT INTO consumption_records VALUES (
      'record-fixed','other-order','s1','u1',100,'CONFIRMED','2026-07-28T00:00:00Z',
      '2026-07-28','Asia/Shanghai','+08:00','a1',NULL,NULL,NULL
    )
  `).run();
  assert.throws(() => {
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE orders SET status='CONFIRMED' WHERE id='o1' AND status='PENDING_CONFIRM'").run();
      db.prepare(`
        INSERT INTO consumption_records VALUES (
          'record-fixed','o1','s1','u1',1800,'CONFIRMED','2026-07-28T00:00:00Z',
          '2026-07-28','Asia/Shanghai','+08:00','a1',NULL,NULL,NULL
        )
      `).run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }, /UNIQUE constraint failed/);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id='o1'").get().status, "PENDING_CONFIRM");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM consumption_records WHERE order_id='o1'").get().count, 0);
});

test("one order has one ledger record and void is excluded from statistics", () => {
  const db = database();
  insertOrder(db, "o1", "request-001", "CONFIRMED", 1800);
  db.prepare(`
    INSERT INTO consumption_records VALUES (
      'c1','o1','s1','u1',1800,'CONFIRMED','2026-07-28T00:00:00Z',
      '2026-07-28','Asia/Shanghai','+08:00','a1',NULL,NULL,NULL
    )
  `).run();
  assert.throws(() => db.prepare(`
    INSERT INTO consumption_records VALUES (
      'c2','o1','s1','u1',1800,'CONFIRMED','2026-07-28T00:00:00Z',
      '2026-07-28','Asia/Shanghai','+08:00','a1',NULL,NULL,NULL
    )
  `).run(), /UNIQUE constraint failed/);
  assert.equal(db.prepare("SELECT SUM(confirmed_amount_cent) amount FROM consumption_records WHERE status='CONFIRMED'").get().amount, 1800);
  db.exec("BEGIN");
  db.prepare("UPDATE orders SET status='VOIDED', void_reason='店长纠错作废' WHERE id='o1' AND status='CONFIRMED'").run();
  db.prepare("UPDATE consumption_records SET status='VOIDED', void_reason='店长纠错作废' WHERE order_id='o1' AND status='CONFIRMED'").run();
  db.exec("COMMIT");
  assert.equal(db.prepare("SELECT COALESCE(SUM(confirmed_amount_cent),0) amount FROM consumption_records WHERE status='CONFIRMED'").get().amount, 0);
  assert.equal(db.prepare("SELECT confirmed_amount_cent FROM consumption_records WHERE order_id='o1'").get().confirmed_amount_cent, 1800);
});
